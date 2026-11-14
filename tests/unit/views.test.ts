import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import { cabs, cabs2, cconj, cdiv, cexpi, cmul, cscale, csub } from "../../src/math/complex.ts";
import { ORIGIN, apply, dist, identity, isometryError, mul } from "../../src/math/lorentz.ts";
import { fromPoincare, toPoincare } from "../../src/math/models.ts";
import { HOME_PICTURE, MAX_LAMBDA, MAX_ZOOM_STEP_W, MIN_SIGMA, diskPicture, poincareFrame, screenToU, uToScreen, zoomPoincare, type DiskPicture } from "../../src/math/views.ts";
import data from "./data/deepzoom.json";
import steps from "./data/zoomstep.json";
import { rng } from "./rng.ts";

const f = Math.fround;

describe("screen coordinates", () => {
  it("round-trip and put the vertical extent at +-1", () => {
    expect(screenToU(-0.5, -0.5, 800, 600)).toEqual([-400 / 300, 1]);
    const [x, y] = uToScreen(screenToU(123, 456, 800, 600), 800, 600);
    expect(x).toBeCloseTo(123, 12);
    expect(y).toBeCloseTo(456, 12);
  });
});

describe("disk pictures", () => {
  it("restore |c|^2 + sigma = 1 from the smaller, precise one of the two", () => {
    // near the rim sigma stays and |c| follows it, in c's direction
    const a = diskPicture([0.6, 0.8 + 1e-9], 1e-12, 0.5);
    expect(a.sigma).toBe(1e-12);
    expect(a.s).toBe(0.5);
    expect(Math.hypot(...a.c)).toBeCloseTo(Math.sqrt(1 - 1e-12), 15);
    expect(a.c[0] / a.c[1]).toBeCloseTo(0.6 / (0.8 + 1e-9), 15);
    // near the centre c stays and sigma follows it
    const b = diskPicture([0.1, 0.2], 0.9, 2);
    expect(b.c).toEqual([0.1, 0.2]);
    expect(b.sigma).toBe(1 - (0.1 * 0.1 + 0.2 * 0.2));
    expect(diskPicture([0, 0], 1, HOME_PICTURE.s)).toEqual(HOME_PICTURE);
    // a sigma that is not above 0 is passed on, for the zoom limits to refuse
    expect(diskPicture([1, 0], NaN, 1).sigma).toBeNaN();
    expect(diskPicture([1, 0], -1e-3, 1).sigma).toBe(-1e-3);
  });
});

describe("Poincare view", () => {
  it("frame(u) equals the Mobius map M_c(c + s u) and is oriented like the picture", () => {
    const r = rng(31);
    for (let k = 0; k < 500; k++) {
      const c: Complex = [r() * 0.9 - 0.45, r() * 0.9 - 0.45];
      const pic: DiskPicture = { c, sigma: 1 - c[0] ** 2 - c[1] ** 2, s: 0.05 + r() * 0.5 };
      const u: Complex = [r() - 0.5, r() - 0.5];
      const z: Complex = [c[0] + pic.s * u[0], c[1] + pic.s * u[1]];
      const fp = poincareFrame(pic, u);
      if (!fp) continue;
      const want = cdiv(csub(z, c), csub([1, 0], cmul(cconj(c), z)));
      expect(cabs(csub(fp.w, want))).toBeLessThan(1e-12);
    }
    // a small step right on screen is a step along +x in the frame
    const fp = poincareFrame({ c: [0.3, 0.4], sigma: 0.75, s: 0.1 }, [1e-9, 0])!; // Im/Re is second order in u
    expect(fp.w[0]).toBeGreaterThan(0);
    expect(Math.abs(fp.w[1] / fp.w[0])).toBeLessThan(1e-9);
  });
  it("reports the plane length per unit of u", () => {
    const pic: DiskPicture = { c: [0.2, -0.5], sigma: 1 - 0.04 - 0.25, s: 0.2 };
    const u: Complex = [0.1, 0.2];
    const h = 1e-6;
    const a = poincareFrame(pic, u)!;
    const b = poincareFrame(pic, [u[0] + h, u[1]])!;
    expect(dist(a.x, b.x) / h).toBeCloseTo(a.scale, 4);
  });
  it("matches 700-digit values in float32 down to sigma = 1e-300", () => {
    let worst = 0;
    for (const v of data.filter((d) => d.model === "poincare")) {
      const sigma = Number(v.sigma);
      const lambda = f(sigma / Number(v.s));
      const [ur, ui] = [f(v.u[0]), f(v.u[1])];
      const [cr, ci] = [f(v.c![0]), f(-v.c![1])]; // conj(c)
      const dr = f(lambda - f(f(cr * ur) - f(ci * ui)));
      const di = f(-f(f(cr * ui) + f(ci * ur)));
      const n = f(f(dr * dr) + f(di * di));
      const wr = f(f(f(ur * dr) + f(ui * di)) / n);
      const wi = f(f(f(ui * dr) - f(ur * di)) / n);
      const want = [Number(v.w[0]), Number(v.w[1])];
      worst = Math.max(worst, Math.hypot(wr - want[0], wi - want[1]) / Math.hypot(...want));
    }
    expect(worst).toBeLessThan(2e-7);
  });
});

