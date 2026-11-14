// Motifs (math/motifs.ts) against brute force, as design-checks/check_motifs.py does: the turns
// that pair the kite's edges, which random motifs are refused, the tile of every point against the
// winding number of every nearby tile's boundary, the seams, the distance to the curves, the unbent
// motif (the kite tiling itself) and the features.
import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import type { TriangleGroup } from "../../src/math/groups.ts";
import { distanceToSide, fold, triangleGroup } from "../../src/math/groups.ts";
import type { Mat3, Vec3 } from "../../src/math/lorentz.ts";
import { apply, dist, mink, mul, reflection, reflectPoint } from "../../src/math/lorentz.ts";
import type { Motif, MotifSpec, Point } from "../../src/math/motifs.ts";
import { compileMotif, featureAt, featureDistance, fromDisk, MAX_CURVE_POINTS, MotifError, poincareDist, sampleChain, toDisk } from "../../src/math/motifs.ts";
import { rng } from "./rng.ts";
import { boundary, kiteCentre, kitesNear, randomMotif, rotations, tileOf, tilesAround, turn } from "./motif-world.ts";
import { I } from "./wythoff-world.ts";

const GROUPS: [number, number, number][] = [
  [3, 3, 4],
  [6, 4, 2],
  [8, 3, 2],
  [4, 4, 3],
  [7, 3, 2],
  // q = 2: Q is no corner of the kite (its angle there is pi); p = 2: nor is P
  [5, 2, 4],
  [2, 3, 7],
];

const maxDiff = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const scaleOf = (M: Mat3) => Math.max(1, ...M.map(Math.abs));
const sameMatrix = (A: Mat3, B: Mat3, tol = 1e-8) => maxDiff(A, B) < tol * scaleOf(A);
const closeV = (a: Vec3, b: Vec3, tol = 1e-10) => maxDiff(a, b) < tol * Math.max(1, ...a.map(Math.abs));

/** A random point of the disk, up to hyperbolic distance maxDist from the origin. */
function randomDisk(r: () => number, maxDist: number): Complex {
  const rad = Math.tanh((r() * maxDist) / 2);
  const a = 2 * Math.PI * r();
  return [rad * Math.cos(a), rad * Math.sin(a)];
}

/** The motif with no bend: its controls at the thirds of the chords PR and RQ (P frame). */
function flatSpec(group: [number, number, number], extra: Partial<MotifSpec> = {}): MotifSpec {
  const g = triangleGroup(...group);
  const R = toDisk(g.corners.R);
  const Q = toDisk(g.corners.Q);
  const thirds = (a: Complex, b: Complex): Point[] => [1, 2].map((k) => [a[0] + ((b[0] - a[0]) * k) / 3, a[1] + ((b[1] - a[1]) * k) / 3]);
  return { name: "flat", group, colouring: "parity", pr: thirds([0, 0], R), rq: thirds(R, Q), ...extra };
}

/** Up to `want` valid random motifs for the group, and how many were refused on the way. */
function motifsFor(g: TriangleGroup, seed: number, want: number): { motifs: Motif[]; refused: number } {
  const r = rng(seed);
  const motifs: Motif[] = [];
  let refused = 0;
  for (let tries = 0; motifs.length < want && tries < want * 8; tries++) {
    const m = randomMotif(g, r, [0.08, 0.15, 0.3, 0.5][Math.floor(r() * 4)]);
    if (m) motifs.push(m);
    else refused++;
  }
  return { motifs, refused };
}

/** The exact hyperbolic distance from w to the polyline (golden section along each segment: the
 *  balls about w are Euclidean disks, so the distance along a straight segment has one minimum). */
