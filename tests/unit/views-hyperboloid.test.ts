// The hyperboloid: each pixel's frame point against a float64 march along its ray (from inside the
// bowl, inside the lower sheet's bowl and outside both), the footprint against finite differences,
// the edge's sign against the hit everywhere and its size against the bisected distance to the
// boundary, the shading, the orbit limits.
import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { mink } from "../../src/math/lorentz.ts";
import {
  CONFORMAL, HB_AMBIENT, HB_HOME, HB_LIGHT, HB_MAX_DISTANCE, HB_MAX_ELEVATION, HB_MIN_DISTANCE, HB_MIN_ELEVATION, HOME, MODELS, VIEW_KEYS, frameJacobian,
  hbOrbit, hyperboloidEdge, hyperboloidFrame, hyperboloidGap, hyperboloidShade, largestStretch, viewUniform, zoomPicture, type HyperboloidPicture,
} from "../../src/math/views.ts";
import vectors from "./data/hyperboloid.json";
import { rng } from "./rng.ts";

const pic = (elevation: number, distance: number, fov: number) => ({ model: "hyperboloid" as const, elevation, distance, fov });
const lq = (a: Vec3, b: Vec3) => a[2] * b[2] - a[0] * b[0] - a[1] * b[1];
/** v less its part along the point x on the sheet (Q(x, x) = 1): what moves the point on the plane.
 *  Coordinates of a point far up the sheet are large and lose digits mostly along x itself, which
 *  only moves it off the surface; so the tests measure errors in this tangent part, by its plane
 *  length. */
const tangent = (v: Vec3, x: Vec3): Vec3 => {
  const k = lq(v, x);
  return [v[0] - k * x[0], v[1] - k * x[1], v[2] - k * x[2]];
};
const planeLength = (v: Vec3) => Math.sqrt(Math.max(0, -lq(v, v)));
type Region = "inside" | "lower" | "outside";
const region = (p: HyperboloidPicture): Region => {
  const { o } = hbOrbit(p);
  return lq(o, o) > 1 ? (o[2] > 0 ? "inside" : "lower") : "outside";
};

/** The pixel's ray (the definition, built here independently): from o along F + f (u_x R + u_y U). */
function ray(p: HyperboloidPicture, u: Complex): { o: Vec3; d: Vec3 } {
  const ce = Math.cos(p.elevation);
  const se = Math.sin(p.elevation);
  const f = Math.tan(p.fov / 2);
  return { o: [0, -p.distance * ce, 1 + p.distance * se], d: [f * u[0], ce + f * u[1] * se, -se + f * u[1] * ce] };
}

/** The first point ahead on the upper sheet, by marching: geometric steps of 0.5% from 1e-4 to 1e9,
 *  a sign change of Q(p, p) - 1 (with t > 0 at both ends) bisected 200 times. Null when no change is
 *  found, which includes rays that only graze (two roots within one step). */
function march(p: HyperboloidPicture, u: Complex): Vec3 | null {
  const { o, d } = ray(p, u);
  const at = (l: number): Vec3 => [o[0] + l * d[0], o[1] + l * d[1], o[2] + l * d[2]];
  const g = (l: number) => {
    const q = at(l);
    return q[2] * q[2] - q[0] * q[0] - q[1] * q[1] - 1;
  };
  let a = 0;
  let ga = g(0);
  for (let l = 1e-4; l < 1e9; l *= 1.005) {
    const gl = g(l);
    if (Math.sign(gl) !== Math.sign(ga) && at(l)[2] > 0 && at(a)[2] > 0) {
      let lo = a;
      let hi = l;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (Math.sign(g(mid)) === Math.sign(ga)) lo = mid;
        else hi = mid;
      }
      return at((lo + hi) / 2);
    }
    a = l;
    ga = gl;
  }
  return null;
}

/** Random orbits over the whole range (the camera at least 0.05 R from the surface, as the controls
 *  keep it) and screen points of a 16:9 screen. */
