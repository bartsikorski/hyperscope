// The unit grid (design: Unit grid; design notes, step 8): three grids of one shape, an even family
// of lines E = jΔ and a spreading family of geodesics S = iΔ/2^m subdivided by powers of two where
// they spread. Each grid keeps its own camera, moved by the same right factors as the view's camera
// and never re-centred: S is an exact fixed-point BigInt, E a float64.
//
//   Cartesian (Fermi)  E = Y = asinh(y),        S = X = atanh(x / t)          spacing  dX cosh Y
//   Polar              E = r = acosh(t),        S = phi = atan2(y, x) / 2pi   spacing  2pi dphi sinh r
//   Horocyclic         E = h = -ln(t - y),      S = p = x / (t - y)           spacing  dp e^-h
//
// A grid camera (S0, E0, theta) is the isometry G = A(S0) B(E0) R(theta): Cartesian boostX(X0)
// boostY(Y0), polar rotation(2pi phi0) boostX(r0), horocyclic parabolic(p0) boostY(h0). theta is the
// angle from the grid's first frame axis (e_X, e_r, e_p) to the screen's x axis. Closed forms below
// were checked against 100-digit composition of these matrices (tools/hp/grid_vectors.py). The three
// coordinate systems are the standard ones of the hyperbolic plane (Cannon, Floyd, Kenyon and Parry,
// Hyperbolic Geometry, 1997; Ratcliffe, Foundations of Hyperbolic Manifolds).

import type { Mat3, Vec3 } from "./lorentz.ts";
import { apply } from "./lorentz.ts";

export type GridKind = "cartesian" | "polar" | "horocyclic";
export const GRID_KINDS: GridKind[] = ["cartesian", "polar", "horocyclic"];

/** Size of R: labels in metres for the physical sizes, in R for bare units. */
export type GridUnit = "earth" | "km" | "m" | "R";
export const GRID_UNITS: GridUnit[] = ["earth", "km", "m", "R"];
export const UNITS: Record<GridUnit, { name: string; perR: number; symbol: "m" | "R" }> = {
  earth: { name: "R = Earth's radius", perR: 6_371_000, symbol: "m" },
  km: { name: "R = 1 km", perR: 1000, symbol: "m" },
  m: { name: "R = 1 m", perR: 1, symbol: "m" },
  R: { name: "units of R", perR: 1, symbol: "R" },
};

export interface GridSettings {
  on: boolean;
  kind: GridKind;
  unit: GridUnit;
}
export const DEFAULT_GRID: GridSettings = { on: false, kind: "cartesian", unit: "earth" };

// ------------------------------------------------------------------------------ exact numbers

/** S is kept as n / 2^FRAC_BITS (R for Cartesian and horocyclic, turns for polar). */
export const FRAC_BITS = 256n;
const ONE = 1n << FRAC_BITS;
const SCALE = 2 ** Number(FRAC_BITS);

/** x as a fixed-point BigInt: exact, since x * 2^256 is a float64 with the same 53 bits. */
export function toFixed(x: number): bigint {
  return BigInt(Math.round(x * SCALE));
}

export function fixedToNumber(n: bigint): number {
  return Number(n) / SCALE;
}

/** floor(a / b) for b > 0, and the remainder a - b floor(a / b) in [0, b). */
function floorDiv(a: bigint, b: bigint): [bigint, bigint] {
  let q = a / b;
  let r = a - q * b;
  if (r < 0n) {
    q -= 1n;
    r += b;
  }
  return [q, r];
}

// ------------------------------------------------------------------------------- grid cameras

export interface GridCamera {
  /** S0 * 2^FRAC_BITS; polar: turns, kept in [0, 1). */
  s: bigint;
  /** E0: Y, r or h of the screen-centre point. */
  e: number;
  /** Angle from the grid's first frame axis to the screen's x axis. */
  theta: number;
}

export type GridCameras = Record<GridKind, GridCamera>;

