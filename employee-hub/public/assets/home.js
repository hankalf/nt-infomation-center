/* Kiosk home: tiles (monday.com forms), quick links and live board panels. */
(function () {
  "use strict";
  var H = window.Hub;
  var hub = null;
  var hubJson = "";
  var panelTimer = null;
  var $ = function (id) { return document.getElementById(id); };

  function greetingWord() {
    var h = new Date().getHours();
    return h < 12 ? H.t("morning") : h < 18 ? H.t("afternoon") : H.t("evening");
  }

  function renderClock() {
    var now = new Date();
    $("date").textContent = now.toLocaleDateString(H.locale(), { weekday: "long", month: "long", day: "numeric" });
    $("greeting").textContent = greetingWord() + ", " + (H.pick(hub.settings.teamWord) || "team") + ".";
  }

  function renderHeader() {
    var name = H.pick(hub.settings.hubName) || "Employee Hub";
    $("brand-name").textContent = name;
    document.title = name;
    H.renderLangToggle($("lang-toggle"), hub.settings, render);
    var qr = $("mini-qr");
    qr.hidden = !hub.settings.showQr;
    $("mini-qr-label").textContent = H.t("openOnPhone");
    qr.setAttribute("aria-label", H.t("openOnPhone"));
  }

  function tileHref(t) {
    if (!t.url) return null;
    return t.open === "tab" ? t.url : "/open/t/" + encodeURIComponent(t.id);
  }

  function renderTiles() {
    var box = $("tiles");
    box.innerHTML = "";
    $("intro").textContent = H.pick(hub.settings.intro);
    if (!hub.tiles.length) {
      box.appendChild(H.el("div", { class: "empty frost" }, [H.el("strong", { text: H.t("noTools") }), H.t("noToolsAdmin")]));
      return;
    }
    hub.tiles.forEach(function (t) {
      var href = tileHref(t);
      var a = H.el(href ? "a" : "div", { class: "tile frost" + (href ? "" : " tile--off"), href: href || null,
        target: href && t.open === "tab" ? "_blank" : null, rel: href && t.open === "tab" ? "noopener" : null, "aria-disabled": href ? null : "true" });
      a.appendChild(H.el("div", { class: "tile-top" }, [
        H.el("span", { class: "tile-icon", "aria-hidden": "true", text: H.icon(t.icon) }),
        href ? H.el("span", { class: "tile-code", text: t.code || "" }) : H.el("span", { class: "badge", text: H.t("comingSoon") }),
      ]));
      a.appendChild(H.el("div", null, [
        H.el("h2", null, [H.pick(t.title), H.el("span", { class: "arrow", "aria-hidden": "true", text: "↗" })]),
        H.el("p", { text: H.pick(t.description) }),
      ]));
      box.appendChild(a);
    });
  }

  function renderLinks() {
    var block = $("links-block");
    block.hidden = !hub.links.length;
    if (!hub.links.length) return;
    $("links-title").textContent = H.t("quickLinks");
    $("links-sub").textContent = H.t("quickLinksSub");
    var ul = $("links");
    ul.innerHTML = "";
    hub.links.forEach(function (l) {
      var embed = l.open === "embed";
      var a = H.el("a", { class: "qlink frost", href: embed ? "/open/l/" + encodeURIComponent(l.id) : l.url,
        target: embed ? null : "_blank", rel: embed ? null : "noopener" }, [
        H.el("div", { class: "qlink-top" }, [
          H.el("span", { class: "qlink-icon", "aria-hidden": "true", text: H.icon(l.icon) }),
          H.el("span", { class: "arrow", "aria-hidden": "true", text: "↗" }),
        ]),
        H.el("div", null, [H.el("strong", { text: H.pick(l.title) }), H.pick(l.description) ? H.el("small", { text: H.pick(l.description) }) : null]),
      ]);
      ul.appendChild(H.el("li", null, [a]));
    });
  }

  function renderPanelShells() {
    var box = $("panels");
    box.innerHTML = "";
    hub.panels.forEach(function (p) {
      var sec = H.el("section", { id: "panel-" + p.id, class: "panel-block" });
      var head = H.el("div", { class: "block-head" }, [
        H.el("div", null, [H.el("h2", { text: H.pick(p.title) }), H.pick(p.subtitle) ? H.el("p", { text: H.pick(p.subtitle) }) : null]),
        p.linkUrl ? H.el("a", { class: "block-link", href: p.linkUrl, target: "_blank", rel: "noopener", text: H.t("openBoard") + " ↗" }) : null,
      ]);
      sec.appendChild(head);
      var body = H.el("div", { class: "panel-body" }, [H.el("div", { class: "skeleton" }), H.el("div", { class: "skeleton" }), H.el("div", { class: "skeleton" })]);
      sec.appendChild(body);
      sec.appendChild(H.el("div", { class: "panel-foot" }));
      box.appendChild(sec);
    });
  }

  /** "LINDE #2 · Critical" for a single watched column, "LINDE #3 · Failed: Mast, Horn" when the matched columns aren't already shown. */
  function rowDetail(r, label) {
    var parts = r.details.map(function (d) { return H.opt(d.text); });
    if (r.flagged) {
      var shown = r.details.map(function (d) { return d.title; });
      var extra = r.flaggedColumns.filter(function (c) { return shown.indexOf(c) < 0; }).map(H.opt);
      if (extra.length) parts.push((label ? label + ": " : "") + extra.join(", "));
    }
    return parts.join(" · ");
  }

  function renderPanelRows(p, data) {
    var sec = $("panel-" + p.id);
    if (!sec) return;
    var body = sec.querySelector(".panel-body");
    var foot = sec.querySelector(".panel-foot");
    body.innerHTML = "";
    foot.innerHTML = "";
    if (!data.rows.length) {
      body.appendChild(H.el("div", { class: "empty frost", text: H.pick(p.emptyText) || H.t("nothing") }));
    } else {
      var ul = H.el("ul", { class: "rows frost" });
      data.rows.forEach(function (r) {
        var detail = rowDetail(r, H.pick(p.highlightLabel));
        var li = H.el("li", { class: "row" + (r.flagged ? " row--flag" : "") }, [
          H.el("span", { class: "row-dot", "aria-hidden": "true", text: r.flagged ? "⚠" : "•" }),
          H.el("div", { class: "row-main" }, [H.el("p", { class: "row-title", text: H.opt(r.title) }), detail ? H.el("p", { class: "row-detail", text: detail }) : null]),
          H.el("div", { class: "row-side" }, [
            r.flagged ? H.el("div", { class: "flag", text: H.pick(p.highlightLabel) || "⚠" }) : (r.group ? H.el("div", { text: H.opt(r.group) }) : null),
            p.showTime && r.createdAt ? H.el("div", { class: "time", text: H.fmtTime(r.createdAt) }) : null,
          ]),
        ]);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    foot.appendChild(H.el("span", { text: data.fetchedAt ? H.t("updated", H.ago(data.fetchedAt)) : "" }));
    if (data.stale) foot.appendChild(H.el("span", { class: "warn", text: H.t("savedData") }));
  }

  function renderPanelError(p, err) {
    var sec = $("panel-" + p.id);
    if (!sec) return;
    var body = sec.querySelector(".panel-body");
    body.innerHTML = "";
    var msg = err && err.code === "not_configured" ? H.t("notConnected") : H.t("couldNotLoad");
    body.appendChild(H.el("div", { class: "empty frost" }, [H.el("p", { class: "alert", text: msg })]));
  }

  var panelData = {};
  function loadPanel(p) {
    return H.fetchJson("/api/panels/" + encodeURIComponent(p.id))
      .then(function (data) { panelData[p.id] = data; renderPanelRows(p, data); })
      .catch(function (err) { if (!panelData[p.id]) renderPanelError(p, err); });
  }
  function loadPanels() {
    hub.panels.forEach(loadPanel);
  }

  function render() {
    H.resolveLang(hub.settings);
    H.setOptionLabels(hub.optionLabels);
    renderHeader();
    renderClock();
    renderTiles();
    renderLinks();
    renderPanelShells();
    hub.panels.forEach(function (p) { if (panelData[p.id]) renderPanelRows(p, panelData[p.id]); });
    loadPanels();
    clearInterval(panelTimer);
    panelTimer = setInterval(loadPanels, Math.max(15, hub.settings.refreshSeconds || 60) * 1000);
  }

  function loadHub() {
    return H.fetchJson("/api/hub").then(function (data) {
      var json = JSON.stringify(data);
      if (json === hubJson) return;
      hubJson = json;
      hub = data;
      panelData = {};
      render();
    });
  }

  loadHub().catch(function () {
    $("greeting").textContent = H.t("couldNotLoad");
  });
  setInterval(function () { if (hub) renderClock(); }, 30000);
  setInterval(function () { loadHub().catch(function () {}); }, 5 * 60000); // picks up admin changes without a reload
})();
