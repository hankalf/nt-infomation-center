"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const jsQR = require("jsqr");
const { normalizeUrl, describeLink, boardIdFromUrl } = require("../lib/links");
const { encodeQr, toSvg } = require("../lib/qr");
const { createMonday, buildRules, matches, dateContext, parseLabels } = require("../lib/monday");
const { validateTile, validatePanel, validateSettings, ValidationError } = require("../lib/store");
const { createFakeMonday } = require("./fake-monday");

// --- links --------------------------------------------------------------------
test("normalizeUrl adds https and rejects non-web links", () => {
  assert.equal(normalizeUrl("forms.monday.com/forms/abc?r=use1"), "https://forms.monday.com/forms/abc?r=use1");
  assert.equal(normalizeUrl("  https://Example.com/Path "), "https://example.com/Path");
  assert.equal(normalizeUrl("", { allowEmpty: true }), "");
  assert.throws(() => normalizeUrl(""), /enter a link/);
  assert.throws(() => normalizeUrl("javascript:alert(1)"), /http/);
  assert.throws(() => normalizeUrl("not a url"), /web address/);
});

test("describeLink turns a monday form share link into its embed address", () => {
  const d = describeLink("https://forms.monday.com/forms/9f8e7d6c?r=use1");
  assert.equal(d.kind, "form");
  assert.equal(d.embedUrl, "https://forms.monday.com/forms/embed/9f8e7d6c?r=use1");
  assert.equal(describeLink("https://forms.monday.com/forms/embed/9f8e7d6c?r=use1").embedUrl, "https://forms.monday.com/forms/embed/9f8e7d6c?r=use1");
  assert.equal(describeLink("https://view.monday.com/1234567890-abc?r=use1").embedUrl, "https://view.monday.com/embed/1234567890-abc?r=use1");
  assert.equal(describeLink("https://acme.monday.com/boards/1234567890/views/1").kind, "monday");
  assert.equal(describeLink("https://acme.monday.com/boards/1234567890/views/1").boardId, "1234567890");
  assert.equal(describeLink("https://docs.google.com/x").kind, "web");
  assert.equal(boardIdFromUrl("https://acme.monday.com/boards/55/pulses/9"), "55");
  assert.equal(boardIdFromUrl("98765"), "98765");
  assert.equal(boardIdFromUrl("https://acme.monday.com/"), "");
});

// --- QR ---------------------------------------------------------------------------
test("QR codes scan back to the hub address", () => {
  for (const url of ["https://hub.up.railway.app/", "https://employee-hub-production-1234.up.railway.app/?lang=es"]) {
    const m = encodeQr(url);
    const scale = 4, margin = 4;
    const size = (m.length + margin * 2) * scale;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const mx = Math.floor(x / scale) - margin, my = Math.floor(y / scale) - margin;
        const dark = mx >= 0 && my >= 0 && mx < m.length && my < m.length && m[my][mx];
        const v = dark ? 0 : 255, i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
      }
    }
    const res = jsQR(data, size, size);
    assert.ok(res, "jsQR should decode the code");
    assert.equal(res.data, url);
  }
  const svg = toSvg(encodeQr("https://x.example/"), { title: "a <b>" });
  assert.match(svg, /^<svg /);
  assert.match(svg, /aria-label="a &lt;b&gt;"/);
  assert.throws(() => encodeQr("x".repeat(400)), /too long/);
});

// --- store validation ---------------------------------------------------------------
test("tiles validate and normalise", () => {
  const t = validateTile({ title: "PTO", url: "forms.monday.com/forms/abc", icon: "", open: "embed" });
  assert.equal(t.url, "https://forms.monday.com/forms/abc");
  assert.equal(t.icon, "link");
  assert.deepEqual(t.title, { en: "PTO", es: "" });
  assert.equal(validateTile({ title: { en: "x" } }).url, "");
  assert.throws(() => validateTile({ title: "" }), ValidationError);
  assert.throws(() => validateTile({ title: "x", url: "ftp://nope" }), /http/);
  assert.throws(() => validateTile({ title: "x", open: "popup" }), /Open mode/);
});

