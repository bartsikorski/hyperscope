// The band view: the Fermi form against tanh(z/2), the relative form against 120-digit values next to
// the edge, the zoom at the cursor, and the edge distance.
import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import { cabs, ctanh } from "../../src/math/complex.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { ORIGIN, apply, dist, identity, isometryError, mink, mul, sub } from "../../src/math/lorentz.ts";
import { fromPoincare, toPoincare } from "../../src/math/models.ts";
import {
  HOME, MAX_ZOOM_STEP_W, MIN_BAND_GAP, bandFrame, centreScale, edgeDistance, viewUniform, zoomBand, type BandPicture,
} from "../../src/math/views.ts";
import vectors from "./data/band.json";
import { rng } from "./rng.ts";

const num = (a: string[]) => a.map(Number);
const relDist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i])) / Math.max(Math.hypot(...b), 1e-300);
const pic = (y0: number, s: number) => ({ model: "band" as const, y0, s });

/** The boost along the y axis that takes the origin to the band point (0, y0), applied to p. */
function lift(y0: number, p: Vec3): Vec3 {
  const ch = 1 / Math.cos(y0);
  const sh = Math.tan(y0);
  return [p[0], ch * p[1] + sh * p[2], ch * p[2] + sh * p[1]];
}

describe("band view", () => {
  it("is tanh(z/2) to the Poincare disk, seen from the screen-centre point", () => {
    const r = rng(71);
    for (let n = 0; n < 1000; n++) {
      const p: BandPicture = { y0: (r() - 0.5) * 2.6, s: 0.05 + r() * 1.5 };
      const u: Complex = [r() * 3.4 - 1.7, r() * 2 - 1];
      const z: Complex = [p.s * u[0], p.y0 + p.s * u[1]];
      const fp = bandFrame(p, u);
      expect(fp === null).toBe(Math.abs(z[1]) >= Math.PI / 2);
      if (!fp) continue;
      const want = fromPoincare(ctanh([z[0] / 2, z[1] / 2]));
      expect(dist(lift(p.y0, fp.x), want)).toBeLessThan(1e-9 * want[2]);
      expect(Math.abs(mink(fp.x, fp.x) + 1)).toBeLessThan(1e-9 * fp.x[2] ** 2);
      expect(Math.abs(fp.scale / (p.s / Math.cos(z[1])) - 1)).toBeLessThan(1e-12);
    }
  });

  it("is conformal and keeps the picture's orientation at the screen centre", () => {
    const r = rng(72);
    for (let n = 0; n < 200; n++) {
      const p: BandPicture = { y0: (r() - 0.5) * 3, s: 0.01 + r() };
      const u: Complex = [r() - 0.5, (r() - 0.5) * 0.4];
      const fp = bandFrame(p, u);
      if (!fp) continue;
      const h = 1e-6 * Math.min(1, fp.x[2] ** -1);
      const j0 = sub(bandFrame(p, [u[0] + h, u[1]])!.x, fp.x).map((v) => v / h) as Vec3;
      const j1 = sub(bandFrame(p, [u[0], u[1] + h])!.x, fp.x).map((v) => v / h) as Vec3;
      const [a, b, c] = [mink(j0, j0), mink(j0, j1), mink(j1, j1)];
      expect(Math.abs(Math.sqrt(a) / fp.scale - 1)).toBeLessThan(1e-4);
      expect(Math.abs(Math.sqrt(c) / fp.scale - 1)).toBeLessThan(1e-4);
      expect(Math.abs(b) / (a + c)).toBeLessThan(1e-4);
    }
    // the centre's u_x runs along +x and u_y along +y, as in the other views
    const p: BandPicture = { y0: 1.3, s: 0.2 };
    const ex = bandFrame(p, [1e-7, 0])!.w;
    const ey = bandFrame(p, [0, 1e-7])!.w;
    expect(ex[0]).toBeGreaterThan(0);
    expect(Math.abs(ex[1] / ex[0])).toBeLessThan(1e-6);
    expect(ey[1]).toBeGreaterThan(0);
    expect(Math.abs(ey[0] / ey[1])).toBeLessThan(1e-6);
  });

  it("matches 120-digit values next to the edge, gap down to 1e-12", () => {
    let worstX = 0;
    let worstScale = 0;
    let worstEdge = 0;
    for (const v of vectors.frame) {
      const p = pic(v.y0, v.s);
      const fp = bandFrame(p, [v.u[0], v.u[1]]);
      expect(fp).not.toBeNull();
      // as a hyperbolic distance, relative to the point's size (float64 resolves positions to that)
      const x = num(v.x) as Vec3;
      worstX = Math.max(worstX, relDist(fp!.x, x));
      worstScale = Math.max(worstScale, Math.abs(fp!.scale / Number(v.scale) - 1));
      const e = Number(v.edge);
      worstEdge = Math.max(worstEdge, Math.abs(edgeDistance(p, [v.u[0], v.u[1]]) - e) / Math.max(1, Math.abs(e)));
    }
    expect(vectors.frame.length).toBeGreaterThan(80);
    expect(worstX).toBeLessThan(1e-12);
    expect(worstScale).toBeLessThan(1e-11);
    expect(worstEdge).toBeLessThan(1e-12);
  });

  it("matches the frame in emulated float32 (the shader's arithmetic) next to the edge", () => {
    const f = Math.fround;
    let worst = 0;
    let worstEdge = 0;
    for (const v of vectors.frame) {
      // views/band.glsl line by line, with float32 rounding after each operation
      const [c0, s0, s, near] = viewUniform(pic(v.y0, v.s)).map(f);
      const series = (t: number, sign: number) => {
        const t2 = f(t * t);
        return f(t * f(1 + sign * f(f(t2 / 6) * f(1 + sign * f(f(t2 / 20) * f(1 + sign * f(t2 / 42)))))));
      };
      const half = (t: number) => f(0.5 * f(s * f(t)));
      const sh = Math.abs(half(v.u[1])) < 0.5 ? series(half(v.u[1]), -1) : f(Math.sin(half(v.u[1])));
      const ch = f(Math.sqrt(f(1 - f(sh * sh))));
      const C = f(c0 - f(f(2 * sh) * f(f(c0 * sh) + f(s0 * ch))));
      const h = Math.abs(half(v.u[0])) < 0.5 ? series(half(v.u[0]), 1) : f(Math.sinh(half(v.u[0])));
      const m = f(2 * f(h * h));
      const cmid = f(f(c0 * ch) - f(s0 * sh));
      const k = f(C * c0);
      const x: Vec3 = [f(f(f(2 * h) * f(Math.sqrt(f(1 + f(h * h))))) / C), f(f(f(2 * f(cmid * sh)) - f(s0 * m)) / k), f(1 + f(f(m + f(2 * f(sh * sh))) / k))];
      // the edge from the float64 gap, as the shader has it
      const far = f(f(Math.PI) - near);
      const up = s0 >= 0 ? near : far;
      const down = s0 >= 0 ? far : near;
      const e = Math.max(f(v.u[1]) - f(up / s), f(-f(down / s) - f(v.u[1])));
      worstEdge = Math.max(worstEdge, Math.abs(e - Number(v.edge)) / Math.max(1, Math.abs(Number(v.edge))));
      // relative to the point's size: a distance in R near the screen centre, and what float32 can
      // resolve of a point far out (the folding then works to that too)
      worst = Math.max(worst, relDist(x, num(v.x)));
    }
    expect(worst).toBeLessThan(5e-7);
    expect(worstEdge).toBeLessThan(3e-7);
  });

  it("zooms at the cursor to full precision at every edge gap (120-digit vectors)", () => {
    let worstY = 0;
    let worstN = 0;
    for (const v of vectors.zoom) {
      const step = zoomBand({ y0: v.y0, s: v.s }, [v.u0[0], v.u0[1]], v.k);
      expect(isometryError(step.N)).toBeLessThan(1e-9);
      // y0' as an edge gap: compare cos y0' to cos of the exact value
      worstY = Math.max(worstY, Math.abs(step.pic.y0 - Number(v.y1)) / Math.cos(Number(v.y1)));
      const a = toPoincare(apply(step.N, ORIGIN));
      const b = toPoincare(apply(step.N, fromPoincare([0.5, 0])));
      worstN = Math.max(worstN, relDist(a, num(v.a)), relDist(b, num(v.b)));
    }
    expect(vectors.zoom.length).toBeGreaterThan(200);
    expect(worstY).toBeLessThan(1e-3); // y0 is a float64 next to pi/2: 1e-16 absolute on a gap of 1e-12
    expect(worstN).toBeLessThan(1e-12);
  });

  it("keeps the world point under the cursor all the way to the edge gap limit, and stops there", () => {
    const r = rng(73);
    let p: BandPicture = { y0: HOME.band.y0, s: HOME.band.s };
    let cam = identity();
    let moved = 0;
    for (let n = 0; n < 400; n++) {
      // zoom in just inside the upper edge while it is on the screen, else zoom out to bring it back
      const up = Math.atan2(Math.cos(p.y0), Math.sin(p.y0)) / p.s;
      const inward = up < 1;
      const u0: Complex = inward ? [r() * 3 - 1.5, 0.98 * up] : [r() * 3 - 1.5, 0];
      const before = bandFrame(p, u0)!;
      const step = zoomBand(p, u0, inward ? 2 : 0.5);
      expect(cabs(toPoincare(apply(step.N, ORIGIN)))).toBeLessThan(MAX_ZOOM_STEP_W + 1e-9);
      expect(Math.cos(step.pic.y0)).toBeGreaterThanOrEqual(MIN_BAND_GAP);
      const camAfter = mul(cam, step.N);
      const after = bandFrame(step.pic, u0)!;
      const atLimit = Math.cos(step.pic.y0) < 4 * MIN_BAND_GAP;
      if (!atLimit) {
        const want = apply(cam, before.x);
        expect(dist(want, apply(camAfter, after.x))).toBeLessThan(1e-8 * want[2]);
        moved++;
      }
      p = step.pic;
      cam = camAfter;
    }
    expect(moved).toBeGreaterThan(30);
    expect(Math.cos(p.y0)).toBeLessThan(2 * MIN_BAND_GAP);
  });

  it("knows its centre scale and its two edges", () => {
    const p = pic(1.1, 0.3);
    expect(centreScale(p)).toBeCloseTo(0.3 / Math.cos(1.1), 14);
    expect(edgeDistance(p, [0.4, (Math.PI / 2 - 1.1) / 0.3])).toBeCloseTo(0, 12);
    expect(edgeDistance(p, [0.4, -(Math.PI / 2 + 1.1) / 0.3])).toBeCloseTo(0, 12);
    expect(edgeDistance(p, [0, 0])).toBeLessThan(0);
    expect(edgeDistance(HOME.band, [0, 1])).toBeCloseTo(0.2, 12); // home: the band is 0.8 of the screen high
  });
});