function exactDist(w: Complex, poly: readonly Complex[]): number {
  let best = Infinity;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const f = (t: number) => poincareDist(w, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    let [lo, hi] = [0, 1];
    let x1 = hi - g * (hi - lo);
    let x2 = lo + g * (hi - lo);
    let [f1, f2] = [f(x1), f(x2)];
    for (let k = 0; k < 70; k++) {
      if (f1 < f2) {
        hi = x2;
        x2 = x1;
        f2 = f1;
        x1 = hi - g * (hi - lo);
        f1 = f(x1);
      } else {
        lo = x1;
        x1 = x2;
        f1 = f2;
        x2 = lo + g * (hi - lo);
        f2 = f(x2);
      }
    }
    best = Math.min(best, f(0), f(1), f1, f2);
  }
  return best;
}

/** The exact distance from a point of the motif's own tile to its boundary: the four curves, each
 *  reached through the group's matrices (not the motif's turns). */
function exactDe(m: Motif, y: Vec3): number {
  const { rhoP, rhoQ } = rotations(m.group);
  return Math.min(
    exactDist(toDisk(y), m.c1),
    exactDist(toDisk(apply(rhoP, y)), m.c1),
    exactDist(toDisk(apply(m.toQ, y)), m.c2),
    exactDist(toDisk(apply(m.toQ, apply(rhoQ, y))), m.c2),
  );
}

describe("the kite's edges", () => {
  it("are paired by rho_P, a turn about P in the P frame, and rho_Q, a turn about Q in the Q frame", () => {
    const r = rng(3);
    const groups = [...GROUPS, [3, 7, 2], [5, 5, 5], [2, 4, 5], [12, 3, 2]] as [number, number, number][];
    for (const [p, q, rr] of groups) {
      const g = triangleGroup(p, q, rr);
      const m = compileMotif(flatSpec([p, q, rr]));
      const { rhoP, rhoQ } = rotations(g);
      const Rp = reflectPoint(g.corners.R, g.normals[0]);
      // rho_P R' = R, rho_Q R' = R; P and Q stay put
      expect(closeV(apply(rhoP, Rp), g.corners.R)).toBe(true);
      expect(closeV(apply(rhoQ, Rp), g.corners.R)).toBe(true);
      expect(closeV(apply(rhoP, g.corners.P), g.corners.P)).toBe(true);
      expect(closeV(apply(rhoQ, g.corners.Q), g.corners.Q)).toBe(true);
      // the Q frame puts Q at 0
      expect(closeV(apply(m.fromQ, [0, 0, 1]), g.corners.Q)).toBe(true);
      expect(sameMatrix(mul(m.toQ, m.fromQ), I, 1e-12)).toBe(true);
      for (let k = 0; k < 20; k++) {
        const w = randomDisk(r, 3);
        expect(closeV(apply(rhoP, fromDisk(w)), fromDisk(turn(w, m.turnP)))).toBe(true);
        expect(closeV(apply(rhoQ, apply(m.fromQ, fromDisk(w))), apply(m.fromQ, fromDisk(turn(w, m.turnQ))))).toBe(true);
      }
      // the away directions point from PR (P frame) and QR (Q frame) into T
      const n = g.normals;
      const midPR = toDisk(g.corners.R).map((v) => v / 2) as Complex;
      const inT = (x: Vec3) => n.every((v) => mink(x, v) < 0);
      expect(inT(fromDisk([midPR[0] + 1e-6 * m.awayPR[0], midPR[1] + 1e-6 * m.awayPR[1]]))).toBe(true);
      const rq = toDisk(apply(m.toQ, g.corners.R)).map((v) => v / 2) as Complex;
      expect(inT(apply(m.fromQ, fromDisk([rq[0] + 1e-6 * m.awayQR[0], rq[1] + 1e-6 * m.awayQR[1]])))).toBe(true);
    }
  });
});

