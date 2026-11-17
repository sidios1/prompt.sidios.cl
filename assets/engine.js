// Lógica pura: predicción en línea y armado del prompt (port de SuggestionEngine.swift y PromptModel.swift).
(function () {
  const C = window.PF_CATALOG;

  const FIELDS = [
    { id: "rol", title: "Rol",
      placeholder: "Eres un…",
      help: "Quién debe ser el modelo: experiencia, especialidad y perspectiva." },
    { id: "contexto", title: "Contexto",
      placeholder: "Situación, proyecto, audiencia, datos relevantes…",
      help: "La información de fondo que el modelo necesita para entender la tarea." },
    { id: "objetivo", title: "Objetivo",
      placeholder: "Qué debe lograr el modelo…",
      help: "La tarea concreta, con verbo de acción y criterio de éxito." },
    { id: "salida", title: "Salida",
      placeholder: "Formato, extensión y estructura de la respuesta…",
      help: "Cómo debe verse la respuesta final." },
    { id: "restricciones", title: "Restricciones",
      placeholder: "- Una regla por línea…",
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
  function detectDomain(values) {
    const weighted = [[values.contexto, 2], [values.objetivo, 2], [values.rol, 1], [values.salida, 1]];
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
  // usuario, el resto del catálogo y el diccionario base (PF_LEXICON).

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

  function bump(map, key, next, weight) {
    let m = map.get(key);
    if (!m) map.set(key, (m = new Map()));
    m.set(next, (m.get(next) || 0) + weight);
  }

  /** Modelo de predicción para un ámbito y un historial. Se cachea desde la app. */
  function buildModel(domain, entries) {
    const model = { vocab: new Map(), bi: new Map(), tri: new Map() };
    const lex = window.PF_LEXICON || [];
    lex.forEach((w, i) => addWord(model.vocab, w, 1 + 2 * (1 - i / lex.length)));
    for (const d of C.all) {
      const w = d.id === domain.id ? 6 : d.id === C.general.id ? 3 : 1;
      catalogTexts(d).forEach((t) => addNgrams(model, t, w));
    }
    (entries || []).forEach((e) => Object.values(e.values || {}).forEach((t) => addNgrams(model, t, 2)));
    return model;
  }

  /** Palabras siguientes más probables a partir de las dos últimas, con umbral de confianza. */
  function nextWords(model, extra, prev2, prev1, limit) {
    const out = [];
    let a = prev2, b = prev1;
    for (let n = 0; n < limit && b; n++) {
      const next = bestNext(model, extra, a, b);
      if (!next) break;
      out.push(next);
      a = b; b = next;
    }
    return out;
  }

  function bestNext(model, extra, a, b) {
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
    return (a && pick([model.tri, extra.tri], a + " " + b, 0.34)) || pick([model.bi, extra.bi], b, 0.4);
  }

  /** Copia el uso de mayúsculas de lo escrito por el usuario a la forma canónica. */
  function matchCase(typed, word) {
    if (typed.length > 1 && typed === typed.toUpperCase() && typed !== typed.toLowerCase()) return word.toUpperCase();
    if (typed[0] && typed[0] !== typed[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  const canonical = (model, k) => (model.vocab.get(k) || { w: k }).w;
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
    for (const k in values || {}) addNgrams(extra, values[k], 4);
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
        if (k.length <= q.length || !k.startsWith(q)) return;
        let score = s;
        if (prev1) {
          const bi = (model.bi.get(prev1) || new Map()).get(k) || 0;
          const tri = prev2 ? (model.tri.get(prev2 + " " + prev1) || new Map()).get(k) || 0 : 0;
          score += bi * 3 + tri * 5;
        }
        if (score > bestS) { best = k; bestS = score; }
      };
      model.vocab.forEach((v, k) => consider(k, v.s + ((extra.vocab.get(k) || { s: 0 }).s)));
      extra.vocab.forEach((v, k) => { if (!model.vocab.has(k)) consider(k, v.s); });
      if (!best) return null;
      const word = (model.vocab.get(best) || extra.vocab.get(best)).w;
      const chain = nextWords(model, extra, prev1, best, MAX_CHAIN);
      const tail = chain.length ? " " + joinWords(model, chain) : "";
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
