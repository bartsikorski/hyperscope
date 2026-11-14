// The Klein, half-plane and local views, and the dispatch that lets the camera treat every view alike.
import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import { cabs, cabs2, cdiv, cexpi, cmul, cscale, csub } from "../../src/math/complex.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { ORIGIN, apply, dist, identity, inverse, isometryError, mink, mul, sub, translationTo } from "../../src/math/lorentz.ts";
import { fromKlein, fromPoincare, toKlein, toPoincare } from "../../src/math/models.ts";
import {
  HOME, HOME_PICTURE, KLEIN_STEP, MAX_ZOOM_STEP_W, MIN_SIGMA, MODELS, centreScale, centredPicture, frameOf, halfPlaneFrame,
  kleinFrame, kleinScreenOf, localFrame, zoomHalfPlane, zoomKlein, zoomLocal, zoomPicture, type DiskPicture, type FramePoint, type Picture,
} from "../../src/math/views.ts";
import vectors from "./data/views.json";
import { rng } from "./rng.ts";

const num = (a: string[]) => a.map(Number);
const relDist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i])) / Math.max(Math.hypot(...b), 1e-300);

/** Largest plane length per unit of u at u, from the Jacobian of the frame map (Minkowski Gram matrix). */
function footprint(frame: (u: Complex) => FramePoint | null, u: Complex, h = 1e-6): number {
  const x0 = frame(u)!.x;
  const j0 = sub(frame([u[0] + h, u[1]])!.x, x0).map((v) => v / h) as Vec3;
  const j1 = sub(frame([u[0], u[1] + h])!.x, x0).map((v) => v / h) as Vec3;
  const [a, b, c] = [mink(j0, j0), mink(j0, j1), mink(j1, j1)];
  return Math.sqrt((a + c + Math.sqrt((a - c) ** 2 + 4 * b * b)) / 2);
}

/** Where N sends the frame origin and the frame point 0.5, in Poincare coordinates. */
const images = (N: number[]) => [toPoincare(apply(N, ORIGIN)), toPoincare(apply(N, fromPoincare([0.5, 0])))];