describe("random motifs", () => {
  it("are refused when a curve leaves its two triangles or the edges cross, and accepted otherwise", () => {
    let valid = 0;
    let refused = 0;
    for (const [p, q, r] of GROUPS) {
      const out = motifsFor(triangleGroup(p, q, r), p * 1000 + q * 100 + r, 8);
      expect(out.motifs.length).toBeGreaterThanOrEqual(4);
      valid += out.motifs.length;
      refused += out.refused;
      for (const m of out.motifs) {
        expect(m.c1.length).toBeLessThanOrEqual(MAX_CURVE_POINTS);
        expect(m.c2.length).toBeLessThanOrEqual(MAX_CURVE_POINTS);
        expect(m.c1[0]).toEqual([0, 0]);
        expect(m.c2[m.c2.length - 1]).toEqual([0, 0]);
        expect(m.lengths[0]).toBeGreaterThanOrEqual(dist(m.group.corners.P, m.group.corners.R) - 1e-9);
        expect(m.lengths[1]).toBeGreaterThanOrEqual(dist(m.group.corners.R, m.group.corners.Q) - 1e-9);
      }
    }
    expect(valid).toBeGreaterThan(40);
    expect(refused).toBeGreaterThan(5);
  });

  it("put every point in the one tile whose boundary winds around it", () => {
    let points = 0;
    for (const [p, q, r] of GROUPS) {
      const g = triangleGroup(p, q, r);
      const c0 = kiteCentre(g);
      const corners = [g.corners.P, g.corners.Q, g.corners.R, reflectPoint(g.corners.R, g.normals[0])];
      const reach = 2.2 * Math.max(...corners.map((v) => dist(c0, v)));
      const kites = kitesNear(g, 1.8 + reach);
      const { motifs } = motifsFor(g, p * 1000 + q * 100 + r, 6);
      const rr = rng(p * 7 + q * 11 + r * 13);
      for (const m of motifs) {
        const loop = boundary(m, 3);
        for (let k = 0; k < 40; k++) {
          const w = randomDisk(rr, 1.8);
          const x = fromDisk(w);
          const t = tileOf(m, x);
          if (t.hit.de < 1e-6) continue;
          const around = tilesAround(m, kites, loop, x, reach);
          expect(around.length).toBe(1);
          expect(sameMatrix(around[0], t.M)).toBe(true);
          // the point after the letters lies in the motif's own tile, and the tile's element takes it there
          expect(closeV(apply(t.M, t.hit.y), x, 1e-8)).toBe(true);
          points++;
        }
      }
    }
    expect(points).toBeGreaterThan(1000);
  });

  it("meet at seams: either side of a curve lie the two tiles its turn pairs, and across names the other", () => {
    let seams = 0;
    for (const [p, q, r] of GROUPS) {
      const g = triangleGroup(p, q, r);
      const { rhoP, rhoQ } = rotations(g);
      const ball = kitesNear(g, 1.5);
      const { motifs } = motifsFor(g, p * 1000 + q * 100 + r, 4);
      const rr = rng(p * 5 + q * 3 + r);
      const S = g.normals.map(reflection);
      for (const m of motifs) {
        for (const [curve, frame, pair] of [
          [m.c1, "P", rhoP],
          [m.c2, "Q", rhoQ],
        ] as const) {
          for (let k = 0; k < 6; k++) {
            const i = Math.floor(rr() * (curve.length - 1));
            const t = 0.1 + 0.8 * rr();
            const a = curve[i];
            const b = curve[i + 1];
            const z: Complex = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const nrm: Complex = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
            const G = ball[Math.floor(rr() * ball.length)];
            const sides = [1, -1].map((sgn) => {
              const v = fromDisk([z[0] + sgn * 1e-7 * nrm[0], z[1] + sgn * 1e-7 * nrm[1]]);
              return tileOf(m, apply(G, frame === "P" ? v : apply(m.fromQ, v)));
            });
            const [A, B] = sides;
            expect(sameMatrix(A.M, B.M, 1e-6)).toBe(false);
            expect(sameMatrix(mul(A.M, pair), B.M, 1e-7) || sameMatrix(mul(B.M, pair), A.M, 1e-7)).toBe(true);
            for (const [s, other] of [
              [A, B],
              [B, A],
            ] as const) {
              expect(s.hit.de).toBeLessThan(1e-5);
              const across = s.hit.across.reduce((M, j) => mul(M, S[j]), s.M);
              expect(sameMatrix(across, other.M, 1e-7)).toBe(true);
            }
            seams++;
          }
        }
      }
    }
    expect(seams).toBeGreaterThan(200);
  });

  it("give de within the measured error of the hyperbolic distance to the curves", () => {
    // relative error by distance, a few times what design-checks/check_motifs.py measured
    const bands: [number, number][] = [
      [1e-3, 1e-7],
      [1e-2, 1e-5],
      [1e-1, 1e-3],
      [Infinity, 5e-3],
    ];
    const worst = [0, 0, 0, 0];
    for (const [p, q, r] of GROUPS) {
      const g = triangleGroup(p, q, r);
      const { motifs } = motifsFor(g, p * 1000 + q * 100 + r, 4);
      const rr = rng(p * 17 + q * 19 + r * 23);
      for (const m of motifs) {
        for (let k = 0; k < 12; k++) {
          // near c1 or c2, at distances from 1e-7 to 0.1, or anywhere in the kite
          let x: Vec3;
          if (k < 8) {
            const onC1 = k % 2 === 0;
            const curve = onC1 ? m.c1 : m.c2;
            const i = Math.floor(rr() * (curve.length - 1));
            const a = curve[i];
            const b = curve[i + 1];
            const t = rr();
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const off = (rr() < 0.5 ? 1 : -1) * 10 ** (-7 + 6 * rr());
            const v = fromDisk([a[0] + t * (b[0] - a[0]) - (off * (b[1] - a[1])) / len, a[1] + t * (b[1] - a[1]) + (off * (b[0] - a[0])) / len]);
            x = onC1 ? v : apply(m.fromQ, v);
          } else x = fromDisk(randomDisk(rr, 1.5));
          const t = tileOf(m, x);
          const exact = exactDe(m, t.hit.y);
          const band = bands.findIndex(([top]) => exact < top);
          const err = Math.abs(t.hit.de - exact) / exact;
          worst[band] = Math.max(worst[band], err);
          expect(err).toBeLessThan(bands[band][1]);
        }
      }
    }
    // the bands were reached
    expect(worst.filter((v) => v > 0).length).toBeGreaterThanOrEqual(3);
  });

  it("follow the camera: moving by a rotation of the group moves each tile with it", () => {
    for (const [p, q, r] of GROUPS) {
      const g = triangleGroup(p, q, r);
      const { rhoP, rhoQ } = rotations(g);
      const { motifs } = motifsFor(g, p * 1000 + q * 100 + r, 2);
      const rr = rng(p + q + r);
      for (const m of motifs)
        for (let k = 0; k < 20; k++) {
          let G = I;
          for (let s = 0; s < 6; s++) G = mul(G, [rhoP, rhoQ][Math.floor(rr() * 2)]);
          const x = fromDisk(randomDisk(rr, 1.5));
          const a = tileOf(m, x);
          if (a.hit.de < 1e-6) continue;
          const b = tileOf(m, apply(G, x));
          expect(sameMatrix(b.M, mul(G, a.M), 1e-7)).toBe(true);
        }
    }
  });
});

