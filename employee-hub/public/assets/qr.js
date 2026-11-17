(function () {
  "use strict";
  var H = window.Hub;
  var $ = function (id) { return document.getElementById(id); };
  function render(hub) {
    H.resolveLang(hub.settings);
    $("brand-name").textContent = H.pick(hub.settings.hubName) || "Employee Hub";
    H.renderLangToggle($("lang-toggle"), hub.settings, function () { render(hub); });
    $("eyebrow").textContent = H.t("qrEyebrow");
    $("title").textContent = H.t("qrTitle");
    document.title = H.t("qrTitle");
    $("qr").alt = H.t("qrAlt");
    $("url").textContent = hub.publicUrl || "";
    $("back").textContent = "← " + H.t("backToHub");
    $("print").textContent = "🖨 " + H.t("qrPrint");
  }
  $("print").addEventListener("click", function () { window.print(); });
  H.fetchJson("/api/hub").then(render).catch(function () { $("title").textContent = H.t("couldNotLoad"); });
})();
