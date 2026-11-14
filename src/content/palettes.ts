// Palettes: mandelscope's cyclic gradients and Hyperscope's discrete colour sets (palettes.json),
// baked into a 256-entry table with mip levels for the GPU, and the CPU twin of the shader's palette
// lookup (design notes, step 7).
// Origin: gradients and their OKLab interpolation from mandelscope (MIT), see CREDITS.md.

import type { RGB } from "../math/colour.ts";
import { halfBits, halfValue, hexSrgb, hsvToRgb, mix, oklabToSrgb, srgbToLinear, srgbToOklab } from "../math/colour.ts";
import data from "./palettes.json" with { type: "json" };

export interface Palette {
  name: string;
  /** Cyclic gradient stops (position in [0, 1), "#rrggbb"), sorted; null = mandelscope's HSV rainbow. */
  stops: [number, string][] | null;
  /** A discrete set: a colouring uses these colours in order (a continuous source uses `stops`,
   *  which space them evenly). */
  colours?: string[];
}

export const PALETTES: Palette[] = [
  ...data.discrete.map((d) => ({ name: d.name, colours: d.colours, stops: d.colours.map((c, i): [number, string] => [i / d.colours.length, c]) })),
  ...data.gradients.map((g) => ({ name: g.name, stops: g.stops as [number, string][] | null })),
];

/** Kept for links saved by mandelscope users; not offered in the list. */
const HIDDEN = new Set(["Gold & Blue", "Fire", "Ocean", "Emerald"]);
export const PALETTE_NAMES = PALETTES.map((p) => p.name).filter((n) => !HIDDEN.has(n));

export function paletteByName(name: string): Palette {
  const p = PALETTES.find((q) => q.name === name);
  if (!p) throw new Error(`unknown palette "${name}"`);
  return p;
}

/** Entries of the palette texture's first level; level L has TABLE_SIZE >> L entries. */
export const TABLE_SIZE = 256;
export const TABLE_LEVELS = 9;

/** mandelscope's make_palette: n sRGB entries, entry i at position i / n, interpolated in OKLab
 *  between the stops with wrap-around, clipped. */
export function bakeSrgb(p: Palette, n = TABLE_SIZE): RGB[] {
  const out: RGB[] = [];
  if (p.stops === null) {
    for (let i = 0; i < n; i++) out.push(hsvToRgb(i / n, 0.85, 1));
    return out;
  }
  const pos = [...p.stops.map((s) => s[0]), p.stops[0][0] + 1];
  const lab = [...p.stops.map((s) => srgbToOklab(hexSrgb(s[1]))), srgbToOklab(hexSrgb(p.stops[0][1]))];
  for (let i = 0; i < n; i++) {
    let t = i / n;
    if (t < pos[0]) t += 1;
    // numpy.interp: the last interval whose left end is <= t
    let k = 0;
    while (k + 2 < pos.length && pos[k + 1] <= t) k++;
    const f = pos[k + 1] > pos[k] ? Math.min(1, Math.max(0, (t - pos[k]) / (pos[k + 1] - pos[k]))) : 0;
    out.push(oklabToSrgb(mix(lab[k], lab[k + 1], f)));
  }
  return out;
}

export interface PaletteTable {
  name: string;
  /** Linear RGB, rounded to half floats, 3 numbers per entry; levels[L] has TABLE_SIZE >> L entries. */
  levels: Float64Array[];
  /** The same values as half-float bits with alpha 1, RGBA per entry, ready for texImage2D. */
  bits: Uint16Array[];
  /** Mean colour (the last level). */
  mean: RGB;
}

const tables = new Map<string, PaletteTable>();

