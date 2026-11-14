// Motifs (design notes, step 16): a picture that tiles the plane under the rotations alone, by
// Escher's method of bent edges. The kite K = T u s1 T (corners P, R, Q, R') has its edges paired
// by the rotations: rho_P = s2 s1 carries PR' onto PR, rho_Q = s3 s1 carries QR' onto QR. A motif
// bends PR into the curve c1 and RQ into c2; their turned copies c1' = rho_P^-1 c1 and
// c2' = rho_Q^-1 c2 replace PR' and QR'. c1 is a polyline in the P frame (the world's Poincare
// coordinates, P at 0) and c2 one in the Q frame (the world moved along x so Q is at 0), where each
// rotation is a plain turn about 0: the copies are the same polylines turned, and the seams match
// exactly. Features (circles, ellipses, strokes, filled shapes) are drawn over the tile in the P
// frame. Per pixel (motifAt): after the fold into the kite, a ray from the point away from PR (or
// QR) that crosses the curve an odd number of times puts the point in the neighbour's tile, two
// more mirrors away; de is the distance to the nearest of the four curves.
// Checked numerically before this was written (design-checks/check_motifs.py).
// Origin: the method of bent edges after M. C. Escher (no artwork reproduced); computer methods for
// Escher-like hyperbolic patterns after Doug Dunham. See CREDITS.md.

import type { Complex } from "./complex.ts";
import type { TriangleGroup } from "./groups.ts";
import { isHyperbolic, triangleGroup } from "./groups.ts";
import type { Mat3, Vec3 } from "./lorentz.ts";
import { apply, boostX, mink, reflectPoint } from "./lorentz.ts";

/** Sizes the shader's Motif block holds (tiling.glsl). */
export const MAX_CURVE_POINTS = 48;
export const MAX_FEATURES = 24;
export const MAX_FEATURE_POINTS = 128;
export const MAX_STROKE_POINTS = 16;
export const MAX_SHAPE_POINTS = 32;
/** Points of the format stay this far inside the unit disk. */
const MAX_RADIUS = 0.98;

export const MOTIF_FORMAT = "hyperscope-motif";
export const MOTIF_VERSION = 1;

