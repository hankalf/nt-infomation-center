"use strict";

const fs = require("fs");
const fsp = require("fs/promises");

/**
 * A JSON document on disk, kept in memory. Updates are serialised and written
 * atomically (write to a temp file, then rename) so a crash can't leave a
 * half-written file behind.
 */
class JsonFile {
  constructor(path, defaults) {
    this.path = path;
    this.defaults = defaults;
    this.data = null;
    this.queue = Promise.resolve();
  }

  load() {
    if (fs.existsSync(this.path)) {
      this.data = JSON.parse(fs.readFileSync(this.path, "utf8"));
    } else {
      this.data = typeof this.defaults === "function" ? this.defaults() : structuredClone(this.defaults);
    }
    return this.data;
  }

  get() {
    return this.data;
  }

  async write(data) {
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
    await fsp.rename(tmp, this.path);
  }

  /** Run `mutator(draft)`; if it doesn't throw, persist the draft and return its result. */
  update(mutator) {
    const run = async () => {
      const draft = structuredClone(this.data);
      const result = await mutator(draft);
      await this.write(draft);
      this.data = draft;
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

module.exports = { JsonFile };
