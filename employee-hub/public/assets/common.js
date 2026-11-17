/* Shared helpers for the kiosk pages: language, translations, icons, fetch. */
(function () {
  "use strict";

  var STR = {
    en: {
      openOnPhone: "Open on your phone", switchLang: "Cambiar a español",
      morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening",
      quickLinks: "Quick links", quickLinksSub: "Handbooks, schedules, and resources.",
      comingSoon: "Coming soon", loading: "Loading…", couldNotLoad: "Could not load this right now.",
      updated: "Updated {x}", savedData: "Showing saved data — monday.com isn't responding.",
      notConnected: "Not connected to monday.com yet.", nothing: "Nothing to show right now.",
      backToHub: "Back to hub", openNewTab: "Open in new tab",
      returning: "Returning to the hub in {x}s", tapToStay: "Tap anywhere to keep working",
      noTools: "No tools have been added yet.", noToolsAdmin: "Sign in to the admin area to add your monday.com form links.",
      qrEyebrow: "Take it with you", qrTitle: "Scan to open the hub", qrPrint: "Print this code",
      qrAlt: "QR code linking to the employee hub", linkMissing: "This tool isn't set up yet. Please tell a lead.",
      notFound: "That tool no longer exists.", justNow: "just now", minAgo: "{x} min ago", openBoard: "Open board",
      frameBlocked: "If the form doesn't appear here, open it in a new tab.",
    },
    es: {
      openOnPhone: "Abrir en su teléfono", switchLang: "Switch to English",
      morning: "Buenos días", afternoon: "Buenas tardes", evening: "Buenas noches",
      quickLinks: "Enlaces rápidos", quickLinksSub: "Manuales, horarios y recursos.",
      comingSoon: "Próximamente", loading: "Cargando…", couldNotLoad: "No se pudo cargar ahora.",
      updated: "Actualizado {x}", savedData: "Mostrando datos guardados: monday.com no responde.",
      notConnected: "Aún no está conectado a monday.com.", nothing: "No hay nada que mostrar ahora.",
      backToHub: "Volver al portal", openNewTab: "Abrir en otra pestaña",
      returning: "Volviendo al portal en {x}s", tapToStay: "Toque en cualquier lugar para seguir",
      noTools: "Aún no se han agregado herramientas.", noToolsAdmin: "Inicie sesión en el área de administración para agregar los enlaces de formularios de monday.com.",
      qrEyebrow: "Llévelo con usted", qrTitle: "Escanee para abrir el portal", qrPrint: "Imprimir este código",
      qrAlt: "Código QR que abre el portal del empleado", linkMissing: "Esta herramienta aún no está lista. Avise a un líder.",
      notFound: "Esa herramienta ya no existe.", justNow: "justo ahora", minAgo: "hace {x} min", openBoard: "Abrir tablero",
      frameBlocked: "Si el formulario no aparece aquí, ábralo en otra pestaña.",
    },
  };

  // Names used by the original hub (and a few friendly aliases) → emoji. Anything else is shown as typed.
  var ICONS = {
    link: "🔗", Link: "🔗", document: "📄", Document: "📄", video: "🎥", Video: "🎥", safety: "🛡️", Safety: "🛡️",
    schedule: "📅", Schedule: "📅", payroll: "💵", Payroll: "💵", training: "🎓", Training: "🎓", contact: "📞", Contact: "📞",
    board: "📊", clipboard: "📋", wrench: "🔧", calendar: "📅", hardhat: "🦺", forklift: "🚜", truck: "🚛", alert: "⚠️",
    info: "ℹ️", star: "⭐", chat: "💬", map: "🗺️", user: "👤", check: "✅", flag: "🚩", bell: "🔔", home: "🏠", key: "🔑",
    mail: "✉️", tools: "🧰", pto: "🏖️", gear: "🦺",
  };

  var LANG_KEY = "hub-lang";
  var current = null;
  var optionLabels = {};

  function lang() {
    if (current) return current;
    try { current = localStorage.getItem(LANG_KEY) || ""; } catch (e) { current = ""; }
    return current;
  }
  function setLang(l) {
    current = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* private mode */ }
    document.documentElement.lang = l;
  }
  /** Pick the language to show: saved choice if the hub offers it, otherwise the hub's default. */
  function resolveLang(settings) {
    var langs = (settings && settings.languages) || ["en"];
    var saved = lang();
    var l = langs.indexOf(saved) >= 0 ? saved : (settings && settings.defaultLang) || langs[0];
    setLang(l);
    return l;
  }
  function t(key, x) {
    var d = STR[lang()] || STR.en;
    var s = d[key] != null ? d[key] : STR.en[key] || key;
    return s.replace("{x}", x == null ? "" : String(x));
  }
  /** Admin-entered bilingual text: {en, es}. Falls back to English. */
  function pick(obj) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    return obj[lang()] || obj.en || "";
  }
  /** Spanish display name for a value that came from a board, if one was entered. */
  function opt(label) {
    var map = optionLabels[lang()];
    return (map && map[label]) || label;
  }
  function setOptionLabels(m) { optionLabels = m || {}; }
  function icon(name) {
    var s = (name || "").trim();
    return ICONS[s] || s || "🔗";
  }
  function locale() { return lang() === "es" ? "es-US" : "en-US"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var err = new Error(j.error || ("HTTP " + r.status)); err.status = r.status; err.code = j.code; throw err; }
        return j;
      });
    });
  }
  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(locale(), { month: "short", day: "numeric" });
  }
  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? t("justNow") : t("minAgo", m);
  }

  /** The EN/ES switch in the top bar. Only shown when more than one language is enabled. */
  function renderLangToggle(container, settings, onChange) {
    container.innerHTML = "";
    var langs = (settings && settings.languages) || ["en"];
    if (langs.length < 2) { container.hidden = true; return; }
    container.hidden = false;
    container.setAttribute("aria-label", t("switchLang"));
    langs.forEach(function (l) {
      var b = el("button", { type: "button", "aria-pressed": String(l === lang()), text: l.toUpperCase() });
      b.addEventListener("click", function () { if (l !== lang()) { setLang(l); onChange(); } });
      container.appendChild(b);
    });
  }

  window.Hub = { t: t, pick: pick, opt: opt, setOptionLabels: setOptionLabels, icon: icon, lang: lang, setLang: setLang, resolveLang: resolveLang,
    locale: locale, esc: esc, el: el, fetchJson: fetchJson, fmtTime: fmtTime, ago: ago, renderLangToggle: renderLangToggle };
})();