export type Point = [number, number];
export const SLOTS = ["tile", "line", "black", "white"] as const;
export type Slot = (typeof SLOTS)[number];
export const FEATURE_KINDS = ["circle", "ellipse", "stroke", "shape"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

interface FeatureBase {
  colour: Slot;
  /** Toward white when positive, toward black when negative, in [-1, 1]; 0 when left out. */
  tone?: number;
}

/** A feature as the format gives it, in the P frame's Poincare coordinates. Paths are cubic Bezier
 *  chains: a start point, then two controls and an end per segment (3n + 1 points). */
export type FeatureSpec =
  | (FeatureBase & { kind: "circle"; centre: Point; radius: number })
  | (FeatureBase & { kind: "ellipse"; centre: Point; radii: Point; angle?: number })
  | (FeatureBase & { kind: "stroke"; path: Point[]; width: number | Point })
  | (FeatureBase & { kind: "shape"; path: Point[] });

/** A motif as JSON (src/content/motifs/*.json, or a file the user loads). */
export interface MotifSpec {
  format?: string;
  version?: number;
  name: string;
  group: [number, number, number];
  /** The colouring it is drawn with when chosen (a ContentState colouring name). */
  colouring: string;
  /** What Mosaic gives a colour to: each kite, or the polygon around P (its p kites alike). */
  cell?: "kite" | "P";
  /** c1's Bezier controls between P and R (3n - 1 points; P and R are the group's), P frame. */
  pr: Point[];
  /** c2's Bezier controls between R and Q, in the P frame too (sampled there, then moved to the Q
   *  frame). */
  rq: Point[];
  features?: FeatureSpec[];
}

export interface Feature {
  /** Index in FEATURE_KINDS. */
  kind: number;
  /** Index in SLOTS. */
  slot: number;
  tone: number;
  /** circle: centre, radius, 0; ellipse: centre and radii. */
  geo: [number, number, number, number];
  /** An ellipse's turn: cos and sin of its angle. */
  rot: Complex;
  /** A stroke's points with their half widths, a shape's with 0 (the last joins the first). */
  points: [number, number, number][];
  /** A circle holding every point the feature covers (P frame). */
  bound: [number, number, number];
}

/** A motif checked and sampled for one group (compileMotif). */
export interface Motif {
  spec: MotifSpec;
  group: TriangleGroup;
  /** c1 from P (0) to R in the P frame; c2 from R to Q (0) in the Q frame. */
  c1: Complex[];
  c2: Complex[];
  /** The world to the Q frame and back (moves along x by -d(P, Q) and d(P, Q)). */
  toQ: Mat3;
  fromQ: Mat3;
  dPQ: number;
  /** rho_P as a turn in the P frame (by 2 pi / p), rho_Q in the Q frame (by -2 pi / q). */
  turnP: Complex;
  turnQ: Complex;
  /** Unit directions away from PR (P frame) and QR (Q frame), into T. */
  awayPR: Complex;
  awayQR: Complex;
  /** Circles holding c1 (P frame) and c2 (Q frame), ends and straight edge included. */
  bound1: [number, number, number];
  bound2: [number, number, number];
  features: Feature[];
  /** Hyperbolic lengths of c1 and c2. */
  lengths: [number, number];
  /** Mosaic's cell: 0 each kite, 1 the polygon around P. */
  cell: 0 | 1;
}

export class MotifError extends Error {}

// ----------------------------------------------------------------------------- the disk

export const toDisk = (x: Vec3): Complex => [x[0] / (1 + x[2]), x[1] / (1 + x[2])];

export function fromDisk(w: Complex): Vec3 {
  const r2 = w[0] * w[0] + w[1] * w[1];
  const k = 1 / (1 - r2);
  return [2 * w[0] * k, 2 * w[1] * k, (1 + r2) * k];
}

const turn = (w: Complex, t: Complex): Complex => [w[0] * t[0] - w[1] * t[1], w[0] * t[1] + w[1] * t[0]];
const unturn = (w: Complex, t: Complex): Complex => [w[0] * t[0] + w[1] * t[1], w[1] * t[0] - w[0] * t[1]];

/** The hyperbolic distance between two points of the disk: 2 atanh(|w - z| / |1 - conj(z) w|). */
export function poincareDist(w: Complex, z: Complex): number {
  const dx = w[0] - z[0];
  const dy = w[1] - z[1];
  // 1 - conj(z) w
  const ux = 1 - (z[0] * w[0] + z[1] * w[1]);
  const uy = -(z[0] * w[1] - z[1] * w[0]);
  const r = Math.sqrt((dx * dx + dy * dy) / (ux * ux + uy * uy));
  return 2 * Math.atanh(Math.min(r, 1 - 1e-16));
}

/** Whether the ray from w along d crosses the polyline an odd number of times (each segment
 *  counted from its start, not its end, so a crossing at a joint counts once). */
export function oddCrossings(w: Complex, d: Complex, poly: readonly Complex[]): boolean {
  let odd = false;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i];
    const ex = poly[i + 1][0] - a[0];
    const ey = poly[i + 1][1] - a[1];
    const den = d[1] * ex - d[0] * ey;
    if (den === 0) continue;
    const rx = a[0] - w[0];
    const ry = a[1] - w[1];
    const t = (ry * ex - rx * ey) / den;
    const s = (d[0] * ry - d[1] * rx) / den;
    if (t > 0 && s >= 0 && s < 1) odd = !odd;
  }
  return odd;
}

/** The polyline's (Euclidean) nearest point to w. */
export function nearestOn(w: Complex, poly: readonly Complex[]): Complex {
  let best = Infinity;
  let at: Complex = poly[0];
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i];
    const ex = poly[i + 1][0] - a[0];
    const ey = poly[i + 1][1] - a[1];
    const t = Math.min(1, Math.max(0, ((w[0] - a[0]) * ex + (w[1] - a[1]) * ey) / (ex * ex + ey * ey)));
    const zx = a[0] + t * ex;
    const zy = a[1] + t * ey;
    const d2 = (w[0] - zx) ** 2 + (w[1] - zy) ** 2;
    if (d2 < best) {
      best = d2;
      at = [zx, zy];
    }
  }
  return at;
}

