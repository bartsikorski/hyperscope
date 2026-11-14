// Hyperboloid model of the hyperbolic plane, curvature -1 (one unit = one curvature radius R).
//
//   <a, b> = a.x b.x + a.y b.y - a.t b.t,     H^2 = { x : <x, x> = -1, x.t > 0 },     cosh d(a, b) = -<a, b>
//
// Points are Vec3 = [x, y, t]. Isometries are 3x3 Lorentz matrices M (row-major, M^T eta M = eta,
// M_tt > 0) acting as x -> M x; their columns are the images of the basis vectors. Everything here is
// float64; the GPU only ever receives well-conditioned results (see docs: "Numeric rules").
// Origin: the hyperboloid model as a working representation follows HyperRogue (Zeno Rogue); see CREDITS.md.

export type Vec3 = [number, number, number];
/** Row-major 3x3 matrix: [m00, m01, m02, m10, m11, m12, m20, m21, m22]. */
export type Mat3 = number[];

export const ORIGIN: Vec3 = [0, 0, 1];

export function mink(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] - a[2] * b[2];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Rescale a timelike vector onto the upper sheet of the hyperboloid. */
export function normalizePoint(x: Vec3): Vec3 {
  const n = Math.sqrt(-mink(x, x));
  return scale(x, Math.sign(x[2]) / n);
}

/** Rescale a spacelike vector to <n, n> = 1. */
export function normalizeSpacelike(n: Vec3): Vec3 {
  return scale(n, 1 / Math.sqrt(mink(n, n)));
}

/** Hyperbolic distance. Uses 2 asinh(|a - b| / 2), which keeps full precision for tiny distances
 *  where acosh(-<a, b>) loses half the digits. */
export function dist(a: Vec3, b: Vec3): number {
  const d = sub(a, b);
  const q = mink(d, d); // >= 0 for two points on the hyperboloid (up to rounding)
  return 2 * Math.asinh(Math.sqrt(Math.max(q, 0)) / 2);
}

// ----------------------------------------------------------------------------- matrices

export function identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  return r;
}

export function apply(m: Mat3, x: Vec3): Vec3 {
  return [
    m[0] * x[0] + m[1] * x[1] + m[2] * x[2],
    m[3] * x[0] + m[4] * x[1] + m[5] * x[2],
    m[6] * x[0] + m[7] * x[1] + m[8] * x[2],
  ];
}

/** Inverse of a Lorentz matrix: eta M^T eta (no division, exact up to rounding). */
export function inverse(m: Mat3): Mat3 {
  return [m[0], m[3], -m[6], m[1], m[4], -m[7], -m[2], -m[5], m[8]];
}

export function det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

export function column(m: Mat3, j: number): Vec3 {
  return [m[j], m[3 + j], m[6 + j]];
}

export function fromColumns(c0: Vec3, c1: Vec3, c2: Vec3): Mat3 {
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

/** max |M^T eta M - eta|: how far M is from being a Lorentz matrix. */
export function isometryError(m: Mat3): number {
  const cols = [column(m, 0), column(m, 1), column(m, 2)];
  const eta = [1, 1, -1];
  let e = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) e = Math.max(e, Math.abs(mink(cols[i], cols[j]) - (i === j ? eta[i] : 0)));
  return e;
}

/** Gram-Schmidt in the eta metric (t column first, then x, then y). Called after every camera
 *  update so rounding errors never accumulate. Keeps the orientation. */
export function reorthonormalize(m: Mat3): Mat3 {
  const ct = normalizePoint(column(m, 2));
  let cx = column(m, 0);
  cx = add(cx, scale(ct, mink(cx, ct)));
  cx = normalizeSpacelike(cx);
  let cy = column(m, 1);
  cy = add(cy, scale(ct, mink(cy, ct)));
  cy = sub(cy, scale(cx, mink(cy, cx)));
  cy = normalizeSpacelike(cy);
  return fromColumns(cx, cy, ct);
}

// ----------------------------------------------------------------------------- primitive isometries

/** Rotation by theta about the origin. */
export function rotation(theta: number): Mat3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Translation by d along the x axis. */
export function boostX(d: number): Mat3 {
  const c = Math.cosh(d);
  const s = Math.sinh(d);
  return [c, 0, s, 0, 1, 0, s, 0, c];
}

/** The pure translation (boost, no rotation) taking the origin to p:
 *  T(p) = [[I + p_s p_s^T / (1 + p_t), p_s], [p_s^T, p_t]]. */
export function translationTo(p: Vec3): Mat3 {
  const [x, y, t] = p;
  const k = 1 / (1 + t);
  return [1 + x * x * k, x * y * k, x, x * y * k, 1 + y * y * k, y, x, y, t];
}

/** Reflection in the geodesic with unit spacelike normal n: x -> x - 2 <x, n> n. */
export function reflectPoint(x: Vec3, n: Vec3): Vec3 {
  const d = 2 * mink(x, n);
  return [x[0] - d * n[0], x[1] - d * n[1], x[2] - d * n[2]];
}

/** Matrix of the reflection in the geodesic with unit normal n: I - 2 n n^T eta. */
export function reflection(n: Vec3): Mat3 {
  const e = [n[0], n[1], -n[2]]; // eta n
  const r = identity();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[3 * i + j] -= 2 * n[i] * e[j];
  return r;
}

/** Half-turn about the point p: y -> -y - 2 <p, y> p. */
export function halfTurn(p: Vec3): Mat3 {
  const e = [p[0], p[1], -p[2]];
  const r = [-1, 0, 0, 0, -1, 0, 0, 0, -1];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[3 * i + j] -= 2 * p[i] * e[j];
  return r;
}

/** Midpoint of the geodesic segment between two points. */
export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return normalizePoint(add(a, b));
}

/** The transvection along the geodesic through a and b that takes a to b: H_m H_a, m the midpoint.
 *  Used for panning, so the grabbed point follows the cursor exactly. */
export function transvection(a: Vec3, b: Vec3): Mat3 {
  return mul(halfTurn(midpoint(a, b)), halfTurn(a));
}
