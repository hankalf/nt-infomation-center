/* Shows one tile or quick link inside the hub (iframe), then returns home after a while so the kiosk resets. */
(function () {
  "use strict";
  var H = window.Hub;
  var $ = function (id) { return document.getElementById(id); };
  var m = /^\/open\/(t|l)\/([^/]+)$/.exec(location.pathname);
  var kind = m ? m[1] : "t";
  var id = m ? decodeURIComponent(m[2]) : "";
  var WARN_SECONDS = 30;

  H.fetchJson("/api/hub").then(function (hub) {
    H.resolveLang(hub.settings);
    var list = kind === "l" ? hub.links : hub.tiles;
    var item = list.filter(function (x) { return x.id === id; })[0];
    document.title = H.pick(hub.settings.hubName) || "Employee Hub";
    $("back-label").textContent = H.t("backToHub");
    if (!item) return showMessage(H.t("notFound"));
    $("title").textContent = H.pick(item.title);
    document.title = H.pick(item.title) + " · " + document.title;
    if (!item.url) return showMessage(H.t("linkMissing"));

    var newtab = $("newtab");
    newtab.href = item.url;
    newtab.textContent = H.t("openNewTab") + " ↗";
    newtab.hidden = false;

    var frame = $("frame");
    frame.title = H.pick(item.title);
    frame.src = item.embedUrl || item.url;
    frame.hidden = false;
    // A site that refuses to be framed shows nothing (the browser blocks it silently) — give people a way out.
    setTimeout(function () {
      var msg = $("frame-msg");
      msg.textContent = H.t("frameBlocked");
      msg.hidden = false;
      msg.className = "frame-msg frame-msg--hint";
    }, 8000);

    startIdleTimer(hub.settings.idleReturnSeconds);
  }).catch(function () {
    showMessage(H.t("couldNotLoad"));
  });

  function showMessage(text) {
    var msg = $("frame-msg");
    msg.textContent = text;
    msg.hidden = false;
    startIdleTimer(30);
  }

  /** After `total` seconds without any tap on this page, go home. The last 30 seconds show a warning that any tap cancels. */
  function startIdleTimer(total) {
    total = Number(total) || 0;
    if (total <= 0) return;
    var deadline = Date.now() + total * 1000;
    var overlay = $("idle"), countdown = $("countdown");
    function reset() {
      deadline = Date.now() + total * 1000;
      overlay.hidden = true;
    }
    ["pointerdown", "touchstart", "keydown", "mousemove", "scroll"].forEach(function (ev) { window.addEventListener(ev, reset, { passive: true }); });
    // Taps inside the iframe are invisible to us, but focusing it moves focus away from the page: count that as activity.
    window.addEventListener("blur", reset);
    window.addEventListener("focus", reset);
    setInterval(function () {
      var left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) { location.href = "/"; return; }
      if (left <= WARN_SECONDS) {
        overlay.hidden = false;
        $("idle-title").textContent = H.t("returning", left);
        $("idle-sub").textContent = H.t("tapToStay");
        countdown.hidden = false;
        countdown.textContent = left + "s";
      } else {
        overlay.hidden = true;
        countdown.hidden = true;
      }
    }, 500);
  }
})();
