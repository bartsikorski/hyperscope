// CPU reference renderer: the per-pixel function of the shader, in float64. The GPU tests compare
// the shader against it pixel by pixel, and tools/reference.ts writes PNGs from it.
// Origin: anti-aliasing from the distance to the mirrors follows Arnaud Chéritat's raster methods;
// motifs (step 16) after M. C. Escher's bent edges and Doug Dunham's methods (see math/motifs.ts);
// your own tile picture (step 17) read with Lance Williams' mip-mapping (see content/tileimage.ts).

import type { ColourSource } from "../content/looks.ts";
import type { PaletteTable } from "../content/palettes.ts";
import { samplePalette } from "../content/palettes.ts";
import type { PictureMap, TileImage, TileMode } from "../content/tileimage.ts";
import { mapUV, pictureLod, sampleImage } from "../content/tileimage.ts";
import type { RGB } from "../math/colour.ts";
import { hex, linearToSrgb, mix } from "../math/colour.ts";
import type { Colouring, Perm } from "../math/colourings.ts";
import type { GridFrame } from "../math/grid.ts";
import { carry, colourAcross, colourOf } from "../math/colourings.ts";
import type { Complex } from "../math/complex.ts";
import type { TriangleGroup } from "../math/groups.ts";
import { distanceToSide, fold } from "../math/groups.ts";
import type { TileMat } from "../math/tileid.ts";
import { applyTile, carryTile, faceHash, identityTile, mosaicHash, tileIdentity, tileOf } from "../math/tileid.ts";
import type { Wythoff } from "../math/wythoff.ts";
import { faceAcross, wythoffAt } from "../math/wythoff.ts";
import type { Mat3, Vec3 } from "../math/lorentz.ts";
import { ORIGIN, apply, dist, mink, reflectPoint } from "../math/lorentz.ts";
import type { Feature, Motif, MotifHit } from "../math/motifs.ts";
import { featureAt, featureDistance, motifAt, SLOTS, toDisk } from "../math/motifs.ts";
import type { Picture } from "../math/views.ts";
import { edgeDistance, frameJacobian, frameOf, precisionFade, screenToU, viewShade } from "../math/views.ts";
import { shadeGrid, tentCoverage, type Coverage } from "./grid.ts";
import { sampleOffset } from "./samples.ts";

export type { RGB } from "../math/colour.ts";
export { hex, linearToSrgb, srgbToLinear } from "../math/colour.ts";

const add = (a: RGB, b: RGB): RGB => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Far-tile fade: the colour blends into the average between these pixel sizes, in inradii of the
 *  fundamental triangle (tuned on the reference pictures; the shader gets the same numbers). */
export const FADE_START = 0.4;
export const FADE_END = 1.2;

/** The faint ring along the picture's edge: the HUD accent at 40%, 1.25 px wide. */
export const ICE: RGB = hex("#8fd3ff");
export const RING_WIDTH_PX = 1.25;
export const RING_ALPHA = 0.4;

/** Inner glow decay and relief bevel width, in units of the largest distance to the edge sides. */
export const GLOW_WIDTH = 0.15;
export const BEVEL_WIDTH = 0.25;

export type LineUnit = "plane" | "px";

export interface TilingStyle {
  source: ColourSource;
  /** Linear RGB per colour class of the colouring (the Colouring source), or Mosaic's discrete set
   *  (none for a gradient palette). */
  colours: RGB[];
  /** The baked palette (the other sources). */
  palette: PaletteTable;
  phase: number;
  density: number;
  /** Which sides carry lines: side 3 = {p, q} edges, side 2 = dual edges, side 1 = centre-to-vertex. */
  sides: [boolean, boolean, boolean];
  /** Line width in plane units, or in pixels when lineUnit is "px". */
  lineWidth: number;
  lineUnit: LineUnit;
  lineColour: RGB;
  background: RGB;
  glow: number;
  relief: number;
  /** Light azimuth in radians, counterclockwise from the screen's right. */
  light: number;
}

/** Constants derived once per content (design notes, step 7), shared by the CPU and the shader. */
export interface Shading {
  /** The edge sides (bit j = side j + 1): the sides with lines, or side 3 when none are drawn. */
  edgeMask: number;
  /** Largest distance to the nearest edge side inside the triangle. */
  maxInside: number;
  /** Length of the drawn sides per area of the triangle (the line share of the far-tile colour). */
  lineLengthPerArea: number;
  /** Far-tile colour before lines: avgFill + avgGlow, or for Distance fill * fillFactor + avgGlow. */
  avgFill: RGB;
  /** The fill factor (relief and glow, and the picture's transparency) as one number: fillFactor's
   *  mean, which it equals in every channel but with a tinted picture (the Frame block's copy). */
  avgFactor: number;
  fillFactor: RGB;
  avgGlow: RGB;
  /** Colour where the picture meets its edge (pixels whose centre falls outside it): the far-tile
   *  colour at an infinite pixel size. */
  rim: RGB;
}

export interface TilingScene {
  group: TriangleGroup;
  colouring: Colouring;
  /** The camera's starting permutation (changes when the camera is re-centered). */
  cameraPerm: Perm;
  /** The camera's tile labelling (math/tileid.ts, Mosaic); the identity when left out. */
  cameraTile?: TileMat;
  style: TilingStyle;
  shading: Shading;
  /** Origin of the depth count: the start tile is centred at origin * P (the world origin at home). */
  origin: Mat3;
  /** No tiling: the picture is filled with shading.rim (content/scene.ts, the unit grid's preset). */
  plain?: boolean;
  /** A Wythoff tiling's tables (math/wythoff.ts); version 1's tiling when left out. Its colours
   *  (style.colours, the Colouring source) are per face kind, through wythoff.colourOf. */
  wythoff?: Wythoff | null;
  /** A motif (math/motifs.ts), drawn instead of a Wythoff tiling: its tiles are coloured as the
   *  colouring colours the kites of the rotations. */
  motif?: Motif | null;
  /** Your own tile picture (content/tileimage.ts), over version 1's tiling only (no Wythoff tiling
   *  or motif): in T, mirrored at its sides, or in the kite, turned. */
  picture?: ScenePicture | null;
}

/** A tile picture as the renderers draw it: the picture's levels, the mode, the tint, and the map
 *  from w (Poincaré coordinates of the world's frame) to its texture coordinates. */
export interface ScenePicture {
  image: TileImage;
  mode: TileMode;
  tint: boolean;
  map: PictureMap;
}

/** Lengths of sides 1, 2, 3: side 1 runs from P to Q, side 2 from P to R, side 3 from Q to R. */
function sideLengths(g: TriangleGroup): [number, number, number] {
  const { P, Q, R } = g.corners;
  return [dist(P, Q), dist(P, R), dist(Q, R)];
}