function* samples(seed: number, n: number): Generator<[ReturnType<typeof pic>, Complex]> {
  const r = rng(seed);
  for (let i = 0; i < n; ) {
    const p = pic(HB_MIN_ELEVATION + (HB_MAX_ELEVATION - HB_MIN_ELEVATION) * r(), HB_MIN_DISTANCE * (HB_MAX_DISTANCE / HB_MIN_DISTANCE) ** r(), ((40 + 60 * r()) * Math.PI) / 180);
    const u: Complex = [(2 * r() - 1) * 1.78, 2 * r() - 1];
    if (Math.abs(hyperboloidGap(p)) < 0.05) continue;
    i++;
    yield [p, u];
  }
}

describe("the hyperboloid", () => {
  it("is view 6, between H3 and the band, not conformal, at home 5 R from the vertex, 55 degrees up, a 50 degree field", () => {
    expect(VIEW_KEYS.hyperboloid).toBe("6");
    expect(MODELS.indexOf("hyperboloid")).toBe(MODELS.indexOf("h3") + 1);
    expect(CONFORMAL.hyperboloid).toBe(false);
    expect(HOME.hyperboloid).toEqual({ model: "hyperboloid", ...HB_HOME });
    expect(HB_HOME.distance).toBe(5);
    expect((HB_HOME.elevation * 180) / Math.PI).toBeCloseTo(55, 12);
    expect((HB_HOME.fov * 180) / Math.PI).toBeCloseTo(50, 12);
    expect(viewUniform(HOME.hyperboloid)).toEqual([5, Math.cos(HB_HOME.elevation), Math.sin(HB_HOME.elevation), Math.tan(HB_HOME.fov / 2)]);
    // home looks at the vertex from inside the bowl
    expect(region(HB_HOME)).toBe("inside");
    const c = hyperboloidFrame(HB_HOME, [0, 0])!;
    for (let j = 0; j < 3; j++) expect(c.x[j]).toBeCloseTo([0, 0, 1][j], 12);
  });

  it("puts each pixel where its ray first meets the upper sheet ahead (against a march along the ray)", () => {
    const counts: Record<Region, number> = { inside: 0, lower: 0, outside: 0 };
    let hits = 0;
    let misses = 0;
    for (const [p, u] of samples(1, 3000)) {
      counts[region(p)]++;
      const want = march(p, u);
      const got = hyperboloidFrame(p, u);
      if (!want || !got) {
        // they may disagree only next to the edge, where the march steps over a graze
        if (want || got) expect(Math.abs(hyperboloidEdge(p, u))).toBeLessThan(1e-3);
        else misses++;
        continue;
      }
      hits++;
      // the frame point is the hit, normalised onto the hyperboloid, within the t^2 rule of the
      // other non-conformal views (the march itself loses digits as t^2 near the cone)
      const t2 = got.x[2] * got.x[2];
      expect(Math.abs(mink(got.x, got.x) + 1)).toBeLessThan(1e-13 * t2);
      expect(planeLength(tangent([want[0] - got.x[0], want[1] - got.x[1], want[2] - got.x[2]], got.x))).toBeLessThan(1e-12 * t2);
    }
    expect(counts.inside).toBeGreaterThan(600);
    expect(counts.lower).toBeGreaterThan(150);
    expect(counts.outside).toBeGreaterThan(600);
    expect(hits).toBeGreaterThan(1000);
    expect(misses).toBeGreaterThan(300);
  });

  it("matches 120-digit values, the footprint too, also next to the silhouette and to infinity", () => {
    let n = 0;
    let near = 0;
    for (const v of vectors.frame) {
      const p = pic(v.elevation, v.distance, v.fov);
      const got = hyperboloidFrame(p, v.u as Complex);
      if (v.x === null) {
        expect(got).toBeNull();
        continue;
      }
      expect(got).not.toBeNull();
      const x = v.x.map(Number) as Vec3;
      const scale = Number(v.scale);
      // the position to the float64 grain of its coordinates (t^2) or of u (scale), whichever is
      // coarser; the footprint near the silhouette to eps / (distance to it): it divides by
      // Q(p, d) = -sqrt(B^2 - AC), whose cancellation the 1e-8 points expose
      const t2 = x[2] * x[2];
      expect(planeLength(tangent([got!.x[0] - x[0], got!.x[1] - x[1], got!.x[2] - x[2]], x))).toBeLessThan(1e-13 * (t2 + scale));
      expect(Math.abs(got!.scale / scale - 1)).toBeLessThan(1e-12 * t2 + 1e-14 / Math.abs(hyperboloidEdge(p, v.u as Complex)));
      n++;
      if ("near" in v) near++;
    }
    expect(n).toBeGreaterThan(80);
    expect(near).toBeGreaterThan(30);
  });

  it("gives the plane length per unit of u as the Jacobian's largest stretch, against finite differences", () => {
    let n = 0;
    for (const [p, u] of samples(2, 4000)) {
      const f = hyperboloidFrame(p, u);
      if (!f || Math.abs(hyperboloidEdge(p, u)) < 1e-2) continue;
      const jac = frameJacobian(p, u, f.x)!;
      const h = 1e-6;
      const fd = ([0, 1] as const).map((k) => {
        const a = hyperboloidFrame(p, [u[0] + (k === 0 ? h : 0), u[1] + (k === 1 ? h : 0)]);
        const b = hyperboloidFrame(p, [u[0] - (k === 0 ? h : 0), u[1] - (k === 1 ? h : 0)]);
        return a && b ? ([0, 1, 2].map((j) => (a.x[j] - b.x[j]) / (2 * h)) as Vec3) : null;
      });
      if (!fd[0] || !fd[1]) continue;
      const [d1, d2] = [tangent(fd[0], f.x), tangent(fd[1], f.x)];
      for (const [k, dk] of [d1, d2].entries()) {
        expect(Math.abs(lq(jac[k], f.x))).toBeLessThan(1e-9 * f.scale * f.x[2]);
        expect(planeLength([jac[k][0] - dk[0], jac[k][1] - dk[1], jac[k][2] - dk[2]])).toBeLessThan(1e-5 * f.scale);
      }
      expect(f.scale / largestStretch(d1, d2)).toBeCloseTo(1, 5);
      n++;
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("signs its edge distance by the hit, and every change of the hit lies on that edge", () => {
    const r = rng(3);
    let near = 0;
    const step = 3e-3;
    for (const [p, u] of samples(3, 60000)) {
      const e = hyperboloidEdge(p, u);
      const hit = hyperboloidFrame(p, u) !== null;
      expect(e < 0).toBe(hit);
      // a neighbour a step away in a random direction: when the hit changes between them, both lie
      // within about a step of the edge (no boundary is left out)
      const a = 2 * Math.PI * r();
      const v: Complex = [u[0] + step * Math.cos(a), u[1] + step * Math.sin(a)];
      if ((hyperboloidFrame(p, v) !== null) !== hit) {
        near++;
        expect(Math.abs(e)).toBeLessThan(1.2 * step);
        expect(Math.abs(hyperboloidEdge(p, v))).toBeLessThan(1.2 * step);
      }
    }
    expect(near).toBeGreaterThan(40);
  });

  it("draws no edge where nothing changes: next to a small edge distance the hit changes", () => {
    // the accent ring follows |edge| < a pixel or two; a curve that does not bound the picture
    // (the grazes of the lower sheet, the cone's lower half) must not count
    let checked = 0;
    let lost = 0;
    for (const [p, u] of samples(6, 200000)) {
      const e = hyperboloidEdge(p, u);
      if (!(Math.abs(e) < 0.01)) continue;
      checked++;
      const hit = hyperboloidFrame(p, u) !== null;
      let found = false;
      for (let k = 0; k < 64 && !found; k++) {
        const a = (2 * Math.PI * k) / 64;
        found = (hyperboloidFrame(p, [u[0] + 3 * Math.abs(e) * Math.cos(a), u[1] + 3 * Math.abs(e) * Math.sin(a)]) !== null) !== hit;
      }
      if (!found) lost++;
    }
    expect(checked).toBeGreaterThan(1000);
    expect(lost).toBe(0);
  });

  it("measures the distance to the silhouette and to infinity in units of u, against bisection", () => {
    const kinds = { silhouette: 0, infinity: 0 };
    const r = rng(4);
    for (let i = 0; i < 400000 && (kinds.silhouette < 60 || kinds.infinity < 60); i++) {
      const p = pic(HB_MIN_ELEVATION + (HB_MAX_ELEVATION - HB_MIN_ELEVATION) * r(), HB_MIN_DISTANCE * (HB_MAX_DISTANCE / HB_MIN_DISTANCE) ** r(), ((40 + 60 * r()) * Math.PI) / 180);
      if (Math.abs(hyperboloidGap(p)) < 0.05) continue;
      const u: Complex = [(2 * r() - 1) * 1.78, 2 * r() - 1];
      const e = hyperboloidEdge(p, u);
      if (!(Math.abs(e) < 2e-3 && Math.abs(e) > 1e-5)) continue;
      // the edge's gradient direction, by differences, and the hit's change along it
      const h = 1e-7;
      const g: Complex = [(hyperboloidEdge(p, [u[0] + h, u[1]]) - hyperboloidEdge(p, [u[0] - h, u[1]])) / (2 * h), (hyperboloidEdge(p, [u[0], u[1] + h]) - hyperboloidEdge(p, [u[0], u[1] - h])) / (2 * h)];
      const gl = Math.hypot(g[0], g[1]);
      const at = (s: number): Complex => [u[0] - (s * g[0]) / gl, u[1] - (s * g[1]) / gl];
      const hit0 = hyperboloidFrame(p, u) !== null;
      let lo = 0;
      let hi = 3 * e; // the boundary lies about e along -grad
      if ((hyperboloidFrame(p, at(hi)) !== null) === hit0) continue; // a corner of two curves
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if ((hyperboloidFrame(p, at(mid)) !== null) === hit0) lo = mid;
        else hi = mid;
      }
      // which curve it is: the cone (A = Q(d, d) changes sign across it) or the silhouette
      const A = (s: number) => {
        const { d } = ray(p, at(s));
        return lq(d, d);
      };
      kinds[Math.sign(A(lo)) !== Math.sign(A(hi)) ? "infinity" : "silhouette"]++;
      expect(Math.abs(lo / e - 1)).toBeLessThan(0.02);
    }
    expect(kinds.silhouette).toBeGreaterThanOrEqual(60);
    expect(kinds.infinity).toBeGreaterThanOrEqual(60);
  });

  it("shades with a soft Lambert term between the ambient and 1, brightest facing the light", () => {
    for (const [p, u] of samples(5, 5000)) {
      const f = hyperboloidFrame(p, u);
      if (!f) continue;
      const s = hyperboloidShade(p, u, f.x);
      expect(s).toBeGreaterThanOrEqual(HB_AMBIENT);
      expect(s).toBeLessThanOrEqual(1 + 1e-12);
    }
    // the vertex from straight above: the normal (0, 0, 1) faces the camera, the light comes from
    // up-left behind it: n . L = L_back / |L| (L in right, up, back)
    const top = pic(Math.PI / 2, 4, 1);
    const shade = (u: Complex) => hyperboloidShade(top, u, hyperboloidFrame(top, u)!.x);
    expect(HB_LIGHT[0]).toBeLessThan(0);
    expect(shade([0, 0])).toBeCloseTo(HB_AMBIENT + (1 - HB_AMBIENT) * (HB_LIGHT[2] / Math.hypot(...HB_LIGHT)), 12);
    // seen from inside the bowl, the wall on the right faces the light from the left
    expect(shade([0.8, 0])).toBeGreaterThan(shade([0, 0]));
    expect(shade([-0.8, 0])).toBeLessThan(shade([0, 0]));
  });

  it("zooms by the orbit distance, within 1.5 and 40 R", () => {
    const z = zoomPicture(HOME.hyperboloid, [0.3, 0.2], 2);
    expect(z.pic).toEqual({ ...HOME.hyperboloid, distance: 2.5 });
    expect((zoomPicture(HOME.hyperboloid, [0, 0], 100).pic as HyperboloidPicture).distance).toBe(HB_MIN_DISTANCE);
    expect((zoomPicture(HOME.hyperboloid, [0, 0], 0.01).pic as HyperboloidPicture).distance).toBe(HB_MAX_DISTANCE);
  });
});
