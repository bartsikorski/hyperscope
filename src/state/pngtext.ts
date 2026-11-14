// A text chunk inside a PNG (design notes, step 9: Screenshot): screenshots carry their saved state
// in an iTXt chunk named "hyperscope" (UTF-8, so names like Poincaré survive), and a PNG dropped on
// the window is read back from it. Works on the bytes alone, in the browser and in Node.

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

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const isPNG = (png: Uint8Array) => png.length >= 8 && SIGNATURE.every((b, i) => png[i] === b);

/** The PNG with an uncompressed iTXt chunk `keyword` holding `text`, right after the header. */
export function withText(png: Uint8Array, keyword: string, text: string): Uint8Array<ArrayBuffer> {
  if (!isPNG(png)) throw new Error("not a PNG");
  const enc = new TextEncoder();
  // keyword, 0, compression flag 0, method 0, empty language tag and translated keyword (each 0-ended), text
  const data = new Uint8Array([...enc.encode(keyword), 0, 0, 0, 0, 0, ...enc.encode(text)]);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(enc.encode("iTXt"), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  // the header chunk is first: 8 signature bytes, then IHDR's length, type, 13 bytes and CRC
  const at = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at));
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

/** The text of the first uncompressed iTXt or tEXt chunk named `keyword`, or null. */
export function readText(png: Uint8Array, keyword: string): string | null {
  if (!isPNG(png)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const dec = new TextDecoder();
  for (let at = 8; at + 12 <= png.length; ) {
    const length = view.getUint32(at);
    const type = dec.decode(png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, Math.min(png.length, at + 8 + length));
    if (type === "IEND") break;
    if (type === "iTXt" || type === "tEXt") {
      const zero = data.indexOf(0);
      if (zero > 0 && dec.decode(data.subarray(0, zero)) === keyword) {
        if (type === "tEXt") return new TextDecoder("latin1").decode(data.subarray(zero + 1));
        if (data[zero + 1] !== 0) return null; // compressed: not written by Hyperscope
        // after the compression method: the language tag and the translated keyword, each 0-ended
        const lang = data.indexOf(0, zero + 3);
        const translated = lang < 0 ? -1 : data.indexOf(0, lang + 1);
        return translated < 0 ? null : dec.decode(data.subarray(translated + 1));
      }
    }
    at += 12 + length;
  }
  return null;
}