export function edgeMask(sides: [boolean, boolean, boolean]): number {
  const m = sides.reduce((mask, on, j) => mask | (on ? 1 << j : 0), 0);
  return m || 4;
}

/** Relief shading factor: a bevel of slope h' along the edge sides, lit from azimuth `light` at 45
 *  degrees; ghat is the unit screen direction in which the distance to the edge grows. */
function reliefFactor(style: TilingStyle, maxInside: number, de: number, ghat: Complex): number {
  const hp = style.relief * (1 - smoothstep(0, BEVEL_WIDTH * maxInside, de));
  const gl = ghat[0] * Math.cos(style.light) + ghat[1] * Math.sin(style.light);
  return Math.max(0, (1 - hp * gl) / Math.sqrt(1 + hp * hp));
}

/** The quadrature points of the fundamental triangle for the area means below: Klein coordinates
 *  make it a Euclidean triangle, cut into equal small triangles weighted by the area element
 *  (1 - |k|^2)^(-3/2). The points depend only on the group and are kept for the last few groups;
 *  each point's distance to the nearest edge (the edge sides, or a Wythoff tiling's edges) is kept
 *  per edge sides or per tiling (computing them is most of the cost, about 50 ms, and a look change
 *  reuses them). */
interface Points {
  /** x, y, t of each point. */
  x: Float64Array;
  w: Float64Array;
}

interface Quadrature {
  w: Float64Array;
  de: Float64Array;
  maxInside: number;
  /** The sum of the weights, in order. */
  total: number;
  /** A Wythoff tiling's weight of each face kind (wythoff.ts KINDS). */
  kindWeight?: number[];
}

const QUADRATURE_N = 240;
const pointsOf = new Map<string, Points>();
const quadratures = new Map<string, Quadrature>();
const wythoffQuadratures = new WeakMap<Wythoff, Quadrature>();

/** Most recently used last; at most 8 kept. */
function cached<T>(map: Map<string, T>, key: string, make: () => T): T {
  let v = map.get(key);
  if (v) map.delete(key);
  else v = make();
  map.set(key, v);
  if (map.size > 8) map.delete(map.keys().next().value!);
  return v;
}

function trianglePoints(group: TriangleGroup, N = QUADRATURE_N): Points {
  return cached(pointsOf, `${group.p},${group.q},${group.r}|${N}`, () => {
    const klein = (x: Vec3): Complex => [x[0] / x[2], x[1] / x[2]];
    const [P, Q, R] = [group.corners.P, group.corners.Q, group.corners.R].map(klein);
    const x: number[] = [];
    const w: number[] = [];
    for (let a = 0; a < N; a++)
      for (let b = 0; a + b < N; b++)
        for (const off of a + b <= N - 2 ? [1 / 3, 2 / 3] : [1 / 3]) {
          const l1 = (a + off) / N;
          const l2 = (b + off) / N;
          const k: Complex = [P[0] + l1 * (Q[0] - P[0]) + l2 * (R[0] - P[0]), P[1] + l1 * (Q[1] - P[1]) + l2 * (R[1] - P[1])];
          const r2 = k[0] * k[0] + k[1] * k[1];
          x.push(k[0] / Math.sqrt(1 - r2), k[1] / Math.sqrt(1 - r2), 1 / Math.sqrt(1 - r2));
          w.push((1 - r2) ** -1.5);
        }
    return { x: Float64Array.from(x), w: Float64Array.from(w) };
  });
}

function summed(w: Float64Array, de: Float64Array, kindWeight?: number[]): Quadrature {
  let maxInside = -Infinity;
  for (const d of de) maxInside = Math.max(maxInside, d);
  let total = 0;
  for (const v of w) total += v;
  return { w, de, maxInside, total, kindWeight };
}

function quadrature(group: TriangleGroup, mask: number): Quadrature {
  return cached(quadratures, `${group.p},${group.q},${group.r}|${mask}`, () => {
    const { x, w } = trianglePoints(group);
    const de = new Float64Array(w.length);
    for (let i = 0; i < w.length; i++) {
      const p: Vec3 = [x[3 * i], x[3 * i + 1], x[3 * i + 2]];
      let d = Infinity;
      for (let j = 0; j < 3; j++) if (mask & (1 << j)) d = Math.min(d, distanceToSide(p, group.normals[j]));
      de[i] = d;
    }
    return summed(w, de);
  });
}

/** A Wythoff tiling's quadrature over its domain: the triangle's points, and for the kite their
 *  mirror images across side 1 as well (the same weights); each with its distance to the nearest
 *  edge and its face's kind. */
function wythoffQuadrature(group: TriangleGroup, wy: Wythoff): Quadrature {
  let q = wythoffQuadratures.get(wy);
  if (q) return q;
  const { x, w: w1 } = trianglePoints(group);
  const n = w1.length;
  const copies = wy.kite ? 2 : 1;
  const w = new Float64Array(n * copies);
  const de = new Float64Array(n * copies);
  const kindWeight = [0, 0, 0, 0];
  for (let c = 0; c < copies; c++)
    for (let i = 0; i < n; i++) {
      let p: Vec3 = [x[3 * i], x[3 * i + 1], x[3 * i + 2]];
      if (c === 1) p = reflectPoint(p, group.normals[0]);
      const hit = wythoffAt(wy, p);
      w[c * n + i] = w1[i];
      de[c * n + i] = hit.de;
      kindWeight[wy.faces[hit.face].kind] += w1[i];
    }
  q = summed(w, de, kindWeight);
  wythoffQuadratures.set(wy, q);
  return q;
}

/** A motif's quadrature over the kite (T's points and their mirror images across side 1, odd): each
 *  point's distance to the tile's edge and the topmost feature over it (hard edges). A coarser grid
 *  than the triangle's, since each point costs a motifAt (about 0.2 s in all, once per motif). */
interface MotifQuadrature extends Quadrature {
  feature: Int8Array;
}

const MOTIF_QUADRATURE_N = 160;
const motifQuadratures = new WeakMap<Motif, MotifQuadrature>();

function motifQuadrature(m: Motif): MotifQuadrature {
  let q = motifQuadratures.get(m);
  if (q) return q;
  const { x, w: w1 } = trianglePoints(m.group, MOTIF_QUADRATURE_N);
  const n = w1.length;
  const w = new Float64Array(2 * n);
  const de = new Float64Array(2 * n);
  const feature = new Int8Array(2 * n);
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < n; i++) {
      let p: Vec3 = [x[3 * i], x[3 * i + 1], x[3 * i + 2]];
      if (c === 1) p = reflectPoint(p, m.group.normals[0]);
      const hit = motifAt(m, p, c === 1);
      w[c * n + i] = w1[i];
      de[c * n + i] = hit.de;
      feature[c * n + i] = m.features.length ? featureAt(m, toDisk(hit.y)) : -1;
    }
  q = { ...summed(w, de), feature };
  motifQuadratures.set(m, q);
  return q;
}

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [1, 1, 1];

