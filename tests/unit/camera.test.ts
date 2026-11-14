import { describe, expect, it } from "vitest";
import { compose, findColourings, identityPerm, parity } from "../../src/math/colourings.ts";
import type { Complex } from "../../src/math/complex.ts";
import { fold, triangleGroup } from "../../src/math/groups.ts";
import { ORIGIN, apply, dist, inverse, isometryError, mink, reflectPoint, rotation, type Vec3 } from "../../src/math/lorentz.ts";
import { BAND_EASE, HOME, MAX_BAND_S, MODELS, centreScale, edgeDistance, frameOf, kleinScreenOf, kleinShift, type DiskPicture, type HalfPlanePicture, type Picture } from "../../src/math/views.ts";
import {
  ANCHOR_MARGIN_PX, EASE_FROM, KLEIN_OPEN_RATE, MAX_ELL, MAX_S, PAN_REACH, MIN_FOOTPRINT_PLAIN, MIN_MU, centreFootprint, clampZoom, easeCentre, homeView, kleinOpenBound, minCentreFootprint, openKlein, panBy, rotateBy,
  rotateDrag, settle, switchModel, worldAt, zoomAnchor, zoomAt, type ViewState,
} from "../../src/input/camera.ts";
import { FRAC_BITS, GRID_KINDS, gridAt, type GridKind } from "../../src/math/grid.ts";
import { Controls, type ControlsHost } from "../../src/input/controls.ts";
import { rng } from "./rng.ts";

const H = 1000;
const g73 = triangleGroup(7, 3, 2);

/** Whether a zoom-out may have re-centred the picture on purpose (the disks past EASE_FROM, the band
 *  at its smallest edge gap for its scale). */
const easedOut = (p: Picture) =>
  p.model === "poincare" || p.model === "klein" ? p.s > EASE_FROM
  : p.model === "band" ? Math.atan2(Math.cos(p.y0), Math.abs(Math.sin(p.y0))) <= BAND_EASE * p.s * (1 + 1e-9)
  : false;

/** Plane length of one screen unit at u (for "within a fraction of a pixel" checks). */
const unitAt = (v: ViewState, u: Complex) => frameOf(v.picture, u)!.scale;
const disk = (v: ViewState) => v.picture as DiskPicture;
const zoom = (v: ViewState, u0: Complex, k: number) => zoomAt(v, u0, k, H).view;

/** Inside H3 a zoom holds the ground under the cursor only where it lies within PAN_REACH before
 *  and after (camera.ts zoomH3At); elsewhere the eye stays over its foot point. */
const unheld = (a: ViewState, b: ViewState, u: Complex) => {
  if (a.picture.model !== "h3") return false;
  const far = Math.cosh(PAN_REACH);
  const p = frameOf(a.picture, u);
  const q = frameOf(b.picture, u);
  return !(p && q && p.x[2] <= far && q.x[2] <= far);
};

