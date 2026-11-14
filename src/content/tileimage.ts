// Your own tile picture (design notes, step 17): its mip levels, the GL sampling rule the shader's
// textureLod follows (so the CPU reference reads the same levels the same way), the placement of
// the shape on the picture, the registry of pictures by id, and the template's geometry. Pure: the
// browser's decoding and storage are in state/pictures.ts.
// Origin: the level of detail from the pixel's footprint is Lance Williams' mip-mapping ("Pyramidal
// parametrics", SIGGRAPH 1983); the wrap and filter rules are the OpenGL ES 3.0 specification's.

import { srgbToLinear } from "../math/colour.ts";
import type { Complex } from "../math/complex.ts";
import type { TriangleGroup } from "../math/groups.ts";
import type { Vec3 } from "../math/lorentz.ts";
import { dist } from "../math/lorentz.ts";

export type TileMode = "kaleidoscope" | "chiral";
export const TILE_MODES: readonly TileMode[] = ["kaleidoscope", "chiral"];

/** Where the shape sits on the picture: the centre of its bounding box (fractions of the picture's
 *  width and height, y down), the box's larger side as a fraction of the picture's shorter side,
 *  and the shape's turn on the picture in degrees, counterclockwise as seen. */
export interface Placement {
  x: number;
  y: number;
  size: number;
  turn: number;
}
export const DEFAULT_PLACEMENT: Placement = { x: 0.5, y: 0.5, size: 0.84, turn: 0 };
/** The placement's limits (saved states and the card keep within them). */
export const PLACE_LIMITS = { xy: [-1, 2], size: [0.05, 8] } as const;

/** The content's tile picture: the mode, the tint, the placement and the picture's id (the SHA-256
 *  of its data URL; the bytes are kept apart, by id). */
export interface TileImageState {
  mode: TileMode;
  /** Multiplied by the look's colours; as it is when left out. */
  tint?: boolean;
  place: Placement;
  id: string;
}

/** Pictures are cut down to this many pixels on the longer side. */
export const MAX_PICTURE_PX = 2048;

/** One mip level: RGBA bytes, top row first; colours premultiplied by alpha in linear light, then
 *  sRGB encoded (as an SRGB8_ALPHA8 texture holds them), alpha linear. */
export interface Level {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface TileImage {
  id: string;
  width: number;
  height: number;
  /** Level 0 first, down to 1 x 1. */
  levels: Level[];
  /** Every alpha is 255. */
  opaque: boolean;
}

/** sRGB byte to linear, as the GPU decodes an SRGB8_ALPHA8 texel. */
export const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
/** Linear to the nearest sRGB byte, round(linearToSrgb(v) 255): a table by v in steps of 1/65535,
 *  then the one step up a bucket can hold (the bytes step up at STEPS, never twice in a bucket). */
const STEPS = Float64Array.from({ length: 255 }, (_, b) => srgbToLinear((b + 0.5) / 255));
const BUCKETS = (() => {
  const t = new Uint8Array(65536);
  let b = 0;
  for (let i = 0; i < 65536; i++) {
    while (b < 255 && i / 65535 >= STEPS[b]) b++;
    t[i] = b;
  }
  return t;
})();
export function encodeSrgb(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 1) return 255;
  const b = BUCKETS[Math.floor(v * 65535)];
  return b < 255 && v >= STEPS[b] ? b + 1 : b;
}
const encode = encodeSrgb;

/** The weights of an exact area average from n texels down to m: output i covers input
 *  [i n / m, (i + 1) n / m), each input weighted by its overlap. */
function boxWeights(n: number, m: number): { first: Int32Array; count: Int32Array; weight: Float64Array; stride: number } {
  const r = n / m;
  const stride = Math.ceil(r) + 1;
  const first = new Int32Array(m);
  const count = new Int32Array(m);
  const weight = new Float64Array(m * stride);
  for (let i = 0; i < m; i++) {
    const lo = i * r;
    const hi = (i + 1) * r;
    const j0 = Math.floor(lo);
    first[i] = j0;
    let k = 0;
    for (let j = j0; j < hi && j < n; j++, k++) weight[i * stride + k] = (Math.min(hi, j + 1) - Math.max(lo, j)) / r;
    count[i] = k;
  }
  return { first, count, weight, stride };
}