/** A colour toward white by t when t is positive, toward black by -t when negative. */
export function toned(c: RGB, t: number): RGB {
  return t > 0 ? mix(c, WHITE, t) : t < 0 ? times(c, 1 + t) : c;
}

/** A feature's colour over a tile of colour `tile` (the source's colour at the pixel). */
export function featureColour(f: Feature, style: TilingStyle, tile: RGB): RGB {
  const slot = SLOTS[f.slot];
  return toned(slot === "tile" ? tile : slot === "line" ? style.lineColour : slot === "black" ? BLACK : WHITE, f.tone);
}

/** Area means over the fundamental triangle (or a Wythoff tiling's domain) by quadrature (above).
 *  The relief term is averaged over light directions as well, which leaves 1 / sqrt(1 + h'^2). The
 *  Colouring source's mean is `mean`, or for a Wythoff tiling its kinds' colours weighted by area. */
export function shadingOf(group: TriangleGroup, style: TilingStyle, mean: RGB, wy?: Wythoff | null, motif?: Motif | null, picture?: ScenePicture | null): Shading {
  if (motif) return motifShading(group, style, mean, motif);
  if (picture && !wy) return pictureShading(group, style, mean, picture);
  const mask = edgeMask(style.sides);
  const { w: weights, de: dists, maxInside, total, kindWeight } = wy ? wythoffQuadrature(group, wy) : quadrature(group, mask);
  if (wy && kindWeight && style.source === "colouring") {
    mean = [0, 0, 0];
    for (let k = 0; k < kindWeight.length; k++) if (wy.colourOf[k] >= 0) mean = add(mean, times(style.colours[wy.colourOf[k]], kindWeight[k] / total));
  }  let W = 0;
  let A = 0;
  let G = 0;
  let F: RGB = [0, 0, 0];
  // without glow, relief or the inside source every point's factor is 1: the sums are the total
  const plain = style.glow <= 0 && style.relief === 0 && style.source !== "inside";
  if (plain) [W, A] = [total, total];
  else for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    const de = dists[i];
    const gamma = style.glow > 0 ? style.glow * Math.exp(-de / (GLOW_WIDTH * maxInside)) : 0;
    const hp = style.relief * (1 - smoothstep(0, BEVEL_WIDTH * maxInside, de));
    const a = ((1 - gamma) / Math.sqrt(1 + hp * hp)) * w;
    W += w;
    A += a;
    G += gamma * w;
    if (style.source === "inside") F = add(F, times(samplePalette(style.palette, style.phase + (style.density * de) / maxInside, 0), a));
  }
  const area = Math.PI * (1 - 1 / group.p - 1 / group.q - 1 / group.r);
  const len = sideLengths(group);
  let lineLength = 0;
  for (let j = 0; j < 3; j++) if (style.sides[j]) lineLength += len[j];
  // a Wythoff tiling's edges, and version 1's sides drawn over them
  const lengthPerArea = lineLength / area + (wy ? wy.lengthPerArea : 0);
  // the colouring's classes, or Mosaic's discrete set, average to their mean; the rest to the palette's
  const ownMean = style.source === "colouring" || (style.source === "mosaic" && style.colours.length > 0);
  const avgFill = style.source === "inside" ? times(F, 1 / W) : times(ownMean ? mean : style.palette.mean, A / W);
  const avgGlow = times(style.lineColour, G / W);
  const lineShare = style.lineUnit === "px" ? (lengthPerArea > 0 ? 1 : 0) : Math.min(1, (style.lineWidth / 2) * lengthPerArea);
  const rimFill = style.source === "distance" ? times(style.palette.mean, A / W) : avgFill;
  const rim = mix(add(rimFill, avgGlow), style.lineColour, lineShare);
  return { edgeMask: mask, maxInside, lineLengthPerArea: lengthPerArea, avgFill, avgFactor: A / W, fillFactor: [A / W, A / W, A / W], avgGlow, rim };
}

/** Each quadrature point's picture (premultiplied linear RGBA), T's points then, for the kite, their
 *  mirror images across side 1: sampled at the level of the point's own share of the area, so the
 *  sum is a box-filtered integral. Kept for the last few pictures, groups, modes and placements. */
const pictureSampleCache = new Map<string, Float64Array>();

function pictureSamples(group: TriangleGroup, pic: ScenePicture): Float64Array {
  const m = pic.map;
  const key = `${pic.image.id}|${group.p},${group.q},${group.r}|${pic.mode}|${m.u.join()},${m.v.join()},${m.s},${m.maxLod}`;
  return cached(pictureSampleCache, key, () => {
    const { x, w } = trianglePoints(group);
    const n = w.length;
    let total = 0;
    for (const v of w) total += v;
    const area = Math.PI * (1 - 1 / group.p - 1 / group.q - 1 / group.r);
    const copies = pic.mode === "chiral" ? 2 : 1;
    const out = new Float64Array(4 * n * copies);
    const s: number[] = [0, 0, 0, 0];
    for (let c = 0; c < copies; c++)
      for (let i = 0; i < n; i++) {
        const k = 1 / (1 + x[3 * i + 2]);
        const wd: Complex = [x[3 * i] * k, (c === 1 ? -1 : 1) * x[3 * i + 1] * k];
        const [u, v] = mapUV(m, wd);
        // the point's area in w: its share of T's, times the Poincare factor squared
        const texels = m.s * Math.sqrt((w[i] / total) * area) * 0.5 * (1 - wd[0] * wd[0] - wd[1] * wd[1]);
        const lod = Math.min(m.maxLod, Math.max(0, Math.log2(texels)));
        sampleImage(pic.image, u, v, lod, s);
        out.set(s, 4 * (c * n + i));
      }
    return out;
  });
}

/** Version 1's means with your own picture over the source's colour c (design notes, step 17: The
 *  far-tile colour). With k the relief factor times one minus the glow, p and a the picture: as it
 *  is, the colour k (p + c (1 - a)) + glow, so the fill factor is mean(k (1 - a)) and mean(k p) joins
 *  the glow's constant; tinted, k c (p + 1 - a) + glow, a fill factor per channel. The inside
 *  source's c varies with de and is summed point by point. */
