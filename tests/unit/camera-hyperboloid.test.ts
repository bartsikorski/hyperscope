// Moving on the hyperboloid: home looks at the start point at the vertex, a model switch keeps the
// screen centre's point there (both ways, and through H3), the orbit turns and raises the camera,
// a zoom changes its distance and holds the point under the cursor, and the camera never ends
// within HB_WALL_GAP of the surface: it passes through, or stops short where the limits leave no
// room beyond. The HUD and the controls follow.
import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import { ORIGIN, apply, dist, inverse } from "../../src/math/lorentz.ts";
import {
  HB_HOME, HB_MAX_DISTANCE, HB_MAX_ELEVATION, HB_MIN_DISTANCE, HB_MIN_ELEVATION, HOME, MODELS, frameOf, hyperboloidGap, type HyperboloidPicture,
} from "../../src/math/views.ts";
import {
  HB_WALL_GAP, ORBIT_PER_UNIT, PAN_REACH, clearWall, homeView, orbit, orbitDrag, panBy, settle, switchModel, worldAt, zoomAt, type ViewState,
} from "../../src/input/camera.ts";
import { Controls } from "../../src/input/controls.ts";
import { parity } from "../../src/math/colourings.ts";
import { triangleGroup } from "../../src/math/groups.ts";
import { rng } from "./rng.ts";

const H = 800;
const g73 = triangleGroup(7, 3, 2);
const deg = Math.PI / 180;
const hb = (v: ViewState) => v.picture as HyperboloidPicture & { model: "hyperboloid" };
const withOrbit = (v: ViewState, p: HyperboloidPicture): ViewState => ({ ...v, picture: { model: "hyperboloid", ...p } });
/** The orbit distance at which the camera at elevation e crosses the upper sheet's wall (C = 0). */
const wallAt = (e: number) => (2 * Math.sin(e)) / Math.cos(2 * e);
const clear = (p: HyperboloidPicture) => Math.abs(hyperboloidGap(p)) >= HB_WALL_GAP;

describe("home on the hyperboloid", () => {
  it("looks at the start point at the vertex, from HB_HOME or the orbit it is given, inside the bowl", () => {
    const v = homeView(2, "hyperboloid");
    expect(v.picture).toEqual(HOME.hyperboloid);
    expect(v.camera).toEqual(homeView(2).camera);
    expect(dist(worldAt(v, [0, 0])!, ORIGIN)).toBeLessThan(1e-12);
    expect(hyperboloidGap(HB_HOME)).toBeGreaterThan(HB_WALL_GAP);
    const o: HyperboloidPicture = { elevation: -0.4, distance: 7, fov: 1.2 };
    expect(homeView(2, "hyperboloid", undefined, o).picture).toEqual({ model: "hyperboloid", ...o });
  });
});

describe("switching to and from the hyperboloid", () => {
  it("keeps the screen centre's point at the vertex, and the orbit it is given", () => {
    const r = rng(61);
    for (let n = 0; n < 40; n++) {
      let v = homeView(2, MODELS[n % MODELS.length]);
      for (let i = 0; i < 3; i++) v = settle(panBy(v, [0.1, 0.1], [r() - 0.5, r() - 0.5]), g73, parity);
      if (v.picture.model === "hyperboloid") continue;
      const centre = worldAt(v, [0, 0]);
      if (!centre) continue;
      const o: HyperboloidPicture = { elevation: (50 + 30 * r()) * deg, distance: 2 + 3 * r(), fov: (40 + 60 * r()) * deg };
      const on = switchModel(v, "hyperboloid", H, undefined, undefined, o);
      expect(on.picture).toEqual({ model: "hyperboloid", ...o });
      // the vertex is the frame's origin
      expect(dist(apply(on.camera, ORIGIN), centre)).toBeLessThan(1e-9);
      expect(dist(worldAt(on, [0, 0])!, centre)).toBeLessThan(1e-9);
      // and back out: the vertex at the new view's screen centre
      for (const model of MODELS.filter((m) => m !== "hyperboloid")) {
        const off = switchModel(on, model, H);
        expect(off.picture.model).toBe(model);
        expect(dist(worldAt(off, [0, 0])!, centre), model).toBeLessThan(1e-9);
      }
    }
  });
});