/** One level down: floor(w / 2) x floor(h / 2) (at least 1), an exact area average of `src`
 *  (four channels, row-major). */
function downsample(src: Float32Array, w: number, h: number): { data: Float32Array; width: number; height: number } {
  const W = Math.max(1, w >> 1);
  const H = Math.max(1, h >> 1);
  if (w === 2 * W && h === 2 * H) {
    // even sides: each texel the mean of a 2 x 2 block
    const out = new Float32Array(W * H * 4);
    const row = w * 4;
    for (let j = 0; j < H; j++) {
      const a = 2 * j * row;
      const o = j * W * 4;
      for (let i = 0; i < W * 4; i += 4) {
        const s = a + 2 * i;
        for (let c = 0; c < 4; c++) out[o + i + c] = 0.25 * (src[s + c] + src[s + 4 + c] + src[s + row + c] + src[s + row + 4 + c]);
      }
    }
    return { data: out, width: W, height: H };
  }
  const bx = boxWeights(w, W);
  const by = boxWeights(h, H);
  // along x, then along y
  const tmp = new Float32Array(W * h * 4);
  for (let y = 0; y < h; y++)
    for (let i = 0; i < W; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < bx.count[i]; k++) {
        const wt = bx.weight[i * bx.stride + k];
        const s = (y * w + bx.first[i] + k) * 4;
        r += wt * src[s];
        g += wt * src[s + 1];
        b += wt * src[s + 2];
        a += wt * src[s + 3];
      }
      const o = (y * W + i) * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = a;
    }
  const out = new Float32Array(W * H * 4);
  for (let j = 0; j < H; j++)
    for (let k = 0; k < by.count[j]; k++) {
      const wt = by.weight[j * by.stride + k];
      const row = (by.first[j] + k) * W * 4;
      const o = j * W * 4;
      for (let i = 0; i < W * 4; i++) out[o + i] += wt * tmp[row + i];
    }
  return { data: out, width: W, height: H };
}

/** A picture's levels from its RGBA bytes (sRGB, straight alpha, top row first, as a canvas gives
 *  them). Level 0 is the bytes premultiplied in linear light; each next level is the exact area
 *  average of the one before (level 0 as stored), in linear premultiplied light. */
export function tileImageFromRGBA(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, id: string): TileImage {
  if (!(width >= 1 && height >= 1 && Number.isInteger(width) && Number.isInteger(height)) || rgba.length !== width * height * 4) throw new Error("the picture's pixels do not match its size");
  const n = width * height;
  const data0 = new Uint8Array(n * 4);
  const lin = new Float32Array(n * 4);
  let opaque = true;
  for (let i = 0; i < n * 4; i += 4) {
    const a = rgba[i + 3];
    if (a !== 255) opaque = false;
    for (let c = 0; c < 3; c++) {
      const byte = a === 255 ? rgba[i + c] : encode((SRGB_TO_LINEAR[rgba[i + c]] * a) / 255);
      data0[i + c] = byte;
      lin[i + c] = SRGB_TO_LINEAR[byte];
    }
    data0[i + 3] = a;
    lin[i + 3] = a / 255;
  }
  const levels: Level[] = [{ width, height, data: data0 }];
  let cur: { data: Float32Array; width: number; height: number } = { data: lin, width, height };
  while (cur.width > 1 || cur.height > 1) {
    cur = downsample(cur.data, cur.width, cur.height);
    const bytes = new Uint8Array(cur.data.length);
    for (let i = 0; i < bytes.length; i += 4) {
      bytes[i] = encode(cur.data[i]);
      bytes[i + 1] = encode(cur.data[i + 1]);
      bytes[i + 2] = encode(cur.data[i + 2]);
      bytes[i + 3] = Math.round(Math.min(1, Math.max(0, cur.data[i + 3])) * 255);
    }
    levels.push({ width: cur.width, height: cur.height, data: bytes });
  }
  return { id, width, height, levels, opaque };
}

