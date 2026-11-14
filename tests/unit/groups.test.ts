import { describe, expect, it } from "vitest";
import { MAX_SWEEPS, fold, isHyperbolic, recenter, triangleGroup } from "../../src/math/groups.ts";
import { ORIGIN, apply, det, dist, mink, mul, rotation, translationTo } from "../../src/math/lorentz.ts";
import { randomPoint, rng } from "./rng.ts";

const GROUPS: [number, number, number][] = [[7, 3, 2], [4, 6, 2], [8, 3, 2], [5, 4, 2], [3, 3, 4], [4, 4, 3], [2, 3, 7], [6, 4, 2], [3, 7, 2]];

describe("triangle groups", () => {
  it("have the right Gram matrix <n_i, n_j> = -cos(pi / m_ij)", () => {
    for (const [p, q, r] of GROUPS) {
      const { normals: n } = triangleGroup(p, q, r);
      const want = [[1, -Math.cos(Math.PI / p), -Math.cos(Math.PI / q)], [-Math.cos(Math.PI / p), 1, -Math.cos(Math.PI / r)], [-Math.cos(Math.PI / q), -Math.cos(Math.PI / r), 1]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(mink(n[i], n[j])).toBeCloseTo(want[i][j], 12);
    }
  });
  it("put P at the origin, Q on the positive x axis and the incenter inside", () => {
    for (const pqr of GROUPS) {
      const g = triangleGroup(...pqr);
      expect(dist(g.corners.P, ORIGIN)).toBeLessThan(1e-12);
      expect(Math.abs(g.corners.Q[1])).toBeLessThan(1e-12);
      expect(g.corners.Q[0]).toBeGreaterThan(0);
      for (const n of g.normals) expect(mink(g.incenter, n)).toBeLessThan(0);
      for (const n of g.normals) expect(Math.asinh(-mink(g.incenter, n))).toBeCloseTo(g.inradius, 12);
    }
  });
  it("have the requested corner angles", () => {
    for (const [p, q, r] of GROUPS) {
      const { normals: n } = triangleGroup(p, q, r);
      // with outward normals the interior angle between two sides is acos(-<n_i, n_j>)
      expect(Math.acos(-mink(n[0], n[1]))).toBeCloseTo(Math.PI / p, 12);
      expect(Math.acos(-mink(n[0], n[2]))).toBeCloseTo(Math.PI / q, 12);
      expect(Math.acos(-mink(n[1], n[2]))).toBeCloseTo(Math.PI / r, 12);
    }
  });
  it("reject Euclidean, spherical and non-integer triples", () => {
    expect(isHyperbolic(4, 4, 2)).toBe(false);
    expect(isHyperbolic(3, 3, 2)).toBe(false);
    expect(() => triangleGroup(6, 3, 2)).toThrow(/not a hyperbolic/);
    // every order of the Euclidean triples (in floats 1/2 + 1/3 + 1/6 is just below 1)
    for (const [a, b, c] of [[2, 3, 6], [2, 4, 4], [3, 3, 3]])
      for (const t of [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]] as const) expect(isHyperbolic(...t)).toBe(false);
    expect(isHyperbolic(2, 3, 7)).toBe(true);
    expect(() => triangleGroup(7.5, 3, 2)).toThrow();
  });
});

describe("fold", () => {
  it("lands every point up to distance 8 inside the triangle, preserving <x, x> and distances", () => {
    const r = rng(11);
    for (const pqr of GROUPS) {
      const g = triangleGroup(...pqr);
      for (let k = 0; k < 15_000; k++) {
        const x = randomPoint(r, 8);
        const f = fold(x, g.normals);
        expect(f.capped).toBe(false);
        for (const n of g.normals) expect(mink(f.x, n)).toBeLessThanOrEqual(1e-9 * x[2]);
        expect(Math.abs(mink(f.x, f.x) + 1)).toBeLessThan(1e-9 * x[2] * x[2]);
        expect(f.word.length).toBeLessThan(3 * MAX_SWEEPS);
      }
    }
  });
  it("leaves points inside the triangle alone", () => {
    const g = triangleGroup(7, 3, 2);
    const f = fold(g.incenter, g.normals);
    expect(f.word).toEqual([]);
  });
});

describe("re-centering", () => {
  it("uses an even number of reflections and brings the camera within the doubled triangle", () => {
    const r = rng(12);
    for (const pqr of GROUPS) {
      const g = triangleGroup(...pqr);
      for (let k = 0; k < 300; k++) {
        const cam = mul(translationTo(randomPoint(r, 6)), rotation(r() * 7));
        const { g: sym, word } = recenter(cam, g);
        expect(word.length % 2).toBe(0);
        expect(det(sym)).toBeCloseTo(1, 6);
        const c = apply(mul(sym, cam), ORIGIN);
        // inside the triangle, or inside its mirror image across side 1 (y <= 0 side)
        const inside = g.normals.every((n) => mink(c, n) <= 1e-9);
        const mirrored = [g.normals[1], g.normals[2]].every((n) => mink([c[0], -c[1], c[2]], n) <= 1e-9);
        expect(inside || mirrored).toBe(true);
        expect(c[2]).toBeLessThan(Math.cosh(2 * g.inradius + 3));
      }
    }
  });
});
