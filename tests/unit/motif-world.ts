// Brute force for the motif tests (design-checks/check_motifs.py): random motifs, the kites near a
// point as rotation-group elements, each tile's whole boundary in the world, and whether it winds
// around a point.
import type { Complex } from "../../src/math/complex.ts";
import type { TriangleGroup } from "../../src/math/groups.ts";
import { fold } from "../../src/math/groups.ts";
import type { Mat3, Vec3 } from "../../src/math/lorentz.ts";
import { add, apply, dist, inverse, mul, normalizePoint, reflection, reflectPoint } from "../../src/math/lorentz.ts";
import type { Motif, MotifSpec, Point } from "../../src/math/motifs.ts";
import { compileMotif, fromDisk, MotifError, motifAt, toDisk } from "../../src/math/motifs.ts";
import { I } from "./wythoff-world.ts";

/** Control points along the chord from a to b, pushed across it by amp times its length. */
function across(a: Complex, b: Complex, amps: number[]): Point[] {
  const d: Complex = [b[0] - a[0], b[1] - a[1]];
  return amps.map((amp, i) => {
    const t = (i + 1) / (amps.length + 1);
    return [a[0] + t * d[0] - d[1] * amp, a[1] + t * d[1] + d[0] * amp];
  });
}

/** A random motif for the group (two Bezier segments per curve), or null when it is refused. */
export function randomMotif(g: TriangleGroup, r: () => number, amp: number): Motif | null {
  const R = toDisk(g.corners.R);
  const Q = toDisk(g.corners.Q);
  const amps = () => Array.from({ length: 5 }, () => amp * (2 * r() - 1));
  const spec: MotifSpec = { name: "random", group: [g.p, g.q, g.r], colouring: "parity", pr: across([0, 0], R, amps()), rq: across(R, Q, amps()) };
  try {
    return compileMotif(spec);
  } catch (e) {
    if (e instanceof MotifError) return null;
    throw e;
  }
}

const turn = (w: Complex, t: Complex): Complex => [w[0] * t[0] - w[1] * t[1], w[0] * t[1] + w[1] * t[0]];
const unturn = (w: Complex, t: Complex): Complex => [w[0] * t[0] + w[1] * t[1], w[1] * t[0] - w[0] * t[1]];

function dense(poly: readonly Complex[], k: number): Complex[] {
  const out: Complex[] = [];
  for (let i = 0; i + 1 < poly.length; i++)
    for (let s = 0; s < k; s++) out.push([poly[i][0] + ((poly[i + 1][0] - poly[i][0]) * s) / k, poly[i][1] + ((poly[i + 1][1] - poly[i][1]) * s) / k]);
  out.push(poly[poly.length - 1]);
  return out;
}

/** The identity tile's boundary P R Q R' P as world points, each polyline segment cut into k along
 *  its own frame's straight segment. */
export function boundary(m: Motif, k: number): Vec3[] {
  const d1 = dense(m.c1, k);
  const d2 = dense(m.c2, k);
  const q = (w: Complex) => apply(m.fromQ, fromDisk(w));
  return [
    ...d1.map(fromDisk),
    ...d2.slice(1).map(q),
    ...d2.slice(0, -1).reverse().map((w) => q(unturn(w, m.turnQ))),
    ...d1.slice(0, -1).reverse().map((w) => fromDisk(unturn(w, m.turnP))),
  ];
}

/** rho_P and rho_Q as matrices (s2 s1 and s3 s1). */
export function rotations(g: TriangleGroup): { rhoP: Mat3; rhoQ: Mat3 } {
  const R = g.normals.map(reflection);
  return { rhoP: mul(R[1], R[0]), rhoQ: mul(R[2], R[0]) };
}

/** A point inside the kite (the mean of its corners). */
export const kiteCentre = (g: TriangleGroup): Vec3 => normalizePoint(add(add(g.corners.P, g.corners.Q), add(g.corners.R, reflectPoint(g.corners.R, g.normals[0]))));

/** Rotation-group elements whose kite centre lies within radius of the origin. */
export function kitesNear(g: TriangleGroup, radius: number): Mat3[] {
  const { rhoP, rhoQ } = rotations(g);
  const gens = [rhoP, inverse(rhoP), rhoQ, inverse(rhoQ)];
  const c0 = kiteCentre(g);
  // rounded to whole units of 1e-7 (+ 0 turns -0 into 0, which toFixed would print as "-0.0000000")
  const key = (M: Mat3) => apply(M, c0).map((v) => Math.round(v * 1e7) + 0).join();
  const seen = new Set([key(I)]);
  const out = [I];
  let frontier = [I];
  while (frontier.length) {
    const next: Mat3[] = [];
    for (const M of frontier)
      for (const s of gens) {
        const M2 = mul(M, s);
        const k = key(M2);
        if (seen.has(k) || Math.acosh(apply(M2, c0)[2]) > radius) continue;
        seen.add(k);
        out.push(M2);
        next.push(M2);
      }
    frontier = next;
  }
  return out;
}

/** The winding number of the closed polyline (first = last) around w. */
export function winding(pts: Complex[], w: Complex): number {
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a: Complex = [pts[i][0] - w[0], pts[i][1] - w[1]];
    const b: Complex = [pts[i + 1][0] - w[0], pts[i + 1][1] - w[1]];
    total += Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
  }
  return Math.round(total / (2 * Math.PI));
}

/** The motif's own route: fold, into the kite, the tile; the tile's element as a matrix. */
export function tileOf(m: Motif, x: Vec3): { M: Mat3; word: number[]; hit: ReturnType<typeof motifAt> } {
  const n = m.group.normals;
  const f = fold(x, n);
  const odd = f.word.length % 2 === 1;
  const word = odd ? [...f.word, 0] : [...f.word];
  const hit = motifAt(m, odd ? reflectPoint(f.x, n[0]) : f.x, odd);
  word.push(...hit.letters);
  const R = n.map(reflection);
  return { M: word.reduce((M, j) => mul(M, R[j]), I), word, hit };
}

/** The tiles (among kites) whose boundary winds around x. */
export function tilesAround(m: Motif, kites: Mat3[], loop: Vec3[], x: Vec3, reach: number): Mat3[] {
  const c0 = kiteCentre(m.group);
  const w = toDisk(x);
  return kites.filter((M) => dist(apply(M, c0), x) < reach && winding(loop.map((v) => toDisk(apply(M, v))), w) !== 0);
}

export { turn, unturn };