describe("Klein view", () => {
  it("frame(u) is the pure boost T(P_c)^-1 applied to the picture point c + s u", () => {
    const r = rng(41);
    let n = 0;
    for (let k = 0; k < 500; k++) {
      const c: Complex = [r() * 1.2 - 0.6, r() * 1.2 - 0.6];
      const pic: DiskPicture = { c, sigma: 1 - cabs2(c), s: 0.05 + r() * 0.5 };
      const u: Complex = [r() - 0.5, r() - 0.5];
      const z: Complex = [c[0] + pic.s * u[0], c[1] + pic.s * u[1]];
      const fp = kleinFrame(pic, u);
      expect(fp === null).toBe(cabs2(z) >= 1);
      if (!fp) continue;
      const want = apply(inverse(translationTo(fromKlein(c))), fromKlein(z));
      expect(dist(fp.x, want)).toBeLessThan(1e-9);
      expect(cabs(csub(fp.w, toPoincare(want)))).toBeLessThan(1e-12);
      n++;
    }
    expect(n).toBeGreaterThan(400);
    // the frame keeps orientation (Klein shears directions off the line through c, so only on that
    // line does a step right on screen stay a step along +x), and the home view is the identity
    const shear = kleinFrame({ c: [0.3, 0.4], sigma: 0.75, s: 0.1 }, [1e-9, 0])!.x;
    expect(shear[0] * kleinFrame({ c: [0.3, 0.4], sigma: 0.75, s: 0.1 }, [0, 1e-9])!.x[1]).toBeGreaterThan(0);
    const fp = kleinFrame({ c: [0.5, 0], sigma: 0.75, s: 0.1 }, [1e-9, 0])!;
    expect(fp.x[0]).toBeGreaterThan(0);
    expect(Math.abs(fp.x[1] / fp.x[0])).toBeLessThan(1e-6);
    expect(shear[1]).not.toBe(0);
    const home = kleinFrame(HOME_PICTURE, [0.3, -0.2])!;
    expect(cabs(csub(toKlein(home.x), [0.3 * 1.05, -0.2 * 1.05]))).toBeLessThan(1e-15);
  });
  it("finds the screen point of a frame point (kleinScreenOf), shallow and deep", () => {
    const r = rng(23);
    for (let i = 0; i < 2000; i++) {
      const depth = Math.exp(-30 * r());
      const a = 2 * Math.PI * r();
      const rad = Math.sqrt(1 - depth);
      const pic: DiskPicture = { c: [rad * Math.cos(a), rad * Math.sin(a)], sigma: depth, s: depth * (0.05 + r()) };
      const u: Complex = [2 * r() - 1, 2 * r() - 1];
      const f = kleinFrame(pic, u);
      if (!f) continue;
      const back = kleinScreenOf(pic, f.x)!;
      expect(cabs(csub(back, u))).toBeLessThan(1e-9 * (1 + cabs(u)));
    }
    expect(kleinScreenOf(HOME_PICTURE, [0, -2, -Math.sqrt(5)])).toBeNull();
  });
  it("reports the largest plane length per unit of u (Klein is not conformal)", () => {
    const r = rng(42);
    for (let k = 0; k < 50; k++) {
      const c: Complex = [r() * 1.2 - 0.6, r() * 1.2 - 0.6];
      const pic: DiskPicture = { c, sigma: 1 - cabs2(c), s: 0.05 + r() * 0.3 };
      const u: Complex = [r() - 0.5, r() - 0.5];
      const fp = kleinFrame(pic, u);
      if (!fp || cabs2(fp.w) > 0.8) continue;
      expect(footprint((v) => kleinFrame(pic, v), u) / fp.scale - 1).toBeLessThan(1e-4);
    }
  });
  it("matches 120-digit values at every depth", () => {
    let worstX = 0;
    let worstScale = 0;
    for (const v of vectors.klein) {
      const fp = kleinFrame({ c: [v.c[0], v.c[1]], sigma: v.sigma, s: v.s }, [v.u[0], v.u[1]])!;
      worstX = Math.max(worstX, relDist(fp.x, num(v.x)));
      worstScale = Math.max(worstScale, Math.abs(fp.scale / Number(v.scale) - 1));
    }
    expect(worstX).toBeLessThan(1e-14);
    expect(worstScale).toBeLessThan(1e-14);
  });
  it("zooms to full precision at every depth (120-digit vectors)", () => {
    let worstSigma = 0;
    let worstN = 0;
    for (const v of vectors.kleinZoom) {
      const step = zoomKlein({ c: [v.c[0], v.c[1]], sigma: v.sigma, s: v.s }, [v.u0[0], v.u0[1]], v.k);
      worstSigma = Math.max(worstSigma, Math.abs(step.pic.sigma / Number(v.sigma1) - 1));
      const [a, b] = images(step.N);
      worstN = Math.max(worstN, relDist(a, num(v.a)), relDist(b, num(v.b)));
    }
    expect(worstSigma).toBeLessThan(1e-14);
    expect(worstN).toBeLessThan(1e-13);
  });
  it("flies toward the boundary for 900 zooms with every step consistent", () => {
    let pic: DiskPicture = HOME_PICTURE;
    const probes: Complex[] = [[0, 0], [0.3, 0.2], [-0.4, -0.5], [0.9, -0.1]];
    let worst = 0;
    for (let n = 0; n < 900; n++) {
      const e = cexpi(0.7 + 0.0005 * n);
      const b = pic.c[0] * e[0] + pic.c[1] * e[1];
      const toEdge = pic.sigma / pic.s / (b + Math.sqrt(b * b + pic.sigma)); // |c + s t e| = 1
      const u0 = cscale(e, toEdge);
      const step = zoomKlein(pic, u0, 2);
      expect(step.pic.sigma).toBeGreaterThan(0);
      expect(isometryError(step.N)).toBeLessThan(1e-12);
      for (const u of probes) {
        const want = kleinFrame(pic, [u0[0] / 2 + u[0] / 2, u0[1] / 2 + u[1] / 2]);
        const after = kleinFrame(step.pic, u);
        if (!want || !after) continue;
        // in units of the screen: the plane distance over the plane length of half a unit of u
        worst = Math.max(worst, dist(apply(step.N, after.x), want.x) / (want.scale / 2));
      }
      pic = step.pic;
    }
    expect(worst).toBeLessThan(1e-11);
    expect(pic.sigma).toBeLessThan(1e-200);
  });
  it("keeps the screen centre inside the step limit when the cursor is outside the disk", () => {
    const r = rng(43);
    const pics: DiskPicture[] = [HOME_PICTURE, { c: [0.6, 0.8 * Math.sqrt(1 - 1e-20)], sigma: 0.64e-20, s: 1e-21 }];
    for (const pic of pics)
      for (let n = 0; n < 2000; n++) {
        const step = zoomKlein(pic, [r() * 6 - 3, r() * 4 - 2], r() < 0.5 ? 2 : 0.5);
        expect(step.pic.sigma).toBeGreaterThan(0);
        expect(cabs(toKlein(apply(step.N, ORIGIN)))).toBeLessThan(KLEIN_STEP + 1e-9);
      }
  });
  it("stops at the zoom limits", () => {
    let pic: DiskPicture = HOME_PICTURE;
    for (let n = 0; n < 1100; n++) {
      const toEdge = pic.sigma / pic.s / (pic.c[0] + Math.sqrt(pic.c[0] ** 2 + pic.sigma));
      pic = zoomKlein(pic, [toEdge, 0], 2).pic;
    }
    expect(pic.sigma).toBeGreaterThanOrEqual(MIN_SIGMA);
    expect(kleinFrame(pic, [0.1, 0.1])!.scale).toBeGreaterThan(0);
  });
});