describe("the unbent motif", () => {
  it("is the kite tiling: no point moves to a neighbour, and de is the distance to the kite's sides", () => {
    for (const [p, q, r] of GROUPS) {
      const g = triangleGroup(p, q, r);
      const base = compileMotif(flatSpec([p, q, r]));
      // straight curves in their own frames are the geodesics PR and RQ
      const line = (a: Complex, b: Complex): Complex[] => Array.from({ length: 24 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 23, a[1] + ((b[1] - a[1]) * i) / 23]);
      const Rq = toDisk(apply(base.toQ, g.corners.R));
      const R = toDisk(g.corners.R);
      const m: Motif = { ...base, c1: line([0, 0], R), c2: line(Rq, [0, 0]), bound1: [R[0] / 2, R[1] / 2, Math.hypot(...R) / 2 + 1e-9], bound2: [Rq[0] / 2, Rq[1] / 2, Math.hypot(...Rq) / 2 + 1e-9] };
      const rr = rng(p * 3 + q * 5 + r * 7);
      for (let k = 0; k < 400; k++) {
        const x = fromDisk(randomDisk(rr, 2.5));
        const f = fold(x, g.normals);
        const t = tileOf(m, x);
        expect(t.hit.letters).toEqual([]);
        const exact = Math.min(distanceToSide(f.x, g.normals[1]), distanceToSide(f.x, g.normals[2]));
        expect(Math.abs(t.hit.de - exact)).toBeLessThan(5e-3 * exact + 1e-12);
      }
    }
  });
});