// ----------------------------------------------------------------------------- per pixel

export interface MotifHit {
  /** The two mirrors to the tile the point lies in when that is a neighbour's, else none. */
  letters: number[];
  /** The point after them: in the motif's own tile. */
  y: Vec3;
  /** Distance to the nearest of the four curves. */
  de: number;
  /** The mirrors from this tile to the tile across the nearest curve. */
  across: [number, number];
  /** The nearest curve: 0 c1, 1 c1', 2 c2, 3 c2'. */
  curve: number;
  /** The unit direction in which de grows, in the P frame (curves 0 and 1) or the Q frame (2 and 3). */
  grad: Complex;
}

const ACROSS: [number, number][] = [
  [1, 0],
  [0, 1],
  [2, 0],
  [0, 2],
];

/** The tile a point of the kite lies in, its distance to the tile's edge and the tile across it.
 *  `odd`: the point lies in s1 T (the fold word was odd and the point went once more across side 1). */
export function motifAt(m: Motif, x: Vec3, odd: boolean): MotifHit {
  const n = m.group.normals;
  let y = x;
  let wP = toDisk(y);
  let wQ = toDisk(apply(m.toQ, y));
  let letters: number[] = [];
  const inBound = (w: Complex, b: readonly number[]) => (w[0] - b[0]) ** 2 + (w[1] - b[1]) ** 2 <= b[2] * b[2];
  const back = (d: Complex): Complex => [-d[0], -d[1]];
  if (!odd) {
    if (inBound(wP, m.bound1) && oddCrossings(wP, m.awayPR, m.c1)) letters = [1, 0];
    else if (inBound(wQ, m.bound2) && oddCrossings(wQ, m.awayQR, m.c2)) letters = [2, 0];
  } else {
    const mP = turn(wP, m.turnP);
    const mQ = turn(wQ, m.turnQ);
    if (inBound(mP, m.bound1) && oddCrossings(mP, back(m.awayPR), m.c1)) letters = [0, 1];
    else if (inBound(mQ, m.bound2) && oddCrossings(mQ, back(m.awayQR), m.c2)) letters = [0, 2];
  }
  if (letters.length) {
    for (const j of letters) y = reflectPoint(y, n[j]);
    wP = toDisk(y);
    wQ = toDisk(apply(m.toQ, y));
  }
  // the four curves: c1 and c1' (as c1 from rho_P y) in the P frame, c2 and c2' in the Q frame
  const at: Complex[] = [wP, turn(wP, m.turnP), wQ, turn(wQ, m.turnQ)];
  let de = Infinity;
  let curve = 0;
  let grad: Complex = [0, 0];
  for (let c = 0; c < 4; c++) {
    const v = at[c];
    const z = nearestOn(v, c < 2 ? m.c1 : m.c2);
    const d = poincareDist(v, z);
    if (d < de) {
      de = d;
      curve = c;
      const gx = v[0] - z[0];
      const gy = v[1] - z[1];
      const len = Math.hypot(gx, gy);
      grad = len > 0 ? [gx / len, gy / len] : [0, 0];
    }
  }
  if (curve === 1) grad = unturn(grad, m.turnP);
  else if (curve === 3) grad = unturn(grad, m.turnQ);
  return { letters, y, de, across: ACROSS[curve], curve, grad };
}