function pictureShading(group: TriangleGroup, style: TilingStyle, mean: RGB, pic: ScenePicture): Shading {
  const mask = edgeMask(style.sides);
  const { w: weights, de: dists, maxInside } = quadrature(group, mask);
  const samples = pictureSamples(group, pic);
  const n = weights.length;
  const copies = pic.mode === "chiral" ? 2 : 1;
  const inside = style.source === "inside";
  let W = 0;
  let G = 0;
  let K1a = 0;
  const Kp: RGB = [0, 0, 0];
  const Kt: RGB = [0, 0, 0];
  const F: RGB = [0, 0, 0];
  for (let c = 0; c < copies; c++)
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      const de = dists[i];
      const gamma = style.glow > 0 ? style.glow * Math.exp(-de / (GLOW_WIDTH * maxInside)) : 0;
      const hp = style.relief * (1 - smoothstep(0, BEVEL_WIDTH * maxInside, de));
      const k = (1 - gamma) / Math.sqrt(1 + hp * hp);
      const o = 4 * (c * n + i);
      const a = samples[o + 3];
      const ci = inside ? samplePalette(style.palette, style.phase + (style.density * de) / maxInside, 0) : null;
      W += w;
      G += gamma * w;
      if (pic.tint)
        for (let ch = 0; ch < 3; ch++) {
          const f = k * (samples[o + ch] + 1 - a) * w;
          Kt[ch] += f;
          if (ci) F[ch] += ci[ch] * f;
        }
      else {
        K1a += k * (1 - a) * w;
        for (let ch = 0; ch < 3; ch++) {
          Kp[ch] += k * samples[o + ch] * w;
          if (ci) F[ch] += ci[ch] * k * (1 - a) * w;
        }
      }
    }
  const fillFactor: RGB = pic.tint ? times(Kt, 1 / W) : [K1a / W, K1a / W, K1a / W];
  const area = Math.PI * (1 - 1 / group.p - 1 / group.q - 1 / group.r);
  const len = sideLengths(group);
  let lineLength = 0;
  for (let j = 0; j < 3; j++) if (style.sides[j]) lineLength += len[j];
  const lengthPerArea = lineLength / area;
  const ownMean = style.source === "colouring" || (style.source === "mosaic" && style.colours.length > 0);
  const base = ownMean ? mean : style.palette.mean;
  const avgFill: RGB = inside ? times(F, 1 / W) : [base[0] * fillFactor[0], base[1] * fillFactor[1], base[2] * fillFactor[2]];
  const avgGlow = add(times(style.lineColour, G / W), pic.tint ? [0, 0, 0] : times(Kp, 1 / W));
  const lineShare = style.lineUnit === "px" ? (lengthPerArea > 0 ? 1 : 0) : Math.min(1, (style.lineWidth / 2) * lengthPerArea);
  const pm = style.palette.mean;
  const rimFill: RGB = style.source === "distance" ? [pm[0] * fillFactor[0], pm[1] * fillFactor[1], pm[2] * fillFactor[2]] : avgFill;
  const rim = mix(add(rimFill, avgGlow), style.lineColour, lineShare);
  const avgFactor = (fillFactor[0] + fillFactor[1] + fillFactor[2]) / 3;
  return { edgeMask: mask, maxInside, lineLengthPerArea: lengthPerArea, avgFill, avgFactor, fillFactor, avgGlow, rim };
}

/** A motif's means over its kite: each step of a pixel's colour is affine in the tile's colour c
 *  (relief scales it; glow and features mix toward fixed colours, a tile-slot feature toward c
 *  toned), so each point is alpha c + beta and the fill is mean(alpha) mean(c) + mean(beta); for
 *  the inside source c varies with de and is summed point by point. The outline counts in the line
 *  share: (len c1 + len c2) / area(T), as the sides count theirs. */
function motifShading(group: TriangleGroup, style: TilingStyle, mean: RGB, m: Motif): Shading {
  const { w: weights, de: dists, feature, maxInside, total } = motifQuadrature(m);
  let A = 0;
  let B: RGB = [0, 0, 0];
  let F: RGB = [0, 0, 0];
  const plain = style.glow <= 0 && style.relief === 0 && style.source !== "inside" && m.features.length === 0;
  if (plain) A = total;
  else {
    // per feature: its alpha and beta at full cover
    const fa = m.features.map((f) => (SLOTS[f.slot] === "tile" ? (f.tone > 0 ? 1 - f.tone : 1 + f.tone) : 0));
    const fb = m.features.map((f) => featureColour(f, style, BLACK));
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i];
      const de = dists[i];
      let a = 1;
      let b: RGB = [0, 0, 0];
      const fi = feature[i];
      if (fi >= 0) {
        a = fa[fi];
        b = fb[fi];
      } else {
        const hp = style.relief * (1 - smoothstep(0, BEVEL_WIDTH * maxInside, de));
        a = 1 / Math.sqrt(1 + hp * hp);
        if (style.glow > 0) {
          const gamma = style.glow * Math.exp(-de / (GLOW_WIDTH * maxInside));
          a *= 1 - gamma;
          b = times(style.lineColour, gamma);
        }
      }
      A += a * w;
      B = add(B, times(b, w));
      if (style.source === "inside" && a > 0) F = add(F, times(samplePalette(style.palette, style.phase + (style.density * de) / maxInside, 0), a * w));
    }
  }
  const area = Math.PI * (1 - 1 / group.p - 1 / group.q - 1 / group.r);
  const len = sideLengths(group);
  let lineLength = m.lengths[0] + m.lengths[1];
  for (let j = 0; j < 3; j++) if (style.sides[j]) lineLength += len[j];
  const lengthPerArea = lineLength / area;
  const W = total;
  const ownMean = style.source === "colouring" || (style.source === "mosaic" && style.colours.length > 0);
  const avgFill = style.source === "inside" ? times(F, 1 / W) : times(ownMean ? mean : style.palette.mean, A / W);
  const avgGlow = times(B, 1 / W);
  const lineShare = style.lineUnit === "px" ? 1 : Math.min(1, (style.lineWidth / 2) * lengthPerArea);
  const rimFill = style.source === "distance" ? times(style.palette.mean, A / W) : avgFill;
  const rim = mix(add(rimFill, avgGlow), style.lineColour, lineShare);
  return { edgeMask: edgeMask(style.sides), maxInside, lineLengthPerArea: lengthPerArea, avgFill, avgFactor: A / W, fillFactor: [A / W, A / W, A / W], avgGlow, rim };
}

/** Mosaic's colour for a tile's hash h (tileid.ts mosaicHash): the discrete set's colour picked by h's
 *  top 24 bits in integers (the set already starts at the phase), or the gradient at the phase plus
 *  those bits as a fraction. */