/** GL's MIRRORED_REPEAT on a texel index: (size - 1) - mirror((i mod 2 size) - size), mirror(a) = a
 *  for a >= 0, else -(1 + a). */
export function mirrorIndex(i: number, size: number): number {
  const m = ((i % (2 * size)) + 2 * size) % (2 * size);
  const a = m - size;
  return size - 1 - (a >= 0 ? a : -(1 + a));
}

/** Bilinear at (u, v) on one level, mirrored repeat, added into out times k (premultiplied linear
 *  RGBA). */
function bilinear(lv: Level, u: number, v: number, k: number, out: number[]): void {
  const x = u * lv.width - 0.5;
  const y = v * lv.height - 0.5;
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const fx = x - i0;
  const fy = y - j0;
  const ia = mirrorIndex(i0, lv.width);
  const ib = mirrorIndex(i0 + 1, lv.width);
  const ja = mirrorIndex(j0, lv.height) * lv.width;
  const jb = mirrorIndex(j0 + 1, lv.height) * lv.width;
  const d = lv.data;
  const corners: [number, number][] = [
    [(ja + ia) * 4, (1 - fx) * (1 - fy)],
    [(ja + ib) * 4, fx * (1 - fy)],
    [(jb + ia) * 4, (1 - fx) * fy],
    [(jb + ib) * 4, fx * fy],
  ];
  for (const [o, wt] of corners) {
    if (wt === 0) continue;
    const kw = k * wt;
    out[0] += kw * SRGB_TO_LINEAR[d[o]];
    out[1] += kw * SRGB_TO_LINEAR[d[o + 1]];
    out[2] += kw * SRGB_TO_LINEAR[d[o + 2]];
    out[3] += (kw * d[o + 3]) / 255;
  }
}

/** textureLod(picture, (u, v), lod) with LINEAR_MIPMAP_LINEAR and MIRRORED_REPEAT: premultiplied
 *  linear RGBA. The level of detail is clamped to the levels there are. */
export function sampleImage(img: TileImage, u: number, v: number, lod: number, out: number[] = [0, 0, 0, 0]): number[] {
  out[0] = out[1] = out[2] = out[3] = 0;
  const q = img.levels.length - 1;
  const l = Math.min(q, Math.max(0, lod));
  const d1 = Math.floor(l);
  const f = l - d1;
  if (d1 >= q || f === 0) bilinear(img.levels[d1], u, v, 1, out);
  else {
    bilinear(img.levels[d1], u, v, 1 - f, out);
    bilinear(img.levels[d1 + 1], u, v, f, out);
  }
  return out;
}

// ------------------------------------------------------------------------------- the shape

const toDisk = (x: Vec3): Complex => [x[0] / (1 + x[2]), x[1] / (1 + x[2])];

/** The shape's corners in Poincaré coordinates of the world's frame (P at 0, side 1 along +x, T
 *  above it): P, Q, R, and for the chiral mode's kite R' = s1 R below side 1. Side QR (and QR') is
 *  an arc bowed toward P, inside the corners' hull, so the corners give the bounding box. */
export function shapeCorners(group: TriangleGroup, mode: TileMode): Complex[] {
  const { P, Q, R } = group.corners;
  const c = [toDisk(P), toDisk(Q), toDisk(R)];
  if (mode === "chiral") c.push([c[2][0], -c[2][1]]);
  return c;
}

/** The shape's bounding box: its centre and its larger side, in w. */
export function shapeBox(group: TriangleGroup, mode: TileMode): { c: Complex; E: number } {
  const pts = shapeCorners(group, mode);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { c: [(x0 + x1) / 2, (y0 + y1) / 2], E: Math.max(x1 - x0, y1 - y0) };
}

/** w to the picture's texture coordinates: u = row u . (w, 1), v = row v . (w, 1) (v down from the
 *  top row); s level-0 texels per unit of w; the last level of detail used. */
export interface PictureMap {
  u: [number, number, number];
  v: [number, number, number];
  s: number;
  maxLod: number;
}