describe("camera moves", () => {
  it("keep the grabbed point under the cursor through 2000 random pans, zooms and rotations in every model", () => {
    for (const model of MODELS) {
      const r = rng(41);
      let v = homeView(2, model);
      let worst = 0;
      let zooms = 0;
      for (let n = 0; n < 2000; n++) {
        const ua: Complex = [r() * 1.6 - 0.8, r() * 1.6 - 0.8];
        const ub: Complex = [ua[0] + (r() - 0.5) * 0.3, ua[1] + (r() - 0.5) * 0.3];
        const before = worldAt(v, ua);
        if (!before || !frameOf(v.picture, ub)) {
          // inside H3, from high up the ground fills only the bottom of the screen: come down to it
          if (model === "h3") v = zoomAt(v, [0, 0], 1.7, H).view;
          continue;
        }
        const kind = n % 3;
        const kz = r() < 0.6 ? 1.7 : 0.6;
        const z = zoomAt(v, ua, kz, H);
        // a zoom-in within ANCHOR_MARGIN_PX of the edge (the band's edges cross this square) aims inside
        const anchored = kz > 1 && zoomAnchor(v.picture, ua, H) !== ua;
        const moved = kind === 0 ? panBy(v, ua, ub) : kind === 1 ? z.view : rotateBy(v, r() - 0.5);
        // compared before re-centering, which moves the world by a symmetry of the tiling; zooms
        // that ease the disk back to the centre, meet the step guard or are anchored move the point
        // on purpose
        const reach = Math.cosh(PAN_REACH);
        const pulled = frameOf(v.picture, ua)!.x[2] > reach || frameOf(v.picture, ub)!.x[2] > reach;
        if (kind === 0 && !pulled) worst = Math.max(worst, dist(before, worldAt(moved, ub)!) / unitAt(moved, ub));
        const eased = easedOut(moved.picture);
        const guarded = dist(apply(inverse(v.camera), apply(moved.camera, ORIGIN)), ORIGIN) > 2.9;
        if (kind === 1 && z.k !== 1 && !eased && !guarded && !anchored && !unheld(v, z.view, ua)) {
          worst = Math.max(worst, dist(before, worldAt(moved, ua)!) / unitAt(moved, ua));
          zooms++;
        }
        v = settle(moved, g73, parity);
        expect(isometryError(v.camera)).toBeLessThan(1e-12);
      }
      expect(worst, model).toBeLessThan(1e-9); // in screen units: far below a pixel
      expect(zooms, model).toBeGreaterThan(200);
    }
  });
  it("move the unit grids with the picture: the grid point under the cursor stays there, re-centering leaves them alone", () => {
    const one = 1n << FRAC_BITS;
    /** Plane distance between the grid points at frame point xa of view a and xb of view b, in
     *  screen units at ub. */
    const gridGap = (kind: GridKind, a: ViewState, xa: Vec3, b: ViewState, xb: Vec3, ub: Complex) => {
      const p = gridAt(kind, a.grids[kind], xa);
      const q = gridAt(kind, b.grids[kind], xb);
      let ds = b.grids[kind].s - a.grids[kind].s;
      if (kind === "polar") ds = ((ds % one) + one + one / 2n) % one - one / 2n;
      let dS = Number(ds) / 2 ** Number(FRAC_BITS) + q.ds - p.ds;
      // the polar angle in turns, modulo a whole turn (a pan that takes the camera past the centre
      // turns its own angle by most of one, which the points' angles take back)
      if (kind === "polar") dS -= Math.round(dS);
      const f = kind === "cartesian" ? Math.cosh(p.e) : kind === "polar" ? 2 * Math.PI * Math.sinh(p.e) : Math.exp(-p.e);
      return Math.hypot(q.e - p.e, dS * f) / unitAt(b, ub);
    };
    for (const model of MODELS) {
      const r = rng(47);
      let v = homeView(2, model);
      const worst = { pan: 0, zoom: 0, rotate: 0 };
      let counted = 0;
      for (let n = 0; n < 600; n++) {
        const ua: Complex = [r() * 1.6 - 0.8, r() * 1.6 - 0.8];
        const ub: Complex = [ua[0] + (r() - 0.5) * 0.3, ua[1] + (r() - 0.5) * 0.3];
        if (!frameOf(v.picture, ua) || !frameOf(v.picture, ub)) {
          if (model === "h3") v = zoomAt(v, [0, 0], 1.7, H).view;
          continue;
        }
        const kind = n % 3;
        const kz = r() < 0.6 ? 1.7 : 0.6;
        const z = zoomAt(v, ua, kz, H);
        // a zoom-in within ANCHOR_MARGIN_PX of the edge (the band's edges cross this square) aims inside
        const anchored = kz > 1 && zoomAnchor(v.picture, ua, H) !== ua;
        const theta = r() - 0.5;
        const moved = kind === 0 ? panBy(v, ua, ub) : kind === 1 ? z.view : rotateBy(v, theta);
        const eased = easedOut(moved.picture);
        const guarded = dist(apply(inverse(v.camera), apply(moved.camera, ORIGIN)), ORIGIN) > 2.9;
        const xa = frameOf(v.picture, ua)!.x;
        // a longer move (a pan at the edge of the zoomed-out local view) has entries near e^d, so its
        // turn at the centre is good to about 1e-16 e^d, for the tiling's camera as for the grids'
        if (!guarded) {
          for (const g of GRID_KINDS) {
            if (kind === 0) worst.pan = Math.max(worst.pan, gridGap(g, v, xa, moved, frameOf(moved.picture, ub)!.x, ub));
            if (kind === 1 && z.k !== 1 && !eased && !anchored && !unheld(v, z.view, ua)) worst.zoom = Math.max(worst.zoom, gridGap(g, v, xa, moved, frameOf(moved.picture, ua)!.x, ua));
            // a rotation by theta turns the frame point x to R(theta) x
            if (kind === 2) worst.rotate = Math.max(worst.rotate, gridGap(g, v, xa, moved, apply(rotation(theta), xa), ua));
          }
          counted++;
        }
        v = settle(moved, g73, parity);
        expect(v.grids).toBe(moved.grids);
      }
      expect(counted, model).toBeGreaterThan(400);
      for (const [move, w] of Object.entries(worst)) expect(w, `${model} ${move}`).toBeLessThan(1e-9);
    }
  });
  it("re-centering keeps the camera's centre point in the kite (the triangle and its mirror image across side 1)", () => {
    let v = homeView(2);
    for (let n = 0; n < 300; n++) {
      v = settle(panBy(v, [0.3, 0.1], [-0.3, -0.1]), g73, parity);
      let c = apply(v.camera, ORIGIN);
      if (mink(c, g73.normals[0]) > 0) c = reflectPoint(c, g73.normals[0]);
      for (const nrm of g73.normals) expect(mink(c, nrm)).toBeLessThanOrEqual(1e-12);
      expect(Math.max(...v.camera.map(Math.abs))).toBeLessThan(10);
    }
  });
  it("re-centering never changes what is on screen, colours included", () => {
    const col = findColourings({ p: 6, q: 4, r: 2 }).find((c) => c.k === 3)!;
    const g = triangleGroup(6, 4, 2);
    const colourAt = (v: ViewState, u: Complex) => {
      const f = fold(worldAt(v, u)!, g.normals);
      let p = v.perm;
      for (const j of f.word) p = compose(p, col.sigma[j]);
      return p[0];
    };
    const r = rng(42);
    let v = homeView(3);
    for (let n = 0; n < 200; n++) {
      const moved = panBy(v, [0.2, 0], [-0.25, 0.1]);
      const settled = settle(moved, g, col);
      for (let s = 0; s < 20; s++) {
        const u: Complex = [r() * 1.2 - 0.6, r() * 1.2 - 0.6];
        expect(colourAt(settled, u)).toBe(colourAt(moved, u));
      }
      v = settled;
    }
  });
  it("rotate-drag turns the grabbed point to the cursor's direction", () => {
    const v: ViewState = { ...homeView(2), picture: { model: "poincare", c: [0.3, 0.2], sigma: 1 - 0.13, s: 0.4 } };
    const ua: Complex = [0.5, 0.1];
    const ub: Complex = [-0.2, 0.4];
    const next = rotateDrag(v, ua, ub);
    // the old world point under ua, seen in the new frame, points the way ub does
    const local = apply(inverse(next.camera), worldAt(v, ua)!);
    const wb = frameOf(v.picture, ub)!.w;
    expect(Math.atan2(local[1], local[0])).toBeCloseTo(Math.atan2(wb[1], wb[0]), 12);
  });
});

