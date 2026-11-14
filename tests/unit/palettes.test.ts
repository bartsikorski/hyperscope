import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { halfBits, halfValue, hexSrgb, oklabToSrgb, srgbToOklab, type RGB } from "../../src/math/colour.ts";
import { PALETTE_NAMES, PALETTES, TABLE_LEVELS, TABLE_SIZE, bakeSrgb, paletteByName, paletteTable, randomPalette, samplePalette } from "../../src/content/palettes.ts";
import { rng } from "./rng.ts";

// written by tools/hp/palette_vectors.py from mandelscope's own make_palette (float32 output)
const vectors = JSON.parse(readFileSync(new URL("./data/palettes.json", import.meta.url), "utf8")) as { n: number; tables: Record<string, RGB[]> };

describe("palettes", () => {
  it("bake every gradient exactly as mandelscope does", () => {
    const names = Object.keys(vectors.tables);
    expect(names.length).toBe(24);
    let worst = 0;
    for (const name of names) {
      const ours = bakeSrgb(paletteByName(name), vectors.n);
      ours.forEach((c, i) => c.forEach((v, k) => (worst = Math.max(worst, Math.abs(v - vectors.tables[name][i][k])))));
    }
    expect(worst).toBeLessThan(1e-6); // mandelscope rounds its tables to float32
  });

  it("offer 20 gradients and 4 discrete sets, without mandelscope's legacy four", () => {
    expect(PALETTE_NAMES.length).toBe(24);
    expect(PALETTE_NAMES).not.toContain("Fire");
    const discrete = PALETTES.filter((p) => p.colours);
    expect(discrete.map((p) => p.name)).toEqual(["Gilded tiles", "Escher", "Ink & paper", "Neon tiles"]);
    for (const p of discrete) expect(p.stops!.map((s) => s[0])).toEqual(p.colours!.map((_, i) => i / p.colours!.length));
  });

  it("go through OKLab and back unchanged (to 1e-5 of sRGB: the published matrices have 10 digits)", () => {
    const r = rng(7);
    for (let i = 0; i < 1000; i++) {
      const c: RGB = [r(), r(), r()];
      const back = oklabToSrgb(srgbToOklab(c));
      back.forEach((v, k) => expect(Math.abs(v - c[k])).toBeLessThan(1e-5));
    }
    expect(srgbToOklab(hexSrgb("#ffffff"))[0]).toBeCloseTo(1, 6);
  });
});

describe("half floats", () => {
  it("round to the nearest half and back", () => {
    for (const x of [0, 1, 0.5, 2 ** -14, 2 ** -24, 1023 * 2 ** -24, 65504 - 32]) expect(halfValue(halfBits(x))).toBe(x);
    expect(halfBits(1)).toBe(0x3c00);
    expect(halfBits(2 ** -14)).toBe(0x0400);
    const r = rng(11);
    for (let i = 0; i < 10000; i++) {
      const x = r() ** 4;
      const h = halfValue(halfBits(x));
      const ulp = x < 2 ** -14 ? 2 ** -24 : 2 ** (Math.floor(Math.log2(x)) - 10);
      expect(Math.abs(h - x)).toBeLessThanOrEqual(ulp / 2 + 1e-18);
    }
  });
});

describe("palette tables", () => {
  const table = paletteTable(paletteByName("Gilded"));

  it("hold 9 mip levels, each the mean of pairs of the level below", () => {
    expect(table.levels.length).toBe(TABLE_LEVELS);
    for (let L = 1; L < TABLE_LEVELS; L++) {
      const lo = table.levels[L - 1];
      const hi = table.levels[L];
      expect(hi.length).toBe((3 * TABLE_SIZE) >> L);
      for (let i = 0; i < hi.length / 3; i++)
        for (let c = 0; c < 3; c++) {
          const m = (lo[6 * i + c] + lo[6 * i + 3 + c]) / 2;
          expect(Math.abs(hi[3 * i + c] - m)).toBeLessThanOrEqual(m * 2 ** -11 + 2 ** -25);
        }
    }
    const mean = [0, 1, 2].map((c) => table.levels[0].filter((_, i) => i % 3 === c).reduce((a, b) => a + b) / TABLE_SIZE);
    table.mean.forEach((v, c) => expect(v).toBeCloseTo(mean[c], 3));
    expect(table.bits[0].length).toBe(4 * TABLE_SIZE);
  });

  it("sample like the texture: entries at i / 256, linear between, the mean when a pixel spans the cycle", () => {
    const e = (i: number) => [0, 1, 2].map((c) => table.levels[0][3 * i + c]);
    for (const i of [0, 17, 128, 255]) samplePalette(table, i / TABLE_SIZE, 0).forEach((v, c) => expect(v).toBeCloseTo(e(i)[c], 12));
    const mid = samplePalette(table, 40.25 / TABLE_SIZE, 0);
    mid.forEach((v, c) => expect(v).toBeCloseTo(0.75 * e(40)[c] + 0.25 * e(41)[c], 12));
    // cyclic: just below 1 blends entry 255 into entry 0
    samplePalette(table, 1 - 0.5 / TABLE_SIZE, 0).forEach((v, c) => expect(v).toBeCloseTo((e(255)[c] + e(0)[c]) / 2, 12));
    samplePalette(table, 3.3, 2).forEach((v, c) => expect(v).toBeCloseTo(table.mean[c], 12));
    // the filter only blurs: a sample at width w lies within the range of the entries it covers
    const w = 8 / TABLE_SIZE;
    const s = samplePalette(table, 0.5, w);
    for (let c = 0; c < 3; c++) {
      const covered = Array.from({ length: 17 }, (_, k) => e(120 + k)[c]);
      expect(s[c]).toBeGreaterThanOrEqual(Math.min(...covered) - 1e-9);
      expect(s[c]).toBeLessThanOrEqual(Math.max(...covered) + 1e-9);
    }
  });
});

describe("random palettes", () => {
  it("are repeatable, sorted, with a dark and a bright stop", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const p = randomPalette(seed);
      expect(randomPalette(seed)).toEqual(p);
      const pos = p.stops!.map((s) => s[0]);
      expect(pos[0]).toBe(0);
      expect([...pos].sort((a, b) => a - b)).toEqual(pos);
      const L = p.stops!.map((s) => srgbToOklab(hexSrgb(s[1]))[0]);
      expect(Math.min(...L)).toBeLessThan(0.2);
      expect(Math.max(...L)).toBeGreaterThan(0.85);
      expect(bakeSrgb(p).length).toBe(TABLE_SIZE);
    }
  });
});