/** The map of a placement for a picture of width x height pixels with `levels` levels: the pixel
 *  of w is (x W + s (dx cos t - dy sin t), y H + s (-dx sin t - dy cos t)), (dx, dy) = w - c, with
 *  s = size min(W, H) / E. maxLod is the last level, or the level where the whole shape is one
 *  texel when that comes first. */
export function pictureMap(group: TriangleGroup, mode: TileMode, place: Placement, width: number, height: number, levels: number): PictureMap {
  const { c, E } = shapeBox(group, mode);
  const s = (place.size * Math.min(width, height)) / E;
  const t = (place.turn * Math.PI) / 180;
  const [cs, sn] = [Math.cos(t), Math.sin(t)];
  const u: [number, number, number] = [(s * cs) / width, (-s * sn) / width, place.x + (s / width) * (-cs * c[0] + sn * c[1])];
  const v: [number, number, number] = [(-s * sn) / height, (-s * cs) / height, place.y + (s / height) * (sn * c[0] + cs * c[1])];
  return { u, v, s, maxLod: Math.min(levels - 1, Math.max(0, Math.log2(s * E))) };
}

/** The texture coordinates of w. */
export const mapUV = (m: PictureMap, w: Complex): Complex => [m.u[0] * w[0] + m.u[1] * w[1] + m.u[2], m.v[0] * w[0] + m.v[1] * w[1] + m.v[2]];

/** The level of detail of a pixel of plane length lpx at w: log2 of the texels it covers, clamped. */
export function pictureLod(m: PictureMap, w: Complex, lpx: number): number {
  const texels = m.s * lpx * 0.5 * (1 - w[0] * w[0] - w[1] * w[1]);
  return Math.min(m.maxLod, Math.max(0, Math.log2(Math.max(texels, 1e-30))));
}

// ------------------------------------------------------------------------------- the registry

/** A picture known by id: its data URL once read, its levels once decoded. */
export interface PictureEntry {
  src?: string;
  image?: TileImage;
  /** Being read or decoded, ready, not held here, or not readable (why). */
  status: "loading" | "ready" | "missing" | "broken";
  why?: string;
}

const registry = new Map<string, PictureEntry>();
/** Decoded pictures kept at once (each up to about 22 MB with its levels); the data URLs stay. */
const KEEP_DECODED = 3;
const decodedOrder: string[] = [];

export function pictureEntry(id: string): PictureEntry | undefined {
  return registry.get(id);
}

/** Record what is known of a picture: its data URL, its levels (the last few decoded are kept), or
 *  that it is loading, missing or broken. */
export function setPicture(id: string, patch: Partial<PictureEntry>): PictureEntry {
  const was = registry.get(id) ?? { status: "loading" as const };
  const next: PictureEntry = { ...was, ...patch };
  if (next.image) next.status = "ready";
  registry.set(id, next);
  if (patch.image) {
    const i = decodedOrder.indexOf(id);
    if (i >= 0) decodedOrder.splice(i, 1);
    decodedOrder.push(id);
    while (decodedOrder.length > KEEP_DECODED) {
      const old = registry.get(decodedOrder.shift()!);
      if (old) {
        delete old.image;
        old.status = old.src ? "loading" : "missing";
      }
    }
  }
  return next;
}

/** The decoded picture of an id, or null while it is not. */
export function pictureImage(id: string): TileImage | null {
  return registry.get(id)?.image ?? null;
}

// ------------------------------------------------------------------------------- template

/** The template's drawing in pixels of a size x size picture at the default placement: the shape's
 *  outline (closed), its edges (pair 0: PR and PR', 1: QR and QR', 2: a mirror side), ticks at
 *  equal hyperbolic distances from P (on PR, PR') and from Q (on QR, QR'), and the corners. */
export interface TemplateGeometry {
  size: number;
  outline: Complex[];
  edges: { name: string; pair: number; points: Complex[] }[];
  ticks: { edge: number; index: number; at: Complex; normal: Complex }[];
  corners: { name: string; at: Complex; out: Complex }[];
}

export const TEMPLATE_PX = 1024;
/** Ticks along each paired edge: this many intervals. */
export const TEMPLATE_TICKS = 8;