export function homeGrids(): GridCameras {
  return { cartesian: { s: 0n, e: 0, theta: 0 }, polar: { s: 0n, e: 0, theta: 0 }, horocyclic: { s: 0n, e: 0, theta: 0 } };
}

const TURN = 2 * Math.PI;

/** R(theta) q. */
function turn(theta: number, q: Vec3): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c * q[0] - s * q[1], s * q[0] + c * q[1], q[2]];
}

/** t - 1 of a point on the hyperboloid without cancellation. */
export function tMinusOne(q: Vec3): number {
  return (q[0] * q[0] + q[1] * q[1]) / (1 + q[2]);
}

/** Grid coordinates of a frame point q (relative to the screen centre): E absolute, S relative to
 *  S0 (R, or turns for polar), both float64. */
export function gridAt(kind: GridKind, g: GridCamera, q: Vec3): { e: number; ds: number } {
  const [x, y, t] = turn(g.theta, q);
  const e0 = g.e;
  switch (kind) {
    case "cartesian": {
      const c = Math.cosh(e0);
      const s = Math.sinh(e0);
      return { e: Math.asinh(s * t + c * y), ds: Math.atanh(x / (c * (t + Math.tanh(e0) * y))) };
    }
    case "polar": {
      const wx = Math.cosh(e0) * x + Math.sinh(e0) * t;
      return { e: Math.asinh(Math.hypot(wx, y)), ds: Math.atan2(y, wx) / TURN };
    }
    case "horocyclic": {
      const d = horoDenominator(x, y, t);
      return { e: e0 - horoLog([x, y, t]), ds: (Math.exp(e0) * x) / d };
    }
  }
}

/** t - y of a point, without cancellation on either side (t - y = (1 + x^2) / (t + y)). */
export function horoDenominator(x: number, y: number, t: number): number {
  return y > 0 ? (1 + x * x) / (t + y) : t - y;
}

/** ln(t - y) of a point: log1p((t - 1) - y) near the centre (no cancellation for small moves),
 *  ln of the denominator above further out. */
function horoLog(q: Vec3): number {
  const a = tMinusOne(q) - q[1];
  return Math.abs(a) < 0.5 ? Math.log1p(a) : Math.log(horoDenominator(q[0], q[1], q[2]));
}

/** The grid camera after the view's camera is multiplied by N on the right. */
export function moveGrid(kind: GridKind, g: GridCamera, n: Mat3): GridCamera {
  const [x, y, t] = turn(g.theta, apply(n, [0, 0, 1]));
  const [vx, vy, vt] = turn(g.theta, apply(n, [1, 0, 0]));
  const e0 = g.e;
  switch (kind) {
    case "cartesian": {
      const tau = Math.tanh(e0);
      const w = t + tau * y;
      return {
        s: g.s + toFixed(Math.atanh(x / (Math.cosh(e0) * w))),
        e: Math.asinh(Math.sinh(e0) * t + Math.cosh(e0) * y),
        theta: Math.atan2(vy + tau * vt, vx * w - tau * vy * x - vt * x),
      };
    }
    case "polar": {
      const c = Math.cosh(e0);
      const s = Math.sinh(e0);
      const tau = Math.tanh(e0);
      const wx = c * x + s * t;
      const r = Math.asinh(Math.hypot(wx, y));
      const dphi = Math.atan2(y, wx);
      let theta: number;
      if (r < 1) {
        // near the centre phi and theta are each ill-conditioned but 2pi phi + theta is not: carry
        // the frame's x axis u = boostX(r0) v back to the centre along the radius, take its angle
        // and subtract the same dphi that goes into S (exact at the centre itself, any dphi)
        const wt = s * x + c * t;
        const ux = c * vx + s * vt;
        const k = (s * vx + c * vt) / (1 + wt);
        theta = Math.atan2(vy - y * k, ux - wx * k) - dphi;
      } else theta = Math.atan2(-y * vx + (x + tau * t) * vy - tau * y * vt, tau * vx + vt);
      return { s: (((g.s + toFixed(dphi / TURN)) % ONE) + ONE) % ONE, e: r, theta };
    }
    case "horocyclic": {
      const d = horoDenominator(x, y, t);
      return {
        s: g.s + toFixed((Math.exp(e0) * x) / d),
        e: e0 - horoLog([x, y, t]),
        theta: Math.atan2(vy - vt, d * vx + x * (vy - vt)),
      };
    }
  }
}