describe("zoom at the cursor", () => {
  it("keeps the point under the cursor and N maps the new frame onto the old one", () => {
    const r = rng(32);
    let pic: DiskPicture = HOME_PICTURE;
    let cam = identity();
    for (let k = 0; k < 300; k++) {
      const u0: Complex = [r() * 1.6 - 0.8, r() * 1.6 - 0.8];
      const before = poincareFrame(pic, u0);
      const step = zoomPoincare(pic, u0, r() < 0.7 ? 2 : 0.5);
      if (!before || step.pic.s > 1.25) continue;
      const after = poincareFrame(step.pic, u0)!;
      const camAfter = mul(cam, step.N);
      expect(dist(apply(cam, before.x), apply(camAfter, after.x))).toBeLessThan(1e-9 * before.x[2]);
      expect(isometryError(step.N)).toBeLessThan(1e-9);
      pic = step.pic;
      cam = camAfter;
    }
  });
  it("updates sigma and N to full precision at every depth (120-digit vectors)", () => {
    let worstSigma = 0;
    let worstN = 0;
    for (const v of steps) {
      const pic: DiskPicture = { c: [v.c[0], v.c[1]], sigma: v.sigma, s: v.s };
      const step = zoomPoincare(pic, [v.u0[0], v.u0[1]], v.k);
      worstSigma = Math.max(worstSigma, Math.abs(step.pic.sigma / Number(v.sigma1) - 1));
      // N sends the new screen centre (frame origin) to its place in the old frame
      const a = [Number(v.a[0]), Number(v.a[1])];
      const got = toPoincare(apply(step.N, ORIGIN));
      worstN = Math.max(worstN, Math.hypot(got[0] - a[0], got[1] - a[1]) / Math.max(Math.hypot(a[0], a[1]), 1e-300));
    }
    expect(worstSigma).toBeLessThan(1e-14);
    expect(worstN).toBeLessThan(1e-13);
  });
  it("flies toward the boundary for 900 zooms with every step consistent", () => {
    // the cursor sits on the boundary (its direction sweeping slowly), so each 2x zoom halves both
    // sigma and s: a trip toward an ideal point. N must map the new frame onto the old one at
    // several screen points, to 1e-12 of a screen unit
    let pic: DiskPicture = HOME_PICTURE;
    const probes: Complex[] = [[0, 0], [0.3, 0.2], [-0.4, -0.5], [0.9, -0.1]];
    let worst = 0;
    for (let n = 0; n < 900; n++) {
      const e = cexpi(0.7 + 0.0005 * n);
      const b = pic.c[0] * e[0] + pic.c[1] * e[1]; // Re(conj(c) e)
      const lambda = pic.sigma / pic.s;
      const toEdge = lambda / (b + Math.sqrt(b * b + pic.sigma)); // |c + s t e| = 1, without cancellation
      const u0 = cscale(e, toEdge);
      const step = zoomPoincare(pic, u0, 2);
      expect(step.pic.sigma).toBeGreaterThan(0);
      expect(isometryError(step.N)).toBeLessThan(1e-12);
      for (const u of probes) {
        const want = poincareFrame(pic, [u0[0] / 2 + u[0] / 2, u0[1] / 2 + u[1] / 2]);
        const after = poincareFrame(step.pic, u);
        if (!want || !after) continue;
        const mapped = toPoincare(apply(step.N, after.x));
        const perU = (want.scale * (1 - cabs2(want.w))) / 2; // |dw/du| in the old frame
        worst = Math.max(worst, cabs(csub(mapped, want.w)) / perU);
      }
      pic = step.pic;
    }
    expect(worst).toBeLessThan(1e-12);
    expect(pic.sigma).toBeLessThan(1e-200);
    // the naive 1 - |c|^2 has lost every digit at this depth; the kept sigma has not
    expect(Math.abs(1 - cabs2(pic.c) - pic.sigma) / pic.sigma).toBeGreaterThan(1e100);
  });
  it("stops at the zoom limits instead of underflowing or overflowing", () => {
    let pic: DiskPicture = HOME_PICTURE;
    for (let n = 0; n < 1100; n++) {
      // the cursor on the boundary straight to the right of the screen centre
      const lambda = pic.sigma / pic.s;
      const step = zoomPoincare(pic, [lambda / (pic.c[0] + Math.sqrt(pic.c[0] ** 2 + pic.sigma)), 0], 2);
      if (n > 1050) expect(step.N).toEqual(identity());
      pic = step.pic;
    }
    expect(pic.sigma).toBeGreaterThanOrEqual(MIN_SIGMA);
    expect(Number.isFinite(pic.sigma / pic.s)).toBe(true);
    pic = HOME_PICTURE;
    for (let n = 0; n < 200; n++) pic = zoomPoincare(pic, [0, 0], 2).pic;
    expect(pic.sigma / pic.s).toBeLessThanOrEqual(MAX_LAMBDA);
    expect(poincareFrame(pic, [0.5, 0.5])!.scale).toBeGreaterThan(0);
  });
  it("keeps the screen centre inside the disk when the cursor is outside it", () => {
    const r = rng(33);
    const pics: DiskPicture[] = [HOME_PICTURE, { c: [0.6, 0.8 * Math.sqrt(1 - 1e-20)], sigma: 0.64e-20, s: 1e-21 }];
    for (const pic of pics)
      for (let n = 0; n < 2000; n++) {
        const u0: Complex = [r() * 6 - 3, r() * 4 - 2];
        const step = zoomPoincare(pic, u0, r() < 0.5 ? 2 : 0.5);
        expect(step.pic.sigma).toBeGreaterThan(0);
        expect(cabs(toPoincare(apply(step.N, ORIGIN)))).toBeLessThan(MAX_ZOOM_STEP_W + 1e-9);
      }
  });
});

describe("model helpers used by views", () => {
  it("Poincare coordinates of frame points stay inside the disk", () => {
    const fp = poincareFrame(HOME_PICTURE, [0.5, 0.5])!;
    expect(cabs(toPoincare(fromPoincare(fp.w)))).toBeLessThan(1);
  });
});