export function mosaicColour(style: TilingStyle, h: number): RGB {
  const n = style.colours.length;
  return n > 0 ? style.colours[((h >>> 8) * n) >>> 24] : samplePalette(style.palette, style.phase + (h >>> 8) / 16777216, 0);
}

/** Mean of the class colours (the Colouring source's far-tile fill). */
export function classMean(colours: RGB[], k: number): RGB {
  let mean: RGB = [0, 0, 0];
  for (let i = 0; i < k; i++) mean = mix(mean, colours[i], 1 / (i + 1));
  return mean;
}

/** The depth count's start: the polygon centre P of the start tile in world coordinates, the walls
 *  between it and the fundamental triangle (walls through P do not count), and the tolerance below
 *  which a wall counts as passing through P (float32 rounding of s in the shader, with a margin). */
export interface Start {
  s: Vec3;
  walls: number;
  tol: number;
}

export function startOf(scene: Pick<TilingScene, "group" | "origin">): Start {
  const s = apply(scene.origin, ORIGIN);
  const tol = 1e-5 * s[2] + 1e-6;
  let x = s;
  let walls = 0;
  for (const j of fold(s, scene.group.normals).word) {
    if (Math.abs(mink(x, scene.group.normals[j])) > tol) walls++;
    x = reflectPoint(x, scene.group.normals[j]);
  }
  return { s, walls, tol };
}

/** Depth of a folded point: the walls between its triangle and the start tile's centre P, leaving
 *  out the walls through P, so the rings keep the tile's symmetry. Counted along the fold: its
 *  reflections across walls not through P, plus the start's walls, minus twice the reflections
 *  that move P to the other side too (those walls also lie between P and the fundamental triangle).
 *  Smoothed between the nearest side toward P (down) and the nearest away from it (up), ignoring
 *  sides through P: depth - 1/2 + down / (down + up), continuous across every wall. `d` are the
 *  folded point's distances to the three sides. */
export function depthAt(group: TriangleGroup, start: Start, word: readonly number[], d: number[]): { depth: number; smooth: number; span: number } {
  const { depth, s } = depthOf(group, start, word);
  let down = Infinity;
  let up = Infinity;
  for (let j = 0; j < 3; j++) {
    const ds = mink(s, group.normals[j]);
    if (ds > start.tol) down = Math.min(down, d[j]);
    else if (ds < -start.tol) up = Math.min(up, d[j]);
  }
  const span = down + up;
  const ratio = down === Infinity ? 1 : span > 0 ? down / span : 0.5;
  return { depth, smooth: depth - 0.5 + ratio, span };
}

/** The whole depth of the word's triangle, and the start carried along the word (depthAt). */
export function depthOf(group: TriangleGroup, start: Start, word: readonly number[]): { depth: number; s: Vec3 } {
  let s = start.s;
  let crossed = 0;
  let shared = 0;
  for (const j of word) {
    const ds = mink(s, group.normals[j]);
    if (Math.abs(ds) > start.tol) {
      crossed++;
      if (ds > 0) shared++;
    }
    s = reflectPoint(s, group.normals[j]);
  }
  return { depth: crossed + start.walls - 2 * shared, s };
}

/** Coverage of a pixel of plane width lpx centred at distance d from a line of width w that is
 *  centred on the side (1D box filter: overlap of [d - lpx/2, d + lpx/2] with [-w/2, w/2]). */
export function lineCoverage(d: number, w: number, lpx: number): number {
  const lo = Math.max(d - lpx / 2, -w / 2);
  const hi = Math.min(d + lpx / 2, w / 2);
  return Math.max(0, hi - lo) / lpx;
}

/** A band strip's depth fog at u's x (strip-local): linear between the strip's sides, constant
 *  beyond (input/strips.ts Strip.fog, tiling.glsl). */
export function stripFog(fog: readonly number[] | undefined, ux: number): number {
  if (!fog) return 0;
  const t = Math.min(1, Math.max(0, (ux - fog[0]) / (fog[1] - fog[0])));
  return fog[2] + (fog[3] - fog[2]) * t;
}

/** The picture at the point y (in the shape) seen by a pixel of plane length lpx: premultiplied
 *  linear RGBA. */
function pictureAt(pic: ScenePicture, y: Vec3, lpx: number): number[] {
  const w = toDisk(y);
  const [u, v] = mapUV(pic.map, w);
  return sampleImage(pic.image, u, v, pictureLod(pic.map, w, lpx));
}

/** The colour c (the source's) under your own picture at the folded point x of T (design notes,
 *  step 17): the picture at x, or for the chiral mode at x in the kite (an odd word's point once
 *  more across side 1), blended within half a pixel of the kite's edges toward the neighbour's
 *  picture at its own point (across side 2 then 1, or side 3 then 1; for an odd word across side 2
 *  or 3 alone); then over c, or tinted by it. d are x's distances to the three sides. */
export function pictureOver(pic: ScenePicture, group: TriangleGroup, x: Vec3, odd: boolean, d: number[], lpx: number, c: RGB): RGB {
  const n = group.normals;
  const chiral = pic.mode === "chiral";
  let p = pictureAt(pic, chiral && odd ? reflectPoint(x, n[0]) : x, lpx);
  if (chiral)
    for (const j of [1, 2]) {
      const t = Math.max(0, 0.5 - d[j] / lpx);
      if (t <= 0) continue;
      const q = pictureAt(pic, odd ? reflectPoint(x, n[j]) : reflectPoint(reflectPoint(x, n[j]), n[0]), lpx);
      p = p.map((v, k) => v + (q[k] - v) * t);
    }
  const a = p[3];
  return pic.tint ? [c[0] * (p[0] + 1 - a), c[1] * (p[1] + 1 - a), c[2] * (p[2] + 1 - a)] : [p[0] + c[0] * (1 - a), p[1] + c[1] * (1 - a), p[2] + c[2] * (1 - a)];
}

/** Colour of the frame point xf (the camera maps it to the world) seen by a pixel of plane size
 *  lpx; `tangents` are the frame map's central differences across the pixel (for relief); `fog`
 *  fades the depth colouring of a band strip far from its start (stripFog). */
