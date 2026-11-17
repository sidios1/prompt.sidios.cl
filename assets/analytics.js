// Google Analytics 4 con modo de consentimiento.
// - Hasta que la persona acepte, GA no guarda cookies (solo pings anónimos sin identificador).
// - Se registran visitas y acciones (copiar, exportar, nuevo…). Nunca el texto de los prompts.
(function () {
  const GA_ID = "G-VY00DK2LLN"; // ID de medición de GA4 (propiedad PromptForge)
  const KEY_CONSENT = "promptforge.consent.v1";

  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const enabled = !!GA_ID && !local;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  let consent = null;
  try { consent = localStorage.getItem(KEY_CONSENT); } catch (_) {}

  if (enabled) {
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: consent === "granted" ? "granted" : "denied",
    });
    gtag("js", new Date());
    gtag("config", GA_ID, { anonymize_ip: true });
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.append(s);
  }

  /** Registra una acción (solo su nombre y datos no personales). */
  window.pfTrack = function (name, params) {
    if (!enabled) return;
    gtag("event", name, params || {});
  };

  function setConsent(value) {
    try { localStorage.setItem(KEY_CONSENT, value); } catch (_) {}
    gtag("consent", "update", { analytics_storage: value });
  }

  // Aviso de consentimiento (solo si GA está activo y aún no se ha respondido).
  function showBanner() {
    if (!enabled || consent) return;
    const bar = document.createElement("div");
    bar.className = "consent";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Uso de cookies");
    bar.innerHTML =
      '<p>Uso Google Analytics para saber cuánta gente usa PromptForge. Tus prompts nunca se envían.</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn" data-v="denied">Rechazar</button>' +
      '<button type="button" class="btn primary" data-v="granted">Aceptar</button>' +
      "</div>";
    bar.addEventListener("click", (ev) => {
      const v = ev.target.getAttribute && ev.target.getAttribute("data-v");
      if (!v) return;
      setConsent(v);
      bar.remove();
    });
    document.body.append(bar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBanner);
  else showBanner();
})();
