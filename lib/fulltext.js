"use strict";

const fsp = require("fs/promises");
const path = require("path");
const AdmZip = require("adm-zip");
const { JsonFile } = require("./jsonfile");

const MAX_CHARS = 200000;
const MAX_ZIP_ENTRY = 20 * 1024 * 1024;

function tidy(text) {
  return String(text || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
}

/** Text from the XML parts of an Office file (docx/xlsx/pptx are zip files). */
function officeText(buf, ext) {
  const zip = new AdmZip(buf);
  const want = {
    docx: (n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n),
    xlsx: (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
    xlsm: (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
    pptx: (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n),
  }[ext];
  let out = "";
  for (const e of zip.getEntries()) {
    if (!want(e.entryName) || e.header.size > MAX_ZIP_ENTRY) continue;
    // Keep paragraph/cell breaks as spaces so words don't run together
    out += " " + e.getData().toString("utf8").replace(/<\/(w:p|a:p|si|c|row)>/g, " ").replace(/<[^>]+>/g, "");
    if (out.length > MAX_CHARS) break;
  }
  return out;
}

async function pdfText(buf) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function extract(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const buf = await fsp.readFile(filePath);
  if (ext === "pdf") return tidy(await pdfText(buf));
  if (["docx", "xlsx", "xlsm", "pptx"].includes(ext)) return tidy(officeText(buf, ext));
  if (["txt", "csv"].includes(ext)) return tidy(buf.toString("utf8"));
  return "";
}

/**
 * Searchable text pulled out of uploaded PDFs and Office files, so a search
 * finds words inside documents, not just in their titles.
 */
class FullText {
  constructor(dataDir) {
    this.file = new JsonFile(path.join(dataDir, "fulltext.json"), { docs: {} });
  }

  load() {
    const d = this.file.load();
    d.docs = d.docs || {};
  }

  has(resourceId, fileName) {
    const d = this.file.get().docs[resourceId];
    return Boolean(d && d.file === fileName);
  }

  async index(resourceId, fileName, filePath) {
    let text = "";
    try {
      text = await extract(filePath);
    } catch (err) {
      console.warn(`Couldn't read text from ${fileName}: ${err.message}`);
    }
    await this.file.update((d) => { d.docs[resourceId] = { file: fileName, text }; });
  }

  async remove(resourceId) {
    if (!this.file.get().docs[resourceId]) return;
    await this.file.update((d) => { delete d.docs[resourceId]; });
  }

  /** Resources whose document text contains every word, with a short snippet. */
  search(query, limit = 50) {
    const words = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
    if (!words.length) return [];
    const out = [];
    for (const [id, doc] of Object.entries(this.file.get().docs)) {
      const lower = doc.text.toLowerCase();
      if (!words.every((w) => lower.includes(w))) continue;
      const at = lower.indexOf(words[0]);
      const start = Math.max(0, at - 60);
      const snippet = (start > 0 ? "…" : "") + doc.text.slice(start, at + 120).trim() + "…";
      out.push({ id, snippet });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Make sure every uploaded resource file is indexed (runs in the background on start). */
  async catchUp(resources, pathFor) {
    for (const r of resources) {
      if (r.file && !this.has(r.id, r.file)) await this.index(r.id, r.file, pathFor(r.file));
    }
    const ids = new Set(resources.map((r) => r.id));
    for (const id of Object.keys(this.file.get().docs)) if (!ids.has(id)) await this.remove(id);
  }
}

module.exports = { FullText, extract };