describe("the orbit", () => {
  it("turns the tiling about the vertex, its near side to the right for a positive yaw", () => {
    const v = homeView(2, "hyperboloid");
    const near = worldAt(v, [0, -0.6])!;
    const w = orbit(v, 0.2, 0);
    expect(w.picture).toEqual(v.picture);
    // the vertex stays, and the near point now lies right of the screen's vertical
    expect(dist(apply(w.camera, ORIGIN), ORIGIN)).toBeLessThan(1e-15);
    expect(apply(inverse(w.camera), near)[0]).toBeGreaterThan(0.05);
    expect(dist(worldAt(orbit(w, -0.2, 0), [0.3, -0.2])!, worldAt(v, [0.3, -0.2])!)).toBeLessThan(1e-12);
  });
  it("raises the camera with a drag down, ORBIT_PER_UNIT per unit of u, within its limits", () => {
    const v = homeView(2, "hyperboloid");
    const up = orbitDrag(v, [0, 0], [0, -0.1]);
    expect(hb(up).elevation - HB_HOME.elevation).toBeCloseTo(0.1 * ORBIT_PER_UNIT, 12);
    expect(hb(up).distance).toBe(HB_HOME.distance);
    const turned = orbitDrag(v, [0, 0], [0.1, 0]);
    expect(dist(apply(inverse(turned.camera), worldAt(v, [0, -0.6])!), apply(inverse(orbit(v, 0.1 * ORBIT_PER_UNIT, 0).camera), worldAt(v, [0, -0.6])!))).toBeLessThan(1e-15);
    let top = v;
    let bottom = v;
    for (let i = 0; i < 20; i++) {
      top = orbit(top, 0, 0.3);
      bottom = orbit(bottom, 0, -0.3);
    }
    expect(hb(top).elevation).toBe(HB_MAX_ELEVATION);
    expect(hb(bottom).elevation).toBe(HB_MIN_ELEVATION);
    // (only on the hyperboloid)
    const disk = homeView(2);
    expect(orbit(disk, 0.3, 0.3)).toBe(disk);
  });
});

describe("the orbit's distance", () => {
  it("changes by the zoom factor between 1.5 and 40 R, holding the point under the cursor", () => {
    const r = rng(62);
    let v = homeView(2, "hyperboloid");
    let held = 0;
    for (let n = 0; n < 300; n++) {
      const u: Complex = [r() * 2.4 - 1.2, r() * 1.6 - 0.8];
      const k = r() < 0.5 ? 1.6 : 1 / 1.6;
      const before = frameOf(v.picture, u);
      const z = zoomAt(v, u, k, H);
      const after = frameOf(z.view.picture, u);
      expect(hb(z.view).distance).toBeGreaterThanOrEqual(HB_MIN_DISTANCE);
      expect(hb(z.view).distance).toBeLessThanOrEqual(HB_MAX_DISTANCE);
      expect(clear(hb(z.view))).toBe(true);
      if (z.k !== 1) expect(hb(z.view).distance).toBeCloseTo(hb(v).distance / z.k, 12);
      const far = Math.cosh(PAN_REACH);
      if (before && after && before.x[2] <= far && after.x[2] <= far && z.k !== 1) {
        // to 1e-9 of a screen unit
        expect(dist(apply(v.camera, before.x), apply(z.view.camera, after.x)) / after.scale).toBeLessThan(1e-9);
        held++;
      }
      v = settle(r() < 0.3 ? orbit(z.view, r() - 0.5, r() - 0.5) : z.view, g73, parity);
    }
    expect(held).toBeGreaterThan(100);
    let near = homeView(2, "hyperboloid");
    for (let i = 0; i < 10; i++) near = zoomAt(near, [0, 0], 2, H).view;
    expect(hb(near).distance).toBe(HB_MIN_DISTANCE);
    expect(zoomAt(near, [0, 0], 2, H).k).toBe(1);
  });
});