export function shadeTiling(scene: TilingScene, start: Start, camera: Mat3, xf: Vec3, lpx: number, tangents: [Vec3, Vec3] | null, fog = 0): RGB {
  const { group, colouring, style, shading: sh } = scene;
  const lineW = style.lineUnit === "px" ? style.lineWidth * lpx : style.lineWidth;
  // the far-tile colour: the area mean of everything below, lines included
  let distanceFill: RGB = [0, 0, 0];
  let fill: RGB;
  if (style.source === "distance") {
    const d = Math.asinh(Math.hypot(xf[0], xf[1]));
    distanceFill = samplePalette(style.palette, style.phase + style.density * d, style.density * lpx);
    fill = add([distanceFill[0] * sh.fillFactor[0], distanceFill[1] * sh.fillFactor[1], distanceFill[2] * sh.fillFactor[2]], sh.avgGlow);
  } else fill = add(sh.avgFill, sh.avgGlow);
  const target = mix(fill, style.lineColour, Math.min(1, (lineW / 2) * sh.lineLengthPerArea));
  const fade = Math.max(smoothstep(FADE_START, FADE_END, lpx / group.inradius), style.source === "depth" ? fog : 0);
  if (fade >= 1) return target;

  // groups.ts fold, with the start point and the tangents carried along
  const f = fold(apply(camera, xf), group.normals);
  if (f.capped) return target;
  let t1 = tangents ? apply(camera, tangents[0]) : null;
  let t2 = tangents ? apply(camera, tangents[1]) : null;
  if (t1 && t2)
    for (const j of f.word) {
      t1 = reflectPoint(t1, group.normals[j]);
      t2 = reflectPoint(t2, group.normals[j]);
    }
  const d = [0, 1, 2].map((j) => distanceToSide(f.x, group.normals[j]));
  let de = Infinity;
  let nearest = 2;
  for (let j = 0; j < 3; j++)
    if (sh.edgeMask & (1 << j) && d[j] < de) {
      de = d[j];
      nearest = j;
    }
  // relief: the unit normal whose product with the tangents gives the screen direction in which de grows
  let reliefNormal = group.normals[nearest];
  let reliefSign = -1;
  const mo = scene.motif ?? null;
  const wy = mo ? null : scene.wythoff;
  // a motif: the tile in the kite (once more across side 1 for an odd word, as the snub), then the
  // letters to a neighbour's tile when the point lies in its bulge
  let moHit: MotifHit | null = null;
  let moWord = f.word;
  if (mo) {
    let y = f.x;
    const odd = f.word.length % 2 === 1;
    if (odd) y = reflectPoint(y, group.normals[0]);
    moHit = motifAt(mo, y, odd);
    moWord = [...f.word, ...(odd ? [0] : []), ...moHit.letters];
    if (t1 && t2)
      for (const j of moWord.slice(f.word.length)) {
        t1 = reflectPoint(t1, group.normals[j]);
        t2 = reflectPoint(t2, group.normals[j]);
      }
    de = moHit.de;
  }
  // a Wythoff tiling: the face in its domain (the kite once more across side 1 for an odd word)
  let wyFace = -1;
  let wyAcross = -1;
  let wyWord = f.word;
  if (wy) {
    let y = f.x;
    if (wy.kite && f.word.length % 2 === 1) {
      y = reflectPoint(y, group.normals[0]);
      if (t1 && t2) {
        t1 = reflectPoint(t1, group.normals[0]);
        t2 = reflectPoint(t2, group.normals[0]);
      }
      wyWord = [...f.word, 0];
    }
    const hit = wythoffAt(wy, y);
    de = hit.de;
    wyFace = hit.face;
    wyAcross = hit.line >= 0 ? faceAcross(wy, hit.face, hit.line) : hit.face;
    if (hit.line >= 0) {
      reliefNormal = wy.lines[hit.line];
      reliefSign = (wy.faces[hit.face].want >> hit.line) & 1 ? 1 : -1;
    }
  }

  let col: RGB;
  type Source = ColourSource | "wythoff-colouring" | "wythoff-mosaic" | "motif-colouring" | "motif-mosaic" | "motif-depth";
  const source: Source = mo
    ? style.source === "colouring" || style.source === "mosaic" || style.source === "depth"
      ? `motif-${style.source}`
      : style.source
    : wy && style.source === "colouring"
      ? "wythoff-colouring"
      : wy && style.source === "mosaic"
        ? "wythoff-mosaic"
        : style.source;
  // a motif's tiles: blended toward the tile across the nearest curve
  const across = mo ? [...moWord, ...moHit!.across] : [];
  const blend = Math.max(0, 0.5 - de / lpx);
  switch (source) {
    case "motif-colouring": {
      const state = carry(colouring, scene.cameraPerm, moWord);
      const own = colourOf(colouring, state);
      const other = colourOf(colouring, carry(colouring, scene.cameraPerm, across));
      col = style.colours[own];
      if (other !== own && blend > 0) col = mix(col, style.colours[other], blend);
      break;
    }
    case "motif-mosaic": {
      // the kite's identity (fixed by no reflection), or the polygon's around P (Rosette)
      const ids = tileIdentity(group);
      const camTile = scene.cameraTile ?? identityTile();
      const hashOf = (word: readonly number[]) => {
        const A = carryTile(camTile, word, ids);
        return mo!.cell === 1 ? mosaicHash(applyTile(A, ids.w, ids.l)) : faceHash(applyTile(A, ids.vt, ids.l), 3, ids.l);
      };
      const own = hashOf(moWord);
      col = mosaicColour(style, own);
      if (blend > 0) {
        const other = hashOf(across);
        if (other !== own) col = mix(col, mosaicColour(style, other), blend);
      }
      break;
    }
    case "motif-depth": {
      // constant over the tile: the depth of its even triangle
      const own = depthOf(group, start, moWord).depth;
      col = samplePalette(style.palette, style.phase + style.density * own, 0);
      if (blend > 0) {
        const other = depthOf(group, start, across).depth;
        if (other !== own) col = mix(col, samplePalette(style.palette, style.phase + style.density * other, 0), blend);
      }
      break;
    }
    case "wythoff-colouring": {
      // the face's kind, blended toward the kind across the nearest edge
      const own = wy!.colourOf[wy!.faces[wyFace].kind];
      const other = wy!.colourOf[wy!.faces[wyAcross].kind];
      col = style.colours[own];
      const t = Math.max(0, 0.5 - de / lpx);
      if (other !== own && t > 0) col = mix(col, style.colours[other], t);
      break;
    }
    case "wythoff-mosaic": {
      // the face's identity: the camera's matrix along the word, applied to the face's own vector
      const ids = tileIdentity(group);
      const A = carryTile(scene.cameraTile ?? identityTile(), wyWord, ids);
      const hashOf = (fi: number) => faceHash(applyTile(A, wy!.faces[fi].id, ids.l), wy!.faces[fi].kind, ids.l);
      col = mosaicColour(style, hashOf(wyFace));
      const t = Math.max(0, 0.5 - de / lpx);
      if (t > 0 && wyAcross !== wyFace) col = mix(col, mosaicColour(style, hashOf(wyAcross)), t);
      break;
    }
    case "colouring": {
      const state = carry(colouring, scene.cameraPerm, f.word);
      const own = colourOf(colouring, state);
      col = style.colours[own];
      // anti-alias colour boundaries: blend toward the tile across side j (colourings.ts colourAcross)
      for (let j = 0; j < 3; j++) {
        const other = colourAcross(colouring, state, j);
        if (other === own) continue;
        const t = Math.max(0, 0.5 - d[j] / lpx);
        if (t > 0) col = mix(col, style.colours[other], t);
      }
      break;
    }
    case "mosaic": {
      const ids = tileIdentity(group);
      const tile = tileOf(scene.cameraTile ?? identityTile(), f.word, ids);
      col = mosaicColour(style, mosaicHash(tile.id));
      // only side 3 bounds the tile around P
      const t = Math.max(0, 0.5 - d[2] / lpx);
      if (t > 0) col = mix(col, mosaicColour(style, mosaicHash(tile.across)), t);
      break;
    }
    case "distance":
      col = distanceFill;
      break;
    case "depth": {
      const { smooth, span } = depthAt(group, start, f.word, d);
      const w = span === Infinity ? 0 : (style.density * lpx) / Math.max(span, 1e-30);
      col = samplePalette(style.palette, style.phase + style.density * smooth, w);
      break;
    }
    case "inside":
      col = samplePalette(style.palette, style.phase + (style.density * de) / sh.maxInside, (style.density * lpx) / sh.maxInside);
      break;
  }
  // your own picture over the source's colour (version 1's tiling only)
  const pic = !mo && !wy ? (scene.picture ?? null) : null;
  if (pic) col = pictureOver(pic, group, f.x, f.word.length % 2 === 1, d, lpx, col);
  const tileCol = col;
  if (style.relief > 0 && t1 && t2) {
    let g: Complex;
    if (moHit) {
      // de's direction in its curve's frame, through the frame's derivative along the tangents
      const inQ = moHit.curve >= 2;
      const y = inQ ? apply(mo!.toQ, moHit.y) : moHit.y;
      const k = 1 / (1 + y[2]);
      const dw = (t: Vec3): number => {
        const v = inQ ? apply(mo!.toQ, t) : t;
        return moHit!.grad[0] * (v[0] - y[0] * v[2] * k) * k + moHit!.grad[1] * (v[1] - y[1] * v[2] * k) * k;
      };
      g = [dw(t1), dw(t2)];
    } else g = [reliefSign * mink(t1, reliefNormal), reliefSign * mink(t2, reliefNormal)];
    const len = Math.hypot(g[0], g[1]);
    if (len > 0) col = times(col, reliefFactor(style, sh.maxInside, de, [g[0] / len, g[1] / len]));
  }
  if (style.glow > 0) col = mix(col, style.lineColour, style.glow * Math.exp(-de / (GLOW_WIDTH * sh.maxInside)));
  // a motif's features over its tile, in the P frame, then its outline
  if (mo) {
    const w = toDisk(moHit!.y);
    const lam = 2 / (1 - w[0] * w[0] - w[1] * w[1]);
    const reach = (0.5 * lpx) / lam;
    for (const ft of mo.features) {
      if (Math.hypot(w[0] - ft.bound[0], w[1] - ft.bound[1]) - ft.bound[2] >= reach) continue;
      const cov = Math.min(1, Math.max(0, 0.5 - (featureDistance(ft, w) * lam) / lpx));
      if (cov > 0) col = mix(col, featureColour(ft, style, tileCol), cov);
    }
    const cov = lineCoverage(de, lineW, lpx);
    if (cov > 0) col = mix(col, style.lineColour, Math.min(1, cov));
  }
  // a Wythoff tiling's edges, then version 1's sides over them
  if (wy) {
    const cov = lineCoverage(de, lineW, lpx);
    if (cov > 0) col = mix(col, style.lineColour, Math.min(1, cov));
  }
  for (let j = 0; j < 3; j++) {
    if (!style.sides[j]) continue;
    const cov = lineCoverage(d[j], lineW, lpx);
    if (cov > 0) col = mix(col, style.lineColour, Math.min(1, cov));
  }
  return fade > 0 ? mix(col, target, fade) : col;
}

