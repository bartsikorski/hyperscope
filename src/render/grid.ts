// The unit grid drawn over a pixel's colour: the CPU twin of shaders/grid.glsl, in float64
// on the same per-frame data (math/grid.ts gridFrame), so the GPU can be compared with it pixel for
// pixel (design notes, step 8).

import type { RGB } from "../math/colour.ts";
import type { GridCameras, GridFrame, GridSettings } from "../math/grid.ts";
import { gridFrame, horoDenominator, offsetTerm, spreadLog2, subdivision, UNITS } from "../math/grid.ts";
import type { Vec3 } from "../math/lorentz.ts";
import type { Picture } from "../math/views.ts";
import { referenceScale } from "../math/views.ts";
import { lineCoverage, smoothstep } from "./reference.ts";

/** Opacity of one level's lines, and of the lines E = 0 and S = 0 in the accent colour. */
export const GRID_OPACITY = 0.45;
export const AXIS_OPACITY = 1;
export const AXIS_WIDTH_PX = 1.5;
/** Radius of the polar centre's dot in pixels. */
export const CENTRE_DOT_PX = 2.5;
/** Linear luminance under which the lines are drawn toward white, else toward near-black, blended
 *  across DARK +- DARK_BAND (a hard switch flips a line's colour on the rounding of the colour
 *  under it). */
export const DARK = 0.25;
export const DARK_BAND = 0.03;
const WHITE: RGB = [1, 1, 1];
const INK: RGB = [0.012, 0.013, 0.016];
const TURN = 2 * Math.PI;
/** A pixel at subdivision m0 + j reads its S phase from the slot's bits for j in this range. */
export const J_MIN = -32;
export const J_MAX = 30;

/** A line's coverage of a pixel, the distance d and width w in pixels (grid.glsl gridCoverage). */
export type Coverage = (d: number, w: number) => number;
/** In one sample: a box of one pixel. */
export const boxCoverage: Coverage = (d, w) => lineCoverage(d, w, 1);
const tentCdf = (t: number) => (t < -1 ? 0 : t > 1 ? 1 : t < 0 ? 0.5 * (1 + t) ** 2 : 1 - 0.5 * (1 - t) ** 2);
/** Drawn once over the samples: the box spread by their jitter of half a pixel either side, a tent
 *  of half-width one pixel, so the lines are as soft as when drawn in every sample. */
export const tentCoverage: Coverage = (d, w) => tentCdf(d + w / 2) - tentCdf(d - w / 2);

const frac = (v: number) => v - Math.floor(v);
const nearest = (v: number) => Math.abs(v - Math.round(v));

/** The grid's numbers for a frame `height` pixels high, or null when the grid is off or its camera
 *  is beyond MAX_E. */
export function frameGrid(settings: GridSettings | undefined, grids: GridCameras, picture: Picture, height: number): GridFrame | null {
  if (!settings?.on) return null;
  return gridFrame(settings.kind, settings.unit, grids[settings.kind], (referenceScale(picture) * 2) / height);
}

/** frac(2^(m0 + j) S0 / unit) from the slot's bits: shifted left (j >= 0) or right (j < 0). */
export function bitsPhase(bits: number, fraction: number, j: number): number {
  if (j >= 0) return frac(fraction * 2 ** j);
  const span = 2 ** -j;
  return ((bits % span) + fraction) / span;
}

/** The frame point's grid coordinates turned into the grid frame, ready for the levels. */
export function gridPoint(f: GridFrame, xf: Vec3): { de: number; e: number; b: number } {
  const c = Math.cos(f.camera.theta);
  const s = Math.sin(f.camera.theta);
  return offsetTerm(f.kind, f.camera.e, [c * xf[0] - s * xf[1], s * xf[0] + c * xf[1], xf[2]]);
}

