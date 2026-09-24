"use strict";

const path = require("path");
const { JsonFile } = require("./jsonfile");

/**
 * Counts how often each resource is opened (via /go/:id). Kept in memory and
 * saved at most every 10 seconds.
 */
class Stats {
  constructor(dataDir) {
    this.file = new JsonFile(path.join(dataDir, "stats.json"), { resources: {} });
    this.timer = null;
  }

  load() {
    const d = this.file.load();
    d.resources = d.resources || {};
  }

  get() {
    return this.file.get().resources;
  }

  record(resourceId) {
    const all = this.get();
    const month = new Date().toISOString().slice(0, 7);
    const s = all[resourceId] || (all[resourceId] = { count: 0, months: {} });
    s.count++;
    s.last = new Date().toISOString();
    s.months[month] = (s.months[month] || 0) + 1;
    // Keep the last 12 months only
    const keys = Object.keys(s.months).sort();
    while (keys.length > 12) delete s.months[keys.shift()];
    this.scheduleSave();
  }

  forget(resourceId) {
    delete this.get()[resourceId];
    this.scheduleSave();
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 10000);
    this.timer.unref();
  }

  flush() {
    return this.file.write(this.file.get()).catch((err) => console.error("Stats save failed:", err.message));
  }
}

module.exports = { Stats };
