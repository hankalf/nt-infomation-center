"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JsonFile } = require("./jsonfile");
const { normalizeUrl, describeLink } = require("./links");

const SEED = path.join(__dirname, "..", "seed", "content.json");

const LANGS = ["en", "es"];
const OPEN_MODES = ["embed", "tab"];
const SORTS = ["newest", "oldest", "board"];
const FILTER_OPS = [
  "any_of", "not_any_of", "contains", "not_contains", "is_empty", "is_not_empty",
  "today", "this_week", "this_month", "last_days", "past", "today_or_future", "future",
];
const SPECIAL_COLUMNS = ["name", "__group__", "__created__"];
const COLLECTIONS = ["tiles", "panels", "links"];

const DEFAULT_SETTINGS = {
  hubName: { en: "Employee Hub", es: "Portal del Empleado" },
  intro: { en: "Tap a tool to get started. Every submission goes straight to the right people.",
    es: "Toque una herramienta para comenzar. Cada envío llega directo a las personas correctas." },
  teamWord: { en: "team", es: "equipo" },
  languages: ["en", "es"],
  defaultLang: "en",
  idleReturnSeconds: 300,
  refreshSeconds: 60,
  publicUrl: "",
  timeZone: "America/New_York",
  showQr: true,
};

class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const newId = () => crypto.randomBytes(5).toString("base64url");

function str(v, max, label) {
  if (v == null) return "";
  if (typeof v !== "string") throw new ValidationError(`${label} must be text.`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${label} can be at most ${max} characters.`);
  return s;
}

/** Text in English and Spanish. Accepts a plain string (English) or {en, es}. */
function bilingual(v, max, label, { required = false } = {}) {
  const o = typeof v === "string" ? { en: v } : v && typeof v === "object" ? v : {};
  const out = { en: str(o.en, max, label), es: str(o.es, max, label) };
  if (required && !out.en) throw new ValidationError(`${label} (English) is required.`);
  return out;
}

function int(v, min, max, dflt, label) {
  if (v == null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label} must be a whole number between ${min} and ${max}.`);
  return n;
}

const bool = (v, dflt) => (v == null ? dflt : Boolean(v));

function oneOf(v, options, dflt, label) {
  if (v == null || v === "") return dflt;
  if (!options.includes(v)) throw new ValidationError(`${label} must be one of: ${options.join(", ")}.`);
  return v;
}

function columnId(v, label = "Column") {
  const s = str(v, 120, label);
  if (!s) throw new ValidationError(`${label} is required.`);
  if (!SPECIAL_COLUMNS.includes(s) && !/^[A-Za-z0-9_\-]+$/.test(s)) throw new ValidationError(`${label} id "${s}" is not valid.`);
  return s;
}

function stringList(v, max, maxLen, label) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  if (arr.length > max) throw new ValidationError(`${label}: at most ${max} entries.`);
  return arr.map((x) => str(x, maxLen, label)).filter(Boolean);
}

function url(v, label, allowEmpty) {
  try { return normalizeUrl(v, { allowEmpty }); } catch (e) { throw new ValidationError(`${label}: ${e.message}`); }
}

function validateTile(input, existing = {}) {
  const t = {
    id: existing.id || newId(),
    title: bilingual(input.title, 80, "Title", { required: true }),
    description: bilingual(input.description, 200, "Description"),
    icon: str(input.icon, 40, "Icon") || "link",
    url: url(input.url, "Link", true),
    open: oneOf(input.open, OPEN_MODES, "embed", "Open mode"),
    active: bool(input.active, true),
    code: str(input.code, 6, "Code"),
  };
  return t;
}

function validateLink(input, existing = {}) {
  return {
    id: existing.id || newId(),
    title: bilingual(input.title, 80, "Title", { required: true }),
    description: bilingual(input.description, 200, "Description"),
    icon: str(input.icon, 40, "Icon") || "link",
    url: url(input.url, "Link", false),
    open: oneOf(input.open, OPEN_MODES, "tab", "Open mode"),
    active: bool(input.active, true),
  };
}

function validateFilter(f) {
  if (!f || typeof f !== "object") throw new ValidationError("Each filter needs a column and a condition.");
  const op = oneOf(f.op, FILTER_OPS, null, "Filter condition");
  if (!op) throw new ValidationError("Each filter needs a condition.");
  const out = { columnId: columnId(f.columnId, "Filter column"), op, values: stringList(f.values, 30, 120, "Filter values") };
  if (["any_of", "not_any_of", "contains", "not_contains"].includes(op) && out.values.length === 0) {
    throw new ValidationError("That filter condition needs at least one value.");
  }
  if (op === "last_days") {
    const n = int(out.values[0], 1, 3650, 7, "Number of days");
    out.values = [String(n)];
  }
  return out;
}

