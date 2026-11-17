/* Admin area: tiles, board panels, quick links and settings. Talks to /api/admin/*. */
(function () {
  "use strict";
  var H = window.Hub;
  var el = H.el;
  var $ = function (id) { return document.getElementById(id); };
  var content = null;
  var panelBoard = null;          // board loaded in the panel editor
  var panelFilters = [];          // filter rows being edited
  var editing = { collection: null, id: null };

  var EMOJI = ["📋", "🔧", "🏖️", "🦺", "🔗", "📄", "🎥", "🛡️", "📅", "💵", "🎓", "📞", "🚛", "🚜", "📦", "⚠️", "✅", "⭐", "ℹ️", "💬", "🗺️", "👤", "🚩", "🔔", "🏠", "🔑", "✉️", "🧰", "📊", "🧊", "🍽️", "🩺", "🕒", "📣"];
  var SPECIAL = [
    { id: "name", title: "Item name", type: "name" },
    { id: "__group__", title: "Group", type: "group" },
    { id: "__created__", title: "Created date", type: "date" },
  ];
  var OP_LABELS = {
    any_of: "is any of", not_any_of: "is not", contains: "contains", not_contains: "doesn't contain",
    is_empty: "is empty", is_not_empty: "is not empty", today: "is today", this_week: "is this week",
    this_month: "is this month", last_days: "is in the last … days", past: "is before today",
    today_or_future: "is today or later", future: "is after today",
  };
  var TEMPLATES = {
    blank: {},
    oos: {
      title: { en: "Out of service", es: "Fuera de servicio" }, icon: "⚠️",
      subtitle: { en: "Do not operate these forklifts until a tech clears them.", es: "No opere estos montacargas hasta que un técnico los libere." },
      emptyText: { en: "All forklifts are in service.", es: "Todos los montacargas están en servicio." },
      highlight: { columns: [], values: ["Critical ⚠️️"], label: { en: "Critical", es: "Crítica" } }, sort: "newest", limit: 12,
      hint: "Load your \"Forklift down\" board, then add a condition like Status is any of NEW, Working on it, Pending Repair, and tick Priority under \"Columns to watch\".",
    },
    today: {
      title: { en: "Today's checks", es: "Revisiones de hoy" }, icon: "✅",
      subtitle: { en: "Daily inspections submitted so far today.", es: "Inspecciones diarias enviadas hoy." },
      emptyText: { en: "No checklists yet today.", es: "Aún no hay revisiones hoy." },
      filters: [{ columnId: "__created__", op: "today", values: [] }],
      highlight: { columns: [], values: ["FAIL"], label: { en: "Failed", es: "Falla" } }, sort: "newest", limit: 12,
      hint: "Load your checklist board, then tick every PASS/FAIL column under \"Columns to watch\" so failed items show in red.",
    },
  };

  // --- API ---------------------------------------------------------------------
  function api(method, url, body) {
    var opts = { method: method, headers: { "X-Requested-With": "hub" }, cache: "no-store" };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { location.href = "/admin/login"; throw new Error("Please sign in again."); }
        if (!r.ok) { var e = new Error(j.error || ("HTTP " + r.status)); e.code = j.code; throw e; }
        return j;
      });
    });
  }
  var toastTimer;
  function toast(msg, isError) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var t = el("div", { class: "toast" + (isError ? " err" : ""), role: "status", text: msg });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, isError ? 6000 : 2500);
  }

  // --- tabs --------------------------------------------------------------------
  function showTab(name) {
    document.querySelectorAll(".tabs [role=tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === name)); });
    document.querySelectorAll(".tab").forEach(function (s) { s.hidden = s.id !== "tab-" + name; });
    history.replaceState(null, "", "#" + name);
  }
  document.querySelectorAll(".tabs [role=tab]").forEach(function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); }); });

  // --- small helpers -----------------------------------------------------------
  function setBi(prefix, obj) { $(prefix + "_en").value = (obj && obj.en) || ""; $(prefix + "_es").value = (obj && obj.es) || ""; }
  function getBi(prefix) { return { en: $(prefix + "_en").value.trim(), es: $(prefix + "_es").value.trim() }; }
  function emojiRow(container, input) {
    container.innerHTML = "";
    EMOJI.forEach(function (e) {
      var b = el("button", { type: "button", text: e, "aria-pressed": String(input.value.trim() === e), "aria-label": "Use " + e });
      b.addEventListener("click", function () { input.value = e; emojiRow(container, input); });
      container.appendChild(b);
    });
  }
  function linkKind(url) {
    if (!url) return { text: "No link yet — shows as \"Coming soon\"", cls: "warn" };
    try {
      var h = new URL(url).hostname;
      if (h === "forms.monday.com") return { text: "monday.com form", cls: "ok" };
      if (h === "view.monday.com") return { text: "monday.com public board view", cls: "ok" };
      if (h === "monday.com" || /\.monday\.com$/.test(h)) return { text: "monday.com (needs a monday login — best opened in a new tab)", cls: "" };
      return { text: h, cls: "" };
    } catch (e) { return { text: url, cls: "" }; }
  }
  var hintTimer;
  function liveLinkHint(input, hint, openRadios) {
    clearTimeout(hintTimer);
    var v = input.value.trim();
    if (!v) { hint.textContent = "Paste the form's share link (monday.com → form → Share → copy link), a board link, or any web address. Leave blank for \"Coming soon\"."; hint.className = "hint"; return; }
    hintTimer = setTimeout(function () {
      api("GET", "/api/admin/link-info?url=" + encodeURIComponent(v)).then(function (info) {
        if (!info.ok) { hint.textContent = info.error; hint.className = "hint hint--warn"; return; }
        var texts = {
          form: "monday.com form — opens inside the hub; the kiosk returns home automatically afterwards.",
          "public-board": "monday.com public board view — can open inside the hub.",
          monday: "A monday.com board, dashboard or doc. These need a monday login, so open them in a new tab.",
          web: "Web link (" + info.host + "). If the site refuses to be embedded, choose \"In a new tab\".",
        };
        hint.textContent = texts[info.kind] || info.url;
        hint.className = "hint " + (info.kind === "form" ? "hint--ok" : "");
        if (openRadios && info.kind === "monday") openRadios.tab.checked = true;
        if (openRadios && info.kind === "form") openRadios.embed.checked = true;
      }).catch(function () {});
    }, 350);
  }

  // --- lists -------------------------------------------------------------------
  function switchBtn(on, onToggle) {
    var b = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on), "aria-label": on ? "Shown on the hub" : "Hidden" });
    b.addEventListener("click", onToggle);
    return b;
  }
  function itemRow(o) {
    var actions = el("div", { class: "actions" });
    actions.appendChild(switchBtn(o.active, o.onToggle));
    var up = el("button", { type: "button", text: "↑", "aria-label": "Move up" }); up.disabled = !o.canUp; up.addEventListener("click", o.onUp);
    var down = el("button", { type: "button", text: "↓", "aria-label": "Move down" }); down.disabled = !o.canDown; down.addEventListener("click", o.onDown);
    var edit = el("button", { type: "button", text: "Edit" }); edit.addEventListener("click", o.onEdit);
    var del = el("button", { type: "button", class: "del", text: "Delete" }); del.addEventListener("click", o.onDelete);
    [up, down, edit, del].forEach(function (b) { actions.appendChild(b); });
    return el("li", { class: o.active ? "" : "inactive" }, [
      el("span", { class: "ico", "aria-hidden": "true", text: H.icon(o.icon) }),
      el("div", { class: "main" }, [el("strong", { text: o.title }), el("span", { class: o.metaClass || "", text: o.meta })]),
      actions,
    ]);
  }
  function listActions(collection, list, i) {
    var item = list[i];
    return {
      active: item.active,
      canUp: i > 0, canDown: i < list.length - 1,
      onToggle: function () { api("PUT", "/api/admin/" + collection + "/" + item.id, { active: !item.active }).then(reload).catch(function (e) { toast(e.message, true); }); },
      onUp: function () { move(collection, list, i, -1); },
      onDown: function () { move(collection, list, i, 1); },
      onDelete: function () {
        if (!confirm("Delete \"" + (item.title && item.title.en) + "\"? This can't be undone.")) return;
        api("DELETE", "/api/admin/" + collection + "/" + item.id).then(function () { toast("Deleted"); return reload(); }).catch(function (e) { toast(e.message, true); });
      },
    };
  }
  function move(collection, list, i, dir) {
    var ids = list.map(function (x) { return x.id; });
    var j = i + dir;
    if (j < 0 || j >= ids.length) return;
    var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    api("PUT", "/api/admin/" + collection + "/order", { ids: ids }).then(reload).catch(function (e) { toast(e.message, true); });
  }

  function renderTiles() {
    var ul = $("tiles-list");
    ul.innerHTML = "";
    if (!content.tiles.length) ul.appendChild(el("li", { class: "empty-note", text: "No tiles yet. Add one for each monday.com form." }));
    content.tiles.forEach(function (t, i) {
      var k = linkKind(t.url);
      var o = listActions("tiles", content.tiles, i);
      o.icon = t.icon; o.title = t.title.en || "(untitled)";
      o.meta = k.text + (t.url ? " · " + (t.open === "embed" ? "opens inside the hub" : "opens in a new tab") : "");
      o.metaClass = k.cls;
      o.onEdit = function () { openItemEditor("tiles", t); };
      ul.appendChild(itemRow(o));
    });
  }
  function renderLinks() {
    var ul = $("links-list");
    ul.innerHTML = "";
    if (!content.links.length) ul.appendChild(el("li", { class: "empty-note", text: "No quick links yet." }));
    content.links.forEach(function (l, i) {
      var k = linkKind(l.url);
      var o = listActions("links", content.links, i);
      o.icon = l.icon; o.title = l.title.en || "(untitled)";
      o.meta = k.text + " · " + (l.open === "embed" ? "opens inside the hub" : "opens in a new tab");
      o.metaClass = k.cls;
      o.onEdit = function () { openItemEditor("links", l); };
      ul.appendChild(itemRow(o));
    });
  }
  function renderPanels() {
    var ul = $("panels-list");
    ul.innerHTML = "";
    var warn = $("panels-monday-warning");
    warn.hidden = content.monday.configured;
    warn.textContent = "monday.com isn't connected: set MONDAY_API_TOKEN on the Railway service. Panels can't load boards until then.";
    if (!content.panels.length) ul.appendChild(el("li", { class: "empty-note", text: "No board panels yet. Add one to show live items from a monday.com board." }));
    content.panels.forEach(function (p, i) {
      var o = listActions("panels", content.panels, i);
      o.icon = p.icon; o.title = p.title.en || "(untitled)";
      o.meta = (p.boardName || ("Board " + p.boardId)) + " · " + p.filters.length + (p.filters.length === 1 ? " condition" : " conditions") + " · up to " + p.limit + " items";
      o.onEdit = function () { openPanelEditor(p); };
      ul.appendChild(itemRow(o));
    });
  }

  // --- tile / quick link editor ----------------------------------------------
  var dlgItem = $("dlg-item");
  function openItemEditor(collection, item) {
    editing = { collection: collection, id: item ? item.id : null };
    var isTile = collection === "tiles";
    $("item-title").textContent = (item ? "Edit " : "Add ") + (isTile ? "tile" : "quick link");
    setBi("i-title", item && item.title); setBi("i-description", item && item.description);
    $("i-url").value = item ? item.url : "";
    $("i-icon").value = item ? item.icon : (isTile ? "📋" : "🔗");
    $("i-code").value = item && item.code ? item.code : "";
    $("i-code-wrap").hidden = !isTile;
    $("i-active").checked = item ? item.active : true;
    var open = item ? item.open : (isTile ? "embed" : "tab");
    document.querySelectorAll("input[name=i-open]").forEach(function (r) { r.checked = r.value === open; });
    emojiRow($("i-emoji"), $("i-icon"));
    $("item-error").hidden = true;
    $("item-delete").hidden = !item;
    liveLinkHint($("i-url"), $("i-url-hint"), null);
    dlgItem.showModal();
  }
  $("i-url").addEventListener("input", function () {
    var radios = { embed: document.querySelector("input[name=i-open][value=embed]"), tab: document.querySelector("input[name=i-open][value=tab]") };
    liveLinkHint($("i-url"), $("i-url-hint"), radios);
  });
  $("i-icon").addEventListener("input", function () { emojiRow($("i-emoji"), $("i-icon")); });
  $("item-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var body = {
      title: getBi("i-title"), description: getBi("i-description"), url: $("i-url").value.trim(), icon: $("i-icon").value.trim(),
      open: (document.querySelector("input[name=i-open]:checked") || {}).value || "embed", active: $("i-active").checked, code: $("i-code").value.trim(),
    };
    var url = "/api/admin/" + editing.collection + (editing.id ? "/" + editing.id : "");
    $("item-save").disabled = true;
    api(editing.id ? "PUT" : "POST", url, body).then(function () {
      dlgItem.close(); toast("Saved"); return reload();
    }).catch(function (e) { $("item-error").textContent = e.message; $("item-error").hidden = false; })
      .finally(function () { $("item-save").disabled = false; });
  });
  $("item-delete").addEventListener("click", function () {
    if (!confirm("Delete this? This can't be undone.")) return;
    api("DELETE", "/api/admin/" + editing.collection + "/" + editing.id).then(function () { dlgItem.close(); toast("Deleted"); return reload(); }).catch(function (e) { toast(e.message, true); });
  });
  $("add-tile").addEventListener("click", function () { openItemEditor("tiles", null); });
  $("add-link").addEventListener("click", function () { openItemEditor("links", null); });

  // --- board panel editor ------------------------------------------------------
  var dlgPanel = $("dlg-panel");
  var dlgTemplate = $("dlg-template");
  var panelState = null; // the panel being edited (fields not represented by inputs: highlight.columns, columns)

  function allColumns() { return SPECIAL.concat(panelBoard ? panelBoard.columns : []); }
  function findColumn(id) { return allColumns().filter(function (c) { return c.id === id; })[0]; }
  function colKind(col) {
    if (!col) return "text";
    var t = String(col.type || "").toLowerCase();
    if (t === "status" || t === "color" || t === "dropdown") return "status";
    if (t === "date") return "date";
    if (col.id === "__group__") return "group";
    return "text";
  }
  function opsFor(kind) {
    if (kind === "status") return ["any_of", "not_any_of", "is_empty", "is_not_empty"];
    if (kind === "date") return ["today", "this_week", "this_month", "last_days", "past", "today_or_future", "future", "is_empty", "is_not_empty"];
    return ["any_of", "not_any_of", "contains", "not_contains", "is_empty", "is_not_empty"];
  }
  function labelsFor(col) {
    if (!col) return null;
    if (col.id === "__group__") return panelBoard ? panelBoard.groups.map(function (g) { return g.title; }) : null;
    return col.labels ? col.labels.map(function (l) { return l.label; }) : null;
  }

  function openPanelEditor(panel, template) {
    var tpl = template ? TEMPLATES[template] || {} : {};
    panelState = panel ? JSON.parse(JSON.stringify(panel)) : {
      title: tpl.title || { en: "", es: "" }, subtitle: tpl.subtitle || { en: "", es: "" }, icon: tpl.icon || "📊", boardId: "", boardName: "",
      titleColumn: "name", columns: [], filters: tpl.filters ? JSON.parse(JSON.stringify(tpl.filters)) : [],
      highlight: tpl.highlight ? JSON.parse(JSON.stringify(tpl.highlight)) : null, sort: tpl.sort || "newest", limit: tpl.limit || 10,
      showTime: true, emptyText: tpl.emptyText || { en: "", es: "" }, linkUrl: "", active: true,
    };
    editing = { collection: "panels", id: panel ? panel.id : null };
    panelBoard = null;
    panelFilters = panelState.filters.map(function (f) { return { columnId: f.columnId, op: f.op, values: f.values.slice() }; });
    $("panel-title").textContent = panel ? "Edit board panel" : "Add board panel";
    $("p-board").value = panel ? panel.boardId : "";
    $("p-board-list").hidden = true;
    $("p-board-box").hidden = true;
    $("p-board-hint").textContent = tpl.hint || "Load the board first: its columns are needed for the options below.";
    setBi("p-title", panelState.title); setBi("p-subtitle", panelState.subtitle); setBi("p-emptyText", panelState.emptyText);
    $("p-icon").value = panelState.icon; emojiRow($("p-emoji"), $("p-icon"));
    $("p-sort").value = panelState.sort; $("p-limit").value = panelState.limit;
    $("p-showTime").checked = panelState.showTime !== false; $("p-active").checked = panelState.active !== false;
    $("p-linkUrl").value = panelState.linkUrl || "";
    $("p-hl-values").value = panelState.highlight ? panelState.highlight.values.join(", ") : "";
    setBi("p-hl-label", panelState.highlight && panelState.highlight.label);
    $("p-preview-out").hidden = true; $("p-preview-out").innerHTML = "";
    $("panel-error").hidden = true;
    $("panel-delete").hidden = !panel;
    renderColumnPickers(); renderFilters(); renderHighlightPickers();
    dlgPanel.showModal();
    if (panel && content.monday.configured) loadBoard(panel.boardId, true);
  }

  function boardBox(text) { var b = $("p-board-box"); b.hidden = false; b.innerHTML = ""; b.appendChild(typeof text === "string" ? el("span", { text: text }) : text); }
  function loadBoard(idOrUrl, quiet) {
    var v = String(idOrUrl || $("p-board").value).trim();
    if (!v) return;
    boardBox("Loading board…");
    return api("GET", "/api/admin/monday/boards/" + encodeURIComponent(v)).then(function (board) {
      panelBoard = board;
      $("p-board").value = board.id;
      if (!$("p-linkUrl").value && board.url) $("p-linkUrl").value = board.url;
      boardBox(el("div", null, [
        el("strong", { text: board.name }), el("span", { class: "hint", text: (board.workspace ? board.workspace + " · " : "") + board.columns.length + " columns · " + board.groups.length + " groups" }),
      ]));
      renderColumnPickers(); renderFilters(); renderHighlightPickers();
    }).catch(function (e) {
      panelBoard = null;
      boardBox(el("span", { class: "hint hint--warn", text: e.message }));
      if (!quiet) toast(e.message, true);
    });
  }
  $("p-load").addEventListener("click", function () { loadBoard(); });
  $("p-board").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); loadBoard(); } });
  $("p-pick").addEventListener("click", function () {
    var sel = $("p-board-list");
    $("p-pick").disabled = true;
    api("GET", "/api/admin/monday/boards").then(function (list) {
      sel.innerHTML = "";
      sel.appendChild(el("option", { value: "", text: "Choose a board…" }));
      list.forEach(function (b) { sel.appendChild(el("option", { value: b.id, text: b.name + (b.workspace ? " — " + b.workspace : "") })); });
      sel.hidden = false;
      sel.focus();
    }).catch(function (e) { toast(e.message, true); }).finally(function () { $("p-pick").disabled = false; });
  });
  $("p-board-list").addEventListener("change", function () { if (this.value) { $("p-board").value = this.value; loadBoard(this.value); } });

  function renderColumnPickers() {
    var sel = $("p-titleColumn");
    sel.innerHTML = "";
    allColumns().forEach(function (c) { sel.appendChild(el("option", { value: c.id, text: c.title })); });
    if (!findColumn(panelState.titleColumn)) sel.appendChild(el("option", { value: panelState.titleColumn, text: panelState.titleColumn + " (load board to see name)" }));
    sel.value = panelState.titleColumn || "name";
    var chips = $("p-columns");
    chips.innerHTML = "";
    var cols = allColumns().filter(function (c) { return c.id !== "name"; });
    panelState.columns.forEach(function (id) { if (!cols.some(function (c) { return c.id === id; })) cols.push({ id: id, title: id }); });
    if (!panelBoard && !panelState.columns.length) chips.appendChild(el("span", { class: "hint", text: "Load the board to pick columns." }));
    cols.forEach(function (c) {
      var cb = el("input", { type: "checkbox", value: c.id });
      cb.checked = panelState.columns.indexOf(c.id) >= 0;
      cb.addEventListener("change", function () {
        if (cb.checked) { if (panelState.columns.length >= 6) { cb.checked = false; toast("Up to 6 details per row.", true); return; } panelState.columns.push(c.id); }
        else panelState.columns = panelState.columns.filter(function (x) { return x !== c.id; });
      });
      chips.appendChild(el("label", null, [cb, c.title]));
    });
  }
  $("p-titleColumn").addEventListener("change", function () { panelState.titleColumn = this.value; });

  function renderFilters() {
    var box = $("p-filters");
    box.innerHTML = "";
    if (!panelFilters.length) box.appendChild(el("p", { class: "hint", text: "No conditions: every item on the board is shown (up to the limit)." }));
    panelFilters.forEach(function (f, i) { box.appendChild(filterRow(f, i)); });
  }
  function filterRow(f, i) {
    var row = el("div", { class: "filter-row" });
    var colSel = el("select", { "aria-label": "Column" });
    var cols = allColumns();
    if (!findColumn(f.columnId)) cols = cols.concat([{ id: f.columnId, title: f.columnId + " (load board to see name)", type: "text" }]);
    cols.forEach(function (c) { colSel.appendChild(el("option", { value: c.id, text: c.title })); });
    colSel.value = f.columnId;
    var opSel = el("select", { "aria-label": "Condition" });
    function fillOps() {
      opSel.innerHTML = "";
      var ops = opsFor(colKind(findColumn(f.columnId)));
      if (ops.indexOf(f.op) < 0) f.op = ops[0];
      ops.forEach(function (op) { opSel.appendChild(el("option", { value: op, text: OP_LABELS[op] })); });
      opSel.value = f.op;
    }
    fillOps();
    var values = el("div", { class: "values" });
    function fillValues() {
      values.innerHTML = "";
      var col = findColumn(f.columnId);
      var labels = labelsFor(col);
      if (f.op === "last_days") {
        var n = el("input", { type: "number", min: "1", max: "3650", value: f.values[0] || "7", "aria-label": "Days" });
        n.addEventListener("input", function () { f.values = [n.value]; });
        values.appendChild(n);
      } else if (["any_of", "not_any_of"].indexOf(f.op) >= 0 && labels && labels.length) {
        var chips = el("div", { class: "chips" });
        labels.forEach(function (lab) {
          var cb = el("input", { type: "checkbox", value: lab });
          cb.checked = f.values.some(function (v) { return v.trim().toLowerCase() === lab.trim().toLowerCase(); });
          cb.addEventListener("change", function () {
            f.values = f.values.filter(function (v) { return v.trim().toLowerCase() !== lab.trim().toLowerCase(); });
            if (cb.checked) f.values.push(lab);
          });
          chips.appendChild(el("label", null, [cb, lab]));
        });
        values.appendChild(chips);
      } else if (["any_of", "not_any_of", "contains", "not_contains"].indexOf(f.op) >= 0) {
        var inp = el("input", { type: "text", value: f.values.join(", "), placeholder: "Values, comma-separated", "aria-label": "Values" });
        inp.addEventListener("input", function () { f.values = inp.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean); });
        values.appendChild(inp);
      } else {
        values.appendChild(el("span", { class: "hint", text: "" }));
      }
    }
    fillValues();
    colSel.addEventListener("change", function () { f.columnId = colSel.value; f.values = []; fillOps(); fillValues(); });
    opSel.addEventListener("change", function () { f.op = opSel.value; if (f.op === "last_days") f.values = ["7"]; fillValues(); });
    var rm = el("button", { type: "button", class: "btn btn--ghost btn--small remove", text: "Remove" });
    rm.addEventListener("click", function () { panelFilters.splice(i, 1); renderFilters(); });
    row.appendChild(colSel); row.appendChild(opSel); row.appendChild(values); row.appendChild(rm);
    return row;
  }
  $("p-add-filter").addEventListener("click", function () {
    var first = allColumns().filter(function (c) { return c.id !== "name" && c.id !== "__group__" && c.id !== "__created__"; })[0];
    panelFilters.push({ columnId: first ? first.id : "__created__", op: first ? opsFor(colKind(first))[0] : "today", values: [] });
    renderFilters();
  });

  function renderHighlightPickers() {
    var hl = panelState.highlight || { columns: [], values: [], label: { en: "", es: "" } };
    panelState.highlight = hl;
    var chips = $("p-hl-columns");
    chips.innerHTML = "";
    var cols = allColumns().filter(function (c) { return c.id !== "name" && c.id !== "__created__"; });
    hl.columns.forEach(function (id) { if (!cols.some(function (c) { return c.id === id; })) cols.push({ id: id, title: id }); });
    if (!panelBoard && !hl.columns.length) chips.appendChild(el("span", { class: "hint", text: "Load the board to pick columns." }));
    cols.forEach(function (c) {
      var cb = el("input", { type: "checkbox", value: c.id });
      cb.checked = hl.columns.indexOf(c.id) >= 0;
      cb.addEventListener("change", function () {
        if (cb.checked) hl.columns.push(c.id); else hl.columns = hl.columns.filter(function (x) { return x !== c.id; });
        renderHighlightSuggestions();
      });
      chips.appendChild(el("label", null, [cb, c.title]));
    });
    renderHighlightSuggestions();
  }
  function renderHighlightSuggestions() {
    var box = $("p-hl-suggest");
    box.innerHTML = "";
    if (!panelBoard) return;
    var hl = panelState.highlight;
    var seen = {};
    var cols = panelBoard.columns.filter(function (c) { return c.labels && (hl.columns.length === 0 || hl.columns.indexOf(c.id) >= 0); });
    cols.forEach(function (c) {
      c.labels.forEach(function (l) {
        if (seen[l.label]) return;
        seen[l.label] = true;
        var b = el("button", { type: "button", text: "+ " + l.label, title: "Add " + l.label });
        b.addEventListener("click", function () {
          var cur = $("p-hl-values").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
          if (cur.indexOf(l.label) < 0) cur.push(l.label);
          $("p-hl-values").value = cur.join(", ");
        });
        box.appendChild(b);
      });
    });
  }

  function collectPanel() {
    var values = $("p-hl-values").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var hl = panelState.highlight && panelState.highlight.columns.length && values.length
      ? { columns: panelState.highlight.columns, values: values, label: getBi("p-hl-label") } : null;
    return {
      title: getBi("p-title"), subtitle: getBi("p-subtitle"), icon: $("p-icon").value.trim() || "📊",
      boardId: (panelBoard && panelBoard.id) || $("p-board").value.trim().replace(/.*\/boards\/(\d+).*/, "$1"),
      boardName: panelBoard ? panelBoard.name : panelState.boardName || "",
      titleColumn: $("p-titleColumn").value || "name", columns: panelState.columns,
      filters: panelFilters.map(function (f) { return { columnId: f.columnId, op: f.op, values: f.values }; }),
      highlight: hl, sort: $("p-sort").value, limit: Number($("p-limit").value) || 10, showTime: $("p-showTime").checked,
      emptyText: getBi("p-emptyText"), linkUrl: $("p-linkUrl").value.trim(), active: $("p-active").checked,
    };
  }
  function previewRows(out, rows, p) {
    out.innerHTML = "";
    out.hidden = false;
    if (!rows.length) { out.appendChild(el("div", { class: "empty frost", text: (p.emptyText && p.emptyText.en) || "Nothing to show right now." })); return; }
    var ul = el("ul", { class: "rows frost" });
    rows.forEach(function (r) {
      var parts = r.details.map(function (d) { return d.text; });
      if (r.flagged) {
        var shown = r.details.map(function (d) { return d.title; });
        var extra = r.flaggedColumns.filter(function (c) { return shown.indexOf(c) < 0; });
        if (extra.length) parts.push(((p.highlight && p.highlight.label && p.highlight.label.en) ? p.highlight.label.en + ": " : "") + extra.join(", "));
      }
      var detail = parts.join(" · ");
      ul.appendChild(el("li", { class: "row" + (r.flagged ? " row--flag" : "") }, [
        el("span", { class: "row-dot", text: r.flagged ? "⚠" : "•" }),
        el("div", { class: "row-main" }, [el("p", { class: "row-title", text: r.title }), detail ? el("p", { class: "row-detail", text: detail }) : null]),
        el("div", { class: "row-side" }, [
          r.flagged ? el("div", { class: "flag", text: (p.highlight && p.highlight.label && p.highlight.label.en) || "⚠" }) : (r.group ? el("div", { text: r.group }) : null),
          p.showTime && r.createdAt ? el("div", { class: "time", text: H.fmtTime(r.createdAt) }) : null,
        ]),
      ]));
    });
    out.appendChild(ul);
  }
  $("p-preview").addEventListener("click", function () {
    var p = collectPanel();
    $("panel-error").hidden = true;
    $("p-preview").disabled = true;
    var out = $("p-preview-out");
    out.hidden = false; out.innerHTML = ""; out.appendChild(el("p", { class: "hint", text: "Asking monday.com…" }));
    api("POST", "/api/admin/panels/preview", p).then(function (res) {
      previewRows(out, res.rows, p);
      out.appendChild(el("p", { class: "hint", text: res.rows.length + (res.rows.length === 1 ? " item" : " items") + " from " + (res.board ? res.board.name : "the board") + "." }));
    }).catch(function (e) { out.innerHTML = ""; out.appendChild(el("p", { class: "dlg-error", text: e.message })); })
      .finally(function () { $("p-preview").disabled = false; });
  });
  $("panel-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var body = collectPanel();
    $("panel-save").disabled = true;
    api(editing.id ? "PUT" : "POST", "/api/admin/panels" + (editing.id ? "/" + editing.id : ""), body).then(function () {
      dlgPanel.close(); toast("Panel saved"); return reload();
    }).catch(function (e) { $("panel-error").textContent = e.message; $("panel-error").hidden = false; })
      .finally(function () { $("panel-save").disabled = false; });
  });
  $("panel-delete").addEventListener("click", function () {
    if (!confirm("Delete this panel? This can't be undone.")) return;
    api("DELETE", "/api/admin/panels/" + editing.id).then(function () { dlgPanel.close(); toast("Deleted"); return reload(); }).catch(function (e) { toast(e.message, true); });
  });
  $("p-icon").addEventListener("input", function () { emojiRow($("p-emoji"), $("p-icon")); });
  $("add-panel").addEventListener("click", function () { dlgTemplate.showModal(); });
  dlgTemplate.querySelectorAll("[data-template]").forEach(function (b) {
    b.addEventListener("click", function () { dlgTemplate.close(); openPanelEditor(null, b.dataset.template); });
  });
  document.querySelectorAll("dialog [data-close]").forEach(function (b) { b.addEventListener("click", function () { b.closest("dialog").close(); }); });

  // --- settings ----------------------------------------------------------------
  function renderSettings() {
    var s = content.settings;
    setBi("s-hubName", s.hubName); setBi("s-intro", s.intro); setBi("s-teamWord", s.teamWord);
    $("s-lang-es").checked = s.languages.indexOf("es") >= 0;
    $("s-defaultLang").value = s.defaultLang;
    $("s-showQr").checked = s.showQr !== false;
    $("s-idleReturnSeconds").value = s.idleReturnSeconds;
    $("s-refreshSeconds").value = s.refreshSeconds;
    $("s-timeZone").value = s.timeZone || "";
    $("s-publicUrl").value = s.publicUrl || "";
    $("s-publicUrl-hint").textContent = "Currently the QR code points to " + content.publicUrl + (s.publicUrl ? "" : " (taken from the address this page was opened on). Set it here if the hub has a custom domain.");
    var lines = Object.keys((content.optionLabels && content.optionLabels.es) || {}).map(function (k) { return k + " = " + content.optionLabels.es[k]; });
    $("s-labels").value = lines.join("\n");
  }
  $("settings-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var body = {
      hubName: getBi("s-hubName"), intro: getBi("s-intro"), teamWord: getBi("s-teamWord"),
      languages: $("s-lang-es").checked ? ["en", "es"] : ["en"], defaultLang: $("s-defaultLang").value, showQr: $("s-showQr").checked,
      idleReturnSeconds: Number($("s-idleReturnSeconds").value), refreshSeconds: Number($("s-refreshSeconds").value),
      timeZone: $("s-timeZone").value.trim(), publicUrl: $("s-publicUrl").value.trim(),
    };
    api("PUT", "/api/admin/settings", body).then(function () { toast("Settings saved"); return reload(); }).catch(function (e) { toast(e.message, true); });
  });
  $("labels-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var es = {};
    $("s-labels").value.split("\n").forEach(function (line) {
      var i = line.indexOf("=");
      if (i < 0) return;
      var k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (k && v) es[k] = v;
    });
    api("PUT", "/api/admin/option-labels", { es: es }).then(function () { toast("Translations saved"); return reload(); }).catch(function (e) { toast(e.message, true); });
  });
  function checkMonday() {
    $("md-dot").className = "dot"; $("md-text").textContent = "Checking…";
    return api("GET", "/api/admin/monday/status").then(function (s) {
      if (!s.configured) { $("md-dot").className = "dot bad"; $("md-text").textContent = "Not connected. " + s.error; return; }
      if (!s.ok) { $("md-dot").className = "dot bad"; $("md-text").textContent = "Token set, but monday.com said: " + s.error; return; }
      $("md-dot").className = "dot ok";
      $("md-text").textContent = "Connected as " + s.user + (s.account ? " · " + s.account : "") + ". Panels read boards this user can see.";
    }).catch(function (e) { $("md-dot").className = "dot bad"; $("md-text").textContent = e.message; });
  }
  $("md-test").addEventListener("click", checkMonday);

  // --- load --------------------------------------------------------------------
  function reload() {
    return api("GET", "/api/admin/content").then(function (c) {
      content = c;
      renderTiles(); renderPanels(); renderLinks(); renderSettings();
    });
  }
  reload().then(checkMonday).catch(function (e) { toast(e.message, true); });
  showTab((location.hash || "#tiles").slice(1).replace(/[^a-z]/g, "") || "tiles");
})();