/** Signed distance from w to the feature in P frame units, negative inside. */
export function featureDistance(f: Feature, w: Complex): number {
  switch (FEATURE_KINDS[f.kind]) {
    case "circle":
      return Math.hypot(w[0] - f.geo[0], w[1] - f.geo[1]) - f.geo[2];
    case "ellipse": {
      // turned into the ellipse's axes; the usual cheap estimate k0 (k0 - 1) / k1
      const p = unturn([w[0] - f.geo[0], w[1] - f.geo[1]], f.rot);
      const [a, b] = [f.geo[2], f.geo[3]];
      const k0 = Math.hypot(p[0] / a, p[1] / b);
      const k1 = Math.hypot(p[0] / (a * a), p[1] / (b * b));
      return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b);
    }
    case "stroke": {
      let d = Infinity;
      const pts = f.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay, ha] = pts[i];
        const [bx, by, hb] = pts[i + 1];
        const ex = bx - ax;
        const ey = by - ay;
        const e2 = ex * ex + ey * ey;
        const t = e2 > 0 ? Math.min(1, Math.max(0, ((w[0] - ax) * ex + (w[1] - ay) * ey) / e2)) : 0;
        d = Math.min(d, Math.hypot(w[0] - ax - t * ex, w[1] - ay - t * ey) - (ha + t * (hb - ha)));
      }
      return d;
    }
    default: {
      // a closed polygon: the nearest edge, inside by the crossings of a ray along +x
      let d2 = Infinity;
      let inside = false;
      const pts = f.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [ax, ay] = pts[j];
        const [bx, by] = pts[i];
        const ex = bx - ax;
        const ey = by - ay;
        const e2 = ex * ex + ey * ey;
        const t = e2 > 0 ? Math.min(1, Math.max(0, ((w[0] - ax) * ex + (w[1] - ay) * ey) / e2)) : 0;
        d2 = Math.min(d2, (w[0] - ax - t * ex) ** 2 + (w[1] - ay - t * ey) ** 2);
        if (ay > w[1] !== by > w[1] && w[0] < ax + ((w[1] - ay) * ex) / ey) inside = !inside;
      }
      return inside ? -Math.sqrt(d2) : Math.sqrt(d2);
    }
  }
}

/** The topmost feature that covers w (hard edges), or -1: the area means' route. */
export function featureAt(m: Motif, w: Complex): number {
  for (let i = m.features.length - 1; i >= 0; i--) {
    const f = m.features[i];
    if ((w[0] - f.bound[0]) ** 2 + (w[1] - f.bound[1]) ** 2 > f.bound[2] * f.bound[2]) continue;
    if (featureDistance(f, w) < 0) return i;
  }
  return -1;
}

// ----------------------------------------------------------------------------- compiling

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

function points(v: unknown, what: string): Point[] {
  if (!Array.isArray(v) || !v.every(isPoint)) throw new MotifError(`${what} must be a list of [x, y] points`);
  for (const p of v) if (Math.hypot(p[0], p[1]) > MAX_RADIUS) throw new MotifError(`${what} has a point outside the disk (|w| above ${MAX_RADIUS})`);
  return v.map((p) => [p[0], p[1]]);
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** A Bezier chain (3n + 1 points) sampled evenly in each segment's parameter, at most `max` points
 *  in all, the ends and joints exact. With a tolerance, a segment gets only as many pieces as keep
 *  the polyline within about tol of it (a straight one, one piece): the deviation of n pieces is
 *  below 3/4 of the controls' distance from the chord over n^2. */
export function sampleChain(chain: Point[], max: number, tol = 0): Point[] {
  const nseg = (chain.length - 1) / 3;
  const per = Math.floor((max - 1) / nseg);
  const out: Point[] = [chain[0]];
  for (let s = 0; s < nseg; s++) {
    const [a, b, c, d] = chain.slice(3 * s, 3 * s + 4);
    let n = per;
    if (tol > 0) {
      const off = Math.max(chordDistance(b, a, d), chordDistance(c, a, d));
      n = Math.min(per, Math.max(1, Math.ceil(Math.sqrt((0.75 * off) / tol))));
    }
    for (let k = 1; k <= n; k++) out.push(k === n ? d : cubic(a, b, c, d, k / n));
  }
  return out;
}

/** The distance from p to the segment ab. */
function chordDistance(p: Point, a: Point, b: Point): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const e2 = ex * ex + ey * ey;
  const t = e2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / e2)) : 0;
  return Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey);
}

/** How far a feature's polyline may stray from its path, in P frame units: about a thousandth of a
 *  tile, so straight pieces cost two points and curved ones what they need, up to the limits. */
const FEATURE_TOL = 2e-5;

