"use strict";

const path = require("path");
const multer = require("multer");
const { ValidationError, newId, slug } = require("./store");

const DOC_EXT = new Set([
  "pdf", "doc", "docx", "dotx", "rtf", "odt", "txt",
  "xls", "xlsx", "xlsm", "xlsb", "xltm", "xltx", "xlam", "csv", "ods",
  "ppt", "pptx", "ppsx", "odp",
  "png", "jpg", "jpeg", "gif", "webp",
  "mp4", "mov", "webm",
  "zip", "msg", "eml", "vsdx", "bas",
]);
const LOGO_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const PHOTO_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const extOf = (name) => path.extname(name).slice(1).toLowerCase();

/** Multer instances for the different kinds of upload. */
function createUploaders({ uploadsDir, tmpDir, maxUploadMb, maxRestoreMb }) {
  const toUploads = (prefix) => multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = extOf(file.originalname);
      const base = prefix || slug(path.basename(file.originalname, path.extname(file.originalname))) || "file";
      cb(null, `${base}-${newId().slice(0, 6)}.${ext}`);
    },
  });
  const only = (allowed, message) => (req, file, cb) => {
    if (allowed.has(extOf(file.originalname))) return cb(null, true);
    cb(new ValidationError(typeof message === "function" ? message(file) : message));
  };
  const docMessage = (file) =>
    `${file.originalname}: .${extOf(file.originalname) || "?"} files aren't allowed. Allowed: ${[...DOC_EXT].join(", ")}`;

  return {
    doc: multer({ storage: toUploads(), limits: { fileSize: maxUploadMb * 1048576, files: 1 }, fileFilter: only(DOC_EXT, docMessage) }),
    bulk: multer({ storage: toUploads(), limits: { fileSize: maxUploadMb * 1048576, files: 30 }, fileFilter: only(DOC_EXT, docMessage) }),
    logo: multer({ storage: toUploads("logo"), limits: { fileSize: 5 * 1048576, files: 1 },
      fileFilter: only(LOGO_EXT, "The logo must be an image: PNG, JPG, GIF, WebP or SVG.") }),
    photo: multer({ storage: toUploads("photo"), limits: { fileSize: 5 * 1048576, files: 1 },
      fileFilter: only(PHOTO_EXT, "Photos must be PNG, JPG, GIF or WebP.") }),
    restore: multer({ dest: tmpDir, limits: { fileSize: maxRestoreMb * 1048576, files: 1 },
      fileFilter: only(new Set(["zip"]), "Choose a backup .zip file.") }),
  };
}

/** "SOP-Goods_In receiving v2.pdf" → "SOP Goods In receiving v2" */
function titleFromFilename(name) {
  return path.basename(name, path.extname(name)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "Untitled";
}

module.exports = { createUploaders, titleFromFilename, DOC_EXT };