describe("half-plane view", () => {
  it("frame(u) is the Mobius map i (z - c) / (z - conj c) of the picture point z = c + s u", () => {
    const r = rng(44);
    for (let k = 0; k < 500; k++) {
      const c: Complex = [r() * 4 - 2, 0.1 + r() * 3];
      const s = 0.05 + r() * 2;
      const u: Complex = [r() * 3 - 1.5, r() * 2 - 1];
      const z: Complex = [c[0] + s * u[0], c[1] + s * u[1]];
      const fp = halfPlaneFrame({ mu: (2 * c[1]) / s }, u);
      expect(fp === null).toBe(z[1] <= 0);
      if (!fp) continue;
      const want = cmul([0, 1], cdiv(csub(z, c), [z[0] - c[0], z[1] + c[1]]));
      expect(cabs(csub(fp.w, want))).toBeLessThan(1e-12);
      expect(dist(fp.x, fromPoincare(want))).toBeLessThan(1e-9);
      expect(fp.scale / (s / z[1]) - 1).toBeLessThan(1e-12); // |dz| / Im z per unit of u
    }
    const fp = halfPlaneFrame(HOME.halfplane, [1e-9, 0])!;
    expect(fp.w[0]).toBeGreaterThan(0);
    expect(Math.abs(fp.w[1] / fp.w[0])).toBeLessThan(1e-6);
  });
  it("matches 120-digit values, also next to the boundary line", () => {
    let worstW = 0;
    let worstScale = 0;
    for (const v of vectors.half) {
      const fp = halfPlaneFrame({ mu: v.mu }, [v.u[0], v.u[1]])!;
      worstW = Math.max(worstW, relDist(fp.w, num(v.w)));
      worstScale = Math.max(worstScale, Math.abs(fp.scale / Number(v.scale) - 1));
    }
    expect(worstW).toBeLessThan(1e-14);
    expect(worstScale).toBeLessThan(1e-12); // 0.4 - 0.1495 i lies 1e-3 above the boundary of mu = 0.3
  });
  it("zooms at the cursor (120-digit vectors and a random walk)", () => {
    let worstMu = 0;
    let worstN = 0;
    for (const v of vectors.halfZoom) {
      const step = zoomHalfPlane({ mu: v.mu }, [v.u0[0], v.u0[1]], v.k);
      worstMu = Math.max(worstMu, Math.abs(step.pic.mu / Number(v.mu1) - 1));
      const [a, b] = images(step.N);
      worstN = Math.max(worstN, relDist(a, num(v.a)), relDist(b, num(v.b)));
    }
    expect(worstMu).toBeLessThan(1e-14);
    expect(worstN).toBeLessThan(1e-13);
    const r = rng(45);
    let pic = { mu: HOME.halfplane.mu };
    let cam = identity();
    let moved = 0;
    for (let k = 0; k < 300; k++) {
      const u0: Complex = [r() * 3 - 1.5, r() * 2 - 1];
      const before = halfPlaneFrame(pic, u0);
      const step = zoomHalfPlane(pic, u0, r() < 0.6 ? 2 : 0.5);
      expect(cabs(toPoincare(apply(step.N, ORIGIN)))).toBeLessThan(MAX_ZOOM_STEP_W + 1e-9);
      pic = step.pic;
      // a guarded step (cursor below the boundary line, or a zoom-out past it) moves the point a little
      if (!before || dist(apply(step.N, ORIGIN), ORIGIN) > 2.9) {
        cam = mul(cam, step.N);
        continue;
      }
      const after = halfPlaneFrame(step.pic, u0)!;
      const camAfter = mul(cam, step.N);
      expect(dist(apply(cam, before.x), apply(camAfter, after.x))).toBeLessThan(1e-9 * apply(cam, before.x)[2]);
      cam = camAfter;
      moved++;
    }
    expect(moved).toBeGreaterThan(150);
  });
});

