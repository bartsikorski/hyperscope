// Triangle groups (p, q, r): the reflection groups of hyperbolic triangles with angles pi/p, pi/q, pi/r.
// The regular tiling {p, q} is (p, q, 2).
//
// Mirrors (unit spacelike normals, the triangle is { x : <x, n_i> <= 0 }):
//   n1 = (0, -1, 0)                          side 1: the x axis
//   n2 = (-sin(pi/p), cos(pi/p), 0)          side 2: the line through the origin at angle pi/p
//   n3 = (a, b, sqrt(a^2 + b^2 - 1))         side 3: opposite the origin
//   b = cos(pi/q),  a = (b cos(pi/p) + cos(pi/r)) / sin(pi/p)
// so that <n_i, n_j> = -cos(pi / m_ij) with m12 = p, m13 = q, m23 = r.
// Vertex P (angle pi/p) is the origin: for {p, q} the polygon centre. Q (angle pi/q) lies on the
// positive x axis: a tiling vertex. R (angle pi/r) lies on side 2: for {p, q} an edge midpoint.
// Checked numerically for seven groups before this was written (design-checks/check_math.py).
// Origin: per-pixel folding into a Schwarz triangle as on Shadertoy (Matt Zucker, Roice Nelson);
// re-centering by a symmetry as in HyperRogue. See CREDITS.md.

import type { Mat3, Vec3 } from "./lorentz.ts";
import { ORIGIN, apply, mink, mul, normalizePoint, reflection, reflectPoint } from "./lorentz.ts";

export interface TriangleGroup {
  p: number;
  q: number;
  r: number;
  normals: [Vec3, Vec3, Vec3];
  /** Corners: P at the origin (angle pi/p), Q on the x axis (pi/q), R on side 2 (pi/r). */
  corners: { P: Vec3; Q: Vec3; R: Vec3 };
  incenter: Vec3;
  inradius: number;
}

/** 1/p + 1/q + 1/r < 1, in whole numbers: in floats 1/2 + 1/3 + 1/6 comes out just below 1. */
export function isHyperbolic(p: number, q: number, r: number): boolean {
  return p >= 2 && q >= 2 && r >= 2 && q * r + p * r + p * q < p * q * r;
}

export function triangleGroup(p: number, q: number, r: number): TriangleGroup {
  if (![p, q, r].every(Number.isInteger) || !isHyperbolic(p, q, r))
    throw new Error(`(${p}, ${q}, ${r}) is not a hyperbolic triangle group: 1/p + 1/q + 1/r must be below 1`);
  const t = Math.PI / p;
  const b = Math.cos(Math.PI / q);
  const a = (b * Math.cos(t) + Math.cos(Math.PI / r)) / Math.sin(t);
  const normals: [Vec3, Vec3, Vec3] = [
    [0, -1, 0],
    [-Math.sin(t), Math.cos(t), 0],
    [a, b, Math.sqrt(a * a + b * b - 1)],
  ];
  const corner = (i: number, j: number) => normalizePoint(lorentzCross(normals[i], normals[j]));
  const corners = { P: corner(0, 1), Q: corner(0, 2), R: corner(1, 2) };
  const incenter = solveIncenter(normals);
  const inradius = Math.asinh(-mink(incenter, normals[0]));
  return { p, q, r, normals, corners, incenter, inradius };
}

/** The timelike or spacelike vector Minkowski-orthogonal to a and b: eta (a x b). */
export function lorentzCross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], -(a[0] * b[1] - a[1] * b[0])];
}

/** The point at equal distance from the three sides: <x, n_i> = -1 for all i, then normalized. */
function solveIncenter(n: [Vec3, Vec3, Vec3]): Vec3 {
  // rows of A are n_i^T eta, so A x = (<n_i, x>)_i
  const A = n.map((v) => [v[0], v[1], -v[2]]);
  const x = solve3(A, [-1, -1, -1]);
  return normalizePoint(x);
}

function solve3(A: number[][], rhs: number[]): Vec3 {
  const d = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = d(A);
  const col = (j: number) => d(A.map((row, i) => row.map((v, k) => (k === j ? rhs[i] : v))));
  return [col(0) / D, col(1) / D, col(2) / D];
}

// ----------------------------------------------------------------------------- folding

export const MAX_SWEEPS = 64;

export interface FoldResult {
  /** The folded point, inside the fundamental triangle. */
  x: Vec3;
  /** Mirror indices (0, 1, 2) in the order they were applied. */
  word: number[];
  /** True when the sweep cap was hit before the point settled (treated as far away). */
  capped: boolean;
  /** Passes over the three mirrors, the last of which moved nothing (the shader's loop count). */
  sweeps: number;
}

/** Reflect x across whichever sides it lies beyond until it is inside the triangle. This is the
 *  reference for the shader's fold loop: same order (sweeps over sides 1, 2, 3), same cap. */
export function fold(x: Vec3, normals: readonly Vec3[], maxSweeps = MAX_SWEEPS): FoldResult {
  const word: number[] = [];
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let moved = false;
    for (let j = 0; j < 3; j++) {
      if (mink(x, normals[j]) > 0) {
        x = reflectPoint(x, normals[j]);
        word.push(j);
        moved = true;
      }
    }
    if (!moved) return { x, word, capped: false, sweeps: sweep + 1 };
  }
  return { x, word, capped: true, sweeps: maxSweeps };
}

/** Re-centering: the symmetry g that brings the camera's screen-centre point back into the triangle,
 *  using only rotation-type symmetries (an even number of reflections), so chiral motifs never flip.
 *  Returns g and the mirror word it was built from (the colouring state continues along it). */
export function recenter(camera: Mat3, group: TriangleGroup): { g: Mat3; word: number[] } {
  const { word } = fold(apply(camera, ORIGIN), group.normals);
  if (word.length % 2 === 1) word.push(0);
  let g: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const j of word) g = mul(reflection(group.normals[j]), g);
  return { g, word };
}

/** Hyperbolic distance from a folded point (inside the triangle) to side j. */
export function distanceToSide(x: Vec3, n: Vec3): number {
  return Math.asinh(Math.max(0, -mink(x, n)));
}
