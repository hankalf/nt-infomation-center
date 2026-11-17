"use strict";

/**
 * A small monday.com GraphQL client for reading boards into kiosk panels.
 *
 * Design notes:
 *  - Filters are always applied here on the server (the source of truth). When
 *    we are confident of monday's own filter syntax for a column type (status
 *    labels, date "TODAY", empty/not empty, text contains) we also send the
 *    filter to monday so fewer items come back.
 *  - If monday rejects a query, we retry without filters/sorting, then with the
 *    simplest possible column fields, so a syntax difference never blanks a panel.
 *  - Results are cached per panel; if monday is unreachable the last good data
 *    is shown with a warning instead of an empty panel.
 */

const ENDPOINT = "https://api.monday.com/v2";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

class MondayError extends Error {
  constructor(message, { status = 502, code = "monday", details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const STATUS_TYPES = ["status", "color"];
const DATE_TYPES = ["date"];
const TEXT_TYPES = ["text", "long_text", "long-text"];
const SERVER_DATE_VALUES = { today: "TODAY", this_week: "THIS_WEEK", this_month: "THIS_MONTH" };

const gqlString = (s) => JSON.stringify(String(s));

/** Status columns keep their labels in settings_str: {"labels":{"0":"Working on it","1":"Done"}}; dropdowns use [{id,name}]. */
function parseLabels(settingsStr) {
  try {
    const s = JSON.parse(settingsStr || "{}");
    if (!s || !s.labels) return null;
    if (Array.isArray(s.labels)) return s.labels.map((l) => ({ id: String(l.id), label: String(l.name == null ? l.label : l.name) }));
    return Object.entries(s.labels).map(([k, v]) => ({ id: String(k), label: String(v) })).filter((x) => x.label !== "");
  } catch (e) {
    return null;
  }
}

/** Lower-case, trimmed, emoji variation selectors removed, so "Critical ⚠️️" matches "critical ⚠️". */
const norm = (s) => String(s == null ? "" : s).replace(/[︎️]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// --- dates in the hub's time zone -------------------------------------------------

function ymdInTz(date, tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}
const ymdToUtc = (ymd) => new Date(`${ymd}T12:00:00Z`);
const addDays = (ymd, n) => new Date(ymdToUtc(ymd).getTime() + n * 86400000).toISOString().slice(0, 10);

/** Today, and the Sunday–Saturday week around it. */
function dateContext(tz, now = new Date()) {
  const today = ymdInTz(now, tz);
  const dow = ymdToUtc(today).getUTCDay();
  return { today, weekStart: addDays(today, -dow), weekEnd: addDays(today, 6 - dow) };
}

// --- filters -----------------------------------------------------------------------

function cellText(row, columnId) {
  if (columnId === "name") return row.name || "";
  if (columnId === "__group__") return row.group || "";
  if (columnId === "__created__") return row.createdAt || "";
  const v = row.values[columnId];
  return v ? v.text || "" : "";
}

function cellDate(row, columnId, tz) {
  if (columnId === "__created__") return row.createdAt ? ymdInTz(new Date(row.createdAt), tz) : "";
  const v = row.values[columnId];
  if (!v) return "";
  if (v.date) return v.date;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.text || "");
  return m ? m[1] : "";
}

/** Does this row pass one filter? */
function matches(row, f, ctx) {
  const text = cellText(row, f.columnId);
  const parts = text.split(",").map(norm).filter(Boolean); // dropdown / people columns list several values
  const whole = norm(text);
  const vals = (f.values || []).map(norm);
  const anyOf = () => vals.some((v) => whole === v || parts.includes(v));
  const contains = () => vals.some((v) => whole.includes(v));
  const d = () => cellDate(row, f.columnId, ctx.tz);
  switch (f.op) {
    case "any_of": return anyOf();
    case "not_any_of": return !anyOf();
    case "contains": return contains();
    case "not_contains": return !contains();
    case "is_empty": return whole === "";
    case "is_not_empty": return whole !== "";
    case "today": return d() === ctx.today;
    case "this_week": { const x = d(); return Boolean(x) && x >= ctx.weekStart && x <= ctx.weekEnd; }
    case "this_month": return d().slice(0, 7) === ctx.today.slice(0, 7);
    case "last_days": { const n = parseInt(f.values && f.values[0], 10) || 7; const x = d(); return Boolean(x) && x >= addDays(ctx.today, -n) && x <= ctx.today; }
    case "past": { const x = d(); return Boolean(x) && x < ctx.today; }
    case "today_or_future": { const x = d(); return Boolean(x) && x >= ctx.today; }
    case "future": { const x = d(); return Boolean(x) && x > ctx.today; }
    default: return true;
  }
}

/** The subset of filters we can also express in monday's query language, so fewer items come back. */
function buildRules(filters, columns) {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const rules = [];
  for (const f of filters) {
    const col = byId.get(f.columnId);
    if (!col) continue; // name / group / created-at filters run locally
    const type = String(col.type || "").toLowerCase();
    if (f.op === "is_empty" || f.op === "is_not_empty") {
      rules.push({ column_id: col.id, compare_value: [], operator: f.op });
    } else if (STATUS_TYPES.includes(type) && (f.op === "any_of" || f.op === "not_any_of") && col.labels) {
      const idx = f.values.map((v) => col.labels.find((l) => norm(l.label) === norm(v))).filter(Boolean).map((l) => Number(l.id));
      if (idx.length && idx.length === f.values.length) rules.push({ column_id: col.id, compare_value: idx, operator: f.op });
    } else if (DATE_TYPES.includes(type) && SERVER_DATE_VALUES[f.op]) {
      rules.push({ column_id: col.id, compare_value: [SERVER_DATE_VALUES[f.op]], operator: "any_of" });
    } else if (TEXT_TYPES.includes(type) && f.op === "contains" && f.values.length === 1) {
      rules.push({ column_id: col.id, compare_value: [f.values[0]], operator: "contains_text" });
    }
  }
  return rules;
}

function ruleLiteral(r) {
  const vals = r.compare_value.map((v) => (typeof v === "number" ? String(v) : gqlString(v))).join(", ");
  return `{column_id: ${gqlString(r.column_id)}, compare_value: [${vals}], operator: ${r.operator}}`;
}

const CV_FULL = `id type text value
          ... on StatusValue { label index }
          ... on DateValue { date time }
          ... on MirrorValue { display_value }
          ... on BoardRelationValue { display_value }
          ... on FormulaValue { display_value }`;
const CV_SIMPLE = "id type text value";
const itemFields = (cv) => `id name created_at updated_at group { id title } column_values { ${cv} }`;

/** Flatten one API item into { id, name, createdAt, group, values: { [columnId]: { text, date, label } } }. */
function normalizeItem(item) {
  const values = {};
  for (const cv of item.column_values || []) {
    let text = cv.text;
    if ((text == null || text === "") && cv.display_value != null) text = cv.display_value;
    if ((text == null || text === "") && cv.label != null) text = cv.label;
    values[cv.id] = { text: text == null ? "" : String(text), type: cv.type || "", date: cv.date || "", label: cv.label == null ? undefined : cv.label };
  }
  return { id: String(item.id), name: item.name || "", createdAt: item.created_at || "", updatedAt: item.updated_at || "", group: item.group ? item.group.title || "" : "", values };
}

function createMonday({ token = "", fetchImpl = globalThis.fetch, cacheSeconds = 45, apiVersion = "", now = () => Date.now(), log = console } = {}) {
  const configured = Boolean(token);
  const boardCache = new Map();  // boardId → { at, data }
  const panelCache = new Map();  // panelId → { at, hash, data }
  const inflight = new Map();    // panelId → Promise
  let boardsList = null;         // { at, data }
  let meCache = null;

  async function gql(query) {
    if (!configured) throw new MondayError("monday.com is not connected. Set MONDAY_API_TOKEN on the service.", { code: "not_configured" });
    const headers = { "Content-Type": "application/json", Authorization: token };
    if (apiVersion) headers["API-Version"] = apiVersion;
    let res;
    try {
      res = await fetchImpl(ENDPOINT, { method: "POST", headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000) });
    } catch (e) {
      throw new MondayError(`Could not reach monday.com (${e.name === "TimeoutError" ? "timed out" : e.message}).`, { code: "network" });
    }
    if (res.status === 401 || res.status === 403) throw new MondayError("monday.com rejected the API token. Check MONDAY_API_TOKEN.", { code: "auth" });
    if (res.status === 429) throw new MondayError("monday.com rate limit reached. Try again in a minute.", { code: "rate" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) throw new MondayError(`monday.com returned HTTP ${res.status}.`, { code: "http" });
    if (Array.isArray(json.errors) && json.errors.length) {
      const msg = json.errors.map((e) => e.message).filter(Boolean).join("; ") || "monday.com rejected the query.";
      throw new MondayError(msg, { code: "graphql", details: json.errors });
    }
    if (json.error_message) throw new MondayError(json.error_message, { code: json.error_code || "graphql" });
    return json.data || {};
  }

  /** Who the token belongs to. */
  async function me() {
    if (meCache && now() - meCache.at < 10 * 60000) return meCache.data;
    const data = await gql("query { me { name email account { name slug } } }");
    meCache = { at: now(), data: data.me };
    return data.me;
  }

  /** Boards this token can see, most recently used first (subitem boards hidden). */
  async function listBoards() {
    if (boardsList && now() - boardsList.at < 60000) return boardsList.data;
    const data = await gql("query { boards(limit: 200, order_by: used_at, state: active) { id name url workspace { name } } }");
    const boards = (data.boards || [])
      .filter((b) => b && !/^Subitems of /i.test(b.name || ""))
      .map((b) => ({ id: String(b.id), name: b.name, url: b.url || "", workspace: b.workspace ? b.workspace.name || "" : "" }));
    boardsList = { at: now(), data: boards };
    return boards;
  }

  /** A board's name, columns (with status/dropdown labels) and groups. Cached for 5 minutes. */
  async function getBoard(boardId, { fresh = false } = {}) {
    const id = String(boardId);
    const hit = boardCache.get(id);
    if (hit && !fresh && now() - hit.at < 5 * 60000) return hit.data;
    const data = await gql(`query { boards(ids: [${Number(id)}]) { id name url workspace { name } columns { id title type settings_str } groups { id title } } }`);
    const b = data.boards && data.boards[0];
    if (!b) throw new MondayError("That board was not found, or the API token can't see it.", { status: 404, code: "not_found" });
    const board = {
      id: String(b.id), name: b.name, url: b.url || "", workspace: b.workspace ? b.workspace.name || "" : "",
      columns: (b.columns || []).map((c) => ({ id: c.id, title: c.title, type: c.type, labels: parseLabels(c.settings_str) })),
      groups: (b.groups || []).map((g) => ({ id: g.id, title: g.title })),
    };
    boardCache.set(id, { at: now(), data: board });
    return board;
  }

  async function fetchPage(boardId, cursor, { rules, orderBy, cv }) {
    if (!cursor) {
      const params = [];
      if (rules.length) params.push(`rules: [${rules.map(ruleLiteral).join(", ")}]`);
      if (orderBy) params.push(`order_by: [{column_id: "__creation_log__", direction: ${orderBy}}]`);
      const qp = params.length ? `, query_params: {${params.join(", ")}}` : "";
      const data = await gql(`query { boards(ids: [${Number(boardId)}]) { items_page(limit: ${PAGE_SIZE}${qp}) { cursor items { ${itemFields(cv)} } } } }`);
      const page = data.boards && data.boards[0] && data.boards[0].items_page;
      if (!page) throw new MondayError("That board was not found, or the API token can't see it.", { status: 404, code: "not_found" });
      return page;
    }
    const data = await gql(`query { next_items_page(limit: ${PAGE_SIZE}, cursor: ${gqlString(cursor)}) { cursor items { ${itemFields(cv)} } } }`);
    return data.next_items_page || { cursor: null, items: [] };
  }

  /** Read, filter and sort a board for one panel. */
  async function queryPanel(panel, { timeZone } = {}) {
    const board = await getBoard(panel.boardId);
    const ctx = { ...dateContext(timeZone || "UTC", new Date(now())), tz: timeZone || "UTC" };
    const filters = panel.filters || [];
    const limit = Math.min(Math.max(Number(panel.limit) || 10, 1), 50);
    const orderBy = panel.sort === "oldest" ? "asc" : panel.sort === "board" ? null : "desc";
    const plans = [
      { rules: buildRules(filters, board.columns), orderBy, cv: CV_FULL, sortedByServer: Boolean(orderBy) },
      { rules: [], orderBy: null, cv: CV_FULL, sortedByServer: false },
      { rules: [], orderBy: null, cv: CV_SIMPLE, sortedByServer: false },
    ];
    let rows = null;
    let lastErr = null;
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      if (i > 0 && plans[i - 1].rules.length === 0 && plans[i - 1].orderBy === null && plan.cv === plans[i - 1].cv) continue; // identical to the last attempt
      try {
        rows = [];
        let cursor = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await fetchPage(panel.boardId, cursor, plan);
          for (const item of res.items || []) {
            const row = normalizeItem(item);
            if (filters.every((f) => matches(row, f, ctx))) rows.push(row);
          }
          cursor = res.cursor;
          // Stop early when the order is already right and we have enough.
          if (!cursor || ((plan.sortedByServer || panel.sort === "board") && rows.length >= limit)) break;
        }
        break;
      } catch (e) {
        lastErr = e;
        if (!(e instanceof MondayError) || e.code !== "graphql") throw e;
        log.warn(`monday.com rejected panel query (attempt ${i + 1}): ${e.message}`);
        rows = null;
      }
    }
    if (!rows) throw lastErr || new MondayError("Could not read the board.");

    if (panel.sort === "newest") rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    else if (panel.sort === "oldest") rows.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

    const colTitle = (id) => {
      if (id === "name") return "Name";
      if (id === "__group__") return "Group";
      if (id === "__created__") return "Created";
      const c = board.columns.find((x) => x.id === id);
      return c ? c.title : id;
    };
    const hl = panel.highlight;
    return {
      board: { id: board.id, name: board.name },
      rows: rows.slice(0, limit).map((row) => {
        const flaggedColumns = hl ? hl.columns.filter((cid) => matches(row, { columnId: cid, op: "any_of", values: hl.values }, ctx)).map(colTitle) : [];
        const title = panel.titleColumn && panel.titleColumn !== "name" ? cellText(row, panel.titleColumn) || row.name : row.name;
        return {
          id: row.id,
          title,
          details: (panel.columns || []).filter((cid) => cid !== panel.titleColumn).map((cid) => ({ id: cid, title: colTitle(cid), text: cellText(row, cid) })).filter((d) => d.text),
          flagged: flaggedColumns.length > 0,
          flaggedColumns,
          createdAt: row.createdAt,
          group: row.group,
        };
      }),
    };
  }

  /** Cached wrapper: fresh data when possible, last good data (marked stale) when monday is unavailable. */
  async function getPanelRows(panel, opts = {}) {
    const hash = JSON.stringify([panel.boardId, panel.filters, panel.columns, panel.titleColumn, panel.highlight, panel.sort, panel.limit, opts.timeZone]);
    const hit = panelCache.get(panel.id);
    if (hit && hit.hash === hash && now() - hit.at < cacheSeconds * 1000) return { ...hit.data, fetchedAt: hit.at, stale: false, cached: true };
    if (inflight.has(panel.id)) return inflight.get(panel.id);
    const p = (async () => {
      try {
        const data = await queryPanel(panel, opts);
        panelCache.set(panel.id, { at: now(), hash, data });
        return { ...data, fetchedAt: now(), stale: false, cached: false };
      } catch (e) {
        if (hit && hit.hash === hash) {
          log.warn(`monday.com panel refresh failed, showing cached data: ${e.message}`);
          return { ...hit.data, fetchedAt: hit.at, stale: true, error: e.message };
        }
        throw e;
      } finally {
        inflight.delete(panel.id);
      }
    })();
    inflight.set(panel.id, p);
    return p;
  }

  function forget(panelId) {
    panelCache.delete(panelId);
  }

  return { configured, gql, me, listBoards, getBoard, queryPanel, getPanelRows, forget };
}

module.exports = { createMonday, MondayError, buildRules, matches, normalizeItem, parseLabels, dateContext, norm, ENDPOINT };