/** The baked table of a palette with all its mip levels (cached by name). */
export function paletteTable(p: Palette): PaletteTable {
  const cached = tables.get(p.name);
  if (cached) return cached;
  const levels: Float64Array[] = [];
  const bits: Uint16Array[] = [];
  const round = (lin: number[]) => {
    const n = lin.length / 3;
    const v = new Float64Array(lin.length);
    const b = new Uint16Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        b[4 * i + c] = halfBits(lin[3 * i + c]);
        v[3 * i + c] = halfValue(b[4 * i + c]);
      }
      b[4 * i + 3] = halfBits(1);
    }
    levels.push(v);
    bits.push(b);
    return v;
  };
  let level = round(bakeSrgb(p).flatMap((c) => c.map(srgbToLinear)));
  for (let L = 1; L < TABLE_LEVELS; L++) {
    const n = TABLE_SIZE >> L;
    const next: number[] = [];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) next.push((level[6 * i + c] + level[6 * i + 3 + c]) / 2);
    level = round(next);
  }
  const table = { name: p.name, levels, bits, mean: [level[0], level[1], level[2]] as RGB };
  tables.set(p.name, table);
  return table;
}

/** One level of the table at texture coordinate s with REPEAT and linear filtering. */
function sampleLevel(table: PaletteTable, L: number, s: number): RGB {
  const v = table.levels[L];
  const n = TABLE_SIZE >> L;
  const x = s * n - 0.5;
  const i = Math.floor(x);
  const a = x - i;
  const i0 = ((i % n) + n) % n;
  const i1 = (i0 + 1) % n;
  return [0, 1, 2].map((c) => v[3 * i0 + c] + (v[3 * i1 + c] - v[3 * i0 + c]) * a) as RGB;
}

/** The palette at coordinate t (cyclic) for a pixel across which t changes by w: the shader's
 *  textureLod with trilinear filtering at s = fract(t) + 0.5 / 256, lod = log2(max(1, 256 w)). */
export function samplePalette(table: PaletteTable, t: number, w: number): RGB {
  const s = t - Math.floor(t) + 0.5 / TABLE_SIZE;
  const lod = Math.min(TABLE_LEVELS - 1, Math.log2(Math.max(1, TABLE_SIZE * w)));
  const L = Math.floor(lod);
  const f = lod - L;
  const a = sampleLevel(table, L, s);
  return f > 0 ? mix(a, sampleLevel(table, L + 1, s), f) : a;
}

// ------------------------------------------------------------------------------ random palettes

/** mulberry32: a small seeded generator, uniform in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toHex = (c: RGB) => "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");

/** mandelscope's random_stops: a pleasant random cyclic gradient with a dark anchor, a bright
 *  highlight opposite it and hues spread around a random base hue, built in OKLCh. (Its own random
 *  generator, so a seed gives a different gradient than in mandelscope.) */
export function randomPalette(seed: number): Palette {
  const r = rng(seed);
  const uniform = (a: number, b: number) => a + (b - a) * r();
  const normal = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const n = 5 + Math.floor(r() * 3);
  const base = uniform(0, 360);
  const spread = [40, 90, 150, 200][Math.floor(r() * 4)];
  const pos = Array.from({ length: n }, (_, i) => Math.min(0.999, Math.max(0, (i + uniform(-0.3, 0.3)) / n)));
  pos[0] = 0;
  const dark = Math.floor(r() * n);
  const light = (dark + Math.floor(n / 2)) % n;
  const stops: [number, string][] = [];
  for (let i = 0; i < n; i++) {
    const [L, C] = i === dark ? [uniform(0.06, 0.16), uniform(0.02, 0.06)] : i === light ? [uniform(0.9, 0.98), uniform(0.02, 0.06)] : [uniform(0.35, 0.8), uniform(0.08, 0.17)];
    const h = ((base + spread * (i / Math.max(n - 1, 1) - 0.5) + 12 * normal()) * Math.PI) / 180;
    stops.push([pos[i], toHex(oklabToSrgb([L, C * Math.cos(h), C * Math.sin(h)]))]);
  }
  stops.sort((a, b) => a[0] - b[0]);
  return { name: `Random ${seed}`, stops };
}
