// Lógica pura: sugerencias y armado del prompt (port de SuggestionEngine.swift y PromptModel.swift).
(function () {
  const C = window.PF_CATALOG;

  const FIELDS = [
    { id: "rol", title: "Rol",
      placeholder: "Eres un… (escribe «eres un» para ver sugerencias)",
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

  const FORMATS = [
    { id: "plain", name: "Texto", ext: "txt", mime: "text/plain" },
    { id: "markdown", name: "Markdown", ext: "md", mime: "text/markdown" },
    { id: "xml", name: "XML", ext: "xml", mime: "application/xml" },
  ];

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

  // ---------- Autocompletado ----------
  /** Coincidencia por prefijo primero, luego por palabras contenidas. Excluye coincidencias exactas. */
  function filter(list, query, allowEmpty) {
    const q = trimmed(folded(query));
    if (!q) return allowEmpty ? list : [];
    const words = q.split(/\s+/);
    const prefix = list.filter((x) => folded(x).startsWith(q));
    const contains = list.filter((x) => {
      const f = folded(x);
      return !f.startsWith(q) && words.every((w) => f.includes(w));
    });
    const result = prefix.concat(contains);
    if (result.some((x) => trimmed(folded(x)) === q)) return [];
    return result;
  }

  /** Devuelve { items, base } o null. El texto final será base + item. */
  function completion(field, text, domain) {
    if (field === "rol") {
      const t = roleTrigger(text);
      if (!t) return null;
      const candidates = roles(domain).map((r) => (t.feminine ? r.f : r.m));
      const matches = filter(candidates, t.partial, true);
      return matches.length ? { items: matches.slice(0, 8), base: t.base } : null;
    }
    const nl = text.lastIndexOf("\n");
    let line = text.slice(nl + 1);
    let base = text.slice(0, nl + 1);
    if (field === "restricciones") {
      const lead = (line.match(/^[ \-•*]*/) || [""])[0];
      base += lead ? lead : "- ";
      line = line.slice(lead.length);
    }
    if (trimmed(line).length < 2) return null;
    const matches = filter(items(field, domain), line, false);
    return matches.length ? { items: matches.slice(0, 6), base } : null;
  }

  // ---------- Chips / menú de sugerencias ----------
  const stripBullet = (line) => trimmed(line.replace(/^[ \-•*]*/, ""));

  function roleForm(masculine, feminine) {
    for (const d of C.all) {
      const r = d.roles.find((x) => x.m === masculine);
      if (r) return feminine ? r.f : r.m;
    }
    return masculine;
  }

  function applyChip(item, field, text, feminine) {
    switch (field) {
      case "rol": {
        const t = roleTrigger(text);
        if (t) return t.base + roleForm(item, t.feminine);
        return (feminine ? "Eres una " : "Eres un ") + roleForm(item, feminine);
      }
      case "restricciones": {
        const lines = text.split("\n").filter((l) => l.length);
        if (lines.some((l) => folded(stripBullet(l)) === folded(item))) {
          return lines.filter((l) => folded(stripBullet(l)) !== folded(item)).join("\n");
        }
        const t = text.replace(/^\n+|\n+$/g, "");
        return (t ? t + "\n" : "") + "- " + item;
      }
      default: {
        const t = trimmed(text);
        if (!t) return item;
        const sep = t.endsWith(".") || t.endsWith(":") ? " " : ". ";
        return t + sep + item;
      }
    }
  }

  function isChipActive(item, field, text) {
    const f = folded(text);
    if (field === "restricciones") return text.split("\n").some((l) => folded(stripBullet(l)) === folded(item));
    if (field === "rol") return f.includes(folded(item)) || f.includes(folded(roleForm(item, true)));
    return f.includes(trimmed(folded(item)));
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

  function assemble(values, format) {
    const filled = FIELDS.map((f) => {
      const v = trimmed(values[f.id]);
      return v ? [f, f.id === "restricciones" ? bulleted(v) : v] : null;
    }).filter(Boolean);
    switch (format) {
      case "plain":
        return filled.map(([f, v]) => (v.includes("\n") ? `${f.title}:\n${v}` : `${f.title}: ${v}`)).join("\n\n");
      case "markdown":
        return filled.map(([f, v]) => `## ${f.title}\n${v}`).join("\n\n");
      default:
        return filled.map(([f, v]) => `<${f.id}>\n${v}\n</${f.id}>`).join("\n\n");
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
    FIELDS, FORMATS, trimmed, folded,
    detectDomain, roles, items, roleTrigger, completion,
    applyChip, isChipActive, roleForm, stripBullet,
    bulleted, assemble,
    isEmptyEntry, entryTitle, entryPreview, entryMatches,
  };
})();