export function moveGrids(grids: GridCameras, n: Mat3): GridCameras {
  return { cartesian: moveGrid("cartesian", grids.cartesian, n), polar: moveGrid("polar", grids.polar, n), horocyclic: moveGrid("horocyclic", grids.horocyclic, n) };
}

// ------------------------------------------------------------------------------------- levels

/** Levels are Delta_k = 10^k units; slots k = kBase .. kBase + SLOTS - 1 go to the GPU. */
export const SLOTS = 8;
/** A level is fully visible at FULL_PX pixels between lines and gone at FADE_PX. */
export const FULL_PX = 80;
export const FADE_PX = 8;
/** Past this E0 cosh leaves the float32 range on the GPU: the grid is not drawn. */
export const MAX_E = 60;

/** The coarsest level: the largest power of ten units not above 2R. */
export function topLevel(unit: GridUnit): number {
  return Math.floor(Math.log10(2 * UNITS[unit].perR) + 1e-9);
}

/** The finest level with lines at least FADE_PX pixels apart at plane length lpx per pixel. */
export function finestLevel(unit: GridUnit, lpx: number): number {
  return Math.floor(Math.log10(FADE_PX * lpx * UNITS[unit].perR)) + 1;
}

/** Spacing of level k in R. */
export function levelSpacing(unit: GridUnit, k: number): number {
  return 10 ** k / UNITS[unit].perR;
}

/** Weight of level k at plane length lpx per pixel: 0 at FADE_PX px between lines, 1 at FULL_PX. */
export function levelWeight(delta: number, lpx: number): number {
  return Math.min(1, Math.max(0, Math.log10(delta / (FADE_PX * lpx))));
}

/** log2 of the spreading at E for level spacing delta (kind's L; polar depends on delta). */
export function spreadLog2(kind: GridKind, e: number, delta: number): number {
  switch (kind) {
    case "cartesian": {
      const a = Math.abs(e);
      return a * Math.LOG2E - 1 + Math.log2(1 + Math.exp(-2 * a));
    }
    case "polar": return Math.log2((TURN * Math.sinh(e)) / delta);
    case "horocyclic": return -e * Math.LOG2E;
  }
}

/** Subdivision level from L: floor, and at least 2 (four rays) for polar. */
export function subdivision(kind: GridKind, L: number): number {
  const m = Math.floor(L);
  return kind === "polar" ? Math.max(2, m) : m;
}

export interface GridSlot {
  k: number;
  /** Delta_k in R. */
  delta: number;
  /** frac(E0 / delta). */
  phaseE: number;
  /** The camera's subdivision level for this slot and the bits of 2^m0 S0 / unit there: floor mod
   *  2^32 and the fraction (float64 here; hi + lo float32 for the GPU). */
  m0: number;
  bits: number;
  frac: number;
  /** Multiplies the pixel's offset term B (below) into 2^m0 dS / unit. */
  uScale: number;
}

export interface GridFrame {
  kind: GridKind;
  unit: GridUnit;
  camera: GridCamera;
  kBase: number;
  kTop: number;
  slots: GridSlot[];
  /** S0 as a float (polar: signed turns), for the lines S = 0. */
  s0: number;
}