function chainOf(v: unknown, what: string, closed: boolean, max: number): Point[] {
  const pts = points(v, what);
  if (pts.length < 4 || (pts.length - 1) % 3 !== 0) throw new MotifError(`${what} must have 3n + 1 points (a start, then two controls and an end per segment)`);
  const nseg = (pts.length - 1) / 3;
  if (nseg > max - 1 || Math.floor((max - 1) / nseg) < 1) throw new MotifError(`${what} has too many segments`);
  const out = sampleChain(pts, max, FEATURE_TOL);
  if (closed && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-12) out.pop();
  return out;
}

function boundOf(pts: readonly (readonly number[])[], pad: (i: number) => number): [number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  const c: Complex = [(x0 + x1) / 2, (y0 + y1) / 2];
  let r = 0;
  pts.forEach((p, i) => (r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1]) + pad(i))));
  return [c[0], c[1], r * (1 + 1e-9) + 1e-12];
}

function featureOf(v: unknown, i: number): Feature {
  const what = `feature ${i + 1}`;
  if (typeof v !== "object" || v === null) throw new MotifError(`${what} is not an object`);
  const f = v as Record<string, unknown>;
  const kind = FEATURE_KINDS.indexOf(f.kind as FeatureKind);
  if (kind < 0) throw new MotifError(`${what}: kind must be one of ${FEATURE_KINDS.join(", ")}`);
  const slot = SLOTS.indexOf(f.colour as Slot);
  if (slot < 0) throw new MotifError(`${what}: colour must be one of ${SLOTS.join(", ")}`);
  const tone = f.tone ?? 0;
  if (!isNum(tone) || Math.abs(tone) > 1) throw new MotifError(`${what}: tone must be a number from -1 to 1`);
  const base = { kind, slot, tone, rot: [1, 0] as Complex, geo: [0, 0, 0, 0] as [number, number, number, number], points: [] as [number, number, number][] };
  switch (FEATURE_KINDS[kind]) {
    case "circle": {
      const [c] = points([f.centre], `${what}'s centre`);
      if (!isNum(f.radius) || f.radius <= 0 || f.radius > 1) throw new MotifError(`${what}: radius must be above 0 and at most 1`);
      return { ...base, geo: [c[0], c[1], f.radius, 0], bound: [c[0], c[1], f.radius * (1 + 1e-9)] };
    }
    case "ellipse": {
      const [c] = points([f.centre], `${what}'s centre`);
      if (!isPoint(f.radii) || !(f.radii[0] > 0 && f.radii[1] > 0 && f.radii[0] <= 1 && f.radii[1] <= 1)) throw new MotifError(`${what}: radii must be two numbers above 0 and at most 1`);
      const angle = f.angle ?? 0;
      if (!isNum(angle)) throw new MotifError(`${what}: angle must be a number of degrees`);
      const a = (angle * Math.PI) / 180;
      return { ...base, geo: [c[0], c[1], f.radii[0], f.radii[1]], rot: [Math.cos(a), Math.sin(a)], bound: [c[0], c[1], Math.max(f.radii[0], f.radii[1]) * (1 + 1e-9)] };
    }
    case "stroke": {
      const pts = chainOf(f.path, `${what}'s path`, false, MAX_STROKE_POINTS);
      const width = f.width;
      const ends: Point | null = isNum(width) ? [width, width] : isPoint(width) ? width : null;
      if (!ends || ends[0] < 0 || ends[1] < 0 || Math.max(...ends) <= 0 || Math.max(...ends) > 1) throw new MotifError(`${what}: width must be a number, or two for its ends, above 0 and at most 1`);
      // the half width tapers along the path's length
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const total = cum[cum.length - 1] || 1;
      const withHalf = pts.map((p, k): [number, number, number] => [p[0], p[1], (ends[0] + (ends[1] - ends[0]) * (cum[k] / total)) / 2]);
      return { ...base, points: withHalf, bound: boundOf(withHalf, (k) => withHalf[k][2]) };
    }
    default: {
      const pts = chainOf(f.path, `${what}'s path`, true, MAX_SHAPE_POINTS + 1);
      if (pts.length > MAX_SHAPE_POINTS) throw new MotifError(`${what}: a shape has at most ${MAX_SHAPE_POINTS} points`);
      const flat = pts.map((p): [number, number, number] => [p[0], p[1], 0]);
      return { ...base, points: flat, bound: boundOf(flat, () => 0) };
    }
  }
}