test("panels validate filters, highlight and board id", () => {
  const p = validatePanel({
    title: { en: "Out of service" }, boardId: "https://acme.monday.com/boards/111".replace(/.*\//, ""), columns: ["lift", "priority"],
    filters: [{ columnId: "status", op: "any_of", values: ["NEW"] }, { columnId: "__created__", op: "last_days", values: [" 14 "] }],
    highlight: { columns: ["priority"], values: ["Critical ⚠️️"], label: { en: "Critical" } }, limit: "12",
  });
  assert.equal(p.boardId, "111");
  assert.equal(p.limit, 12);
  assert.equal(p.filters[1].values[0], "14");
  assert.equal(validatePanel({ title: "x", boardId: "1", filters: [{ columnId: "d", op: "last_days", values: [] }] }).filters[0].values[0], "7");
  assert.throws(() => validatePanel({ title: "x", boardId: "1", filters: [{ columnId: "d", op: "last_days", values: ["x"] }] }), /Number of days/);
  assert.equal(p.highlight.columns[0], "priority");
  assert.equal(p.titleColumn, "name");
  assert.throws(() => validatePanel({ title: "x", boardId: "abc" }), /board/);
  assert.throws(() => validatePanel({ title: "x", boardId: "1", filters: [{ columnId: "status", op: "any_of", values: [] }] }), /at least one value/);
  assert.throws(() => validatePanel({ title: "x", boardId: "1", filters: [{ columnId: "status", op: "sideways" }] }), /condition/);
  assert.equal(validatePanel({ title: "x", boardId: "1", highlight: { columns: [], values: ["a"] } }).highlight, null);
});

test("settings validate time zone and languages", () => {
  const base = validateSettings({}, { hubName: { en: "Hub", es: "" }, languages: ["en", "es"], defaultLang: "es" });
  const s = validateSettings({ languages: ["es"], timeZone: "America/Chicago", idleReturnSeconds: "0" }, base);
  assert.deepEqual(s.languages, ["en", "es"]);
  assert.equal(s.timeZone, "America/Chicago");
  assert.equal(s.idleReturnSeconds, 0);
  assert.equal(validateSettings({ languages: ["en"] }, s).defaultLang, "en");
  assert.throws(() => validateSettings({ timeZone: "Mars/Olympus" }, base), /time zone/);
  assert.throws(() => validateSettings({ refreshSeconds: 5 }, base), /Refresh/);
});

// --- monday helpers ---------------------------------------------------------------------
test("status labels and rules translate to monday's query language", () => {
  const labels = parseLabels(JSON.stringify({ labels: { 0: "Working on it", 1: "Done", 5: "" } }));
  assert.deepEqual(labels, [{ id: "0", label: "Working on it" }, { id: "1", label: "Done" }]);
  const cols = [{ id: "status", type: "status", labels }, { id: "d", type: "date" }, { id: "t", type: "text" }];
  const rules = buildRules([
    { columnId: "status", op: "any_of", values: ["done", "WORKING ON IT"] },
    { columnId: "status", op: "any_of", values: ["Nope"] },           // unknown label → left to local filtering
    { columnId: "d", op: "today", values: [] },
    { columnId: "d", op: "past", values: [] },                         // not translated
    { columnId: "t", op: "contains", values: ["x"] },
    { columnId: "t", op: "is_empty", values: [] },
    { columnId: "__created__", op: "today", values: [] },              // special column → local only
  ], cols);
  assert.deepEqual(rules, [
    { column_id: "status", compare_value: [1, 0], operator: "any_of" },
    { column_id: "d", compare_value: ["TODAY"], operator: "any_of" },
    { column_id: "t", compare_value: ["x"], operator: "contains_text" },
    { column_id: "t", compare_value: [], operator: "is_empty" },
  ]);
});

test("local filters understand lists, dates and the hub time zone", () => {
  const ctx = { ...dateContext("America/New_York", new Date("2026-11-17T03:30:00Z")), tz: "America/New_York" }; // still Nov 16 in New York
  assert.equal(ctx.today, "2026-11-16");
  assert.equal(ctx.weekStart, "2026-11-15"); // Sunday
  const row = { name: "Lift 1", group: "Open", createdAt: "2026-11-17T02:00:00Z", values: {
    drop: { text: "LINDE #1, LINDE #2" }, st: { text: "Critical ⚠️️" }, d: { text: "2026-11-16", date: "2026-11-16" }, empty: { text: "" } } };
  assert.ok(matches(row, { columnId: "drop", op: "any_of", values: ["linde #2"] }, ctx));
  assert.ok(!matches(row, { columnId: "drop", op: "any_of", values: ["LINDE #3"] }, ctx));
  assert.ok(matches(row, { columnId: "st", op: "any_of", values: ["critical ⚠️"] }, ctx));
  assert.ok(matches(row, { columnId: "d", op: "today", values: [] }, ctx));
  assert.ok(matches(row, { columnId: "__created__", op: "today", values: [] }, ctx));
  assert.ok(matches(row, { columnId: "d", op: "this_week", values: [] }, ctx));
  assert.ok(matches(row, { columnId: "d", op: "last_days", values: ["3"] }, ctx));
  assert.ok(!matches(row, { columnId: "d", op: "future", values: [] }, ctx));
  assert.ok(matches(row, { columnId: "empty", op: "is_empty", values: [] }, ctx));
  assert.ok(matches(row, { columnId: "name", op: "contains", values: ["lift"] }, ctx));
  assert.ok(matches(row, { columnId: "__group__", op: "any_of", values: ["Open"] }, ctx));
  assert.ok(!matches(row, { columnId: "missing", op: "is_not_empty", values: [] }, ctx));
});

const PANEL = {
  id: "p1", boardId: "111", title: { en: "Out of service" }, titleColumn: "name", columns: ["lift", "priority", "mirror1"],
  filters: [{ columnId: "status", op: "any_of", values: ["NEW", "Working on it", "Pending Repair"] }],
  highlight: { columns: ["priority"], values: ["Critical ⚠️️"], label: { en: "Critical" } }, sort: "newest", limit: 10,
};

test("queryPanel reads, filters, sorts and flags rows", async () => {
  const fake = createFakeMonday();
  const monday = createMonday({ token: "tok", fetchImpl: fake.fetchImpl });
  const res = await monday.queryPanel(PANEL, { timeZone: "UTC" });
  assert.equal(res.board.name, "Forklift Down");
  assert.deepEqual(res.rows.map((r) => r.title), ["Horn not working", "Battery Issue"]);
  assert.equal(res.rows[0].flagged, true);
  assert.deepEqual(res.rows[0].flaggedColumns, ["Priority"]);
  assert.deepEqual(res.rows[0].details.map((d) => d.text), ["LINDE #2 - DOCK", "Critical ⚠️️", "Sam"]); // mirror uses display_value
  assert.equal(res.rows[1].flagged, false);
  const itemsQuery = fake.state.calls.find((c) => /items_page\(/.test(c.query)).query;
  assert.match(itemsQuery, /rules: \[\{column_id: "status", compare_value: \[3, 0, 4\], operator: any_of\}\]/);
  assert.match(itemsQuery, /order_by: \[\{column_id: "__creation_log__", direction: desc\}\]/);
  assert.equal(fake.state.calls[0].headers.Authorization, "tok");
});

test("queryPanel retries without query_params when monday rejects them", async () => {
  const fake = createFakeMonday({ mode: "reject-params" });
  const monday = createMonday({ token: "tok", fetchImpl: fake.fetchImpl, log: { warn() {} } });
  const res = await monday.queryPanel(PANEL, { timeZone: "UTC" });
  assert.equal(res.rows.length, 2);
  const itemQueries = fake.state.calls.filter((c) => /items_page\(/.test(c.query));
  assert.equal(itemQueries.length, 2);
  assert.ok(!/query_params/.test(itemQueries[1].query));
});

test("getPanelRows caches and serves the last good data when monday is down", async () => {
  let t = 1000000;
  const fake = createFakeMonday();
  const monday = createMonday({ token: "tok", fetchImpl: fake.fetchImpl, cacheSeconds: 45, now: () => t, log: { warn() {} } });
  const a = await monday.getPanelRows(PANEL, { timeZone: "UTC" });
  assert.equal(a.cached, false);
  const calls = fake.state.calls.length;
  const b = await monday.getPanelRows(PANEL, { timeZone: "UTC" });
  assert.equal(b.cached, true);
  assert.equal(fake.state.calls.length, calls);
  t += 60000;
  fake.state.mode = "down";
  const c = await monday.getPanelRows(PANEL, { timeZone: "UTC" });
  assert.equal(c.stale, true);
  assert.equal(c.rows.length, 2);
  assert.match(c.error, /Could not reach/);
  await assert.rejects(monday.getPanelRows({ ...PANEL, id: "fresh" }, { timeZone: "UTC" }), /Could not reach/);
  fake.state.mode = "bad-token";
  await assert.rejects(monday.me(), /rejected the API token/);
});

test("unconfigured client explains itself", async () => {
  const monday = createMonday({ token: "" });
  assert.equal(monday.configured, false);
  await assert.rejects(monday.listBoards(), /MONDAY_API_TOKEN/);
});