/** How fast dE and the offset term B change per pixel. In a conformal view (tangents null) from
 *  the plane's own rates, |grad E| = 1 and |grad B| = scale(E0) / spread(E), times lpx. Elsewhere
 *  (Klein, local) from the frame map's Jacobian (math/views.ts frameJacobian, per pixel) times the
 *  gradients of the grid's coordinates in closed form, with c = cosh E0, tau = tanh E0:
 *    Cartesian: sinh E = c (y + tau t), B = c atanh(x / (c w)), w = t + tau y:
 *      dE = (c / cosh E) d(y + tau t),  dB = (c / cosh E)^2 (w dx - x dw)
 *    polar: sinh r = |(c v, y)|, v = x + tau t, B = c phi:
 *      dE = (c / sinh r)(c / cosh r) v dv + y dy / (sinh r cosh r),  dB = (c / sinh r)^2 (v dy - y dv)
 *    horocyclic: E = E0 - ln D, D = t - y, B = x / D:  dE = -dD / D,  dB = dx / D - (x / D)(dD / D)
 *  The ratios c / cosh E stay finite in float32 at any E0 (the shader's twin). Rates only set line
 *  widths, so their few lost digits far out do not matter. Design notes, step 10: this replaced
 *  central differences over four more frame points. */
export interface GridRates {
  ge: number;
  gb: number;
}

export function gridRates(f: GridFrame, xf: Vec3, lpx: number, tangents: [Vec3, Vec3] | null): GridRates {
  const e0 = f.camera.e;
  const { e } = gridPoint(f, xf);
  if (tangents) {
    const ct = Math.cos(f.camera.theta);
    const st = Math.sin(f.camera.theta);
    const turn = (v: Vec3): Vec3 => [ct * v[0] - st * v[1], st * v[0] + ct * v[1], v[2]];
    const [x, y, t] = turn(xf);
    const [d1, d2] = tangents.map(turn);
    const tau = Math.tanh(e0);
    const c = Math.cosh(e0);
    let dE: [number, number];
    let dB: [number, number];
    switch (f.kind) {
      case "cartesian": {
        const k = c / Math.cosh(e);
        const w = t + tau * y;
        const dw = [d1[2] + tau * d1[1], d2[2] + tau * d2[1]];
        dE = [k * (d1[1] + tau * d1[2]), k * (d2[1] + tau * d2[2])];
        dB = [k * k * (w * d1[0] - x * dw[0]), k * k * (w * d2[0] - x * dw[1])];
        break;
      }
      case "polar": {
        const sh = Math.max(Math.sinh(e), 1e-300);
        const ch = Math.cosh(e);
        const v = x + tau * t;
        const dv = [d1[0] + tau * d1[2], d2[0] + tau * d2[2]];
        const dy = [d1[1], d2[1]];
        dE = [((c / sh) * (c / ch) * v * dv[0]) + (y * dy[0]) / (sh * ch), ((c / sh) * (c / ch) * v * dv[1]) + (y * dy[1]) / (sh * ch)];
        dB = [(c / sh) ** 2 * (v * dy[0] - y * dv[0]), (c / sh) ** 2 * (v * dy[1] - y * dv[1])];
        break;
      }
      case "horocyclic": {
        const D = horoDenominator(x, y, t);
        const dD = [(d1[2] - d1[1]) / D, (d2[2] - d2[1]) / D];
        dE = [-dD[0], -dD[1]];
        dB = [d1[0] / D - (x / D) * dD[0], d2[0] / D - (x / D) * dD[1]];
        break;
      }
    }
    return { ge: Math.hypot(dE[0], dE[1]), gb: Math.hypot(dB[0], dB[1]) };
  }
  const gb = f.kind === "cartesian" ? Math.cosh(e0) / Math.cosh(e) : f.kind === "polar" ? Math.cosh(e0) / Math.sinh(e) : Math.exp(e - e0);
  return { ge: lpx, gb: lpx * gb };
}

/** One level's lines at a pixel: distances in pixels to the nearest even line, to the nearest
 *  spreading line at subdivision m and to the nearest in-between line at m + 1 (which fades in
 *  with `half`). */
export interface LevelLines {
  k: number;
  m: number;
  weight: number;
  even: number;
  spread: number;
  between: number;
  half: number;
}

/** The three finest levels drawn at a pixel of plane size lpx, with weights a, 1 and 1 - a for the
 *  finest's a in (0, 1]: a level fades in at the fine end as the coarsest of the three fades out,
 *  so the summed opacity of every line is continuous in lpx. Distances are in pixels, from the
 *  phases and their rates; `axis` and `zero` are the distances to E = 0 and S = 0. */
