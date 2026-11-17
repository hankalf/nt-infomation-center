"use strict";

/**
 * A stand-in for api.monday.com used by the tests: answers the GraphQL queries
 * the hub sends with fixture data. `opts.mode` changes behaviour:
 *   "ok" (default)       everything works
 *   "reject-params"      queries that use query_params fail with a GraphQL error (tests the retry without filters)
 *   "down"               fetch throws (tests the stale-cache fallback)
 *   "bad-token"          HTTP 401
 */
function createFakeMonday(opts = {}) {
  const state = { mode: opts.mode || "ok", calls: [], items: opts.items || defaultItems() };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  async function fetchImpl(url, init) {
    const query = JSON.parse(init.body).query;
    state.calls.push({ query, headers: init.headers });
    if (state.mode === "down") throw new TypeError("fetch failed");
    if (state.mode === "bad-token") return json({ errors: [{ message: "Not Authenticated" }] }, 401);
    if (/\bme\s*\{/.test(query)) return json({ data: { me: { name: "Pat Lead", email: "pat@example.com", account: { name: "Acme Cold Storage", slug: "acme" } } } });
    if (/boards\(limit: 200/.test(query)) {
      return json({ data: { boards: [
        { id: "111", name: "Forklift Down", url: "https://acme.monday.com/boards/111", workspace: { name: "Warehouse" } },
        { id: "222", name: "Subitems of Forklift Down", url: "", workspace: { name: "Warehouse" } },
        { id: "333", name: "PTO Requests", url: "https://acme.monday.com/boards/333", workspace: { name: "HR" } },
      ] } });
    }
    if (/columns \{ id title type settings_str \}/.test(query)) {
      const id = /ids: \[(\d+)\]/.exec(query)[1];
      if (id !== "111") return json({ data: { boards: [] } });
      return json({ data: { boards: [{
        id: "111", name: "Forklift Down", url: "https://acme.monday.com/boards/111", workspace: { name: "Warehouse" },
        columns: [
          { id: "name", title: "Name", type: "name", settings_str: "{}" },
          { id: "status", title: "Status", type: "status", settings_str: JSON.stringify({ labels: { 0: "Working on it", 1: "Done", 2: "Stuck", 3: "NEW", 4: "Pending Repair", 5: "" } }) },
          { id: "priority", title: "Priority", type: "status", settings_str: JSON.stringify({ labels: { 0: "Low", 1: "Medium", 2: "Critical ⚠️️" } }) },
          { id: "lift", title: "Lift number", type: "dropdown", settings_str: JSON.stringify({ labels: [{ id: 1, name: "LINDE #1 - CLAMP" }, { id: 2, name: "LINDE #2 - DOCK" }] }) },
          { id: "date4", title: "Reported", type: "date", settings_str: "{}" },
          { id: "text", title: "Details", type: "text", settings_str: "{}" },
          { id: "mirror1", title: "Tech", type: "mirror", settings_str: "{}" },
        ],
        groups: [{ id: "topics", title: "Open" }, { id: "done", title: "Fixed" }],
      }] } });
    }
    if (/items_page\(/.test(query)) {
      if (state.mode === "reject-params" && /query_params/.test(query)) {
        return json({ errors: [{ message: "Argument 'rules' on InputObject 'ItemsQuery' has an invalid value", extensions: { code: "argumentLiteralsIncompatible" } }] });
      }
      const id = /ids: \[(\d+)\]/.exec(query)[1];
      if (id !== "111") return json({ data: { boards: [] } });
      return json({ data: { boards: [{ items_page: { cursor: null, items: state.items } }] } });
    }
    if (/next_items_page/.test(query)) return json({ data: { next_items_page: { cursor: null, items: [] } } });
    return json({ errors: [{ message: "Unknown query in fake monday: " + query.slice(0, 80) }] });
  }
  return { fetchImpl, state };
}

function item(id, name, created, cols) {
  return { id, name, created_at: created, updated_at: created, group: { id: "topics", title: "Open" },
    column_values: Object.entries(cols).map(([cid, v]) => ({ id: cid, type: v.type || "text", text: v.text, value: null, ...(v.extra || {}) })) };
}

function defaultItems() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    item("1", "Horn not working", `${today}T08:00:00Z`, { status: { type: "status", text: "NEW", extra: { label: "NEW", index: 3 } }, priority: { type: "status", text: "Critical ⚠️️" }, lift: { type: "dropdown", text: "LINDE #2 - DOCK" }, date4: { type: "date", text: today, extra: { date: today } }, text: { text: "Wheel making noise" }, mirror1: { type: "mirror", text: null, extra: { display_value: "Sam" } } }),
    item("2", "Battery Issue", `${today}T06:00:00Z`, { status: { type: "status", text: "Working on it" }, priority: { type: "status", text: "Low" }, lift: { type: "dropdown", text: "LINDE #1 - CLAMP" }, date4: { type: "date", text: "2024-01-05", extra: { date: "2024-01-05" } }, text: { text: "" } }),
    item("3", "Drive Wheel", "2024-01-02T10:00:00Z", { status: { type: "status", text: "Done" }, priority: { type: "status", text: "Medium" }, lift: { type: "dropdown", text: "LINDE #1 - CLAMP" }, date4: { type: "date", text: "2024-01-02", extra: { date: "2024-01-02" } }, text: { text: "fixed" } }),
  ];
}

module.exports = { createFakeMonday, defaultItems };
