// Brute force for the Wythoff tests: a tiling's edges and faces near the origin from its definition
// alone (group elements walked from the origin), the face holding a point, the distance to the
// edges, and the fold into a tiling's domain.
import type { TriangleGroup } from "../../src/math/groups.ts";
import { fold } from "../../src/math/groups.ts";
import type { Mat3, Vec3 } from "../../src/math/lorentz.ts";
import { apply, dist, mink, mul, normalizePoint, reflection, reflectPoint } from "../../src/math/lorentz.ts";
import type { Wythoff } from "../../src/math/wythoff.ts";

export const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const klein = (x: Vec3): [number, number] => [x[0] / x[2], x[1] / x[2]];
export const close = (a: Vec3, b: Vec3, tol = 1e-6) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) < tol;

/** Points numbered so that two within 1e-6 of each other get one number (a grid of Klein cells), so
 *  rounding never splits a point in two. */
export class Points {
  private cells = new Map<string, number[]>();
  readonly pts: Vec3[] = [];
  id(x: Vec3): number {
    const [a, b] = klein(x).map((v) => Math.floor(v / 1e-4));
    for (let i = a - 1; i <= a + 1; i++) for (let j = b - 1; j <= b + 1; j++) for (const n of this.cells.get(`${i},${j}`) ?? []) if (dist(this.pts[n], x) < 1e-6) return n;
    this.pts.push(x);
    this.cells.set(`${a},${b}`, [...(this.cells.get(`${a},${b}`) ?? []), this.pts.length - 1]);
    return this.pts.length - 1;
  }
}

/** Group elements whose image of the incentre lies within rmax, with their words (M = R[w0] R[w1] ...). */
export function elements(g: TriangleGroup, rmax: number): { M: Mat3; word: number[] }[] {
  const R = g.normals.map(reflection);
  const pts = new Points();
  const key = (M: Mat3) => pts.id(apply(M, g.incenter));
  const seen = new Map([[key(I), { M: I, word: [] as number[] }]]);
  let frontier = [...seen.values()];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const { M, word } of frontier)
      for (let j = 0; j < 3; j++) {
        const M2 = mul(M, R[j]);
        const k = key(M2);
        if (seen.has(k) || apply(M2, g.incenter)[2] > Math.cosh(rmax)) continue;
        const e = { M: M2, word: [...word, j] };
        seen.set(k, e);
        next.push(e);
      }
    frontier = next;
  }
  return [...seen.values()];
}

export interface World {
  edges: [Vec3, Vec3][];
  faces: { centre: Vec3; kind: number; word: number[] }[];
}

/** The tiling's edges and face centres near the origin, from its definition alone. */
export function world(g: TriangleGroup, t: Wythoff, rmax = 3.8): World {
  const R = g.normals.map(reflection);
  const C = [g.corners.P, g.corners.Q, g.corners.R];
  const m = [g.p, g.q, g.r];
  const els = elements(g, rmax);
  const edges = new Map<string, [Vec3, Vec3]>();
  const faces = new Map<string, World["faces"][number]>();
  const pts = new Points();
  const centres = new Points();
  const ek = (a: Vec3, b: Vec3) => [pts.id(a), pts.id(b)].sort((x, y) => x - y).join("|");
  const fk = (c: Vec3) => String(centres.id(c));
  const G = t.G;
  const mirrors = [[0, 1], [0, 2], [1, 2]];
  for (const { M, word } of els) {
    const odd = word.length % 2 === 1;
    if (t.kite) {
      if (!odd) {
        for (const [a, b] of mirrors) {
          const A = apply(M, G);
          const B = apply(M, apply(mul(R[a], R[b]), G));
          edges.set(ek(A, B), [A, B]);
        }
        for (let X = 0; X < 3; X++) if (m[X] >= 3) faces.set(fk(apply(M, C[X])), { centre: apply(M, C[X]), kind: X, word });
      } else {
        const v = [0, 1, 2].map((i) => apply(M, apply(R[i], G)));
        const c = normalizePoint([v[0][0] + v[1][0] + v[2][0], v[0][1] + v[1][1] + v[2][1], v[0][2] + v[1][2] + v[2][2]]);
        faces.set(fk(c), { centre: c, kind: 3, word });
      }
    } else {
      for (let a = 0; a < 3; a++)
        if (t.weights[a] > 0) {
          const A = apply(M, G);
          const B = apply(M, apply(R[a], G));
          edges.set(ek(A, B), [A, B]);
        }
      for (let X = 0; X < 3; X++) if (t.colourOf[X] >= 0) faces.set(fk(apply(M, C[X])), { centre: apply(M, C[X]), kind: X, word });
    }
  }
  return { edges: [...edges.values()], faces: [...faces.values()] };
}

/** Distance from x to the geodesic segment AB (check_wythoff.py seg_dist). */
export function segDist(x: Vec3, A: Vec3, B: Vec3): number {
  const c: Vec3 = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], -(A[0] * B[1] - A[1] * B[0])];
  const s = Math.sqrt(mink(c, c));
  const n: Vec3 = [c[0] / s, c[1] / s, c[2] / s];
  const ab = mink(A, B);
  const TA: Vec3 = [B[0] + ab * A[0], B[1] + ab * A[1], B[2] + ab * A[2]];
  const TB: Vec3 = [A[0] + ab * B[0], A[1] + ab * B[1], A[2] + ab * B[2]];
  if (mink(x, TA) > 0 && mink(x, TB) > 0) return Math.asinh(Math.abs(mink(x, n)));
  return Math.min(dist(x, A), dist(x, B));
}

export const cross2 = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
export const segCross = (a: number[], b: number[], c: number[], d: number[]) => cross2(a, b, c) * cross2(a, b, d) < 0 && cross2(c, d, a) * cross2(c, d, b) < 0;

/** The face holding x: the centre the segment from x reaches without crossing an edge. */
export function trueFace(x: Vec3, w: World) {
  const kx = klein(x);
  const near = w.edges.filter(([a, b]) => Math.min(dist(x, a), dist(x, b)) < 3).map(([a, b]) => [klein(a), klein(b)]);
  const cands = [...w.faces].sort((a, b) => dist(x, a.centre) - dist(x, b.centre)).slice(0, 12);
  return cands.find((f) => !near.some(([a, b]) => segCross(kx, klein(f.centre), a, b)));
}

/** The domain point and the world element of x: folded into T, and for the kite once more across
 *  side 1 when the word is odd. */
export function toDomain(g: TriangleGroup, t: Wythoff, x: Vec3): { y: Vec3; word: number[]; M: Mat3 } {
  const f = fold(x, g.normals);
  const word = [...f.word];
  let y = f.x;
  if (t.kite && word.length % 2) {
    y = reflectPoint(y, g.normals[0]);
    word.push(0);
  }
  const R = g.normals.map(reflection);
  return { y, word, M: word.reduce((M, j) => mul(M, R[j]), I) };
}