describe("zoom limits", () => {
  it("stops zooming out at s = MAX_S and re-centres the disk on the way", () => {
    for (const model of ["poincare", "klein"] as const) {
      let v: ViewState = { ...homeView(2), picture: { model, c: [0.6, 0.5], sigma: 1 - 0.61, s: 0.3 } };
      for (let n = 0; n < 40; n++) v = settle(zoom(v, [0.4, -0.3], 0.8), g73, parity);
      expect(disk(v).s).toBeCloseTo(MAX_S, 12);
      expect(Math.hypot(...disk(v).c)).toBe(0);
      expect(disk(v).sigma).toBeCloseTo(1, 12);
      expect(v.picture.model).toBe(model);
    }
  });
  it("eases the centre without moving the screen-centre point or the scale there", () => {
    const pic = { c: [0.5, -0.4] as Complex, sigma: 1 - 0.41, s: 1.0 };
    const eased = easeCentre(pic);
    expect(Math.hypot(...eased.c)).toBeCloseTo((MAX_S - 1) / (MAX_S - EASE_FROM), 12);
    expect(eased.sigma).toBeCloseTo(1 - (eased.c[0] ** 2 + eased.c[1] ** 2), 14);
    expect(frameOf({ model: "poincare", ...eased }, [0, 0])!.w).toEqual([0, 0]);
  });
  it("stops zooming in where a centre pixel covers MIN_FOOTPRINT of the plane, in every model", () => {
    // (inside H3 the eye's height and on the hyperboloid the orbit's distance have their own limits)
    for (const model of MODELS.filter((m) => m !== "h3" && m !== "hyperboloid")) {
      let v = homeView(2, model);
      for (let n = 0; n < 60; n++) v = zoom(v, [0.1, 0.05], 2);
      expect(centreFootprint(v.picture), model).toBeGreaterThanOrEqual(minCentreFootprint(H) * (1 - 1e-12));
      expect(centreFootprint(v.picture), model).toBeLessThan(minCentreFootprint(H) * 1.001);
      expect(zoomAt(v, [0.1, 0.05], 2, H).k).toBe(1);
    }
    // Klein toward the boundary: the direction along the rim is r times shorter and stops first,
    // (re-aimed at the rim every step, this dives along it: the opening, gradual by design, trails)
    let v = homeView(2, "klein");
    for (let n = 0; n < 60; n++) {
      const p = disk(v);
      const t = (p.sigma / p.s / (p.c[0] + Math.sqrt(p.c[0] ** 2 + p.sigma))) * 0.98;
      v = zoom(v, [t, 0], 2);
    }
    const p = disk(v);
    expect(Math.sqrt(p.sigma) * centreScale(v.picture)).toBeCloseTo(minCentreFootprint(H), 6);
  });
  it("goes on to MIN_FOOTPRINT_PLAIN on plain content, and back to the tiling's limit about the centre", () => {
    for (const model of MODELS.filter((m) => m !== "h3" && m !== "hyperboloid")) {
      let v = homeView(2, model);
      for (let n = 0; n < 60; n++) v = settle(zoomAt(v, [0.1, 0.05], 2, H, MIN_FOOTPRINT_PLAIN).view, g73, parity);
      expect(centreFootprint(v.picture) / minCentreFootprint(H, MIN_FOOTPRINT_PLAIN), model).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(centreFootprint(v.picture) / minCentreFootprint(H, MIN_FOOTPRINT_PLAIN), model).toBeLessThan(1.001);
      const c = clampZoom(v, H);
      expect(centreFootprint(c.picture) / minCentreFootprint(H), model).toBeGreaterThanOrEqual(1);
      expect(centreFootprint(c.picture) / minCentreFootprint(H), model).toBeLessThan(1 + 1e-9);
      expect(dist(worldAt(c, [0, 0])!, worldAt(v, [0, 0])!), model).toBeLessThan(1e-12);
      expect(clampZoom(c, H)).toBe(c);
    }
  });
  it("stops zooming out at the half-plane's MIN_MU and the local view's MAX_ELL", () => {
    let h = homeView(2, "halfplane");
    let l = homeView(2, "local");
    for (let n = 0; n < 30; n++) {
      h = zoom(h, [0.2, 0.3], 0.7);
      l = zoom(l, [0.2, 0.3], 0.7);
    }
    expect(h.picture.model === "halfplane" && h.picture.mu).toBeCloseTo(MIN_MU, 12);
    expect(l.picture.model === "local" && l.picture.ell).toBeCloseTo(MAX_ELL, 12);
    expect(zoomAt(h, [0, 0], 0.5, H).k).toBeCloseTo(1, 12);
    expect(zoomAt(l, [0, 0], 0.5, H).k).toBeCloseTo(1, 12);
  });
  it("switches models in place: same camera, same plane length per unit of u at the centre", () => {
    const r = rng(43);
    for (let n = 0; n < 50; n++) {
      let v = homeView(2, MODELS[n % MODELS.length]);
      for (let i = 0; i < 4; i++) v = settle(zoom(panBy(v, [0.1, 0.2], [r() - 0.5, r() - 0.5]), [r() - 0.5, r() - 0.5], 0.5 + r() * 3), g73, parity);
      for (const model of MODELS) {
        const w = switchModel(v, model, H);
        expect(w.picture.model).toBe(model);
        // the plane inside H3 keeps the centre point but from its own eye: its camera steps back;
        // the hyperboloid's orbit looks at it at the vertex
        if (model !== "h3" && v.picture.model !== "h3") expect(w.camera).toBe(v.camera);
        if (model === v.picture.model) expect(w).toBe(v);
        else if (model === "h3" || model === "hyperboloid") expect(w.picture).toEqual(HOME[model]);
        else {
          const want = Math.min(centreScale(v.picture), { poincare: 2 * MAX_S, klein: MAX_S, halfplane: 2 / MIN_MU, local: MAX_ELL, band: MAX_BAND_S }[model]);
          expect(centreScale(w.picture) / want).toBeCloseTo(1, 12);
        }
        expect(dist(worldAt(w, [0, 0])!, worldAt(v, [0, 0])!)).toBeLessThan(1e-12);
      }
    }
    const far: ViewState = { ...homeView(2), picture: { model: "local", ell: MAX_ELL } };
    expect(switchModel(far, "poincare", H).picture).toMatchObject({ s: MAX_S, sigma: 1 });
    expect(switchModel(far, "klein", H).picture).toMatchObject({ s: MAX_S, sigma: 1 });
  });
  it("homeView has the identity camera and colours", () => {
    expect(homeView(3).perm).toEqual(identityPerm(3));
  });
});