function validatePanel(input, existing = {}) {
  const boardId = str(input.boardId, 20, "Board");
  if (!/^\d{1,20}$/.test(boardId)) throw new ValidationError("Pick a monday.com board (paste its link or ID).");
  const filters = Array.isArray(input.filters) ? input.filters : [];
  if (filters.length > 8) throw new ValidationError("At most 8 filters per panel.");
  let highlight = null;
  if (input.highlight && typeof input.highlight === "object") {
    const columns = stringList(input.highlight.columns, 40, 120, "Highlight columns").map((c) => columnId(c, "Highlight column"));
    const values = stringList(input.highlight.values, 30, 120, "Highlight values");
    if (columns.length && values.length) highlight = { columns, values, label: bilingual(input.highlight.label, 80, "Highlight label") };
  }
  const columns = stringList(input.columns, 6, 120, "Columns to show").map((c) => columnId(c, "Column"));
  return {
    id: existing.id || newId(),
    title: bilingual(input.title, 80, "Title", { required: true }),
    subtitle: bilingual(input.subtitle, 200, "Subtitle"),
    icon: str(input.icon, 40, "Icon") || "board",
    boardId,
    boardName: str(input.boardName, 120, "Board name"),
    titleColumn: input.titleColumn ? columnId(input.titleColumn, "Title column") : "name",
    columns: [...new Set(columns)],
    filters: filters.map(validateFilter),
    highlight,
    sort: oneOf(input.sort, SORTS, "newest", "Sort"),
    limit: int(input.limit, 1, 50, 10, "Items to show"),
    showTime: bool(input.showTime, true),
    emptyText: bilingual(input.emptyText, 120, "Empty message"),
    linkUrl: url(input.linkUrl, "Board link", true),
    active: bool(input.active, true),
  };
}

function validateSettings(input, current) {
  const s = { ...current };
  if (input.hubName !== undefined) s.hubName = bilingual(input.hubName, 60, "Hub name", { required: true });
  if (input.intro !== undefined) s.intro = bilingual(input.intro, 200, "Intro");
  if (input.teamWord !== undefined) s.teamWord = bilingual(input.teamWord, 40, "Greeting word");
  if (input.languages !== undefined) {
    const langs = stringList(input.languages, 5, 5, "Languages").filter((l) => LANGS.includes(l));
    if (!langs.includes("en")) langs.unshift("en");
    s.languages = LANGS.filter((l) => langs.includes(l));
  }
  if (input.defaultLang !== undefined) s.defaultLang = oneOf(input.defaultLang, LANGS, "en", "Default language");
  if (!s.languages.includes(s.defaultLang)) s.defaultLang = s.languages[0];
  if (input.idleReturnSeconds !== undefined) s.idleReturnSeconds = int(input.idleReturnSeconds, 0, 3600, 300, "Return to home after");
  if (input.refreshSeconds !== undefined) s.refreshSeconds = int(input.refreshSeconds, 15, 3600, 60, "Refresh every");
  if (input.publicUrl !== undefined) s.publicUrl = url(input.publicUrl, "Public address", true);
  if (input.showQr !== undefined) s.showQr = Boolean(input.showQr);
  if (input.timeZone !== undefined) {
    const tz = str(input.timeZone, 60, "Time zone") || DEFAULT_SETTINGS.timeZone;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch (e) { throw new ValidationError(`"${tz}" is not a valid time zone (try America/New_York).`); }
    s.timeZone = tz;
  }
  return s;
}

/** Spanish display names for values that come from boards, e.g. {"NEW": "NUEVO"}. */
function validateOptionLabels(input) {
  const out = {};
  if (!input || typeof input !== "object") return { es: {} };
  for (const lang of LANGS) {
    if (lang === "en") continue;
    const map = input[lang];
    out[lang] = {};
    if (!map || typeof map !== "object") continue;
    const entries = Object.entries(map);
    if (entries.length > 500) throw new ValidationError("At most 500 translated values.");
    for (const [k, v] of entries) {
      const key = str(k, 120, "Value"), val = str(v, 120, "Translation");
      if (key && val) out[lang][key] = val;
    }
  }
  return out;
}

