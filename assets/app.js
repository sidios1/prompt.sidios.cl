// PromptForge web — estado, historial y UI.
(function () {
  const P = window.PF;
  const C = window.PF_CATALOG;
  const $ = (id) => document.getElementById(id);
  const track = (name, params) => { if (window.pfTrack) window.pfTrack(name, params); };

  const KEY_HISTORY = "promptforge.history.v1";
  const KEY_SETTINGS = "promptforge.settings.v1";
  const KEY_SELECTED = "promptforge.selected.v1";

  // ---------- Utilidades ----------
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children || [])) if (c != null) n.append(c);
    return n;
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const readJSON = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  // ---------- Estado ----------
  const settings = Object.assign({ format: "claude", feminine: false, spell: true, theme: "system", tipSeen: false }, readJSON(KEY_SETTINGS, {}));
  const announce = (msg) => { const a = $("announcer"); if (!a) return; a.textContent = ""; setTimeout(() => { a.textContent = msg; }, 50); };

  // ---------- Tema ----------
  // "system" sigue al sistema operativo hasta que se pulsa el botón; desde ahí queda fijo en
  // "light" o "dark". index.html aplica el tema guardado antes de pintar.
  const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => settings.theme === "dark" || (settings.theme !== "light" && darkMQ.matches);
  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === "light" || settings.theme === "dark") root.setAttribute("data-theme", settings.theme);
    else root.removeAttribute("data-theme");
    const dark = isDark();
    root.classList.toggle("is-dark", dark);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (settings.theme === "system") m.setAttribute("content", m.media.includes("dark") ? "#000000" : "#ffffff");
      else m.setAttribute("content", dark ? "#000000" : "#ffffff");
    });
    const btn = document.getElementById("btn-theme");
    if (btn) {
      const label = dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
      btn.setAttribute("aria-label", label);
      btn.title = label;
    }
    const sel = document.getElementById("set-theme");
    if (sel) sel.value = settings.theme;
  }
  function toggleTheme() {
    settings.theme = isDark() ? "light" : "dark";
    writeJSON(KEY_SETTINGS, settings);
    applyTheme();
    track("cambiar_tema", { tema: settings.theme });
  }
  darkMQ.addEventListener("change", () => { if (settings.theme === "system") applyTheme(); });
  applyTheme();
  let entries = (readJSON(KEY_HISTORY, []) || []).filter((e) => e && e.id && e.values);
  // Los formatos antiguos (Texto, Markdown, XML) pasan a la plataforma equivalente.
  settings.format = P.normalizeFormat(settings.format);
  entries.forEach((e) => { e.format = P.normalizeFormat(e.format); });
  let selectedId = null;
  let search = "";
  let saveTimer = null;

  const newEntry = () => ({ id: uid(), created: Date.now(), modified: Date.now(), values: {}, format: settings.format, domainOverride: null });
  const current = () => entries.find((e) => e.id === selectedId);
  const sorted = () => entries.slice().sort((a, b) => b.modified - a.modified);
  const activeDomain = (e) => (e.domainOverride && C.domain(e.domainOverride)) || P.detectDomain(e.values);
  const filledCount = (e) => P.FIELDS.filter((f) => P.trimmed(e.values[f.id])).length;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    writeJSON(KEY_HISTORY, entries.filter((e) => !P.isEmptyEntry(e)));
    model = null;
    writeJSON(KEY_SELECTED, selectedId);
  }
  window.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

  // ---------- Historial ----------
  function discardSelectedIfEmpty() {
    const cur = current();
    if (cur && P.isEmptyEntry(cur) && entries.length > 1) entries = entries.filter((e) => e.id !== cur.id);
  }

  function select(id, focusField) {
    if (!id || id === selectedId || !entries.some((e) => e.id === id)) return;
    discardSelectedIfEmpty();
    selectedId = id;
    renderFields();
    refresh();
    closeDrawer();
    scheduleSave();
    if (focusField) focusTextarea(focusField);
  }

  function newPrompt() {
    const cur = current();
    if (cur && P.isEmptyEntry(cur)) { focusTextarea("rol"); return; }
    const e = newEntry();
    entries.push(e);
    select(e.id, "rol");
    track("nuevo_prompt");
  }

  function duplicate(id) {
    const src = entries.find((e) => e.id === id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    Object.assign(copy, { id: uid(), created: Date.now(), modified: Date.now() });
    entries.push(copy);
    select(copy.id);
  }

  function remove(id) {
    const removed = entries.find((e) => e.id === id);
    if (!removed) return;
    const wasSelected = id === selectedId;
    entries = entries.filter((e) => e.id !== id);
    if (wasSelected) {
      selectedId = null;
      const next = sorted()[0];
      if (next) select(next.id); else { const e = newEntry(); entries.push(e); select(e.id); }
    } else refresh();
    scheduleSave();
    toast("Prompt eliminado", "Deshacer", () => {
      entries.push(removed);
      select(removed.id);
    });
  }

  function groups() {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86400000;
    const buckets = [
      ["Hoy", (t) => t >= startToday],
      ["Ayer", (t) => t >= startToday - day],
      ["Últimos 7 días", (t) => t > now.getTime() - 7 * day],
      ["Últimos 30 días", (t) => t > now.getTime() - 30 * day],
      ["Anteriores", () => true],
    ];
    let remaining = sorted().filter((e) => P.entryMatches(e, search) && (!search || !P.isEmptyEntry(e)));
    const out = [];
    for (const [title, test] of buckets) {
      const hits = remaining.filter((e) => test(e.modified));
      remaining = remaining.filter((e) => !test(e.modified));
      if (hits.length) out.push([title, hits]);
    }
    return out;
  }

  function dateText(t) {
    const d = new Date(t);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  function renderHistory() {
    const list = $("history-list");
    list.replaceChildren();
    const gs = groups();
    if (!gs.length) {
      list.append(el("div", { class: "history-empty", text: search ? `Sin resultados para «${search}».` : "Aún no hay prompts." }));
      return;
    }
    for (const [title, items] of gs) {
      list.append(el("div", { class: "hgroup", text: title }));
      for (const e of items) {
        const preview = P.entryPreview(e);
        const title = P.entryTitle(e);
        list.append(el("div", { class: "hitem" + (e.id === selectedId ? " active" : "") }, [
          el("button", {
            type: "button", class: "hitem-main",
            "aria-current": e.id === selectedId ? "true" : null,
            onclick: () => select(e.id),
            onkeydown: (ev) => { if (ev.key === "Delete") { ev.preventDefault(); remove(e.id); } },
          }, [
            el("span", { class: "hitem-title", text: title }),
            el("span", { class: "hitem-sub" }, [
              el("span", { class: "d", text: dateText(e.modified) }),
              el("span", { class: "p", text: preview || "Sin más texto" }),
            ]),
          ]),
          el("div", { class: "hitem-actions" }, [
            el("button", { type: "button", class: "icon-btn", title: "Duplicar", "aria-label": `Duplicar «${title}»`, text: "⧉",
              onclick: (ev) => { ev.stopPropagation(); duplicate(e.id); } }),
            el("button", { type: "button", class: "icon-btn", title: "Eliminar", "aria-label": `Eliminar «${title}»`, text: "×",
              onclick: (ev) => { ev.stopPropagation(); remove(e.id); } }),
          ]),
        ]));
      }
    }
  }

  // ---------- Campos ----------
  const fieldRefs = {};

  function renderFields() {
    clearGhost();
    const host = $("fields");
    host.replaceChildren();
    const e = current();
    P.FIELDS.forEach((f, i) => {
      const ta = el("textarea", {
        id: "f-" + f.id, rows: f.id === "rol" ? "1" : "3",
        placeholder: f.placeholder, spellcheck: settings.spell ? "true" : "false", lang: "es",
        "aria-describedby": "h-" + f.id, autocomplete: "off", "aria-autocomplete": "inline",
      });
      ta.value = e.values[f.id] || "";
      ta.addEventListener("input", () => onInput(f.id));
      ta.addEventListener("keydown", (ev) => onFieldKey(f.id, ev));
      ta.addEventListener("blur", () => { if (ghost && ghost.field === f.id) clearGhost(); });
      ta.addEventListener("focus", () => updateGhost(f.id));
      ta.addEventListener("click", () => updateGhost(f.id));
      ta.addEventListener("scroll", () => { layer.scrollTop = ta.scrollTop; });

      // Capa con el texto fantasma: replica el texto del campo (invisible) y añade la predicción en gris.
      const layer = el("div", { class: "ghost", "aria-hidden": "true" });
      const accept = el("button", {
        type: "button", class: "ghost-accept", text: "Completar", hidden: true, tabindex: "-1",
        onmousedown: (ev) => ev.preventDefault(),
        onclick: () => acceptGhost(f.id, false),
      });
      const tip = el("span", { class: "ghost-tip", "aria-hidden": "true", hidden: true }, [el("kbd", { text: "Tab" }), " completa"]);
      // Botón ∑ en la esquina inferior derecha de la caja: abre el editor de ecuaciones (también Alt+M).
      const mathBtn = f.id === "rol" || !window.PF_MATH ? null : el("button", {
        type: "button", class: "field-tool", text: "∑",
        title: "Insertar ecuación (Alt+M)", "aria-label": `Insertar ecuación en «${f.title}»`,
        "aria-keyshortcuts": "Alt+M",
        onmousedown: (ev) => ev.preventDefault(), // conserva el cursor del campo
        onpointerenter: () => window.PF_MATH.preload(),
        onfocus: () => window.PF_MATH.preload(),
        onclick: () => editMath(f.id),
      });
      const wrap = el("div", { class: "input-wrap" + (mathBtn ? " has-tool" : "") }, [ta, layer, accept, tip, mathBtn]);
      if (mathBtn) ta.addEventListener("focus", () => { lastMathField = f.id; });
      host.append(el("div", { class: "field", id: "field-" + f.id }, [
        el("div", { class: "field-head" }, [
          el("label", { for: "f-" + f.id }, [
            el("span", { class: "field-title", text: f.title }),
          ]),
        ]),
        el("p", { class: "field-help", id: "h-" + f.id, text: f.help }),
        wrap,
      ]));
      fieldRefs[f.id] = { ta, wrap, layer, accept, tip };
    });
    requestAnimationFrame(() => P.FIELDS.forEach((f) => autosize(f.id)));
  }

  // En escritorio la app cabe en una pantalla: las cajas se estiran por CSS y no se autoajustan.
  const fitMQ = window.matchMedia("(min-width: 835px) and (min-height: 600px)");
  function syncFitLayout() {
    document.documentElement.classList.toggle("fit-layout", fitMQ.matches);
    P.FIELDS.forEach((f) => autosize(f.id));
  }
  fitMQ.addEventListener("change", syncFitLayout);
  document.documentElement.classList.toggle("fit-layout", fitMQ.matches);

  function autosize(field) {
    const ta = fieldRefs[field] && fieldRefs[field].ta;
    if (!ta) return;
    if (fitMQ.matches) { ta.style.height = ""; ta.style.overflowY = ""; return; }
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 26;
    const max = lh * (field === "rol" ? 3 : 10) + 26;
    ta.style.height = "auto";
    const layer = fieldRefs[field].layer;
    const content = Math.max(ta.scrollHeight, ghost && ghost.field === field ? layer.scrollHeight : 0);
    const h = Math.min(content + 2, max);
    ta.style.height = h + "px";
    ta.style.overflowY = ta.scrollHeight + 2 > max ? "auto" : "hidden";
  }

  function focusTextarea(field) {
    const ta = fieldRefs[field] && fieldRefs[field].ta;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function onInput(field) {
    const e = current();
    const v = fieldRefs[field].ta.value;
    if ((e.values[field] || "") === v) return;
    e.values[field] = v;
    e.modified = Date.now();
    autosize(field);
    scheduleSave();
    refresh();
    dismissed = null;
    updateGhost(field);
  }

  /** Cambio programático (predicción aceptada): actualiza el campo y deja el cursor al final. */
  function setValue(field, value) {
    const ta = fieldRefs[field].ta;
    ta.value = value;
    focusTextarea(field);
    onInput(field);
  }

  // ---------- Ecuaciones ----------
  let lastMathField = "contexto"; // campo donde abre Alt+M si el foco no está en uno con ecuaciones
  function mathShortcut() {
    if (!window.PF_MATH || document.querySelector("dialog[open]")) return;
    const id = document.activeElement && document.activeElement.id;
    const field = id && id.startsWith("f-") && id !== "f-rol" ? id.slice(2) : lastMathField;
    if (fieldRefs[field]) editMath(field);
  }

  // Abre el editor visual; si el cursor está dentro de una fórmula $…$ / $$…$$, la edita y la reemplaza.
  async function editMath(field) {
    const M = window.PF_MATH;
    const ta = fieldRefs[field].ta;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const hit = M.findAt(ta.value, start);
    clearGhost();
    const res = await M.open(hit ? { latex: hit.latex, display: hit.display } : { display: true });
    if (!fieldRefs[field] || fieldRefs[field].ta !== ta) return; // se cambió de prompt mientras tanto
    if (!res) { ta.focus(); ta.setSelectionRange(start, end); return; }
    const a = hit ? hit.start : start, b = hit ? hit.end : end;
    const before = ta.value.slice(0, a), after = ta.value.slice(b);
    let code = M.wrap(res.latex, res.display);
    if (res.display) {
      if (before && !before.endsWith("\n")) code = "\n" + code;
      if (after && !after.startsWith("\n")) code += "\n";
    } else {
      if (before && !/\s$/.test(before)) code = " " + code;
      if (after && !/^[\s.,;:!?)]/.test(after)) code += " ";
    }
    ta.value = before + code + after;
    const caret = before.length + code.length;
    ta.focus();
    ta.setSelectionRange(caret, caret);
    onInput(field);
    announce(hit ? "Ecuación actualizada" : "Ecuación insertada");
    track("insertar_ecuacion", { campo: field, modo: res.display ? "bloque" : "en_linea", edicion: !!hit });
  }

  // ---------- Predicción en línea (texto fantasma) ----------
  // Tab acepta toda la predicción, → solo la palabra siguiente y Esc la descarta hasta la próxima tecla.
  let ghost = null;      // { field, full }
  let dismissed = null;  // campo cuya predicción se descartó con Esc
  let model = null;      // modelo cacheado; se invalida al guardar el historial o cambiar de ámbito
  let modelKey = "";

  function predictionModel(domain) {
    const key = domain.id + "|" + selectedId;
    if (!model || key !== modelKey) {
      model = P.buildModel(domain, entries.filter((e) => e.id !== selectedId));
      modelKey = key;
    }
    return model;
  }

  // La capa replica la caja de texto del campo: misma tipografía, márgenes y ancho útil.
  const MIRRORED = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform",
    "wordSpacing", "textIndent", "paddingTop", "paddingLeft", "paddingBottom", "borderTopWidth", "borderLeftWidth",
    "borderBottomWidth", "borderRightWidth", "borderRadius", "tabSize"];

  function syncLayer(ta, layer) {
    const cs = getComputedStyle(ta);
    for (const p of MIRRORED) layer.style[p] = cs[p];
    // Si la caja muestra barra de desplazamiento, el ancho útil es menor: se descuenta en el margen derecho.
    const bar = ta.offsetWidth - ta.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    layer.style.paddingRight = parseFloat(cs.paddingRight) + Math.max(0, bar) + "px";
    layer.style.top = ta.offsetTop + "px";
    layer.style.left = ta.offsetLeft + "px";
    layer.style.width = ta.offsetWidth + "px";
    layer.style.height = ta.offsetHeight + "px";
  }

  function updateGhost(field) {
    const refs = fieldRefs[field];
    if (!refs) return;
    const { ta } = refs;
    const atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
    if (document.activeElement !== ta || !atEnd || dismissed === field) { clearGhost(); return; }
    const e = current();
    const domain = activeDomain(e);
    const full = P.predict(field, ta.value, { model: predictionModel(domain), domain, feminine: settings.feminine, values: e.values });
    if (!full) { clearGhost(); return; }
    if (ghost && ghost.field !== field) clearGhost();
    if (!ghost) announce(isTouch() ? "Predicción disponible. Usa Completar para aceptarla." : "Predicción disponible. Tab para aceptarla, Escape para descartarla.");
    ghost = { field, full };
    const { layer, wrap, accept } = refs;
    syncLayer(ta, layer);
    layer.replaceChildren(
      el("span", { class: "ghost-typed", text: ta.value }),
      el("span", { class: "ghost-hint", text: full.slice(ta.value.length) }),
    );
    wrap.classList.add("has-ghost");
    accept.hidden = !isTouch();
    refs.tip.hidden = isTouch() || settings.tipSeen;
    autosize(field);
    syncLayer(ta, layer);
    layer.scrollTop = ta.scrollTop;
  }

  function clearGhost() {
    if (!ghost) return;
    const refs = fieldRefs[ghost.field];
    const field = ghost.field;
    ghost = null;
    if (!refs) return;
    refs.layer.replaceChildren();
    refs.wrap.classList.remove("has-ghost");
    refs.accept.hidden = true;
    refs.tip.hidden = true;
    autosize(field);
  }

  function acceptGhost(field, wordOnly) {
    if (!ghost || ghost.field !== field) return false;
    const text = fieldRefs[field].ta.value;
    setValue(field, wordOnly ? P.acceptWord(text, ghost.full) : ghost.full);
    if (!settings.tipSeen) { settings.tipSeen = true; writeJSON(KEY_SETTINGS, settings); }
    track("aceptar_prediccion", { campo: field, modo: wordOnly ? "palabra" : "completa" });
    return true;
  }

  function onFieldKey(field, ev) {
    if (!ghost || ghost.field !== field || ev.isComposing) return;
    const mods = ev.metaKey || ev.ctrlKey || ev.altKey;
    if (ev.key === "Tab" && !ev.shiftKey && !mods) { ev.preventDefault(); acceptGhost(field, false); }
    else if (ev.key === "ArrowRight" && !ev.shiftKey && !mods) { ev.preventDefault(); acceptGhost(field, true); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); dismissed = field; clearGhost(); }
  }

  window.addEventListener("resize", () => { if (ghost) updateGhost(ghost.field); });

  // ---------- Ámbito ----------
  function initDomainSelect() {
    const sel = $("domain");
    sel.append(el("option", { value: "", text: "Automático" }));
    const og = el("optgroup", { label: "Ámbitos" });
    C.all.forEach((d) => og.append(el("option", { value: d.id, text: d.name })));
    sel.append(og);
    sel.addEventListener("change", () => {
      const e = current();
      e.domainOverride = sel.value || null;
      model = null;
      scheduleSave();
      refresh();
    });
  }

  // ---------- Formatos ----------
  function initFormats() {
    const host = $("formats");
    const choose = (id) => { current().format = id; scheduleSave(); refresh(); };
    P.FORMATS.forEach((f) => host.append(el("button", {
      type: "button", role: "radio", "data-format": f.id, text: f.name,
      onclick: () => choose(f.id),
    })));
    // Grupo de radio: una sola parada de Tab; las flechas cambian la opción.
    host.addEventListener("keydown", (ev) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (!step) return;
      ev.preventDefault();
      const ids = P.FORMATS.map((f) => f.id);
      const next = ids[(ids.indexOf(current().format) + step + ids.length) % ids.length];
      choose(next);
      host.querySelector(`[data-format="${next}"]`).focus();
    });
    const setSel = $("set-format");
    P.FORMATS.forEach((f) => setSel.append(el("option", { value: f.id, text: f.name })));
  }

  // ---------- Placeholders según el ámbito ----------
  // Cada ámbito trae un ejemplo coherente; cambia al elegir otro ámbito o al detectarse uno.
  function placeholderFor(field, domain) {
    const ex = domain.ejemplo || C.general.ejemplo;
    if (field === "rol") return `Ej.: Eres ${settings.feminine ? "una" : "un"} ${settings.feminine ? ex.rol.f : ex.rol.m}`;
    if (field === "restricciones") return "Ej.:\n" + ex.restricciones.map((r) => "- " + r).join("\n");
    return "Ej.: " + ex[field];
  }
  function updatePlaceholders() {
    const domain = activeDomain(current());
    P.FIELDS.forEach((f) => { const r = fieldRefs[f.id]; if (r) r.ta.placeholder = placeholderFor(f.id, domain); });
  }

  // ---------- Refresco general ----------
  function refresh() {
    const e = current();
    const prompt = P.assemble(e.values, e.format);
    const n = filledCount(e);

    $("output").textContent = prompt;
    $("output").hidden = !prompt;
    $("empty").hidden = !!prompt;
    ["btn-copy", "btn-export", "btn-share", "mbar-copy"].forEach((id) => { $(id).disabled = !prompt; });
    $("mbar-count").textContent = `${n} de ${P.FIELDS.length}`;

    $("stats").textContent = prompt
      ? `${n} de ${P.FIELDS.length} campos, ${prompt.length.toLocaleString("es-CL")} caracteres, ~${Math.ceil(prompt.length / 4).toLocaleString("es-CL")} tokens`
      : "";

    document.querySelectorAll("#formats button").forEach((b) => { const on = b.dataset.format === e.format; b.setAttribute("aria-checked", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; });

    $("domain").value = e.domainOverride || "";
    $("domain").options[0].textContent = `Automático (${P.detectDomain(e.values).name})`;

    updatePlaceholders();
    renderHistory();
    document.title = (P.isEmptyEntry(e) ? "PromptForge" : P.entryTitle(e).slice(0, 48) + " · PromptForge") + " · sidios";
  }

  // ---------- Acciones ----------
  function promptText() { const e = current(); return P.assemble(e.values, e.format); }

  async function copy() {
    const text = promptText();
    if (!text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      const t = el("textarea", { style: "position:fixed;opacity:0", "aria-hidden": "true" });
      t.value = text; document.body.append(t); t.select();
      try { ok = document.execCommand("copy"); } catch (__) {}
      t.remove();
    }
    if (!ok) { toast("No se pudo copiar. Selecciona el texto de la vista previa y cópialo a mano."); return; }
    flashCopied();
    announce("Prompt copiado al portapapeles");
    track("copiar_prompt", { formato: current().format });
  }

  function exportFile() {
    const e = current();
    const text = promptText();
    if (!text) return;
    const fmt = P.FORMATS.find((f) => f.id === e.format);
    const name = (P.entryTitle(e).replace(/[\/:\\?%*|"<>]/g, "").slice(0, 60).trim() || "prompt") + "." + fmt.ext;
    const url = URL.createObjectURL(new Blob([text], { type: fmt.mime + ";charset=utf-8" }));
    const a = el("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    track("exportar_prompt", { formato: fmt.ext });
  }

  async function share() {
    const text = promptText();
    if (!text || !navigator.share) return;
    try { await navigator.share({ title: P.entryTitle(current()), text }); track("compartir_prompt"); } catch (_) {}
  }

  function clearFields() {
    const e = current();
    const backup = JSON.parse(JSON.stringify(e));
    e.values = {};
    e.domainOverride = null;
    e.format = settings.format;
    e.modified = Date.now();
    renderFields();
    refresh();
    scheduleSave();
    toast("Campos vaciados", "Deshacer", () => {
      Object.assign(e, backup);
      renderFields(); refresh(); scheduleSave();
    });
  }

  // La confirmación de copiado se muestra en el propio botón, sin aviso flotante.
  let copiedTimer = null;
  function flashCopied() {
    ["btn-copy", "mbar-copy"].forEach((id) => { $(id).textContent = "Copiado"; });
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => ["btn-copy", "mbar-copy"].forEach((id) => { $(id).textContent = "Copiar"; }), 1600);
  }

  // ---------- Toast ----------
  // Con acción (Deshacer) dura más y se pausa mientras el puntero o el foco están encima.
  let toastTimer = null;
  let toastDelay = 0;
  function hideToastLater() { clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), toastDelay); }
  function toast(msg, actionLabel, action) {
    const t = $("toast");
    t.replaceChildren(el("span", { text: msg }));
    if (actionLabel) t.append(el("button", { type: "button", text: actionLabel, onclick: () => { t.classList.remove("show"); action(); } }));
    t.classList.add("show");
    toastDelay = actionLabel ? 8000 : 3500;
    hideToastLater();
  }
  function initToast() {
    const t = $("toast");
    const pause = () => clearTimeout(toastTimer);
    const resume = () => { if (t.classList.contains("show") && !t.matches(":hover, :focus-within")) hideToastLater(); };
    t.addEventListener("mouseenter", pause);
    t.addEventListener("focusin", pause);
    t.addEventListener("mouseleave", resume);
    t.addEventListener("focusout", () => setTimeout(resume, 0));
  }

  // ---------- Drawer de historial (pantallas angostas) ----------
  // En pantallas táctiles no se enfoca la búsqueda: abriría el teclado sin pedirlo.
  const isTouch = () => window.matchMedia("(hover: none)").matches;
  // Con el cajón cerrado su contenido queda inerte (no se alcanza con Tab);
  // abierto, lo inerte es el resto de la página.
  const drawerMQ = window.matchMedia("(max-width: 1180px)");
  const behindDrawer = () => [document.querySelector(".nav"), document.querySelector(".form"), document.querySelector(".preview"), $("mbar"), document.querySelector("footer")];
  function syncDrawer() {
    const open = $("history").classList.contains("open");
    const drawer = drawerMQ.matches;
    $("history").inert = drawer && !open;
    behindDrawer().forEach((n) => { if (n) n.inert = drawer && open; });
    $("btn-history").setAttribute("aria-expanded", open ? "true" : "false");
  }
  function openDrawer() {
    $("history").classList.add("open");
    $("scrim").hidden = false;
    syncDrawer();
    if (!isTouch()) $("search").focus(); else $("btn-history-close").focus();
  }
  function closeDrawer() {
    const wasOpen = $("history").classList.contains("open");
    $("history").classList.remove("open");
    $("scrim").hidden = true;
    syncDrawer();
    if (wasOpen && drawerMQ.matches && $("history").contains(document.activeElement) || wasOpen && document.activeElement === document.body) $("btn-history").focus();
  }
  drawerMQ.addEventListener("change", () => { if (!drawerMQ.matches) closeDrawer(); syncDrawer(); });

  // ---------- Ajustes ----------
  function initSettings() {
    const dlg = $("settings");
    $("btn-theme").addEventListener("click", toggleTheme);
    $("set-format").value = settings.format;
    $("set-feminine").value = settings.feminine ? "1" : "0";
    $("set-spell").checked = !!settings.spell;
    $("set-theme").value = settings.theme;
    $("set-theme").addEventListener("change", (ev) => {
      settings.theme = ev.target.value;
      writeJSON(KEY_SETTINGS, settings);
      applyTheme();
      track("cambiar_tema", { tema: settings.theme });
    });
    $("set-format").addEventListener("change", (ev) => { settings.format = ev.target.value; writeJSON(KEY_SETTINGS, settings); });
    $("set-feminine").addEventListener("change", (ev) => { settings.feminine = ev.target.value === "1"; writeJSON(KEY_SETTINGS, settings); updatePlaceholders(); });
    $("set-spell").addEventListener("change", (ev) => {
      settings.spell = ev.target.checked;
      writeJSON(KEY_SETTINGS, settings);
      Object.values(fieldRefs).forEach((r) => r.ta.setAttribute("spellcheck", settings.spell ? "true" : "false"));
    });
    $("btn-settings").addEventListener("click", () => {
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    });
  }

  // ---------- Arranque ----------
  function init() {
    initDomainSelect();
    initFormats();
    initSettings();
    initToast();
    syncDrawer();

    const stored = readJSON(KEY_SELECTED, null);
    if (!entries.length) entries.push(newEntry());
    selectedId = entries.some((e) => e.id === stored) ? stored : sorted()[0].id;

    renderFields();
    refresh();

    $("btn-new").addEventListener("click", newPrompt);
    $("btn-clear").addEventListener("click", clearFields);
    $("btn-copy").addEventListener("click", copy);
    $("btn-export").addEventListener("click", exportFile);
    if (navigator.share) { $("btn-share").hidden = false; $("btn-share").addEventListener("click", share); }
    $("btn-history").addEventListener("click", openDrawer);
    $("btn-history-close").addEventListener("click", closeDrawer);
    $("scrim").addEventListener("click", closeDrawer);
    $("search").addEventListener("input", (ev) => { search = ev.target.value; renderHistory(); });
    $("year").textContent = new Date().getFullYear();

    // Barra inferior (solo visible en móvil vía CSS): se oculta cuando la vista previa está en pantalla.
    $("mbar-copy").addEventListener("click", copy);
    $("mbar-view").addEventListener("click", () => document.querySelector(".preview").scrollIntoView({ behavior: "smooth", block: "start" }));
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        $("mbar").classList.toggle("away", entry.isIntersecting);
      }, { threshold: 0.15 }).observe(document.querySelector(".preview-inner"));
    }

    document.addEventListener("keydown", (ev) => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key === "Enter") { ev.preventDefault(); copy(); }
      else if (mod && !ev.shiftKey && ev.key.toLowerCase() === "s") { ev.preventDefault(); exportFile(); }
      else if (ev.altKey && !mod && ev.code === "KeyN") { ev.preventDefault(); newPrompt(); }
      else if (ev.altKey && !mod && !ev.shiftKey && ev.code === "KeyM") { ev.preventDefault(); mathShortcut(); }
      else if (ev.key === "Escape" && $("history").classList.contains("open")) closeDrawer();
    });

    // Sincroniza si el historial cambia en otra pestaña.
    window.addEventListener("storage", (ev) => {
      if (ev.key !== KEY_HISTORY || !ev.newValue) return;
      const incoming = readJSON(KEY_HISTORY, []);
      const cur = current();
      entries = incoming.filter((e) => e.id !== selectedId).concat(cur ? [cur] : []);
      renderHistory();
    });
  }

  init();
})();