export interface Shot {
  width: number;
  height: number;
  camera: Mat3;
  /** The view and its state; the model picks the frame map. */
  picture: Picture;
  scene: TilingScene;
  /** Colour of the ring along the picture's edge (the HUD accent); ICE when left out. */
  accent?: RGB;
  /** Samples per pixel along each axis (1 = the pixel centre only, as the GPU comparison uses). */
  ss?: number;
  /** Average the first n samples of the progressive sequence (samples.ts) instead, like the GPU. */
  samples?: number;
  /** Shift of every sample in pixels (the GPU comparison probes how sensitive a pixel is). */
  offset?: [number, number];
  /** The unit grid's numbers (math/grid.ts gridFrame); no grid when left out. */
  grid?: GridFrame | null;
  /** The grid in every sample, as while moving (main.frag), instead of once over their mean at the
   *  pixel's centre (display.frag). */
  gridPerSample?: boolean;
  /** Subtracted from u's x (a band strip's centre on the screen, input/strips.ts); 0 when left out. */
  du?: number;
  /** Only these pixel columns, x0 up to x1 (the others stay black). */
  columns?: [number, number];
  /** A band strip's depth fog (input/strips.ts Strip.fog); none when left out. */
  depthFog?: [number, number, number, number];
  /** The band's strips (input/strips.ts): the pixel columns of each are drawn with its camera,
   *  scene and grid, u shifted by its du. */
  strips?: StripShot[];
}

export interface StripShot {
  /** u's x from `from` up to `to` (input/strips.ts Strip). */
  from: number;
  to: number;
  du: number;
  fog: [number, number, number, number];
  camera: Mat3;
  scene: TilingScene;
  grid?: GridFrame | null;
}

/** Linear colour of one sample at (x, y) in pixels, top-down: main.frag of the shaders. The unit
 *  grid (with gridPerSample) goes over the content, the far reach of some views fades to the tiles'
 *  average (views.ts precisionFade), the hyperboloid's light multiplies it all (viewShade); pixels
 *  across the picture's edge blend with the background by the part of the pixel inside, and the
 *  accent ring is drawn over the edge. */