describe("zooming at the edge", () => {
  // the Klein disk at home is drawn at 0.8 of the screen's half-height, so a cursor beside its rim
  // is easily outside it; zooming there used to fly the camera onto the boundary (both disks)
  /** Just past the rim (2 px), well past it toward the lower right, and the far corner. */
  const outsideOf = (v: ViewState): Complex[] => {
    let lo = 0;
    let hi = 3;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (edgeDistance(v.picture, [0.6 * m, -0.8 * m]) <= 0) lo = m;
      else hi = m;
    }
    const r = lo + 4 / H;
    return [[0.6 * r, -0.8 * r], [0.6 * 1.3 * lo, -0.8 * 1.3 * lo], [1.6, 0.9]];
  };

  it("aims a zoom-in outside a disk at the point as far inside as the cursor is outside (at least the margin), toward the cursor", () => {
    for (const model of ["poincare", "klein"] as const) {
      const v = switchModel(homeView(2), model, H);
      for (const u0 of outsideOf(v)) {
        const a = zoomAnchor(v.picture, u0, H);
        const depth = Math.max(ANCHOR_MARGIN_PX, edgeDistance(v.picture, u0) * (H / 2));
        // the screen centre stands in when even it is not that far inside (the far corner)
        if (a[0] === 0 && a[1] === 0) expect(-edgeDistance(v.picture, a) * (H / 2)).toBeLessThan(depth);
        else expect(edgeDistance(v.picture, a) * (H / 2)).toBeCloseTo(-depth, 6);
        expect(a[0] * u0[1] - a[1] * u0[0]).toBeCloseTo(0, 12); // on the way from the centre to the cursor
      }
      const inside: Complex = [0.2, -0.3];
      expect(zoomAnchor(v.picture, inside, H)).toEqual(inside);
    }
  });

  it("grows a disk out to a cursor beside it within a few notches", () => {
    // with a stand-in only ANCHOR_MARGIN_PX inside, the rim crept toward the cursor by a few pixels a
    // notch: 10 notches from 60 px away in the Klein disk, 21 from 150 px, 40 and more from 300 px
    for (const [model, most] of [["klein", 5], ["poincare", 11]] as const)
      for (const start of [homeView(2, model), switchModel(homeView(2), model, H)])
        for (const px of [20, 60, 150, 300]) {
          const dir: Complex = [Math.cos(0.35), Math.sin(0.35)];
          let lo = 0;
          let hi = 3;
          for (let i = 0; i < 60; i++) {
            const m = (lo + hi) / 2;
            if (edgeDistance(start.picture, [dir[0] * m, dir[1] * m]) < 0) lo = m;
            else hi = m;
          }
          const u0: Complex = [dir[0] * (lo + (2 * px) / H), dir[1] * (lo + (2 * px) / H)];
          let v = start;
          let n = 0;
          for (; n < 40 && edgeDistance(v.picture, u0) * (H / 2) > -ANCHOR_MARGIN_PX; n++) v = zoomAt(v, u0, Math.SQRT2, H).view;
          expect(n).toBeLessThanOrEqual(most);
        }
  });

  it("reaches the zoom limit with the cursor outside, where the camera used to run off along the boundary", () => {
    for (const model of ["poincare", "klein"] as const)
      for (const u0 of outsideOf(switchModel(homeView(2), model, H))) {
        let v = switchModel(homeView(2), model, H);
        let limited = false;
        // the rim grows out toward the cursor first: up to 70 doublings for the far corner
        for (let i = 0; i < 100 && !limited; i++) {
          const z = zoomAt(v, u0, 2, H);
          limited = z.k < 2;
          v = settle(z.view, g73, parity);
        }
        // at the limit the screen centre resolves the plane; running off, its footprint grew without end
        expect(limited).toBe(true);
        expect(centreFootprint(v.picture) / minCentreFootprint(H)).toBeCloseTo(1, 6);
      }
  });

  it("the half-plane: a zoom-in below the boundary line does not fall toward it", () => {
    // the line has no far side to grow past the cursor, so the view slides toward it a little each
    // time at a steady scale, with the screen centre staying as far above the line
    let v = switchModel(homeView(2), "halfplane", H);
    const mu0 = (v.picture as HalfPlanePicture).mu;
    for (let i = 0; i < 40; i++) v = settle(zoomAt(v, [0.3, -5], 2, H).view, g73, parity);
    expect((v.picture as HalfPlanePicture).mu / mu0).toBeGreaterThan(0.25);
  });

  it("leaves zooms inside the picture exact, up to the margin", () => {
    const v = switchModel(homeView(2), "klein", H);
    let lo = 0;
    let hi = 2;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (edgeDistance(v.picture, [0.6 * m, -0.8 * m]) * (H / 2) <= -ANCHOR_MARGIN_PX) lo = m;
      else hi = m;
    }
    const u0: Complex = [0.6 * lo * 0.999, -0.8 * lo * 0.999];
    const before = worldAt(v, u0)!;
    const after = zoom(v, u0, 1.5);
    expect(dist(worldAt(after, u0)!, before) / unitAt(after, u0)).toBeLessThan(1e-6);
  });
});

