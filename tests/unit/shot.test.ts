// Screenshots: their sizes, the tiles that cover them, and the saved state in a PNG text chunk that
// leaves the image readable.

import { describe, expect, it } from "vitest";
import { MAX_SIDE, shotSize, tiles } from "../../src/render/shot.ts";
import { readText, withText } from "../../src/state/pngtext.ts";
import { decodePNG, encodePNG } from "../../tools/png.ts";

describe("screenshot sizes", () => {
  it("follows the screen, or is fixed, within the longest side", () => {
    expect(shotSize("screen", 1280, 720)).toEqual([1280, 720]);
    expect(shotSize("2x", 1280, 720)).toEqual([2560, 1440]);
    expect(shotSize("4x", 1280, 720)).toEqual([5120, 2880]);
    expect(shotSize("4x", 2560, 1440)).toEqual([MAX_SIDE, 4608]);
    expect(shotSize("1080p", 640, 480)).toEqual([1920, 1080]);
    expect(shotSize("8k", 640, 480)).toEqual([7680, 4320]);
    expect(shotSize("4x", 3000, 3000)).toEqual([MAX_SIDE, MAX_SIDE]);
  });

  it("covers the picture with tiles, each pixel once", () => {
    for (const [w, h, max] of [[7680, 4320, 2048], [640, 480, 2048], [1000, 999, 256], [1, 1, 64]]) {
      const ts = tiles(w, h, max);
      let area = 0;
      for (const t of ts) {
        expect(t.width).toBeLessThanOrEqual(max);
        expect(t.height).toBeLessThanOrEqual(max);
        expect(t.x + t.width).toBeLessThanOrEqual(w);
        expect(t.y + t.height).toBeLessThanOrEqual(h);
        area += t.width * t.height;
      }
      expect(area).toBe(w * h);
    }
    expect(tiles(7680, 4320, 2048)).toHaveLength(4 * 3);
  });
});

describe("PNG text chunk", () => {
  const rgba = new Uint8Array(4 * 6 * 5).map((_, i) => (i * 37) & 255);
  const png = new Uint8Array(encodePNG(rgba, 6, 5));

  it("reads back what it wrote, in UTF-8, and the image still decodes", () => {
    const text = JSON.stringify({ v: 1, name: "Poincaré µ − ×" });
    const out = withText(png, "hyperscope", text);
    expect(readText(out, "hyperscope")).toBe(text);
    expect(readText(out, "other")).toBeNull();
    expect(readText(png, "hyperscope")).toBeNull();
    const img = decodePNG(out);
    expect([img.width, img.height]).toEqual([6, 5]);
    expect(img.data).toEqual(rgba);
  });

  it("reads a Latin-1 tEXt chunk too, and refuses what is not a PNG", () => {
    const tagged = new Uint8Array(encodePNG(rgba, 6, 5, { hyperscope: "plain text" }));
    expect(readText(tagged, "hyperscope")).toBe("plain text");
    expect(readText(new Uint8Array([1, 2, 3]), "hyperscope")).toBeNull();
    expect(() => withText(new Uint8Array(10), "hyperscope", "x")).toThrow("not a PNG");
  });
});
