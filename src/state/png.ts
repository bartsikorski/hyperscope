// A text chunk inside a PNG (PNG specification, iTXt): the screenshot carries the saved state, so a
// dropped picture restores its view. UTF-8 text, uncompressed, placed right after IHDR.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const isPng = (png: Uint8Array) => png.length >= 8 && SIGNATURE.every((b, i) => png[i] === b);

interface Chunk {
  type: string;
  start: number;
  data: Uint8Array;
  end: number;
}

function* chunks(png: Uint8Array): Generator<Chunk> {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at + 12 <= png.length; ) {
    const len = dv.getUint32(at);
    const end = at + 12 + len;
    if (end > png.length) return;
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    yield { type, start: at, data: png.subarray(at + 8, at + 8 + len), end };
    if (type === "IEND") return;
    at = end;
  }
}

/** The PNG with an iTXt chunk `keyword` = `text` after its header (replacing one already there). */
export function withText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  if (!isPng(png)) throw new Error("not a PNG");
  const enc = new TextEncoder();
  const kw = enc.encode(keyword);
  const body = enc.encode(text);
  // keyword, NUL, compression flag 0, method 0, empty language tag NUL, empty translated keyword NUL
  const data = new Uint8Array(kw.length + 5 + body.length);
  data.set(kw, 0);
  data.set(body, kw.length + 5);
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(enc.encode("iTXt"), 4);
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (const c of chunks(png)) {
    if (c.type === "iTXt" && textOf(c.data)?.keyword === keyword) continue;
    parts.push(png.subarray(c.start, c.end));
    if (c.type === "IHDR") parts.push(chunk);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The text of the iTXt (or tEXt) chunk `keyword`, or null. */
export function readText(png: Uint8Array, keyword: string): string | null {
  if (!isPng(png)) return null;
  for (const c of chunks(png)) {
    if (c.type !== "iTXt" && c.type !== "tEXt") continue;
    const t = c.type === "iTXt" ? textOf(c.data) : latin1Of(c.data);
    if (t?.keyword === keyword) return t.text;
  }
  return null;
}

function textOf(d: Uint8Array): { keyword: string; text: string } | null {
  const k = d.indexOf(0);
  if (k < 0 || d[k + 1] !== 0) return null; // compressed text is not ours
  const lang = d.indexOf(0, k + 3);
  const trans = lang < 0 ? -1 : d.indexOf(0, lang + 1);
  if (trans < 0) return null;
  const dec = new TextDecoder();
  return { keyword: dec.decode(d.subarray(0, k)), text: dec.decode(d.subarray(trans + 1)) };
}

function latin1Of(d: Uint8Array): { keyword: string; text: string } | null {
  const k = d.indexOf(0);
  if (k < 0) return null;
  return { keyword: String.fromCharCode(...d.subarray(0, k)), text: Array.from(d.subarray(k + 1), (b) => String.fromCharCode(b)).join("") };
}