describe("opening the Klein rim", () => {
  /** The Klein disk as a model switch shows it (s = MAX_S), and a point px pixels inside its rim at angle a. */
  const start = () => switchModel(homeView(2), "klein", H);
  const nearRim = (v: ViewState, a: number, px: number): Complex => {
    const rim = 1 / disk(v).s;
    return [(rim - (px * 2) / H) * Math.cos(a), (rim - (px * 2) / H) * Math.sin(a)];
  };
  /** r = sqrt(1 - |z|^2) at the point under u: the squash there is 1 / r. */
  const rAt = (v: ViewState, u: Complex) => Math.sqrt(kleinShift(disk(v), u, disk(v).s).pic.sigma);

  it("keeps the point under the cursor there while it opens the rim", () => {
    const r = rng(17);
    for (let trial = 0; trial < 20; trial++) {
      let v = start();
      const u0 = nearRim(v, r() * 2 * Math.PI, 10 + 40 * r());
      for (let i = 0; i < 40; i++) {
        const before = worldAt(v, u0)!;
        const z = zoomAt(v, u0, 1.1 + r(), H);
        v = z.view;
        if (z.k === 1) break;
        expect(dist(worldAt(v, u0)!, before) / unitAt(v, u0)).toBeLessThan(1e-6);
      }
    }
  });

  it("moves the picture smoothly: per 60 fps frame of the wheel's spring, no more than the zoom itself does", () => {
    // every frame, compare each screen point's new place with where the zoom alone (a scaling about
    // the cursor in the Klein disk) puts it: the opening may add at most 1.5 times the zoom's motion
    const A = 16 / 9;
    const grid: Complex[] = [];
    for (let i = -8; i <= 8; i++) for (let j = -5; j <= 5; j++) grid.push([(i / 8) * A * 0.97, (j / 5) * 0.97]);
    const r = rng(29);
    let frames = 0;
    for (let trial = 0; trial < 6; trial++) {
      let v = trial % 2 ? start() : homeView(2, "klein");
      const u0 = nearRim(v, r() * 2 * Math.PI, 12 + 60 * r());
      for (let notch = 0; notch < 8; notch++) {
        // controls.ts: a notch adds log 2 / 2, followed by the critically damped spring, OMEGA = 20
        let pos = 0;
        let vel = 0;
        const target = Math.LN2 / 2;
        for (let f = 0; f < 40; f++) {
          const e = pos - target;
          const d = Math.exp(-20 / 60);
          const e1 = (e + (vel + 20 * e) / 60) * d;
          vel = (vel - (20 * (vel + 20 * e)) / 60) * d;
          const k = Math.exp(target + e1 - pos);
          pos = target + e1;
          const z = zoomAt(v, u0, k, H);
          if (z.k === 1) continue;
          const a = zoomAnchor(v.picture, u0, H);
          for (const u of grid) {
            const p = worldAt(v, u);
            const want: Complex = [a[0] + (u[0] - a[0]) * z.k, a[1] + (u[1] - a[1]) * z.k];
            if (!p || Math.abs(want[0]) > A || Math.abs(want[1]) > 1) continue;
            const got = kleinScreenOf(disk(z.view), apply(inverse(z.view.camera), p))!;
            const zoomMotion = Math.hypot(u[0] - a[0], u[1] - a[1]) * (z.k - 1);
            expect(Math.hypot(got[0] - want[0], got[1] - want[1])).toBeLessThanOrEqual(1.5 * zoomMotion + 1e-9);
          }
          frames++;
          v = z.view;
        }
      }
    }
    expect(frames).toBeGreaterThan(500);
  });

  it("opens the cursor's region to the bound 1 - cbrt(s / KLEIN_OPEN_FROM), and on to the zoom limit", () => {
    let v = start();
    const u0 = nearRim(v, 0.4, 12);
    const r0 = rAt(v, u0);
    expect(r0).toBeLessThan(0.3);
    let last = r0;
    for (let i = 0; i < 120; i++) {
      const z = zoomAt(v, u0, Math.SQRT2, H);
      v = z.view;
      if (z.k === 1) break;
      const r1 = rAt(v, u0);
      // it only opens, at most by the rate per step, and never past the bound
      expect(r1).toBeGreaterThanOrEqual(last * (1 - 1e-9));
      expect(r1).toBeLessThanOrEqual(Math.max(last * Math.SQRT2 ** KLEIN_OPEN_RATE, kleinOpenBound(disk(v).s) * (1 + 1e-9), last * (1 + 1e-9)));
      // eight notches in (16 times) it has caught up with the bound, unless the zoom limit holds it
      if (i >= 8 && centreFootprint(v.picture) > 1.01 * minCentreFootprint(H)) expect(r1).toBeGreaterThanOrEqual(kleinOpenBound(disk(v).s) * (1 - 1e-9));
      last = r1;
    }
    expect(centreFootprint(v.picture) / minCentreFootprint(H)).toBeCloseTo(1, 6);
    expect(1 / Math.sqrt(disk(v).sigma)).toBeLessThan(1.2);
  });

  it("stays consistent through long wheel zooms at the rim and past it, frame by frame", () => {
    // The regression: rounding let |c|^2 + sigma drift from 1, and measuring the picture from the
    // cursor and back every frame grew the drift until the opening jittered and then a step failed,
    // which stopped the animation until the next input (most such runs at 144 frames a second on a
    // 1400 px canvas). Now, each frame: |c|^2 + sigma = 1 to rounding, the camera is a number, and
    // r at the zoom's anchor only grows, by at most the opening rate and never past the bound.
    let steps = 0;
    for (const height of [1000, 1400]) for (const fps of [60, 144]) for (const px of [-20, 0, 3]) for (const a of [0.35, 2.3, 4.6]) {
      let view = homeView(2, "klein");
      const host: ControlsHost = {
        view: () => view, setView: (v) => (view = v), height: () => height, symmetryAngle: () => 1,
        home() {}, back() {}, forward() {}, nextPreset() {}, cycle() {}, toggleGrid() {}, setModel() {}, wake() {},
      };
      const controls = new Controls(host, null as unknown as HTMLElement);
      const rim = 1 / disk(view).s - (2 * px) / height;
      const u0: Complex = [rim * Math.cos(a), rim * Math.sin(a)];
      const every = Math.round(fps / 10); // ten notches a second, fourteen of them
      for (let f = 0; f < 3 * fps; f++) {
        if (f % every === 0 && f < 14 * every) controls.zoomBy(Math.SQRT2, u0);
        const before = view;
        const anchor = zoomAnchor(before.picture, u0, height);
        controls.tick(1 / fps);
        const p = disk(view);
        expect(Math.abs(p.c[0] ** 2 + p.c[1] ** 2 + p.sigma - 1)).toBeLessThan(1e-14);
        expect(view.camera.every(Number.isFinite)).toBe(true);
        if (p.s < disk(before).s) {
          const r0 = rAt(before, anchor);
          const r1 = rAt(view, anchor);
          const k = disk(before).s / p.s;
          expect(r1).toBeGreaterThanOrEqual(r0 * (1 - 1e-9));
          expect(r1).toBeLessThanOrEqual(Math.max(r0, Math.min(kleinOpenBound(p.s), r0 * k ** KLEIN_OPEN_RATE)) * (1 + 1e-9));
          steps++;
        }
        view = settle(view, g73, parity);
      }
    }
    expect(steps).toBeGreaterThan(3000);
  });

  it("openKlein keeps s and the screen-centre point, with |c|^2 + sigma = 1", () => {
    const p: DiskPicture = { c: [0.97, 0.2], sigma: 1 - 0.97 ** 2 - 0.04, s: 0.01 };
    const o = openKlein(p, 0.6);
    expect(o.s).toBe(p.s);
    expect(o.c[0] * p.c[1] - o.c[1] * p.c[0]).toBeCloseTo(0, 15); // c only shrinks
    expect(o.c[0] ** 2 + o.c[1] ** 2 + o.sigma).toBeCloseTo(1, 14);
    expect(Math.sqrt(o.sigma)).toBeCloseTo(0.6, 14);
    const centre = (q: DiskPicture) => frameOf({ ...q, model: "klein" }, [0, 0])!.x;
    for (let j = 0; j < 3; j++) expect(centre(o)[j]).toBeCloseTo(centre(p)[j], 14);
    // already as open, nothing changes
    expect(openKlein(p, 0.1)).toBe(p);
  });

  it("kleinShift measures the same picture from another screen point", () => {
    const r = rng(5);
    for (let i = 0; i < 200; i++) {
      const depth = Math.exp(-20 * r());
      const a = 2 * Math.PI * r();
      const p: DiskPicture = { c: [Math.sqrt(1 - depth) * Math.cos(a), Math.sqrt(1 - depth) * Math.sin(a)], sigma: depth, s: depth * (0.1 + r()) };
      const pic = { ...p, model: "klein" as const };
      const v: Complex = [0.4 * (r() - 0.5), 0.4 * (r() - 0.5)];
      if (!frameOf(pic, v)) continue;
      const sh = kleinShift(p, v, p.s);
      const u: Complex = [r() - 0.5, r() - 0.5];
      const before = frameOf(pic, u);
      const after = frameOf({ ...sh.pic, model: "klein" }, [u[0] - v[0], u[1] - v[1]]);
      if (!before || !after) continue;
      expect(dist(apply(sh.N, after.x), before.x)).toBeLessThan(1e-9 * before.x[2]);
    }
  });
});