describe("refused motifs", () => {
  const g = triangleGroup(7, 3, 2);
  const R = toDisk(g.corners.R);
  const Q = toDisk(g.corners.Q);
  const ok = flatSpec([7, 3, 2], { name: "test" });
  const refuse = (spec: unknown, why: RegExp) => {
    expect(() => compileMotif(spec)).toThrowError(MotifError);
    expect(() => compileMotif(spec)).toThrowError(why);
  };

  it("say why", () => {
    expect(compileMotif(ok).spec.name).toBe("test");
    refuse(null, /JSON object/);
    refuse({ ...ok, format: "svg" }, /format/);
    refuse({ ...ok, version: 2 }, /newer/);
    refuse({ ...ok, name: "" }, /name/);
    refuse({ ...ok, name: "x".repeat(61) }, /name/);
    refuse({ ...ok, group: [7, 3] }, /group/);
    refuse({ ...ok, group: [7, 3, 1] }, /group/);
    refuse({ ...ok, group: [3, 3, 3] }, /not a hyperbolic/);
    refuse({ ...ok, colouring: 4 }, /colouring/);
    refuse({ ...ok, cell: "Q" }, /cell/);
    refuse({ ...ok, pr: [[0.1, 0.02]] }, /3n - 1/);
    refuse({ ...ok, pr: [[0.1, "a"], [0.2, 0.05]] }, /list of \[x, y\]/);
    refuse({ ...ok, rq: [[0.99, 0], [0.5, 0.2]] }, /outside the disk/);
    // a curve of n segments along its chord: 47 fit among its 48 samples, 48 do not
    const along = (a: Complex, b: Complex, n: number): Point[] => Array.from({ length: 3 * n - 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * (k + 1)) / (3 * n), a[1] + ((b[1] - a[1]) * (k + 1)) / (3 * n)]);
    expect(compileMotif({ ...ok, pr: along([0, 0], R, MAX_CURVE_POINTS - 1), rq: along(R, Q, MAX_CURVE_POINTS - 1) }).c1).toHaveLength(MAX_CURVE_POINTS);
    refuse({ ...ok, pr: along([0, 0], R, MAX_CURVE_POINTS) }, /too many segments/);
    refuse({ ...ok, rq: along(R, Q, MAX_CURVE_POINTS) }, /too many segments/);
    // a curve that leaves its two triangles: PR bent across QR
    refuse({ ...ok, pr: [[R[0] * 0.5 + 0.3, R[1] * 0.5], [R[0], R[1] * 0.2]] }, /from P to R leaves/);
    // RQ bent across PQ (below the x axis)
    refuse({ ...ok, rq: [[R[0], -0.05], [Q[0], -0.05]] }, /from R to Q leaves/);
    // PR bent toward Q and RQ toward P: both stay in T, but they cross
    const towardQ: Point[] = [[Q[0] * 0.7, 0.01], [Q[0] * 0.7, R[1] * 0.5]];
    const towardP: Point[] = [[R[0] * 0.3, R[1] * 0.3], [Q[0] * 0.3, 0.01]];
    expect(() => compileMotif({ ...ok, pr: towardQ })).not.toThrow();
    expect(() => compileMotif({ ...ok, rq: towardP })).not.toThrow();
    refuse({ ...ok, pr: towardQ, rq: towardP }, /cross/);
    refuse({ ...ok, features: {} }, /features must be a list/);
    refuse({ ...ok, features: [{ kind: "star", colour: "line" }] }, /kind/);
    refuse({ ...ok, features: [{ kind: "circle", colour: "red", centre: [0, 0], radius: 0.1 }] }, /colour/);
    refuse({ ...ok, features: [{ kind: "circle", colour: "line", tone: 2, centre: [0, 0], radius: 0.1 }] }, /tone/);
    refuse({ ...ok, features: [{ kind: "circle", colour: "line", centre: [0, 0], radius: 0 }] }, /radius/);
    refuse({ ...ok, features: [{ kind: "ellipse", colour: "line", centre: [0, 0], radii: [0.1, -1] }] }, /radii/);
    refuse({ ...ok, features: [{ kind: "ellipse", colour: "line", centre: [0, 0], radii: [0.1, 0.1], angle: "up" }] }, /angle/);
    refuse({ ...ok, features: [{ kind: "stroke", colour: "line", path: [[0, 0], [0.1, 0]], width: 0.01 }] }, /3n \+ 1/);
    refuse({ ...ok, features: [{ kind: "stroke", colour: "line", path: [[0, 0], [0.03, 0], [0.06, 0], [0.1, 0]], width: 0 }] }, /width/);
    const many = Array.from({ length: 25 }, () => ({ kind: "circle", colour: "white", centre: [0.1, 0.05], radius: 0.01 }));
    refuse({ ...ok, features: many }, /at most 24 features/);
    // a ring's path of 16 curved segments samples 2 points each: 32 points, then 5 rings is 160
    const ring = (c: Point, r: number): Point[] => {
      const out: Point[] = [];
      for (let s = 0; s <= 48; s++) {
        const a = (2 * Math.PI * s) / 48;
        out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
      }
      return out;
    };
    const shapes = Array.from({ length: 5 }, () => ({ kind: "shape", colour: "black", path: ring([0.1, 0.05], 0.02) }));
    refuse({ ...ok, features: shapes }, /at most 128 fit/);
  });
});

