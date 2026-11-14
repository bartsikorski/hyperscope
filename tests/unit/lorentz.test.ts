import { describe, expect, it } from "vitest";
import {
  ORIGIN, apply, boostX, det, dist, halfTurn, identity, inverse, isometryError, midpoint, mink, mul,
  normalizePoint, reflection, reflectPoint, reorthonormalize, rotation, transvection, translationTo,
  type Mat3, type Vec3,
} from "../../src/math/lorentz.ts";
import { randomPoint, rng } from "./rng.ts";

const close = (a: number[], b: number[], tol: number) =>
  a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, Math.abs(b[i])));

describe("primitive isometries", () => {
  const r = rng(1);
  it("are Lorentz matrices", () => {
    for (let k = 0; k < 200; k++) {
      const p = randomPoint(r, 6);
      const a = (r() - 0.5) * 4, phi = r() * 7;
      const n: Vec3 = [Math.cos(phi) * Math.cosh(a), Math.sin(phi) * Math.cosh(a), Math.sinh(a)]; // unit spacelike
      for (const m of [rotation(r() * 7), boostX(r() * 6 - 3), translationTo(p), reflection(n), halfTurn(p)])
        expect(isometryError(m)).toBeLessThan(1e-9 * Math.cosh(6) ** 2);
    }
  });
  it("translationTo(p) takes the origin to p and has no rotation at the origin", () => {
    for (let k = 0; k < 200; k++) {
      const p = randomPoint(r, 6);
      const t = translationTo(p);
      expect(close(apply(t, ORIGIN), p, 1e-12)).toBe(true);
      expect(det(t)).toBeCloseTo(1, 9);
      // a pure boost is symmetric (no rotation part)
      expect(Math.abs(t[1] - t[3])).toBeLessThan(1e-12);
    }
  });
  it("inverse is exact", () => {
    for (let k = 0; k < 200; k++) {
      const m = mul(translationTo(randomPoint(r, 5)), rotation(r() * 7));
      expect(close(mul(m, inverse(m)), identity(), 1e-10)).toBe(true);
    }
  });
  it("reflections fix their mirror and are involutions", () => {
    const n: Vec3 = [0, -1, 0];
    const onMirror: Vec3 = [Math.sinh(1.3), 0, Math.cosh(1.3)];
    expect(close(reflectPoint(onMirror, n), onMirror, 1e-15)).toBe(true);
    const m = reflection(normalizeN([0.3, 0.8, 0.2]));
    expect(close(mul(m, m), identity(), 1e-12)).toBe(true);
    expect(det(m)).toBeCloseTo(-1, 12);
  });
});

function normalizeN(v: Vec3): Vec3 {
  const q = mink(v, v);
  return [v[0] / Math.sqrt(q), v[1] / Math.sqrt(q), v[2] / Math.sqrt(q)];
}

describe("camera updates", () => {
  it("stay Lorentz to 1e-12 over 10^6 random updates when re-orthonormalized", () => {
    const r = rng(2);
    let m: Mat3 = identity();
    let worst = 0;
    for (let k = 0; k < 1_000_000; k++) {
      const step = k % 3 === 0 ? rotation((r() - 0.5) * 0.1) : boostX((r() - 0.5) * 0.05);
      m = reorthonormalize(mul(m, step));
      // keep the camera near the origin, as re-centering does in the app
      if (m[8] > 20) m = reorthonormalize(mul(inverse(translationTo(apply(m, ORIGIN))), m));
      if (k % 1000 === 0) worst = Math.max(worst, isometryError(m));
    }
    expect(worst).toBeLessThan(1e-12);
  });
  it("re-orthonormalization keeps the orientation", () => {
    const m = reorthonormalize(mul(reflection([0, 1, 0]), boostX(0.7)));
    expect(det(m)).toBeCloseTo(-1, 12);
  });
});

describe("distances", () => {
  it("agree with acosh for moderate distances and stay exact for tiny ones", () => {
    const r = rng(3);
    for (let k = 0; k < 500; k++) {
      const a = randomPoint(r, 4);
      const b = randomPoint(r, 4);
      expect(dist(a, b)).toBeCloseTo(Math.acosh(Math.max(1, -mink(a, b))), 6);
    }
    for (const d of [1e-3, 1e-6, 1e-9, 1e-12]) {
      const b = apply(boostX(d), [0, 0, 1]);
      expect(Math.abs(dist(ORIGIN, b) - d) / d).toBeLessThan(1e-9);
    }
  });
});

describe("transvection used for panning", () => {
  it("takes a to b, keeps distances and maps the geodesic through a and b to itself", () => {
    const r = rng(4);
    for (let k = 0; k < 500; k++) {
      const a = randomPoint(r, 3);
      const b = randomPoint(r, 3);
      const t = transvection(a, b);
      expect(close(apply(t, a), b, 1e-10)).toBe(true);
      expect(det(t)).toBeCloseTo(1, 8);
      const q = randomPoint(r, 3);
      expect(dist(apply(t, q), apply(t, a))).toBeCloseTo(dist(q, a), 8);
      // the midpoint moves along the same geodesic: it stays on the line through a and b
      const m = apply(t, midpoint(a, b));
      const normal = lorentzCross(a, b);
      expect(Math.abs(mink(m, normal)) / Math.sqrt(mink(normal, normal))).toBeLessThan(1e-9);
    }
  });
});

function lorentzCross(a: Vec3, b: Vec3): Vec3 {
  // normal of the plane through a and b in the eta metric: eta (a x b)
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [c[0], c[1], -c[2]];
}

describe("normalizePoint", () => {
  it("projects a timelike vector onto the upper sheet", () => {
    const p = normalizePoint([0.3, -0.2, 2]);
    expect(mink(p, p)).toBeCloseTo(-1, 14);
    expect(p[2]).toBeGreaterThan(0);
  });
});