/** What one frame needs: levels around the screen centre's plane length per pixel lpx. */
export function gridFrame(kind: GridKind, unit: GridUnit, g: GridCamera, lpx: number): GridFrame | null {
  if (!(Math.abs(g.e) <= MAX_E)) return null;
  const perR = UNITS[unit].perR;
  const kTop = topLevel(unit);
  const kBase = Math.min(kTop, finestLevel(unit, lpx)) - 2;
  const slots: GridSlot[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const k = kBase + i;
    const delta = levelSpacing(unit, k);
    const ePhase = g.e * perR * 10 ** -k;
    const m0 = subdivision(kind, spreadLog2(kind, g.e, delta));
    // 2^m0 S0 / unit with unit = delta (R) or a turn (polar): exact rational in BigInt
    let num = g.s;
    let den = ONE;
    if (kind !== "polar") {
      num *= BigInt(perR);
      if (k < 0) num *= 10n ** BigInt(-k);
      else den *= 10n ** BigInt(k);
    }
    if (m0 >= 0) num <<= BigInt(m0);
    else den <<= BigInt(-m0);
    const [q, r] = floorDiv(num, den);
    const frac = Number((r << 64n) / den) / 2 ** 64;
    slots.push({ k, delta, phaseE: ePhase - Math.floor(ePhase), m0, bits: Number(BigInt.asUintN(32, q)), frac, uScale: offsetScale(kind, g.e, delta, m0) });
  }
  let s0 = fixedToNumber(g.s);
  if (kind === "polar" && s0 > 0.5) s0 -= 1;
  return { kind, unit, camera: g, kBase, kTop, slots, s0 };
}

/** The pixel's offset term B (of the order of its distance from the centre) times this is
 *  2^m0 dS / unit; see offsetTerm. */
function offsetScale(kind: GridKind, e0: number, delta: number, m0: number): number {
  switch (kind) {
    case "cartesian": return 2 ** m0 / (Math.cosh(e0) * delta);
    case "polar": return 2 ** m0 / (TURN * Math.cosh(e0));
    case "horocyclic": return (2 ** m0 * Math.exp(e0)) / delta;
  }
}

/** The pixel terms shared by all slots, from its frame point turned into the grid frame:
 *  dE (the even coordinate relative to E0, without cancellation), E and the offset term B with
 *  B uScale = 2^m0 dS / unit: Cartesian dX cosh Y0, polar dphi cosh r0 (radians), horocyclic
 *  dp e^-h0. The shader evaluates the same expressions in float32. */
export function offsetTerm(kind: GridKind, e0: number, q: Vec3): { de: number; e: number; b: number } {
  const [x, y, t] = q;
  const tm1 = tMinusOne(q);
  switch (kind) {
    case "cartesian": {
      const c = Math.cosh(e0);
      const s = Math.sinh(e0);
      const tau = Math.tanh(e0);
      const e = Math.asinh(s * t + c * y);
      const de = 2 * Math.asinh((s * tm1 + c * y) / (2 * Math.cosh((e + e0) / 2)));
      const z = x / (c * (t + tau * y));
      const ratio = Math.abs(z) < 1e-8 ? 1 : Math.atanh(z) / z;
      return { de, e: e0 + de, b: (ratio * x) / (t + tau * y) };
    }
    case "polar": {
      const c = Math.cosh(e0);
      const s = Math.sinh(e0);
      const wx = c * x + s * t;
      const r = Math.asinh(Math.hypot(wx, y));
      // cosh r - cosh r0 = s x + c (t - 1) = 2 sinh((r + r0) / 2) sinh((r - r0) / 2)
      const half = Math.sinh((r + e0) / 2);
      const de = half > 1e-150 ? 2 * Math.asinh((s * x + c * tm1) / (2 * half)) : r - e0;
      return { de, e: e0 + de, b: Math.atan2(y / c, x + Math.tanh(e0) * t) * c };
    }
    case "horocyclic": {
      const de = -horoLog(q);
      return { de, e: e0 + de, b: x / horoDenominator(x, y, t) };
    }
  }
}