describe("features", () => {
  const square: Point[] = [];
  const corners: Point[] = [
    [0.1, 0.0],
    [0.2, 0.0],
    [0.2, 0.1],
    [0.1, 0.1],
    [0.1, 0.0],
  ];
  square.push(corners[0]);
  for (let i = 0; i < 4; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    square.push([a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3], b);
  }
  const m = compileMotif(
    flatSpec([7, 3, 2], {
      name: "features",
      features: [
      { kind: "shape", colour: "black", path: square },
      { kind: "circle", colour: "white", tone: 0.5, centre: [0.15, 0.05], radius: 0.02 },
      { kind: "ellipse", colour: "line", centre: [0.3, 0.1], radii: [0.06, 0.02], angle: 90 },
        { kind: "stroke", colour: "tile", tone: -0.5, path: [[0.0, 0.2], [0.1, 0.2], [0.2, 0.2], [0.3, 0.2]], width: [0.02, 0.0] },
      ],
    }),
  );
  const [shape, circle, ellipse, stroke] = m.features;

  it("keep their kind, colour and tone", () => {
    expect(m.features.map((f) => [f.kind, f.slot, f.tone])).toEqual([
      [3, 2, 0],
      [0, 3, 0.5],
      [1, 1, 0],
      [2, 0, -0.5],
    ]);
  });

  it("measure their distance, negative inside", () => {
    expect(featureDistance(circle, [0.15, 0.05])).toBeCloseTo(-0.02, 12);
    expect(featureDistance(circle, [0.2, 0.05])).toBeCloseTo(0.03, 12);
    // the ellipse turned a quarter: long axis along y
    expect(featureDistance(ellipse, [0.3, 0.1 + 0.06])).toBeCloseTo(0, 9);
    expect(featureDistance(ellipse, [0.3 + 0.02, 0.1])).toBeCloseTo(0, 9);
    expect(featureDistance(ellipse, [0.3 + 0.03, 0.1])).toBeGreaterThan(0);
    expect(featureDistance(ellipse, [0.3, 0.1 + 0.05])).toBeLessThan(0);
    expect(featureDistance(ellipse, [0.3, 0.1])).toBeLessThan(0);
    // the stroke tapers from 0.02 wide to nothing
    expect(featureDistance(stroke, [0.0, 0.2 + 0.0099])).toBeLessThan(0);
    expect(featureDistance(stroke, [0.15, 0.2 + 0.004])).toBeLessThan(0);
    expect(featureDistance(stroke, [0.15, 0.2 + 0.0051])).toBeGreaterThan(0);
    expect(featureDistance(stroke, [0.3, 0.2 + 1e-4])).toBeGreaterThan(0);
    // the square, from straight Bezier segments: its four corners alone (closed)
    expect(shape.points.map((v) => v.slice(0, 2))).toEqual(corners.slice(0, 4));
    // the stroke along a straight path: its two ends
    expect(stroke.points.length).toBe(2);
    expect(featureDistance(shape, [0.15, 0.03])).toBeCloseTo(-0.03, 12);
    expect(featureDistance(shape, [0.25, 0.05])).toBeCloseTo(0.05, 12);
  });

  it("are found topmost first, within their bounding circles", () => {
    expect(featureAt(m, [0.15, 0.05])).toBe(1);
    expect(featureAt(m, [0.12, 0.08])).toBe(0);
    expect(featureAt(m, [0.3, 0.12])).toBe(2);
    expect(featureAt(m, [0.05, 0.201])).toBe(3);
    expect(featureAt(m, [0.5, 0.0])).toBe(-1);
    const r = rng(9);
    for (let k = 0; k < 2000; k++) {
      const w: Complex = [r() * 0.4, r() * 0.25];
      for (const f of m.features) if (featureDistance(f, w) < 0) expect(Math.hypot(w[0] - f.bound[0], w[1] - f.bound[1])).toBeLessThanOrEqual(f.bound[2]);
    }
  });
});