describe("local view", () => {
  it("puts the pixel at u at distance ell |u| in the direction of u", () => {
    const r = rng(46);
    for (let k = 0; k < 200; k++) {
      const ell = 0.01 + r() * 5;
      const u: Complex = [r() * 3 - 1.5, r() * 2 - 1];
      const fp = localFrame({ ell }, u);
      expect(dist(fp.x, ORIGIN) / (ell * cabs(u)) - 1).toBeLessThan(1e-9);
      expect(Math.abs(Math.atan2(fp.x[1], fp.x[0]) - Math.atan2(u[1], u[0]))).toBeLessThan(1e-12);
      expect(Math.abs(footprint((v) => localFrame({ ell }, v), u, 1e-7) / fp.scale - 1)).toBeLessThan(1e-5);
    }
    expect(localFrame({ ell: 2 }, [0, 0]).x).toEqual(ORIGIN);
  });
  it("matches 120-digit values and keeps the point under the cursor when zooming", () => {
    let worst = 0;
    for (const v of vectors.local) {
      const fp = localFrame({ ell: v.ell }, [v.u[0], v.u[1]]);
      worst = Math.max(worst, relDist(fp.x, num(v.x)), Math.abs(fp.scale / Number(v.scale) - 1));
    }
    for (const v of vectors.localZoom) {
      const [a, b] = images(zoomLocal({ ell: v.ell }, [v.u0[0], v.u0[1]], v.k).N);
      worst = Math.max(worst, relDist(a, num(v.a)), relDist(b, num(v.b)));
    }
    expect(worst).toBeLessThan(1e-13);
    const r = rng(47);
    for (let k = 0; k < 200; k++) {
      const pic = { ell: 0.01 + r() * 4 };
      const u0: Complex = [r() * 3 - 1.5, r() * 2 - 1];
      const step = zoomLocal(pic, u0, r() < 0.5 ? 2 : 0.5);
      expect(dist(localFrame(pic, u0).x, apply(step.N, localFrame(step.pic, u0).x))).toBeLessThan(1e-9 * localFrame(pic, u0).x[2]);
    }
  });
});

describe("every view alike", () => {
  it("keeps the world point under the cursor through random zooms in each model", () => {
    // (inside H3 and on the hyperboloid zoomPicture moves the eye or the orbit's camera alone;
    // camera.ts zoomAt then holds the ground under the cursor: camera.test.ts)
    for (const model of MODELS.filter((m) => m !== "h3" && m !== "hyperboloid")) {
      const r = rng(48);
      let pic: Picture = HOME[model];
      let cam = identity();
      let moved = 0;
      for (let k = 0; k < 300; k++) {
        const u0: Complex = [r() * 2.4 - 1.2, r() * 1.6 - 0.8];
        const before = frameOf(pic, u0);
        const step = zoomPicture(pic, u0, r() < 0.65 ? 2 : 0.5);
        expect(step.pic.model).toBe(model);
        expect(isometryError(step.N)).toBeLessThan(1e-9);
        const camAfter = mul(cam, step.N);
        const after = frameOf(step.pic, u0);
        // a guarded step (cursor off the picture, or a zoom-out past the boundary) moves the point a little
        const guarded = !before || dist(apply(step.N, ORIGIN), ORIGIN) > 2.9;
        if (before && after && !guarded) {
          expect(dist(apply(cam, before.x), apply(camAfter, after.x))).toBeLessThan(1e-8 * apply(cam, before.x)[2]);
          moved++;
        }
        pic = step.pic;
        cam = camAfter;
      }
      expect(moved, model).toBeGreaterThan(150);
    }
  });
  it("knows the plane length per unit of u at the screen centre, and keeps it across a model switch", () => {
    const pics: Picture[] = [
      { model: "poincare", c: [0.3, -0.5], sigma: 1 - 0.34, s: 0.2 },
      { model: "klein", c: [0.3, -0.5], sigma: 1 - 0.34, s: 0.2 },
      { model: "halfplane", mu: 3.3 },
      { model: "local", ell: 0.7 },
      ...MODELS.map((m) => HOME[m]),
    ];
    for (const pic of pics) {
      const sc = centreScale(pic);
      expect(Math.abs(frameOf(pic, [0, 0])!.scale / sc - 1), pic.model).toBeLessThan(1e-12);
      expect(Math.abs(footprint((u) => frameOf(pic, u), [0, 0], 1e-7) / sc - 1), pic.model).toBeLessThan(1e-5);
      // (the plane inside H3 and the hyperboloid have no centred picture of a given scale: they
      // switch to their own eye or orbit)
      for (const model of MODELS.filter((m) => m !== "h3" && m !== "hyperboloid")) {
        const switched = centredPicture(model, sc);
        expect(switched.model).toBe(model);
        expect(Math.abs(centreScale(switched) / sc - 1)).toBeLessThan(1e-15);
        expect(dist(frameOf(switched, [0, 0])!.x, ORIGIN)).toBe(0);
      }
    }
  });
});