export function shadeSample(shot: Shot, start: Start, x: number, y: number): RGB {
  const { width, height, camera, picture, scene } = shot;
  const u: Complex = screenToU(x, y, width, height);
  u[0] -= shot.du ?? 0;
  const fp = frameOf(picture, u);
  let base: RGB;
  if (fp) {
    const lpx = (fp.scale * 2) / height;
    if (scene.plain) base = scene.shading.rim;
    else {
      // relief: central differences of the frame map one pixel either side
      let tangents: [Vec3, Vec3] | null = null;
      if (scene.style.relief > 0) {
        const h = 2 / height;
        const [a, b, c, d] = ([[h, 0], [-h, 0], [0, h], [0, -h]] as Complex[]).map((e) => frameOf(picture, [u[0] + e[0], u[1] + e[1]]));
        if (a && b && c && d) tangents = [[a.x[0] - b.x[0], a.x[1] - b.x[1], a.x[2] - b.x[2]], [c.x[0] - d.x[0], c.x[1] - d.x[1], c.x[2] - d.x[2]]];
      }
      base = shadeTiling(scene, start, camera, fp.x, lpx, tangents, stripFog(shot.depthFog, u[0]));
    }
    if (shot.grid && shot.gridPerSample) base = gridAt(shot, shot.grid, base, u, fp.x, lpx);
    base = mix(base, scene.shading.rim, precisionFade(picture, fp.x, lpx));
    const light = viewShade(picture, u, fp.x);
    base = [base[0] * light, base[1] * light, base[2] * light];
  } else base = scene.shading.rim;
  const dpx = (edgeDistance(picture, u) * height) / 2;
  const col = mix(scene.style.background, base, Math.min(1, Math.max(0, 0.5 - dpx)));
  const ring = lineCoverage(dpx, RING_WIDTH_PX, 1);
  return ring > 0 ? mix(col, shot.accent ?? ICE, RING_ALPHA * ring) : col;
}

/** The grid over col at screen point u (frame point xf, plane length per pixel lpx). */
function gridAt(shot: Shot, grid: GridFrame, col: RGB, u: Complex, xf: Vec3, lpx: number, cover?: Coverage): RGB {
  // the frame point's change per pixel, for the line widths where the view is not conformal
  const jac = frameJacobian(shot.picture, u, xf);
  const per = (v: Vec3): Vec3 => [(v[0] * 2) / shot.height, (v[1] * 2) / shot.height, (v[2] * 2) / shot.height];
  return shadeGrid(grid, col, xf, lpx, shot.accent ?? ICE, jac && [per(jac[0]), per(jac[1])], cover);
}

/** The grid drawn once over a pixel's mean at its centre (x, y), display.frag: inside the
 *  picture's edge and under the accent ring; on the mean with the light taken off (viewShade) and
 *  put back after, as each sample has it. */
function gridOnce(shot: Shot, grid: GridFrame, mean: RGB, x: number, y: number): RGB {
  const { width, height, picture } = shot;
  const u: Complex = screenToU(x, y, width, height);
  u[0] -= shot.du ?? 0;
  const fp = frameOf(picture, u);
  if (!fp) return mean;
  const dpx = (edgeDistance(picture, u) * height) / 2;
  const lpx = (fp.scale * 2) / height;
  const under = Math.min(1, Math.max(0, 0.5 - dpx)) * (1 - RING_ALPHA * lineCoverage(dpx, RING_WIDTH_PX, 1)) * (1 - precisionFade(picture, fp.x, lpx));
  const light = viewShade(picture, u, fp.x);
  const lined = gridAt(shot, grid, [mean[0] / light, mean[1] / light, mean[2] / light], u, fp.x, lpx, tentCoverage);
  return mix(mean, [lined[0] * light, lined[1] * light, lined[2] * light], under);
}

/** The pixel columns of each strip in a picture width x height pixels, [x0, x1): a column goes with
 *  the strip that holds its centre's u. The GPU draws the same columns (render/gl.ts). */
export function stripColumns(strips: readonly { from: number; to: number }[], width: number, height: number): [number, number][] {
  const col = (u: number) => Math.min(width, Math.max(0, Math.ceil(u * (height / 2) + width / 2 - 0.5)));
  return strips.map((st) => [st.from === -Infinity ? 0 : col(st.from), st.to === Infinity ? width : col(st.to)]);
}

/** Render a view of a tiling into linear RGB floats (row-major, top row first), the unit grid drawn
 *  once over each pixel's mean unless gridPerSample; a band's strips each in their own columns. */
export function renderView(shot: Shot): Float32Array {
  if (shot.strips && shot.strips.length > 1) {
    const out = new Float32Array(shot.width * shot.height * 3);
    const cols = stripColumns(shot.strips, shot.width, shot.height);
    shot.strips.forEach((st, i) => {
      const [x0, x1] = cols[i];
      if (x1 <= x0) return;
      const part = renderView({ ...shot, camera: st.camera, scene: st.scene, grid: st.grid, du: st.du, depthFog: st.fog, strips: undefined, columns: [x0, x1] });
      for (let py = 0; py < shot.height; py++) {
        const row = py * shot.width * 3;
        out.set(part.subarray(row + x0 * 3, row + x1 * 3), row + x0 * 3);
      }
    });
    return out;
  }
  const { width, height, scene } = shot;
  const [dx, dy] = shot.offset ?? [0, 0];
  const ss = shot.ss ?? 1;
  const offsets: [number, number][] = shot.samples
    ? Array.from({ length: shot.samples }, (_, i) => sampleOffset(i))
    : Array.from({ length: ss * ss }, (_, k) => [((k % ss) + 0.5) / ss - 0.5, (Math.floor(k / ss) + 0.5) / ss - 0.5]);
  const out = new Float32Array(width * height * 3);
  const start = startOf(scene);
  const once = shot.gridPerSample ? null : (shot.grid ?? null);
  const [c0, c1] = shot.columns ?? [0, width];
  for (let py = 0; py < height; py++)
    for (let px = c0; px < c1; px++) {
      let acc: RGB = [0, 0, 0];
      for (const [ox, oy] of offsets) {
        const c = shadeSample(shot, start, px + ox + dx, py + oy + dy);
        acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]];
      }
      let mean: RGB = [acc[0] / offsets.length, acc[1] / offsets.length, acc[2] / offsets.length];
      if (once) mean = gridOnce(shot, once, mean, px + dx, py + dy);
      const i = (py * width + px) * 3;
      out[i] = mean[0];
      out[i + 1] = mean[1];
      out[i + 2] = mean[2];
    }
  return out;
}

/** Linear float RGB to 8-bit sRGB RGBA. */
export function toRGBA8(lin: Float32Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < lin.length; i += 3, j += 4) {
    out[j] = Math.round(linearToSrgb(lin[i]) * 255);
    out[j + 1] = Math.round(linearToSrgb(lin[i + 1]) * 255);
    out[j + 2] = Math.round(linearToSrgb(lin[i + 2]) * 255);
    out[j + 3] = 255;
  }
  return out;
}
