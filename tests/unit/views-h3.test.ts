// The plane inside H3: the projective form against the ray from the eye (float64) and against
// 120-digit values, the Jacobian and the footprint against finite differences, the horizon, the
// height limits.
import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { mink } from "../../src/math/lorentz.ts";
import {
  CONFORMAL, H3_HOME, H3_MAX_H, H3_MIN_H, HOME, VIEW_KEYS, centreScale, edgeDistance, frameJacobian, frameOf, h3Frame, horizonAngle, viewUniform,
  tiltWith, zoomPicture, type H3Picture,
} from "../../src/math/views.ts";
import vectors from "./data/h3.json";
import { rng } from "./rng.ts";

const pic = (h: number, pitch: number, fov: number) => ({ model: "h3" as const, h, pitch, fov });

/** The definition: the ray from the eye E = (0, 0, sinh h, cosh h) in R^{3,1} along the pixel's unit
 *  direction meets the plane z = 0 at tanh t = tanh h / (-c); null when it does not. */
function ray(p: H3Picture, u: Complex): Vec3 | null {
  const f = Math.tan(p.fov / 2);
  const w = [f * u[0], Math.cos(p.pitch) + f * u[1] * Math.sin(p.pitch), -Math.sin(p.pitch) + f * u[1] * Math.cos(p.pitch)];
  const L = Math.hypot(...w);
  const [a, b, c] = w.map((v) => v / L);
  if (!(-c > Math.tanh(p.h))) return null;
  const t = Math.atanh(Math.tanh(p.h) / -c);
  return [a * Math.sinh(t), b * Math.sinh(t), Math.cosh(t) * Math.cosh(p.h) + c * Math.sinh(t) * Math.sinh(p.h)];
}

/** Random pictures over the whole range and screen points of a 16:9 screen. */
function* samples(seed: number, n: number): Generator<[ReturnType<typeof pic>, Complex]> {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const h = H3_MIN_H * (H3_MAX_H / H3_MIN_H) ** r();
    yield [pic(h, (Math.PI / 2) * r(), ((40 + 60 * r()) * Math.PI) / 180), [(2 * r() - 1) * 1.78, 2 * r() - 1]];
  }
}