export function gridLines(f: GridFrame, xf: Vec3, lpx: number, rates: GridRates = gridRates(f, xf, lpx, null)): { levels: LevelLines[]; axis: number; zero: number } | null {
  const { de, e, b } = gridPoint(f, xf);
  if (!(Math.abs(e) < 80)) return null;
  const ge = Math.max(rates.ge, 1e-300);
  const gb = Math.max(rates.gb, 1e-300);
  const x = Math.log10(8 * lpx) + Math.log10(UNITS[f.unit].perR);
  const kf = Math.floor(x) + 1;
  const a = kf - x;
  const weights = [a, 1, 1 - a];
  const levels: LevelLines[] = [];
  for (let n = 0; n < 3; n++) {
    const i = kf - f.kBase + n;
    if (i < 0 || i >= f.slots.length || weights[n] <= 0) continue;
    const slot = f.slots[i];
    if (slot.k > f.kTop) break;
    const even = (nearest(slot.phaseE + de / slot.delta) * slot.delta) / ge;
    const L = spreadLog2(f.kind, e, slot.delta);
    const m = subdivision(f.kind, L);
    const j = m - slot.m0;
    let spread = Infinity;
    let between = Infinity;
    if (j >= J_MIN && j <= J_MAX) {
      // the phase at level m is bitsPhase + B uScale 2^j, so it moves by gb uScale 2^j per pixel
      const u = b * slot.uScale;
      const rate = gb * slot.uScale * 2 ** j;
      spread = nearest(bitsPhase(slot.bits, slot.frac, j) + u * 2 ** j) / rate;
      if (j < J_MAX) between = nearest(bitsPhase(slot.bits, slot.frac, j + 1) + u * 2 ** (j + 1)) / (2 * rate);
    }
    levels.push({ k: slot.k, m, weight: weights[n], even, spread, between, half: Math.min(1, Math.max(0, L - m)) });
  }
  // the lines E = 0 and S = 0: |E| / ge, and |S| over the rate of S (B over the kind's scale)
  const e0 = f.camera.e;
  const axis = Math.abs(e) / ge;
  let zero: number;
  switch (f.kind) {
    case "cartesian":
      zero = Math.abs(Math.cosh(e0) * f.s0 + b) / gb;
      break;
    case "polar": {
      const phi = f.s0 + b / (Math.cosh(e0) * TURN);
      zero = Math.abs(phi) < 0.25 ? (Math.abs(phi) * TURN * Math.cosh(e0)) / gb : Infinity;
      break;
    }
    case "horocyclic":
      zero = Math.abs(f.s0 * Math.exp(-e0) + b) / gb;
      break;
  }
  return { levels, axis, zero };
}

/** The colour under the grid with the grid's lines drawn over it, the lines E = 0 and S = 0 in the
 *  accent colour; lpx is the plane length per pixel, `tangents` the frame point's change per pixel
 *  along x and y where the view is not conformal (null where it is). */
export function shadeGrid(f: GridFrame, col: RGB, xf: Vec3, lpx: number, accent: RGB, tangents: [Vec3, Vec3] | null = null, cover: Coverage = boxCoverage): RGB {
  const g = gridLines(f, xf, lpx, gridRates(f, xf, lpx, tangents));
  if (!g) return col;
  const lum = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
  const t = smoothstep(DARK - DARK_BAND, DARK + DARK_BAND, lum);
  const target: RGB = [WHITE[0] + (INK[0] - WHITE[0]) * t, WHITE[1] + (INK[1] - WHITE[1]) * t, WHITE[2] + (INK[2] - WHITE[2]) * t];
  const mixIn = (c: RGB, t: RGB, w: number): RGB => [c[0] + (t[0] - c[0]) * w, c[1] + (t[1] - c[1]) * w, c[2] + (t[2] - c[2]) * w];
  let out = col;
  for (const l of g.levels) {
    const cov = Math.max(cover(l.even, 1), cover(l.spread, 1), l.half * cover(l.between, 1));
    if (cov > 0) out = mixIn(out, target, GRID_OPACITY * l.weight * cov);
  }
  const dot = f.kind === "polar" ? Math.max(0, g.axis - (CENTRE_DOT_PX - AXIS_WIDTH_PX / 2)) : g.axis;
  const cov = Math.max(cover(dot, AXIS_WIDTH_PX), cover(g.zero, AXIS_WIDTH_PX));
  return cov > 0 ? mixIn(out, accent, AXIS_OPACITY * cov) : out;
}
