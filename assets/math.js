// PromptForge web — editor visual de ecuaciones.
// Usa MathLive (MIT) cargado bajo demanda desde jsDelivr; si no carga, cae a un campo de LaTeX.
// La fórmula se entrega como LaTeX entre $…$ (en línea) o $$…$$ (bloque): la notación que mejor leen los LLM.
(function () {
  const SRC = "https://cdn.jsdelivr.net/npm/mathlive@0.101.0/dist/mathlive.min.js";
  const $ = (id) => document.getElementById(id);

  // Letras griegas (código Unicode) para las etiquetas de los chips.
  const GREEK = {
    alpha: 0x3b1, beta: 0x3b2, gamma: 0x3b3, delta: 0x3b4, epsilon: 0x3b5, theta: 0x3b8, lambda: 0x3bb, mu: 0x3bc,
    pi: 0x3c0, rho: 0x3c1, sigma: 0x3c3, tau: 0x3c4, phi: 0x3c6, omega: 0x3c9,
    Gamma: 0x393, Delta: 0x394, Theta: 0x398, Lambda: 0x39b, Sigma: 0x3a3, Phi: 0x3a6, Omega: 0x3a9,
  };

  // Plantillas por categoría. #? / #0 son los huecos navegables de MathLive.
  const TEMPLATES = [
    { id: "basico", name: "Básico", items: [
      ["a/b", "\\frac{#0}{#?}"], ["xⁿ", "#0^{#?}"], ["xₙ", "#0_{#?}"], ["√x", "\\sqrt{#0}"], ["ⁿ√x", "\\sqrt[#?]{#0}"],
      ["|x|", "\\left|#0\\right|"], ["( )", "\\left(#0\\right)"], ["±", "\\pm"], ["·", "\\cdot"], ["×", "\\times"], ["÷", "\\div"], ["∞", "\\infty"],
    ] },
    { id: "calculo", name: "Cálculo", items: [
      ["∫", "\\int #0\\,d#?"], ["∫ₐᵇ", "\\int_{#?}^{#?} #0\\,d#?"], ["∬", "\\iint #0\\,dA"], ["∮", "\\oint #0"],
      ["d/dx", "\\frac{d}{d#?}#0"], ["∂/∂x", "\\frac{\\partial #0}{\\partial #?}"], ["lim", "\\lim_{#?\\to #?} #0"],
      ["∇", "\\nabla"], ["Δ", "\\Delta"], ["f′", "#0'"],
    ] },
    { id: "series", name: "Σ ∏", items: [
      ["Σ", "\\sum_{#?}^{#?} #0"], ["∏", "\\prod_{#?}^{#?} #0"], ["⋃", "\\bigcup_{#?} #0"], ["⋂", "\\bigcap_{#?} #0"],
      ["n!", "#0!"], ["(n k)", "\\binom{#0}{#?}"], ["log", "\\log_{#?} #0"], ["ln", "\\ln #0"], ["eˣ", "e^{#0}"],
      ["sin", "\\sin #0"], ["cos", "\\cos #0"], ["tan", "\\tan #0"],
    ] },
    { id: "matrices", name: "Matrices", items: [
      ["(2×2)", "\\begin{pmatrix}#0 & #? \\\\ #? & #?\\end{pmatrix}"],
      ["[2×2]", "\\begin{bmatrix}#0 & #? \\\\ #? & #?\\end{bmatrix}"],
      ["(3×3)", "\\begin{pmatrix}#0 & #? & #? \\\\ #? & #? & #? \\\\ #? & #? & #?\\end{pmatrix}"],
      ["|det|", "\\begin{vmatrix}#0 & #? \\\\ #? & #?\\end{vmatrix}"],
      ["{ casos", "\\begin{cases}#0 & #? \\\\ #? & #?\\end{cases}"],
      ["v⃗", "\\vec{#0}"], ["x̂", "\\hat{#0}"], ["x̄", "\\overline{#0}"], ["Aᵀ", "#0^{T}"], ["A⁻¹", "#0^{-1}"],
    ] },
    { id: "griego", name: "Griego", items: [
      "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "pi", "rho", "sigma", "tau", "phi", "omega",
      "Gamma", "Delta", "Theta", "Lambda", "Sigma", "Phi", "Omega",
    ].map((n) => [String.fromCodePoint(GREEK[n]), "\\" + n]) },
    { id: "relaciones", name: "Relaciones", items: [
      ["=", "="], ["≠", "\\neq"], ["≈", "\\approx"], ["≡", "\\equiv"], ["≤", "\\leq"], ["≥", "\\geq"], ["∝", "\\propto"],
      ["∈", "\\in"], ["∉", "\\notin"], ["⊂", "\\subset"], ["⊆", "\\subseteq"], ["∀", "\\forall"], ["∃", "\\exists"],
      ["→", "\\to"], ["⇒", "\\Rightarrow"], ["⇔", "\\Leftrightarrow"], ["ℝ", "\\mathbb{R}"], ["ℕ", "\\mathbb{N}"], ["ℤ", "\\mathbb{Z}"], ["∅", "\\emptyset"],
    ] },
  ];

  // ---------- Carga de MathLive ----------
  let loading = null;
  function loadMathLive() {
    if (window.customElements && customElements.get("math-field")) return Promise.resolve(true);
    if (loading) return loading;
    loading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(false), 8000);
      s.onload = () => {
        customElements.whenDefined("math-field").then(() => { clearTimeout(timer); resolve(true); });
      };
      s.onerror = () => { clearTimeout(timer); resolve(false); };
      document.head.append(s);
    }).then((ok) => { if (!ok) loading = null; return ok; });
    return loading;
  }

  // ---------- Delimitadores ----------
  function wrap(latex, display) {
    const t = (latex || "").trim();
    if (!t) return "";
    return display ? `$$\n${t}\n$$` : `$${t}$`;
  }

  /** Si `pos` cae dentro de una fórmula $…$ o $$…$$ de `text`, la devuelve con su rango. */
  function findAt(text, pos) {
    // En línea sigue la regla de Pandoc: sin espacio junto a los $ y sin dígito tras el cierre ($5 y $10 no es fórmula).
    const re = /\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]*?[^\s$])\$(?!\d)/g;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index, end = m.index + m[0].length;
      if (pos > start && pos < end || (pos === end && pos !== start)) {
        const display = m[1] != null;
        return { start, end, display, latex: (display ? m[1] : m[2]).trim() };
      }
      if (start > pos) break;
    }
    return null;
  }

  // ---------- Diálogo ----------
  let dlg, mf, fallback, codeEl, chipsEl, tabsEl, modeEl;
  let state = { display: true, tab: TEMPLATES[0].id, visual: false, resolve: null };

  const currentLatex = () => (state.visual ? mf.getValue("latex-without-placeholders") : fallback.value).trim();

  function renderCode() {
    const out = wrap(currentLatex(), state.display);
    codeEl.textContent = out || "La fórmula aparece aquí como LaTeX.";
    codeEl.classList.toggle("is-empty", !out);
    $("math-insert").disabled = !out;
  }

  function renderTabs() {
    tabsEl.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.tab === state.tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    const tpl = TEMPLATES.find((t) => t.id === state.tab);
    chipsEl.replaceChildren(...tpl.items.map(([label, latex]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "math-chip";
      b.textContent = label;
      b.title = latex.replace(/#[0?]/g, "□");
      b.addEventListener("mousedown", (ev) => ev.preventDefault()); // no robar el foco al editor
      b.addEventListener("click", () => insertTemplate(latex));
      return b;
    }));
  }

  function insertTemplate(latex) {
    if (state.visual) {
      mf.executeCommand(["insert", latex, { focus: true, selectionMode: "placeholder" }]);
      mf.focus();
    } else {
      const plain = latex.replace(/#0|#\?/g, "");
      const a = fallback.selectionStart, b = fallback.selectionEnd;
      fallback.setRangeText(plain, a, b, "end");
      fallback.focus();
    }
    renderCode();
  }

  function renderMode() {
    modeEl.querySelectorAll("button").forEach((b) => {
      const on = (b.dataset.mode === "block") === state.display;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    renderCode();
  }

  function close(result) {
    const r = state.resolve;
    state.resolve = null;
    if (dlg.open) dlg.close();
    if (r) r(result);
  }

  function init() {
    dlg = $("math");
    if (!dlg) return;
    codeEl = $("math-code");
    chipsEl = $("math-chips");
    tabsEl = $("math-tabs");
    modeEl = $("math-mode");
    fallback = $("math-latex");

    TEMPLATES.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.tab = t.id;
      b.textContent = t.name;
      b.addEventListener("click", () => { state.tab = t.id; renderTabs(); });
      tabsEl.append(b);
    });
    tabsEl.addEventListener("keydown", (ev) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
      if (!step) return;
      ev.preventDefault();
      const ids = TEMPLATES.map((t) => t.id);
      state.tab = ids[(ids.indexOf(state.tab) + step + ids.length) % ids.length];
      renderTabs();
      tabsEl.querySelector(`[data-tab="${state.tab}"]`).focus();
    });

    modeEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      state.display = b.dataset.mode === "block"; renderMode();
    }));
    modeEl.addEventListener("keydown", (ev) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
      ev.preventDefault();
      state.display = !state.display;
      renderMode();
      modeEl.querySelector('[aria-checked="true"]').focus();
    });

    fallback.addEventListener("input", renderCode);
    $("math-insert").addEventListener("click", () => {
      const latex = currentLatex();
      if (latex) close({ latex, display: state.display });
    });
    $("math-cancel").addEventListener("click", () => close(null));
    $("math-close").addEventListener("click", () => close(null));
    dlg.addEventListener("close", () => close(null));
    dlg.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); $("math-insert").click(); }
    });
  }

  function mountMathField() {
    if (mf) return;
    mf = document.createElement("math-field");
    mf.id = "math-field";
    mf.setAttribute("aria-label", "Ecuación");
    mf.mathVirtualKeyboardPolicy = window.matchMedia("(hover: none)").matches ? "auto" : "manual";
    mf.smartFence = true;
    mf.addEventListener("input", renderCode);
    // Enter inserta la fórmula.
    mf.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); $("math-insert").click(); }
    }, true);
    $("math-editor").prepend(mf);
  }

  /** Abre el editor. Resuelve con { latex, display } o null si se cancela. */
  async function open(opts) {
    if (!dlg) init();
    const { latex = "", display = true } = opts || {};
    state.display = display;
    if (state.resolve) close(null);
    const result = new Promise((resolve) => { state.resolve = resolve; });

    $("math-status").hidden = false;
    $("math-status").textContent = "Cargando editor…";
    fallback.hidden = true;
    if (mf) mf.hidden = true;
    renderTabs();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");

    const ok = await loadMathLive();
    if (!state.resolve) return result; // se cerró mientras cargaba
    state.visual = ok;
    $("math-status").hidden = ok;
    if (ok) {
      // El teclado virtual (táctil) debe vivir dentro del diálogo modal; fuera quedaría inerte.
      if (window.mathVirtualKeyboard) try { window.mathVirtualKeyboard.container = dlg; } catch (_) {}
      mountMathField();
      mf.hidden = false;
      mf.setValue(latex, { silenceNotifications: true });
      requestAnimationFrame(() => mf.focus());
    } else {
      $("math-status").textContent = "No se pudo cargar el editor visual. Escribe la fórmula en LaTeX.";
      fallback.hidden = false;
      fallback.value = latex;
      fallback.focus();
    }
    renderMode();
    return result;
  }

  // Precarga discreta cuando el puntero se acerca a un botón ∑ (sin costo si nunca se usa).
  const preload = () => { loadMathLive(); };

  window.PF_MATH = { open, wrap, findAt, preload };
})();