/**
 * Everything the hub shows is kept in content.json inside DATA_DIR. On Railway,
 * DATA_DIR should be a mounted Volume so it survives redeploys.
 */
class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.contentPath = path.join(dataDir, "content.json");
    this.file = new JsonFile(this.contentPath, {});
  }

  init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.contentPath)) {
      fs.copyFileSync(SEED, this.contentPath);
      console.log(`Seeded starter content into ${this.dataDir}`);
    }
    const c = this.file.load();
    for (const k of COLLECTIONS) c[k] = Array.isArray(c[k]) ? c[k] : [];
    c.settings = { ...DEFAULT_SETTINGS, ...(c.settings || {}) };
    c.optionLabels = c.optionLabels && typeof c.optionLabels === "object" ? c.optionLabels : { es: {} };
  }

  get() {
    return this.file.get();
  }

  update(mutator) {
    return this.file.update(mutator);
  }

  find(collection, id) {
    return this.get()[collection].find((x) => x.id === id);
  }

  async add(collection, input) {
    const item = validators[collection](input || {});
    await this.update((c) => { c[collection].push(item); });
    return item;
  }

  async edit(collection, id, input) {
    const existing = this.find(collection, id);
    if (!existing) throw new ValidationError("That item no longer exists.", 404);
    const item = validators[collection]({ ...existing, ...(input || {}) }, existing);
    await this.update((c) => {
      const i = c[collection].findIndex((x) => x.id === id);
      c[collection][i] = item;
    });
    return item;
  }

  async remove(collection, id) {
    if (!this.find(collection, id)) throw new ValidationError("That item no longer exists.", 404);
    await this.update((c) => { c[collection] = c[collection].filter((x) => x.id !== id); });
  }

  /** Put `ids` first, in that order; anything not listed keeps its relative order after them. */
  async reorder(collection, ids) {
    if (!Array.isArray(ids)) throw new ValidationError("Expected a list of ids.");
    await this.update((c) => {
      const byId = new Map(c[collection].map((x) => [x.id, x]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      const rest = c[collection].filter((x) => !ids.includes(x.id));
      c[collection] = [...ordered, ...rest];
    });
  }

  async saveSettings(input) {
    const next = validateSettings(input || {}, this.get().settings);
    await this.update((c) => { c.settings = next; });
    return next;
  }

  async saveOptionLabels(input) {
    const next = validateOptionLabels(input);
    await this.update((c) => { c.optionLabels = next; });
    return next;
  }

  /** What the kiosk (anyone with the address) is allowed to see. Board ids and filters stay private. */
  publicView() {
    const c = this.get();
    const linkFields = (l) => {
      const d = describeLink(l.url);
      return { id: l.id, title: l.title, description: l.description, icon: l.icon, url: l.url, open: l.open, kind: d.kind, embedUrl: d.embedUrl };
    };
    return {
      settings: {
        hubName: c.settings.hubName, intro: c.settings.intro, teamWord: c.settings.teamWord,
        languages: c.settings.languages, defaultLang: c.settings.defaultLang,
        idleReturnSeconds: c.settings.idleReturnSeconds, refreshSeconds: c.settings.refreshSeconds,
        showQr: c.settings.showQr, timeZone: c.settings.timeZone,
      },
      tiles: c.tiles.filter((t) => t.active).map((t) => ({
        id: t.id, title: t.title, description: t.description, icon: t.icon, code: t.code, open: t.open,
        url: t.url, embedUrl: t.url ? describeLink(t.url).embedUrl : "", kind: t.url ? describeLink(t.url).kind : "none",
      })),
      links: c.links.filter((l) => l.active).map(linkFields),
      panels: c.panels.filter((p) => p.active).map((p) => ({
        id: p.id, title: p.title, subtitle: p.subtitle, icon: p.icon, emptyText: p.emptyText,
        linkUrl: p.linkUrl, limit: p.limit, showTime: p.showTime, highlightLabel: p.highlight ? p.highlight.label : null,
      })),
      optionLabels: c.optionLabels,
    };
  }
}

const validators = { tiles: validateTile, panels: validatePanel, links: validateLink };

module.exports = {
  Store, ValidationError, validateTile, validatePanel, validateLink, validateSettings, validateOptionLabels,
  LANGS, OPEN_MODES, SORTS, FILTER_OPS, SPECIAL_COLUMNS, COLLECTIONS, DEFAULT_SETTINGS,
};
