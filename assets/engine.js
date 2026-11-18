// Lógica pura: predicción en línea y armado del prompt (port de SuggestionEngine.swift y PromptModel.swift).
(function () {
  const C = window.PF_CATALOG;

  const FIELDS = [
    { id: "rol", title: "Rol",
      placeholder: "Ej.: Eres un nutricionista deportivo con 10 años de experiencia",
      help: "Quién debe ser el modelo: experiencia, especialidad y perspectiva." },
    { id: "contexto", title: "Contexto",
      placeholder: "Ej.: Preparo mi primera media maratón en 12 semanas. Entreno 4 días por semana y trabajo en oficina.",
      help: "La información de fondo que el modelo necesita para entender la tarea." },
    { id: "objetivo", title: "Objetivo",
      placeholder: "Ej.: Diseña un plan de alimentación semanal que acompañe el entrenamiento.",
      help: "La tarea concreta, con verbo de acción y criterio de éxito." },
    { id: "salida", title: "Salida",
      placeholder: "Ej.: Una tabla por día con desayuno, almuerzo, cena y colaciones, más la lista de compras.",
      help: "Cómo debe verse la respuesta final." },
    { id: "restricciones", title: "Restricciones",
      placeholder: "Ej.:\n- Sin lactosa\n- Recetas de menos de 30 minutos\n- Responde en español",
      help: "Límites y reglas que el modelo no debe romper." },
  ];

  // Cada plataforma recibe la estructura que su guía oficial recomienda:
  // - Claude: etiquetas XML por tipo de contenido (docs de Anthropic, «Use XML tags»).
  // - ChatGPT: encabezados Markdown en el orden de la guía de OpenAI
  //   (rol y objetivo, instrucciones, formato de salida, contexto).
  // - Gemini: un solo tipo de delimitador; persona, restricciones y formato al inicio,
  //   el contexto después y la tarea al final (guía de prompting de Gemini).
  const FORMATS = [
    { id: "claude", name: "Claude", ext: "txt", mime: "text/plain" },
    { id: "gemini", name: "Gemini", ext: "md", mime: "text/markdown" },
    { id: "chatgpt", name: "ChatGPT", ext: "md", mime: "text/markdown" },
  ];
  // Formatos de versiones anteriores, guardados en el historial y en los ajustes.
  const LEGACY_FORMATS = { xml: "claude", markdown: "chatgpt", plain: "chatgpt" };
  const normalizeFormat = (f) => (FORMATS.some((x) => x.id === f) ? f : LEGACY_FORMATS[f] || "claude");

  const trimmed = (s) => (s || "").trim();
  /** Minúsculas y sin tildes, para comparar. */
  const folded = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function unique(list, key = (x) => x) {
    const seen = new Set();
    return list.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------- Detección de dominio ----------
  // El rol pesa más: el ámbito (y con él las predicciones de todos los campos) se ajusta según el rol.
  function detectDomain(values) {
    const weighted = [[values.rol, 3], [values.contexto, 2], [values.objetivo, 2], [values.salida, 1]];
    const scores = {};
    for (const [raw, weight] of weighted) {
      if (!raw) continue;
      const text = " " + folded(raw) + " ";
      const tokens = new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
      for (const d of C.all) {
        for (const kw of d.keywords) {
          const hit = kw.includes(" ") ? text.includes(kw) : tokens.has(kw);
          if (hit) scores[d.id] = (scores[d.id] || 0) + weight;
        }
      }
    }
    let best = null;
    for (const id in scores) if (!best || scores[id] > scores[best]) best = id;
    return best && scores[best] > 0 ? C.domain(best) : C.general;
  }

  // ---------- Listas combinadas ----------
  const roles = (domain) => unique(domain.roles.concat(C.general.roles), (r) => r.m);

  function items(field, domain) {
    const g = C.general;
    switch (field) {
      case "rol": return roles(domain).map((r) => r.m);
      case "contexto": return unique(domain.contextos.concat(g.contextos));
      case "objetivo": return unique(domain.objetivos.concat(g.objetivos));
      case "salida": return unique(domain.salidas.concat(g.salidas));
      case "restricciones": return unique(domain.restricciones.concat(g.restricciones));
    }
    return [];
  }

  // ---------- Disparador de rol ----------
  const ROLE_REGEXES = [
    /\b(?:eres|act[uú]a\s+como|s[eé]|ser[aá]s)\s+(una|un)(?:\s+([^\n,.;:]*))?$/i,
    /\b(?:asume|toma|adopta)\s+el\s+(?:rol|papel)\s+de()(?:\s+([^\n,.;:]*))?$/i,
  ];

  function roleTrigger(text) {
    for (const re of ROLE_REGEXES) {
      const m = re.exec(text);
      if (!m) continue;
      const article = (m[1] || "").toLowerCase();
      if (m[2] !== undefined) {
        const start = m.index + m[0].length - m[2].length;
        return { base: text.slice(0, start), partial: m[2], feminine: article === "una" };
      }
      return { base: text + " ", partial: "", feminine: article === "una" };
    }
    return null;
  }

  // ---------- Predicción en línea ----------
  // El campo muestra en gris, tras el cursor, el resto más probable de la palabra y de la frase.
  // Fuentes, de más a menos peso: el prompt actual, el catálogo del ámbito, el historial del
  // usuario, el resto del catálogo y el diccionario (PF_LEXICON_EXTRA y PF_LEXICON_FREQ).

  const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
  const SENTENCE_SPLIT = /[\n.;:!?¿¡()«»"]+/;
  const MAX_CHAIN = 4;

  /** Frases (listas de palabras) de un texto, cortadas en los signos de fin de oración. */
  function phrasesOf(text) {
    return (text || "").split(SENTENCE_SPLIT)
      .map((s) => s.match(WORD_RE) || [])
      .filter((ws) => ws.length);
  }

  /** Todas las frases del catálogo de un ámbito (roles incluidos como «eres un …»). */
  function catalogTexts(d) {
    const out = [].concat(d.contextos, d.objetivos, d.salidas, d.restricciones);
    d.roles.forEach((r) => { out.push("Eres un " + r.m, "Eres una " + r.f); });
    return out;
  }

  function addWord(vocab, w, score) {
    const k = folded(w);
    if (k.length < 2 || /^\d+$/.test(k)) return;
    const cur = vocab.get(k);
    if (!cur) { vocab.set(k, { w, s: score }); return; }
    cur.s += score;
    // Forma canónica: se prefiere la que empieza en minúscula (la mayúscula suele ser inicio de oración).
    if (cur.w[0] !== cur.w[0].toLowerCase() && w[0] === w[0].toLowerCase()) cur.w = w;
  }

  function addNgrams(model, text, weight) {
    for (const ws of phrasesOf(text)) {
      const f = ws.map(folded);
      ws.forEach((w) => addWord(model.vocab, w, weight * 0.5));
      for (let i = 0; i < f.length - 1; i++) {
        bump(model.bi, f[i], f[i + 1], weight);
        if (i < f.length - 2) bump(model.tri, f[i] + " " + f[i + 1], f[i + 2], weight);
      }
    }
  }

  function rowTotal(row) {
    let t = 0;
    row.forEach((c) => { t += c; });
    return t;
  }

  function bump(map, key, next, weight) {
    let m = map.get(key);
    if (!m) map.set(key, (m = new Map()));
    m.set(next, (m.get(next) || 0) + weight);
  }

  // Diccionario: índice ordenado por forma plegada, para buscar por prefijo con búsqueda binaria.
  // Se construye una sola vez. El peso baja con el logaritmo del rango de frecuencia.
  let lexIndex = null;
  function lexicon() {
    if (lexIndex) return lexIndex;
    const byKey = new Map();
    const put = (w, s) => {
      const k = folded(w);
      const cur = byKey.get(k);
      if (!cur) byKey.set(k, { k, w, s });
      else if (s > cur.s) cur.s = s;
    };
    const freq = window.PF_LEXICON_FREQ || [];
    const logN = Math.log(freq.length + 1);
    freq.forEach((w, i) => put(w, 2.5 * (1 - Math.log(i + 1) / logN)));
    (window.PF_LEXICON_EXTRA || []).forEach((w) => put(w, 1.5));
    lexIndex = [...byKey.values()].sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    return lexIndex;
  }

  /** Entradas del diccionario cuya forma plegada empieza por `q`. */
  function lexPrefix(q) {
    const idx = lexicon();
    let lo = 0, hi = idx.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (idx[mid].k < q) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let i = lo; i < idx.length && idx[i].k.startsWith(q); i++) out.push(idx[i]);
    return out;
  }

  /** Modelo de predicción para un ámbito y un historial. Se cachea desde la app. */
  function buildModel(domain, entries) {
    const model = { vocab: new Map(), bi: new Map(), tri: new Map() };
    for (const d of C.all) {
      const w = d.id === domain.id ? 6 : d.id === C.general.id ? 3 : 1;
      catalogTexts(d).forEach((t) => addNgrams(model, t, w));
    }
    (entries || []).forEach((e) => Object.values(e.values || {}).forEach((t) => addNgrams(model, t, 2)));
    return model;
  }

  /** Palabras siguientes más probables a partir de las dos últimas, con umbral de confianza. */
  function nextWords(model, extra, prev2, prev1, limit, strict) {
    const out = [];
    let a = prev2, b = prev1;
    for (let n = 0; n < limit && b; n++) {
      const next = bestNext(model, extra, a, b, strict || n > 0);
      if (!next) break;
      out.push(next);
      a = b; b = next;
    }
    return out;
  }

  function bestNext(model, extra, a, b, triOnly) {
    const pick = (maps, key, minShare) => {
      const counts = new Map();
      for (const m of maps) {
        const row = m.get(key);
        if (row) row.forEach((c, k) => counts.set(k, (counts.get(k) || 0) + c));
      }
      let best = null, bestC = 0, total = 0;
      counts.forEach((c, k) => { total += c; if (c > bestC) { best = k; bestC = c; } });
      return best && bestC / total >= minShare ? best : null;
    };
    const tri = a && pick([model.tri, extra.tri], a + " " + b, 0.34);
    return tri || (triOnly ? null : pick([model.bi, extra.bi], b, 0.4));
  }

  /** Copia el uso de mayúsculas de lo escrito por el usuario a la forma canónica. */
  function matchCase(typed, word) {
    if (typed.length > 1 && typed === typed.toUpperCase() && typed !== typed.toLowerCase()) return word.toUpperCase();
    if (typed[0] && typed[0] !== typed[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  function canonical(model, k) {
    const v = model.vocab.get(k);
    if (v) return v.w;
    const hit = lexPrefix(k)[0];
    return hit && hit.k === k ? hit.w : k;
  }
  const joinWords = (model, ks) => ks.map((k) => canonical(model, k)).join(" ");

  /** Inicio del fragmento actual: tras el último salto de línea o fin de oración. */
  function segmentStart(text) {
    const m = /[\s\S]*(?:\n|[.;:!?]\s+)/.exec(text);
    return m ? m[0].length : 0;
  }

  /** Candidatos de frase completa para el inicio de un fragmento. */
  function phraseCandidates(field, domain, feminine) {
    if (field !== "rol") return items(field, domain);
    const art = feminine ? "una" : "un";
    const rs = roles(domain).map((r) => (feminine ? r.f : r.m));
    return rs.map((r) => `Eres ${art} ${r}`).concat(rs.map((r) => `Actúa como ${art} ${r}`));
  }

  /**
   * Predicción para el texto de un campo (con el cursor al final).
   * Devuelve el texto completo propuesto (`full`), que empieza por lo ya escrito salvo tildes
   * y mayúsculas de la palabra en curso, o null. El fantasma es full.slice(text.length).
   */
  function predict(field, text, ctx) {
    const { model, domain, feminine, values } = ctx;
    const ok = (full) => (full && full.length > text.length && folded(full.slice(0, text.length)) === folded(text) ? full : null);

    // 1) Rol: tras «eres un…», «actúa como una…», «asume el rol de…».
    if (field === "rol") {
      const t = roleTrigger(text);
      if (t) {
        const q = folded(t.partial);
        const hit = roles(domain).map((r) => (t.feminine ? r.f : r.m))
          .find((r) => folded(r).startsWith(q) && folded(r) !== q);
        if (hit) { const r = ok(t.base + t.partial + hit.slice(t.partial.length)); if (r) return r; }
      }
    }

    // 2) Frase del catálogo al inicio del fragmento actual.
    let segStart = segmentStart(text);
    let seg = text.slice(segStart);
    if (field === "restricciones") {
      const lead = (seg.match(/^[ \-•*]*/) || [""])[0];
      segStart += lead.length;
      seg = seg.slice(lead.length);
    }
    const candidates = phraseCandidates(field, domain, feminine);
    const used = folded(text);
    if (!trimmed(seg)) {
      // Fragmento vacío: se propone la siguiente frase del catálogo que aún no esté escrita.
      if (seg || (field === "rol" && text)) return null; // espacios sueltos a mitad de línea
      const fresh = candidates.find((c) => !used.includes(trimmed(folded(c))));
      if (!fresh) return null;
      if (!text) return fresh;
      const bullet = field === "restricciones" && /(^|\n)$/.test(text) ? "- " : "";
      return ok(text + bullet + fresh);
    }
    if (!/^\s/.test(seg)) {
      const q = folded(seg);
      const hit = candidates.find((c) => folded(c).startsWith(q) && trimmed(folded(c)) !== trimmed(q));
      if (hit) {
        const r = ok(text.slice(0, segStart) + seg[0] + hit.slice(1));
        if (r) return r;
      }
    }

    // 3) Palabra en curso (≥ 2 letras) o palabra siguiente, con el contexto del prompt actual.
    const extra = { vocab: new Map(), bi: new Map(), tri: new Map() };
    for (const k in values || {}) {
      const v = k === field ? text.replace(/[\p{L}\p{N}]+$/u, "") : values[k];
      addNgrams(extra, v, 4);
    }
    const segWords = (text.slice(segmentStart(text)).match(WORD_RE) || []).map(folded);
    const endsInWord = /[\p{L}\p{N}]$/u.test(text);

    if (endsInWord) {
      const partial = text.match(/[\p{L}\p{N}]+$/u)[0];
      if (partial.length < 2) return null;
      const q = folded(partial);
      const prev1 = segWords[segWords.length - 2] || null;
      const prev2 = segWords[segWords.length - 3] || null;
      let best = null, bestS = 0;
      const consider = (k, s) => {
        if (k.length < q.length || !k.startsWith(q)) return;
        let score = s;
        if (prev1) {
          const row = model.bi.get(prev1);
          const bi = (row && row.get(k)) || 0;
          const tri = prev2 ? (model.tri.get(prev2 + " " + prev1) || new Map()).get(k) || 0 : 0;
          score += bi * 3 + tri * 5;
          // Palabra ya completa: solo compite si una frase conocida la predice (para seguir con la siguiente).
          if (k === q && !tri && !(bi && bi / rowTotal(row) >= 0.5)) return;
        } else if (k === q) return;
        if (score > bestS) { best = k; bestS = score; }
      };
      // Puntaje = diccionario + catálogo/historial + prompt actual (+ n-gramas en consider()).
      const total = new Map();
      const forms = new Map();
      const add = (k, w, sc) => {
        if (!k.startsWith(q)) return;
        total.set(k, (total.get(k) || 0) + sc);
        if (!forms.has(k) || w[0] === w[0].toLowerCase()) forms.set(k, w);
      };
      lexPrefix(q).forEach((e) => add(e.k, e.w, e.s));
      model.vocab.forEach((v, k) => add(k, v.w, v.s));
      extra.vocab.forEach((v, k) => add(k, v.w, v.s));
      total.forEach((sc, k) => consider(k, sc));
      if (!best) return null;
      // Si lo escrito ya es una palabra, no vale la pena proponer solo su plural.
      if (total.has(q) && (best === q + "s" || best === q + "es")) return null;
      const word = forms.get(best);
      const chain = nextWords(model, extra, prev1, best, MAX_CHAIN, !!prev1);
      const tail = chain.length ? " " + joinWords(model, chain) : "";
      if (best === q && !tail) return null;
      return ok(text.slice(0, text.length - partial.length) + matchCase(partial, word) + tail);
    }

    if (/[ \t]$/.test(text) && segWords.length) {
      const prev1 = segWords[segWords.length - 1];
      const prev2 = segWords[segWords.length - 2] || null;
      const chain = nextWords(model, extra, prev2, prev1, MAX_CHAIN);
      return chain.length ? ok(text + joinWords(model, chain)) : null;
    }
    return null;
  }

  /** Acepta solo la palabra siguiente del fantasma. */
  function acceptWord(text, full) {
    const ghost = full.slice(text.length);
    const m = ghost.match(/^[^\p{L}\p{N}]*[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*[^\p{L}\p{N}\s]*\s?/u);
    return full.slice(0, text.length + (m ? m[0].length : ghost.length));
  }

  // ---------- Utilidades de roles ----------
  function roleForm(masculine, feminine) {
    for (const d of C.all) {
      const r = d.roles.find((x) => x.m === masculine);
      if (r) return feminine ? r.f : r.m;
    }
    return masculine;
  }

  // ---------- Armado ----------
  function bulleted(text) {
    // Una ecuación en bloque ($$…$$ en varias líneas) queda entera en una sola viñeta.
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => "$$ " + m.trim().replace(/\s*\n\s*/g, " ") + " $$");
    return text.split("\n").filter((l) => l.length)
      .map((line) => {
        let s = line.replace(/^[ \t]*/, "");
        if (s && "-•*".includes(s[0])) s = s.slice(1);
        return "- " + trimmed(s);
      })
      .filter((l) => l !== "- ")
      .join("\n");
  }

  /** Une secciones [título, texto] omitiendo las vacías. */
  const sections = (list, render) => list.filter(([, v]) => v).map(([t, v]) => render(t, v)).join("\n\n");

  function assemble(values, format) {
    const v = {};
    FIELDS.forEach((f) => {
      const t = trimmed(values[f.id]);
      v[f.id] = t && f.id === "restricciones" ? bulleted(t) : t;
    });
    switch (normalizeFormat(format)) {
      case "chatgpt": {
        const rolObjetivo = [v.rol, v.objetivo].filter(Boolean).join("\n\n");
        return sections([
          ["Rol y objetivo", rolObjetivo],
          ["Instrucciones", v.restricciones],
          ["Formato de salida", v.salida],
          ["Contexto", v.contexto],
        ], (t, x) => `# ${t}\n${x}`);
      }
      case "gemini":
        return sections([
          ["Persona", v.rol],
          ["Restricciones", v.restricciones],
          ["Formato de respuesta", v.salida],
          ["Contexto", v.contexto],
          ["Tarea", v.objetivo],
        ], (t, x) => `## ${t}\n${x}`);
      default:
        return sections([
          ["rol", v.rol],
          ["contexto", v.contexto],
          ["objetivo", v.objetivo],
          ["formato_de_salida", v.salida],
          ["restricciones", v.restricciones],
        ], (t, x) => `<${t}>\n${x}\n</${t}>`);
    }
  }

  // ---------- Entradas del historial ----------
  const entryText = (e, f) => (e.values && e.values[f]) || "";
  const isEmptyEntry = (e) => FIELDS.every((f) => !trimmed(entryText(e, f.id)));

  function entryTitle(e) {
    for (const f of ["objetivo", "contexto", "rol"]) {
      const line = trimmed(entryText(e, f)).split("\n")[0];
      if (line) return line;
    }
    return "Prompt nuevo";
  }

  function entryPreview(e) {
    const t = entryTitle(e);
    for (const f of FIELDS) {
      const v = trimmed(entryText(e, f.id)).replace(/\n/g, " ");
      if (v && !t.startsWith(v) && !v.startsWith(t)) return v;
    }
    return "";
  }

  function entryMatches(e, query) {
    const q = trimmed(folded(query));
    return !q || Object.values(e.values || {}).some((v) => folded(v).includes(q));
  }

  window.PF = {
    FIELDS, FORMATS, normalizeFormat, trimmed, folded,
    detectDomain, roles, items, roleTrigger, roleForm,
    buildModel, predict, acceptWord,
    bulleted, assemble,
    isEmptyEntry, entryTitle, entryPreview, entryMatches,
  };
})();