describe("the wall", () => {
  it("passes the camera through the surface in one step, to as far beyond as it was kept from it", () => {
    const e = 30 * deg; // the wall at D = 2
    expect(wallAt(e)).toBeCloseTo(2, 12);
    for (const [from, to] of [[3, 2.01], [3, 1.99], [1.6, 2.02], [1.6, 1.98]]) {
      const p = clearWall({ elevation: e, distance: from, fov: 1 }, "distance", to, [HB_MIN_DISTANCE, HB_MAX_DISTANCE]);
      expect(clear(p)).toBe(true);
      // on the far side of the wall from where it started, just past the edge of the gap
      expect(Math.sign(hyperboloidGap(p))).not.toBe(Math.sign(hyperboloidGap({ elevation: e, distance: from, fov: 1 })));
      expect(Math.abs(hyperboloidGap(p)) / HB_WALL_GAP - 1).toBeLessThan(1e-9);
    }
    // an orbit across it, at D = 2.5: the wall at about 32.7 degrees
    const v = withOrbit(homeView(2), { elevation: 40 * deg, distance: 2.5, fov: 1 });
    let w = v;
    for (let i = 0; i < 40; i++) {
      w = orbit(w, 0, -0.5 * deg);
      expect(clear(hb(w))).toBe(true);
    }
    expect(hyperboloidGap(hb(w))).toBeLessThan(0);
  });
  it("stops short where the limits leave no room beyond", () => {
    // the elevation whose wall lies just inside the far limit: going out cannot pass it
    let lo = 30 * deg;
    let hi = 45 * deg;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (wallAt(mid) < HB_MAX_DISTANCE - 0.01) lo = mid;
      else hi = mid;
    }
    const p = clearWall({ elevation: lo, distance: 20, fov: 1 }, "distance", HB_MAX_DISTANCE, [HB_MIN_DISTANCE, HB_MAX_DISTANCE]);
    expect(clear(p)).toBe(true);
    expect(hyperboloidGap(p)).toBeGreaterThan(0);
    expect(p.distance).toBeLessThan(HB_MAX_DISTANCE - 0.01);
    expect(hyperboloidGap(p) / HB_WALL_GAP - 1).toBeLessThan(1e-9);
  });
  it("keeps every orbit and zoom of a long random walk clear of it", () => {
    const r = rng(63);
    let v = homeView(2, "hyperboloid");
    let sides = 0;
    let last = Math.sign(hyperboloidGap(hb(v)));
    for (let n = 0; n < 2000; n++) {
      const step = r();
      v = step < 0.5 ? zoomAt(v, [r() - 0.5, r() - 0.5], Math.exp((r() - 0.5) * 1.5), H).view : orbit(v, r() - 0.5, (r() - 0.5) * 0.6);
      expect(clear(hb(v))).toBe(true);
      const side = Math.sign(hyperboloidGap(hb(v)));
      if (side !== last) sides++;
      last = side;
    }
    expect(sides).toBeGreaterThan(20);
  });
});

describe("controls on the hyperboloid", () => {
  /** Controls on an 800 x 800 element over the given view. */
  function rig(start: ViewState) {
    let view = start;
    const host = {
      view: () => view,
      setView: (v: ViewState) => (view = v),
      height: () => H,
      symmetryAngle: () => (2 * Math.PI) / 7,
      home: () => {},
      back: () => {},
      forward: () => {},
      nextPreset: () => {},
      cycle: () => {},
      toggleGrid: () => {},
      setModel: () => {},
      wake: () => {},
    };
    const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), setPointerCapture: () => {} };
    return { controls: new Controls(host, el as unknown as HTMLElement), get view() { return view; } };
  }
  /** A right-drag of dy pixels down on an 800 x 800 element, then released while still moving. */
  function rightDrag(dx: number, dy: number) {
    const r = rig(homeView(2, "hyperboloid"));
    const c = r.controls as unknown as Record<string, (e: Partial<PointerEvent>) => void> & { glide: { v: Complex }; spin: number };
    const at = (t: number) => ({ pointerId: 1, button: 2, timeStamp: t, clientX: 400 + (dx * t) / 100, clientY: 400 + (dy * t) / 100 });
    c.pointerDown(at(0));
    for (let t = 10; t <= 100; t += 10) c.pointerMove(at(t));
    c.pointerUp(at(100));
    return { view: r.view, glide: c.glide.v, spin: c.spin };
  }
  it("a wheel zoom through the surface carries on to where it was going", () => {
    // at 30 degrees the wall is 2 R from the vertex: 3 R out, a zoom of 1.5 lands on 2 R
    const r = rig(withOrbit(homeView(2), { elevation: 30 * deg, distance: 3, fov: 1 }));
    r.controls.zoomBy(1.5, [0, 0]);
    let n = 0;
    let crossed = false;
    while (r.controls.tick(1 / 60) && n++ < 600) {
      expect(clear(hb(r.view))).toBe(true);
      crossed ||= hyperboloidGap(hb(r.view)) > 0;
    }
    expect(crossed).toBe(true);
    // a little past 2 R: the spring's last steps, after the jump of 0.1 R through the wall
    expect(hb(r.view).distance).toBeLessThan(2 - HB_WALL_GAP);
  });
  it("right-drag down raises the orbit, sideways turns the tiling, and neither keeps momentum", () => {
    const down = rightDrag(0, 40); // 40 px of a 400 px half-height: 0.1 of u
    expect(hb(down.view).elevation - HB_HOME.elevation).toBeCloseTo(0.1 * ORBIT_PER_UNIT, 9);
    expect(down.spin).toBe(0);
    expect(down.glide).toEqual([0, 0]);
    const side = rightDrag(40, 0);
    expect(hb(side.view).elevation).toBe(HB_HOME.elevation);
    const want = orbit(homeView(2, "hyperboloid"), 0.1 * ORBIT_PER_UNIT, 0);
    for (let i = 0; i < 9; i++) expect(Math.abs(side.view.camera[i] - want.camera[i])).toBeLessThan(1e-12);
    expect(side.spin).toBe(0);
  });
});
