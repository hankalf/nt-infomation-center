"use strict";

/**
 * Minimal QR code encoder: byte mode, error correction level L, versions 1–9
 * (up to 230 bytes), fixed mask 0. Enough for the hub's web address, with no
 * dependencies. Ported from the original Employee Hub.
 */

const ECC = [7, 10, 15, 20, 26, 18, 20, 24, 30];
const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2];

function rawModules(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}

function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(d) {
  const r = new Array(d).fill(0);
  r[d - 1] = 1;
  let root = 1;
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      r[j] = mul(r[j], root);
      if (j + 1 < d) r[j] ^= r[j + 1];
    }
    root = mul(root, 2);
  }
  return r;
}

function remainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ (r.shift() || 0);
    r.push(0);
    div.forEach((c, i) => { r[i] ^= mul(c, f); });
  }
  return r;
}

/** Returns a square matrix of booleans (true = dark module). Throws if the text is too long. */
function encodeQr(text) {
  const bytes = Array.from(Buffer.from(String(text), "utf8"));
  let ver = 1;
  for (; ver <= 9; ver++) {
    const cap = Math.floor(rawModules(ver) / 8) - ECC[ver - 1] * BLOCKS[ver - 1];
    if (4 + 8 + bytes.length * 8 <= cap * 8) break;
  }
  if (ver > 9) throw new Error("Text too long for QR");
  const ecc = ECC[ver - 1];
  const nb = BLOCKS[ver - 1];
  const raw = Math.floor(rawModules(ver) / 8);
  const cap = raw - ecc * nb;
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, 8); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < cap * 8; p ^= 0xec ^ 0x11) put(p, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const numShort = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const div = divisor(ecc);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - ecc + (i < numShort ? 0 : 1));
    k += dat.length;
    const e = remainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(e));
  }
  const final = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - ecc || j >= numShort) final.push(b[i]); });
  }

  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((a, i) => pos.forEach((b, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));
  }
  // Format bits: ECC L (01) + mask 0
  const fd = (1 << 3) | 0;
  let rem = fd;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fb = ((fd << 10) | rem) ^ 0x5412;
  const bit = (v, i) => ((v >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(fb, i));
  set(8, 7, bit(fb, 6)); set(8, 8, bit(fb, 7)); set(7, 8, bit(fb, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(fb, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(fb, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(fb, i));
  set(8, size - 8, true);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const vb = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit(vb, i)); set(b, a, bit(vb, i));
    }
  }
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!fn[y][x] && k < final.length * 8) { m[y][x] = bit(final[k >>> 3], 7 - (k & 7)); k++; }
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (!fn[y][x] && (x + y) % 2 === 0) m[y][x] = !m[y][x];
  }
  return m;
}

/** An SVG image of the code. `margin` is the quiet zone in modules; `dark`/`light` are CSS colours. */
function toSvg(matrix, { margin = 4, dark = "#000", light = "#fff", title = "QR code" } = {}) {
  const size = matrix.length;
  const total = size + margin * 2;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (matrix[y][x]) path += `M${x + margin} ${y + margin}h1v1h-1z`;
  }
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="${esc(title)}">` +
    `<rect width="${total}" height="${total}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

module.exports = { encodeQr, toSvg };