describe("the plane inside H3", () => {
  it("is view 5, not conformal, at home 0.3 R up looking 30 degrees down with a 70 degree field", () => {
    expect(VIEW_KEYS.h3).toBe("5");
    expect(CONFORMAL.h3).toBe(false);
    expect(HOME.h3).toEqual({ model: "h3", ...H3_HOME });
    expect(H3_HOME.h).toBe(0.3);
    expect((H3_HOME.pitch * 180) / Math.PI).toBeCloseTo(30, 12);
    expect((H3_HOME.fov * 180) / Math.PI).toBeCloseTo(70, 12);
  });

  it("puts each pixel where its ray from the eye meets the plane (the projective form against the ray)", () => {
    let hits = 0;
    for (const [p, u] of samples(1, 20000)) {
      const want = ray(p, u);
      const got = h3Frame(p, u);
      // within a millionth of a radian of the horizon the two may disagree on a hit
      if (!want || !got) {
        if (want || got) expect(Math.abs(edgeDistance(p, u))).toBeLessThan(1e-6);
        continue;
      }
      hits++;
      // the ray form loses digits near the horizon (atanh of a number near 1): compare relative to x_t^2
      for (let j = 0; j < 3; j++) expect(Math.abs(got.x[j] - want[j])).toBeLessThan(1e-12 * want[2] * want[2]);
      expect(Math.abs(mink(got.x, got.x) + 1)).toBeLessThan(1e-12 * got.x[2] * got.x[2]);
    }
    expect(hits).toBeGreaterThan(8000);
  });

  it("matches 120-digit values, the footprint too", () => {
    let n = 0;
    for (const v of vectors.frame) {
      const got = h3Frame(pic(v.h, v.pitch, v.fov), v.u as Complex);
      if (v.x === null) {
        expect(got).toBeNull();
        continue;
      }
      const x = v.x.map(Number);
      expect(got).not.toBeNull();
      for (let j = 0; j < 3; j++) expect(Math.abs(got!.x[j] - x[j])).toBeLessThan(1e-14 * x[2] * x[2]);
      expect(Math.abs(got!.scale / Number(v.scale) - 1)).toBeLessThan(1e-12 * x[2] * x[2]);
      n++;
    }
    expect(n).toBeGreaterThan(80);
  });

  it("has the Jacobian of finite differences, and its largest stretch as the footprint", () => {
    const e = 1e-6;
    let n = 0;
    for (const [p, u] of samples(2, 3000)) {
      const f = frameOf(p, u);
      if (!f || edgeDistance(p, u) > -1e-3) continue;
      const [t1, t2] = frameJacobian(p, u, f.x)!;
      const fd = (d: Complex): Vec3 => {
        const a = frameOf(p, [u[0] + d[0], u[1] + d[1]])!.x;
        const b = frameOf(p, [u[0] - d[0], u[1] - d[1]])!.x;
        return [(a[0] - b[0]) / (2 * e), (a[1] - b[1]) / (2 * e), (a[2] - b[2]) / (2 * e)];
      };
      const [d1, d2] = [fd([e, 0]), fd([0, e])];
      for (let j = 0; j < 3; j++) {
        expect(Math.abs(t1[j] - d1[j])).toBeLessThan(1e-5 * f.scale * f.x[2]);
        expect(Math.abs(t2[j] - d2[j])).toBeLessThan(1e-5 * f.scale * f.x[2]);
      }
      // the footprint is the largest plane length per unit of u over all directions
      let most = 0;
      for (let k = 0; k < 360; k++) {
        const a = (k * Math.PI) / 360;
        const t: Vec3 = [Math.cos(a) * t1[0] + Math.sin(a) * t2[0], Math.cos(a) * t1[1] + Math.sin(a) * t2[1], Math.cos(a) * t1[2] + Math.sin(a) * t2[2]];
        most = Math.max(most, Math.sqrt(mink(t, t)));
      }
      expect(most / f.scale).toBeLessThanOrEqual(1 + 1e-9);
      expect(most / f.scale).toBeGreaterThan(1 - 1e-4);
      n++;
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("draws the horizon asin(tanh h) below level, and measures the distance to it in units of u", () => {
    for (const h of [0.01, 0.1, 0.3, 1, 2, 6]) {
      for (const pitch of [0, 0.3, 0.9]) {
        const p = pic(h, pitch, (70 * Math.PI) / 180);
        // on the centre column the horizon is where the ray points asin(tanh h) below level
        const f = Math.tan(p.fov / 2);
        const uy = Math.tan(pitch - horizonAngle(h)) / f;
        expect(Math.abs(edgeDistance(p, [0, uy]))).toBeLessThan(1e-12 * (1 + uy * uy));
        expect(h3Frame(p, [0, uy - 1e-6])).not.toBeNull();
        expect(h3Frame(p, [0, uy + 1e-6])).toBeNull();
        // anywhere near it, stepping by the signed distance along the gradient lands on it
        const r = rng(Math.round(h * 100 + pitch * 10));
        for (let i = 0; i < 50; i++) {
          const u: Complex = [(2 * r() - 1) * 1.7, uy + (r() - 0.5) * 0.02];
          const d = edgeDistance(p, u);
          const g: Complex = [(edgeDistance(p, [u[0] + 1e-7, u[1]]) - edgeDistance(p, [u[0] - 1e-7, u[1]])) / 2e-7, (edgeDistance(p, [u[0], u[1] + 1e-7]) - edgeDistance(p, [u[0], u[1] - 1e-7])) / 2e-7];
          const gl = Math.hypot(...g);
          if (Math.abs(d) > 0.05) continue;
          // (only where the horizon is on the screen: there the distance is what anti-aliasing needs)
          if (Math.abs(uy) < 1) expect(Math.abs(edgeDistance(p, [u[0] - (d * g[0]) / gl, u[1] - (d * g[1]) / gl]))).toBeLessThan(0.02 * Math.abs(d) + 1e-9);
          expect(h3Frame(p, u) === null).toBe(d > 0);
        }
      }
    }
    expect((horizonAngle(0.3) * 180) / Math.PI).toBeCloseTo(16.94, 2);
    expect((horizonAngle(1) * 180) / Math.PI).toBeCloseTo(49.6, 1);
  });

  it("changes the eye height by the zoom factor between 0.01 R and 6 R, over the same foot point, tilting with it", () => {
    const p = HOME.h3;
    const z = zoomPicture(p, [0.4, -0.2], 2);
    expect(z.pic).toEqual({ ...p, h: 0.15, pitch: tiltWith(p.pitch, 0.3, 0.15) });
    expect(z.N).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(zoomPicture({ ...p, h: 0.012 }, [0, 0], 4).pic).toMatchObject({ h: H3_MIN_H });
    expect(zoomPicture({ ...p, h: 5 }, [0, 0], 0.25).pic).toMatchObject({ h: H3_MAX_H });
    // the uniform the shader reads
    expect(viewUniform(p)).toEqual([Math.sinh(0.3), Math.cos(p.pitch), Math.sin(p.pitch), Math.tan(p.fov / 2)]);
    // the screen centre's footprint at home: about 1.2 R per unit of u
    expect(centreScale(p)).toBeGreaterThan(0.5);
    expect(centreScale({ ...p, pitch: 0 })).toBe(Infinity);
  });
});