/** Points along the geodesic from a to b at parameters t (equal t, equal hyperbolic distance). */
function geodesic(a: Vec3, b: Vec3, ts: number[]): Vec3[] {
  const d = dist(a, b);
  return ts.map((t) => {
    const ka = Math.sinh((1 - t) * d) / Math.sinh(d);
    const kb = Math.sinh(t * d) / Math.sinh(d);
    return [ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]];
  });
}

/** The shape's edges in w, each as `steps` + 1 points along its geodesic: PR, QR, QR', PR' (pairs 0,
 *  1, 1, 0) for the chiral mode's kite, PQ, QR, RP (pair 2, mirrors) for T. */
export function shapeEdges(group: TriangleGroup, mode: TileMode, steps = 64): { name: string; pair: number; points: Complex[] }[] {
  const { P, Q, R } = group.corners;
  const R2: Vec3 = [R[0], -R[1], R[2]];
  const ts = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const list: [string, number, Vec3, Vec3][] =
    mode === "chiral"
      ? [["PR", 0, P, R], ["QR", 1, Q, R], ["QR′", 1, Q, R2], ["PR′", 0, P, R2]]
      : [["PQ", 2, P, Q], ["QR", 2, Q, R], ["RP", 2, R, P]];
  return list.map(([name, pair, a, b]) => ({ name, pair, points: geodesic(a, b, ts).map(toDisk) }));
}

export function templateGeometry(group: TriangleGroup, mode: TileMode, size = TEMPLATE_PX): TemplateGeometry {
  const m = pictureMap(group, mode, DEFAULT_PLACEMENT, size, size, 1);
  const px = (x: Vec3): Complex => {
    const uv = mapUV(m, toDisk(x));
    return [uv[0] * size, uv[1] * size];
  };
  const { P, Q, R } = group.corners;
  const R2: Vec3 = [R[0], -R[1], R[2]];
  const steps = Array.from({ length: 65 }, (_, i) => i / 64);
  const line = (a: Vec3, b: Vec3) => geodesic(a, b, steps).map(px);
  const edges =
    mode === "chiral"
      ? [
          { name: "PR", pair: 0, from: P, to: R },
          { name: "QR", pair: 1, from: Q, to: R },
          { name: "QR′", pair: 1, from: Q, to: R2 },
          { name: "PR′", pair: 0, from: P, to: R2 },
        ]
      : [
          { name: "PQ", pair: 2, from: P, to: Q },
          { name: "QR", pair: 2, from: Q, to: R },
          { name: "RP", pair: 2, from: R, to: P },
        ];
  // the outline in order P, R, Q, R' (chiral) or P, Q, R
  const order: [Vec3, Vec3][] = mode === "chiral" ? [[P, R], [R, Q], [Q, R2], [R2, P]] : [[P, Q], [Q, R], [R, P]];
  const outline = order.flatMap(([a, b]) => line(a, b).slice(0, -1));
  const ticks: TemplateGeometry["ticks"] = [];
  if (mode === "chiral")
    edges.forEach((e, k) => {
      const ts = Array.from({ length: TEMPLATE_TICKS - 1 }, (_, i) => (i + 1) / TEMPLATE_TICKS);
      geodesic(e.from, e.to, ts).forEach((x, i) => {
        const at = px(x);
        const [a, b] = geodesic(e.from, e.to, [ts[i] - 1e-4, ts[i] + 1e-4]).map(px);
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        ticks.push({ edge: k, index: i + 1, at, normal: [-dy / len, dx / len] });
      });
    });
  const box = outline.reduce((s, p) => [s[0] + p[0] / outline.length, s[1] + p[1] / outline.length], [0, 0]);
  const corner = (name: string, x: Vec3) => {
    const at = px(x);
    const d = [at[0] - box[0], at[1] - box[1]];
    const len = Math.hypot(d[0], d[1]) || 1;
    return { name, at, out: [d[0] / len, d[1] / len] as Complex };
  };
  const corners = [corner("P", P), corner("Q", Q), corner("R", R), ...(mode === "chiral" ? [corner("R′", R2)] : [])];
  return { size, outline, edges: edges.map((e) => ({ name: e.name, pair: e.pair, points: line(e.from, e.to) })), ticks, corners };
}