describe("sampling", () => {
  it("keeps a chain's ends and joints exact and its points within the limit", () => {
    const chain: Point[] = [
      [0, 0],
      [0.1, 0.2],
      [0.2, 0.2],
      [0.3, 0],
      [0.35, -0.1],
      [0.4, -0.1],
      [0.5, 0],
    ];
    for (const max of [3, 4, 16, 33, 48]) {
      const s = sampleChain(chain, max);
      expect(s.length).toBeLessThanOrEqual(max);
      expect(s[0]).toEqual([0, 0]);
      expect(s[s.length - 1]).toEqual([0.5, 0]);
      expect(s[(s.length - 1) / 2]).toEqual([0.3, 0]);
    }
  });
});

describe("the boundary loop", () => {
  it("closes at P and passes R, Q and R'", () => {
    const g = triangleGroup(7, 3, 2);
    const m = randomMotif(g, rng(1), 0.1);
    expect(m).not.toBeNull();
    const loop = boundary(m!, 2);
    expect(closeV(loop[0], loop[loop.length - 1])).toBe(true);
    const near = (v: Vec3) => Math.min(...loop.map((u) => dist(u, v)));
    for (const v of [g.corners.P, g.corners.R, g.corners.Q, reflectPoint(g.corners.R, g.normals[0])]) expect(near(v)).toBeLessThan(1e-9);
  });
});
