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
  const settings = Object.assign({ format: "xml", feminine: false, spell: true, theme: "system" }, readJSON(KEY_SETTINGS, {}));

  // ---------- Tema ----------
  // "system" sigue al sistema operativo; "light" y "dark" lo fijan. index.html lo aplica antes de pintar.
  const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === "light" || settings.theme === "dark") root.setAttribute("data-theme", settings.theme);
    else root.removeAttribute("data-theme");
    const dark = settings.theme === "dark" || (settings.theme !== "light" && darkMQ.matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (settings.theme === "system") m.setAttribute("content", m.media.includes("dark") ? "#000000" : "#ffffff");
      else m.setAttribute("content", dark ? "#000000" : "#ffffff");
    });
  }
  applyTheme();
  let entries = (readJSON(KEY_HISTORY, []) || []).filter((e) => e && e.id && e.values);
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
        list.append(el("div", {
          class: "hitem" + (e.id === selectedId ? " active" : ""),
          role: "button", tabindex: "0",
          "aria-current": e.id === selectedId ? "true" : null,
          onclick: () => select(e.id),
          onkeydown: (ev) => {
            if (ev.target !== ev.currentTarget) return;
            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(e.id); }
            if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); remove(e.id); }
          },
        }, [
          el("div", { class: "hitem-title", text: P.entryTitle(e) }),
          el("div", { class: "hitem-sub" }, [
            el("span", { class: "d", text: dateText(e.modified) }),
            el("span", { class: "p", text: preview || "Sin más texto" }),
          ]),
          el("div", { class: "hitem-actions" }, [
            el("button", { type: "button", class: "icon-btn", title: "Duplicar", "aria-label": "Duplicar", text: "⧉",
              onclick: (ev) => { ev.stopPropagation(); duplicate(e.id); } }),
            el("button", { type: "button", class: "icon-btn", title: "Eliminar", "aria-label": "Eliminar", text: "×",
              onclick: (ev) => { ev.stopPropagation(); remove(e.id); } }),
          ]),
        ]));
      }
    }
  }

  // ---------- Campos ----------
  const fieldRefs = {};
  let completionState = null; // { field, items, base, hl }
  let openMenu = null;        // { field, pop, btn }

  function renderFields() {
    closeMenu();
    closeCompletion();
    const host = $("fields");
    host.replaceChildren();
    const e = current();
    P.FIELDS.forEach((f, i) => {
      const ta = el("textarea", {
        id: "f-" + f.id, rows: f.id === "rol" ? "1" : "3",
        placeholder: f.placeholder, spellcheck: settings.spell ? "true" : "false", lang: "es",
        "aria-describedby": "h-" + f.id, autocomplete: "off",
        "aria-autocomplete": "list", "aria-expanded": "false",
      });
      ta.value = e.values[f.id] || "";
      ta.addEventListener("input", () => onInput(f.id));
      ta.addEventListener("keydown", (ev) => onFieldKey(f.id, ev));
      ta.addEventListener("blur", () => setTimeout(() => { if (completionState && completionState.field === f.id) closeCompletion(); }, 120));
      ta.addEventListener("click", () => updateCompletion(f.id));

      const menuAnchor = f.id === "restricciones" ? null : el("div", { class: "menu-anchor" }, [
        el("button", {
          type: "button", class: "menu-btn", "aria-haspopup": "true", "aria-expanded": "false",
          title: `Insertar una sugerencia en «${f.title}»`, text: "Sugerencias",
          onclick: (ev) => toggleMenu(f.id, ev.currentTarget),
        }),
      ]);

      const rules = f.id === "restricciones"
        ? el("div", { class: "rules" }, [el("div", { class: "stack-label", text: "Reglas comunes" }), el("div", { class: "chips", id: "rules" })])
        : null;

      const wrap = el("div", { class: "input-wrap" }, [ta]);
      host.append(el("div", { class: "field", id: "field-" + f.id }, [
        el("div", { class: "field-head" }, [
          el("label", { for: "f-" + f.id }, [
            el("span", { class: "field-title", text: f.title }),
          ]),
          menuAnchor,
        ]),
        el("p", { class: "sr-only", id: "h-" + f.id, text: f.help }),
        wrap,
        rules,
      ]));
      fieldRefs[f.id] = { ta, wrap, anchor: menuAnchor };
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
    const h = Math.min(ta.scrollHeight + 2, max);
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
    updateCompletion(field);
  }

  /** Cambio programático (sugerencias, chips): actualiza el campo y deja el cursor al final. */
  function setValue(field, value, keepFocus = true) {
    const ta = fieldRefs[field].ta;
    ta.value = value;
    onInput(field);
    closeCompletion();
    if (keepFocus) focusTextarea(field);
  }

  // ---------- Autocompletado ----------
  function updateCompletion(field) {
    const ta = fieldRefs[field].ta;
    if (document.activeElement !== ta || ta.selectionStart !== ta.value.length || ta.selectionEnd !== ta.value.length) {
      closeCompletion(); return;
    }
    const comp = P.completion(field, ta.value, activeDomain(current()));
    if (!comp) { closeCompletion(); return; }
    completionState = { field, items: comp.items, base: comp.base, hl: -1 };
    renderCompletion();
  }

  function renderCompletion() {
    const prev = document.querySelector(".pop.complete");
    if (prev) prev.remove();
    if (!completionState) return;
    const { field, items, hl } = completionState;
    const { ta, wrap } = fieldRefs[field];
    const pop = el("div", { class: "pop complete", role: "listbox", id: "complete-" + field });
    items.forEach((item, i) => {
      pop.append(el("button", {
        type: "button", class: "pop-item" + (i === hl ? " hl" : ""), role: "option",
        "aria-selected": i === hl ? "true" : "false", tabindex: "-1", id: `opt-${field}-${i}`,
        onmousedown: (ev) => ev.preventDefault(),
        onclick: () => acceptCompletion(i),
      }, [item.trim()]));
    });
    wrap.append(pop);
    ta.setAttribute("aria-expanded", "true");
    ta.setAttribute("aria-controls", pop.id);
    if (hl >= 0) {
      ta.setAttribute("aria-activedescendant", `opt-${field}-${hl}`);
      const opt = pop.children[hl];
      if (opt) opt.scrollIntoView({ block: "nearest" });
    } else ta.removeAttribute("aria-activedescendant");
  }

  function closeCompletion() {
    if (completionState && fieldRefs[completionState.field]) {
      const ta = fieldRefs[completionState.field].ta;
      ta.setAttribute("aria-expanded", "false");
      ta.removeAttribute("aria-activedescendant");
    }
    completionState = null;
    document.querySelectorAll(".pop.complete").forEach((n) => n.remove());
  }

  function acceptCompletion(i) {
    if (!completionState) return;
    const { field, items, base } = completionState;
    setValue(field, base + items[i]);
  }

  function onFieldKey(field, ev) {
    const cs = completionState && completionState.field === field ? completionState : null;
    if (!cs) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); cs.hl = (cs.hl + 1) % cs.items.length; renderCompletion(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); cs.hl = cs.hl <= 0 ? cs.items.length - 1 : cs.hl - 1; renderCompletion(); }
    else if (ev.key === "Tab" && !ev.shiftKey) { ev.preventDefault(); acceptCompletion(Math.max(cs.hl, 0)); }
    else if (ev.key === "Enter" && cs.hl >= 0 && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); acceptCompletion(cs.hl); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closeCompletion(); }
  }

  // ---------- Menú de sugerencias ----------
  function toggleMenu(field, btn) {
    if (openMenu && openMenu.field === field) { closeMenu(); return; }
    closeMenu();
    closeCompletion();
    const domain = activeDomain(current());
    const fem = settings.feminine;
    const insert = (item) => { closeMenu(); setValue(field, P.applyChip(item, field, fieldRefs[field].ta.value, fem)); };
    const itemBtn = (label, value) => el("button", { type: "button", class: "pop-item", role: "menuitem", onclick: () => insert(value) }, [label.trim()]);
    const roleBtn = (r) => itemBtn(fem ? r.f : r.m, r.m);

    const pop = el("div", { class: "pop menu", role: "menu" });
    if (field === "rol") {
      pop.append(el("div", { class: "pop-group", text: domain.name }));
      domain.roles.forEach((r) => pop.append(roleBtn(r)));
      if (domain.id !== C.general.id) {
        pop.append(el("div", { class: "pop-group", text: C.general.name }));
        C.general.roles.forEach((r) => pop.append(roleBtn(r)));
      }
      const others = el("details", null, [el("summary", { text: "Otros ámbitos" })]);
      C.all.filter((d) => d.id !== domain.id && d.id !== C.general.id).forEach((d) => {
        others.append(el("details", null, [el("summary", { text: d.name }), ...d.roles.map(roleBtn)]));
      });
      pop.append(others);
    } else {
      pop.append(el("div", { class: "pop-group", text: domain.name }));
      P.items(field, domain).forEach((it) => pop.append(itemBtn(it, it)));
    }
    fieldRefs[field].anchor.append(pop);
    btn.setAttribute("aria-expanded", "true");
    openMenu = { field, pop, btn };
    const first = pop.querySelector(".pop-item");
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu(returnFocus) {
    if (!openMenu) return;
    openMenu.pop.remove();
    openMenu.btn.setAttribute("aria-expanded", "false");
    if (returnFocus) openMenu.btn.focus();
    openMenu = null;
  }

  document.addEventListener("mousedown", (ev) => {
    if (openMenu && !openMenu.pop.contains(ev.target) && !openMenu.btn.contains(ev.target)) closeMenu();
  });

  // Navegación con flechas dentro del menú abierto.
  document.addEventListener("keydown", (ev) => {
    if (!openMenu) return;
    if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); return; }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const items = [...openMenu.pop.querySelectorAll(".pop-item, summary")].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    ev.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = ev.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    items[next].focus();
  });

  // ---------- Reglas comunes ----------
  function renderRules() {
    const host = $("rules");
    if (!host) return;
    const e = current();
    const text = e.values.restricciones || "";
    host.replaceChildren(...P.items("restricciones", activeDomain(e)).map((rule) =>
      el("button", {
        type: "button", class: "chip",
        "aria-pressed": P.isChipActive(rule, "restricciones", text) ? "true" : "false",
        onclick: () => setValue("restricciones", P.applyChip(rule, "restricciones", fieldRefs.restricciones.ta.value), false),
      }, [rule])));
  }

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
      scheduleSave();
      refresh();
    });
  }

  // ---------- Formatos ----------
  function initFormats() {
    const host = $("formats");
    P.FORMATS.forEach((f) => host.append(el("button", {
      type: "button", role: "radio", "data-format": f.id, text: f.name,
      onclick: () => { current().format = f.id; scheduleSave(); refresh(); },
    })));
    const setSel = $("set-format");
    P.FORMATS.forEach((f) => setSel.append(el("option", { value: f.id, text: f.name })));
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

    document.querySelectorAll("#formats button").forEach((b) => b.setAttribute("aria-checked", b.dataset.format === e.format ? "true" : "false"));

    $("domain").value = e.domainOverride || "";
    $("domain").options[0].textContent = `Automático (${P.detectDomain(e.values).name})`;

    renderRules();
    renderHistory();
    document.title = (P.isEmptyEntry(e) ? "PromptForge" : P.entryTitle(e).slice(0, 48) + " · PromptForge") + " · sidios";
  }

  // ---------- Acciones ----------
  function promptText() { const e = current(); return P.assemble(e.values, e.format); }

  async function copy() {
    const text = promptText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const t = el("textarea", { style: "position:fixed;opacity:0" });
      t.value = text; document.body.append(t); t.select();
      try { document.execCommand("copy"); } catch (__) {}
      t.remove();
    }
    flashCopied();
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

  function loadExample() {
    track("cargar_ejemplo");
    const e = current();
    e.values = {
      rol: "Eres un ingeniero experto en prompt engineering",
      contexto: "Estás trabajando en una aplicación web para creación de prompts usando prompt engineering (Rol, Contexto, Objetivo, Salida, Restricciones).",
      objetivo: "Realiza una aplicación de tipo formulario en la que se rellenen los 5 campos y como salida aparezca el prompt armado, con sugerencias contextuales al escribir.",
      salida: "App funcional, con instrucciones para publicarla en GitHub Pages.",
      restricciones: "- Usa HTML, CSS y JavaScript sin dependencias externas\n- Responde en español\n- Explica brevemente cada decisión de diseño",
    };
    e.domainOverride = null;
    e.modified = Date.now();
    renderFields();
    refresh();
    scheduleSave();
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
  let toastTimer = null;
  function toast(msg, actionLabel, action) {
    const t = $("toast");
    t.replaceChildren(el("span", { text: msg }));
    if (actionLabel) t.append(el("button", { type: "button", text: actionLabel, onclick: () => { t.classList.remove("show"); action(); } }));
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), actionLabel ? 5000 : 2200);
  }

  // ---------- Drawer de historial (pantallas angostas) ----------
  // En pantallas táctiles no se enfoca la búsqueda: abriría el teclado sin pedirlo.
  const isTouch = () => window.matchMedia("(hover: none)").matches;
  function openDrawer() {
    $("history").classList.add("open");
    $("scrim").hidden = false;
    if (!isTouch()) $("search").focus();
  }
  function closeDrawer() { $("history").classList.remove("open"); $("scrim").hidden = true; }

  // ---------- Ajustes ----------
  function initSettings() {
    const dlg = $("settings");
    $("set-theme").value = settings.theme;
    $("set-theme").addEventListener("change", (ev) => { settings.theme = ev.target.value; writeJSON(KEY_SETTINGS, settings); applyTheme(); });
    $("set-format").value = settings.format;
    $("set-feminine").value = settings.feminine ? "1" : "0";
    $("set-spell").checked = !!settings.spell;
    $("set-format").addEventListener("change", (ev) => { settings.format = ev.target.value; writeJSON(KEY_SETTINGS, settings); });
    $("set-feminine").addEventListener("change", (ev) => { settings.feminine = ev.target.value === "1"; writeJSON(KEY_SETTINGS, settings); });
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

    const stored = readJSON(KEY_SELECTED, null);
    if (!entries.length) entries.push(newEntry());
    selectedId = entries.some((e) => e.id === stored) ? stored : sorted()[0].id;

    renderFields();
    refresh();

    $("btn-new").addEventListener("click", newPrompt);
    $("btn-example").addEventListener("click", loadExample);
    $("btn-example-2").addEventListener("click", loadExample);
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