/** Segments ab and cd cross (properly: neither touching at an end nor collinear). */
function cross(a: Complex, b: Complex, c: Complex, d: Complex): boolean {
  const o = (p: Complex, q: Complex, r: Complex) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) > 0 !== o(a, b, d) > 0 && o(c, d, a) > 0 !== o(c, d, b) > 0;
}

/** Each segment of a polyline cut into k (points along its straight segments). */
function dense(poly: readonly Complex[], k: number): Complex[] {
  const out: Complex[] = [];
  for (let i = 0; i + 1 < poly.length; i++)
    for (let s = 0; s < k; s++) out.push([poly[i][0] + ((poly[i + 1][0] - poly[i][0]) * s) / k, poly[i][1] + ((poly[i + 1][1] - poly[i][1]) * s) / k]);
  out.push(poly[poly.length - 1]);
  return out;
}

/** x lies inside T, or on its side j (the side two triangles share). */
const inT = (x: Vec3, n: readonly Vec3[], j: number) => [0, 1, 2].every((i) => (i === j ? mink(x, n[i]) <= 0 : mink(x, n[i]) < 0));

/** Check a motif and sample it for its group, its curves with `curvePoints` points each (the
 *  benchmark tries fewer); throws MotifError with the reason it is refused. */
export function compileMotif(input: unknown, curvePoints = MAX_CURVE_POINTS): Motif {
  if (typeof input !== "object" || input === null) throw new MotifError("a motif is a JSON object");
  const s = input as Record<string, unknown>;
  if (s.format !== undefined && s.format !== MOTIF_FORMAT) throw new MotifError(`not a motif (format is not "${MOTIF_FORMAT}")`);
  if (s.version !== undefined && s.version !== MOTIF_VERSION) throw new MotifError(`made by a newer Hyperscope (motif format version ${String(s.version)})`);
  if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 60) throw new MotifError("a motif needs a name of at most 60 characters");
  const gv = s.group;
  if (!Array.isArray(gv) || gv.length !== 3 || !gv.every((v) => Number.isInteger(v) && v >= 2 && v <= 64)) throw new MotifError("group must be three whole numbers from 2 to 64");
  const [p, q, r] = gv as [number, number, number];
  if (!isHyperbolic(p, q, r)) throw new MotifError(`(${p}, ${q}, ${r}) is not a hyperbolic triangle group`);
  if (typeof s.colouring !== "string") throw new MotifError("a motif needs a default colouring");
  const cell = s.cell ?? "kite";
  if (cell !== "kite" && cell !== "P") throw new MotifError('cell must be "kite" or "P"');
  const g = triangleGroup(p, q, r);
  const n = g.normals;
  const R = toDisk(g.corners.R);
  const Qd = toDisk(g.corners.Q);
  const dPQ = Math.acosh(g.corners.Q[2]);
  const toQ = boostX(-dPQ);
  const fromQ = boostX(dPQ);
  const ctl = (v: unknown, what: string): Point[] => {
    const pts = points(v, what);
    if ((pts.length + 1) % 3 !== 0) throw new MotifError(`${what} must have 3n - 1 points (two controls per segment and the joints between)`);
    // each segment needs a point of its own among the curve's samples
    if ((pts.length + 1) / 3 > curvePoints - 1) throw new MotifError(`${what} has too many segments (at most ${curvePoints - 1})`);
    return pts;
  };
  const pr = ctl(s.pr, "pr");
  const rq = ctl(s.rq, "rq");
  const c1 = sampleChain([[0, 0], ...pr, R], curvePoints) as Complex[];
  const c2w = sampleChain([R, ...rq, Qd], curvePoints);
  const c2 = c2w.map((w) => toDisk(apply(toQ, fromDisk(w))));
  c1[0] = [0, 0];
  c1[c1.length - 1] = R;
  c2[0] = toDisk(apply(toQ, g.corners.R));
  c2[c2.length - 1] = [0, 0];
  // c1 inside T u s2 T, c2 inside T u s3 T, touching their boundaries only at their ends
  for (const w of dense(c1, 8).slice(1, -1)) {
    const x = fromDisk(w);
    if (!(inT(x, n, 1) || inT(reflectPoint(x, n[1]), n, 1))) throw new MotifError("the curve from P to R leaves the two triangles on either side of PR");
  }
  for (const w of dense(c2, 8).slice(1, -1)) {
    const x = apply(fromQ, fromDisk(w));
    if (!(inT(x, n, 2) || inT(reflectPoint(x, n[2]), n, 2))) throw new MotifError("the curve from R to Q leaves the two triangles on either side of RQ");
  }
  // the tile's boundary P R Q R' P in the world's disk: no two segments cross
  const world = (w: Complex) => toDisk(apply(fromQ, fromDisk(w)));
  const tP: Complex = [Math.cos((2 * Math.PI) / p), Math.sin((2 * Math.PI) / p)];
  const tQ: Complex = [Math.cos((-2 * Math.PI) / q), Math.sin((-2 * Math.PI) / q)];
  const d1 = dense(c1, 4);
  const d2 = dense(c2, 4);
  // P to R (c1), R to Q (c2), Q to R' (c2' backwards), R' to P (c1' backwards)
  const loop: Complex[] = [...d1, ...d2.slice(1).map(world), ...d2.slice(0, -1).reverse().map((w) => world(unturn(w, tQ))), ...d1.slice(0, -1).reverse().map((w) => unturn(w, tP))];
  checkSimple(loop);
  const features = (Array.isArray(s.features) ? s.features : s.features === undefined ? [] : null)?.map(featureOf);
  if (!features) throw new MotifError("features must be a list");
  if (features.length > MAX_FEATURES) throw new MotifError(`at most ${MAX_FEATURES} features`);
  const total = features.reduce((k, f) => k + f.points.length, 0);
  if (total > MAX_FEATURE_POINTS) throw new MotifError(`the features' paths have ${total} points, at most ${MAX_FEATURE_POINTS} fit`);
  const len = (poly: Complex[]) => poly.slice(1).reduce((L, w, i) => L + poincareDist(w, poly[i]), 0);
  const a = Math.PI / p;
  const phi = Math.PI - Math.PI / q;
  const spec = JSON.parse(JSON.stringify(input)) as MotifSpec;
  return {
    spec,
    group: g,
    c1,
    c2,
    toQ,
    fromQ,
    dPQ,
    turnP: tP,
    turnQ: tQ,
    awayPR: [Math.sin(a), -Math.cos(a)],
    awayQR: [-Math.sin(phi), Math.cos(phi)],
    bound1: boundOf(c1, () => 0),
    bound2: boundOf(c2, () => 0),
    features,
    lengths: [len(c1), len(c2)],
    cell: cell === "P" ? 1 : 0,
  };
}

/** Refuses a closed loop (first point = last) with two segments that cross. */
function checkSimple(loop: Complex[]): void {
  const n = loop.length - 1;
  const box = Array.from({ length: n }, (_, i) => [Math.min(loop[i][0], loop[i + 1][0]), Math.min(loop[i][1], loop[i + 1][1]), Math.max(loop[i][0], loop[i + 1][0]), Math.max(loop[i][1], loop[i + 1][1])]);
  // sorted by left edge: a sweep keeps it near n log n
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => box[i][0] - box[j][0]);
  for (let a = 0; a < n; a++) {
    const i = order[a];
    for (let b = a + 1; b < n; b++) {
      const j = order[b];
      if (box[j][0] > box[i][2]) break;
      if (box[j][1] > box[i][3] || box[j][3] < box[i][1]) continue;
      const gap = Math.abs(i - j);
      if (gap <= 1 || gap === n - 1) continue;
      if (cross(loop[i], loop[i + 1], loop[j], loop[j + 1])) throw new MotifError("the tile's edges cross each other (the curves must meet only at P, R, Q and R')");
    }
  }
}
