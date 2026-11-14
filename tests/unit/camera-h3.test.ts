// Moving inside H3: home looks at the start point, walking and turning compose like camera moves,
// the eye's height stops at its limits and a zoom holds the ground under the cursor, a model switch
// keeps the screen centre's point, and the grid's reference scale is the nearest ground's.
import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import { ORIGIN, apply, dist, inverse, isometryError, type Vec3 } from "../../src/math/lorentz.ts";
import {
  H3_HOME, H3_MAX_H, H3_MAX_PITCH, H3_MIN_H, HOME, centreScale, frameOf, h3Frame, horizonAngle, pitchOf, referenceScale, tiltOf, tiltWith, type H3Picture,
  type Picture,
} from "../../src/math/views.ts";
import {
  MAX_S, PAN_REACH, WALK_PER_UNIT, homeView, look, lookDrag, panBy, rotateBy, switchModel, walk, worldAt, zoomAt, type ViewState,
} from "../../src/input/camera.ts";
import { eyeText } from "../../src/ui/readouts.ts";
import { gridLabels } from "../../src/ui/labels.ts";
import { rng } from "./rng.ts";

const H = 800;
const h3 = (v: ViewState) => v.picture as H3Picture & { model: "h3" };
/** The eye's foot point in the world. */
const foot = (v: ViewState): Vec3 => apply(v.camera, ORIGIN);
/** A world point in the view's frame (x right, y forward from the foot point). */
const inFrame = (v: ViewState, p: Vec3): Vec3 => apply(inverse(v.camera), p);
const ground = (d: number, azimuth: number): Vec3 => [Math.sinh(d) * Math.sin(azimuth), Math.sinh(d) * Math.cos(azimuth), Math.cosh(d)];

describe("home inside H3", () => {
  it("looks at the start point from H3_HOME, or from the eye it is given", () => {
    const v = homeView(2, "h3");
    expect(v.picture).toEqual(HOME.h3);
    expect(dist(worldAt(v, [0, 0])!, ORIGIN)).toBeLessThan(1e-12);
    // the foot point stands back from it, straight behind
    const back = inFrame(v, ORIGIN);
    expect(Math.abs(back[0])).toBeLessThan(1e-15);
    expect(back[1]).toBeGreaterThan(0.3);
    const w = homeView(2, "h3", { h: 1, pitch: 1.2, fov: 1.5 });
    expect(w.picture).toEqual({ model: "h3", h: 1, pitch: 1.2, fov: 1.5 });
    expect(dist(worldAt(w, [0, 0])!, ORIGIN)).toBeLessThan(1e-12);
    // the other views keep the identity camera
    expect(homeView(2, "klein").camera).toEqual(homeView(2).camera);
  });
});

describe("walking and turning inside H3", () => {
  it("walks 2 sinh h of the plane per screen unit, forward along the view, and back again", () => {
    for (const h of [0.01, 0.3, 2]) {
      const v = homeView(2, "h3", { ...H3_HOME, h });
      const w = walk(v, [0, 0.25]);
      expect(dist(foot(v), foot(w)) / (0.25 * WALK_PER_UNIT * Math.sinh(h)) - 1).toBeLessThan(1e-12);
      // straight ahead: the new foot point lies on the old view's forward line
      const ahead = inFrame(v, foot(w));
      expect(Math.abs(ahead[0])).toBeLessThan(1e-15);
      expect(ahead[1]).toBeGreaterThan(0);
      // and sideways to the right for d = (1, 0)
      expect(inFrame(v, foot(walk(v, [0.1, 0])))[0]).toBeGreaterThan(0);
      const back = walk(w, [0, -0.25]);
      for (let i = 0; i < 9; i++) expect(Math.abs(back.camera[i] - v.camera[i])).toBeLessThan(1e-14);
      expect(walk(v, [0, 0])).toBe(v);
    }
    // only inside H3
    const disk = homeView(2);
    expect(walk(disk, [0.3, 0.3])).toBe(disk);
    expect(look(disk, 0.3, 0.3)).toBe(disk);
  });
  it("turns right for a positive yaw, about the foot point, and tilts within its limits", () => {
    const v = walk(homeView(2, "h3"), [0.3, 0.2]);
    const t = 0.4;
    // the ground point t to the right of straight ahead comes to straight ahead
    const p = apply(v.camera, ground(0.7, t));
    const w = look(v, t, 0);
    const q = inFrame(w, p);
    expect(Math.abs(q[0])).toBeLessThan(1e-14);
    expect(q[1]).toBeGreaterThan(0);
    expect(dist(foot(w), foot(v))).toBeLessThan(1e-14);
    expect(isometryError(w.camera)).toBeLessThan(1e-14);
    // turning there and back, or by a full turn, is no turn
    const round = look(look(v, t, 0), -t, 0);
    for (let i = 0; i < 9; i++) expect(Math.abs(round.camera[i] - v.camera[i])).toBeLessThan(1e-14);
    // a positive pitch looks further down, stopping level and straight down
    expect(h3(look(v, 0, 0.1)).pitch).toBeCloseTo(h3(v).pitch + 0.1, 15);
    expect(h3(look(v, 0, -5)).pitch).toBe(0);
    expect(h3(look(v, 0, 5)).pitch).toBe(H3_MAX_PITCH);
    expect(look(v, 0, 0.1).camera).toBe(v.camera);
  });
  it("looks with a right-drag as a mouse look: half the field of view per screen unit", () => {
    const v = homeView(2, "h3");
    const k = h3(v).fov / 2;
    const w = lookDrag(v, [0.1, 0.1], [0.3, 0]);
    const want = look(v, 0.2 * k, 0.1 * k);
    for (let i = 0; i < 9; i++) expect(Math.abs(w.camera[i] - want.camera[i])).toBeLessThan(1e-15);
    expect(h3(w).pitch).toBeCloseTo(h3(want).pitch, 15);
    // dragging right turns right: what was right of the centre comes toward it
    const p = worldAt(v, [0.3, -0.2])!;
    expect(Math.abs(inFrame(w, p)[0])).toBeLessThan(Math.abs(inFrame(v, p)[0]));
  });
  it("pans by grabbing the ground and rotates about the foot point, like the other views", () => {
    const r = rng(12);
    let v = homeView(2, "h3");
    for (let i = 0; i < 300; i++) {
      const ua: Complex = [r() * 2 - 1, r() * 1.2 - 1];
      const ub: Complex = [ua[0] + (r() - 0.5) * 0.2, ua[1] + (r() - 0.5) * 0.2];
      const a = frameOf(v.picture, ua);
      const b = frameOf(v.picture, ub);
      if (!a || !b || a.x[2] > Math.cosh(PAN_REACH) || b.x[2] > Math.cosh(PAN_REACH)) continue;
      const before = worldAt(v, ua)!;
      const w = panBy(v, ua, ub);
      expect(dist(before, worldAt(w, ub)!) / frameOf(w.picture, ub)!.scale).toBeLessThan(1e-9);
      v = r() < 0.5 ? walk(w, [r() - 0.5, r() - 0.5]) : look(w, r() - 0.5, 0);
    }
    // a rotation keeps the foot point
    expect(dist(foot(rotateBy(v, 0.7)), foot(v))).toBeLessThan(1e-13);
  });
});

describe("the eye's height", () => {
  it("goes down by the zoom factor and stops at H3_MIN_H and H3_MAX_H", () => {
    let v = homeView(2, "h3");
    const z = zoomAt(v, [0, 0], 2, H);
    expect(h3(z.view).h).toBeCloseTo(0.15, 15);
    expect(z.k).toBeCloseTo(2, 15);
    for (let i = 0; i < 20; i++) v = zoomAt(v, [0, 0], 2, H).view;
    expect(h3(v).h).toBe(H3_MIN_H);
    expect(zoomAt(v, [0, 0], 2, H)).toEqual({ view: v, k: 1 });
    for (let i = 0; i < 20; i++) v = zoomAt(v, [0, 0], 0.5, H).view;
    expect(h3(v).h).toBe(H3_MAX_H);
    expect(zoomAt(v, [0, 0], 0.5, H).k).toBe(1);
    // the last step lands on the limit and reports the factor applied
    expect(zoomAt(homeView(2, "h3", { ...H3_HOME, h: 0.015 }), [0, 0], 2, H).k).toBeCloseTo(1.5, 12);
  });
  it("holds the ground under the cursor, and keeps the foot point where the cursor shows sky", () => {
    const r = rng(5);
    let held = 0;
    for (let i = 0; i < 400; i++) {
      const v = homeView(2, "h3", { h: 0.02 * 100 ** r(), pitch: r() * 1.4, fov: ((40 + 60 * r()) * Math.PI) / 180 });
      const u: Complex = [r() * 3 - 1.5, r() * 2 - 1];
      const k = r() < 0.5 ? 1.3 : 1 / 1.3;
      const before = frameOf(v.picture, u);
      const z = zoomAt(v, u, k, H);
      const after = frameOf(z.view.picture, u);
      if (!before) {
        expect(z.view.camera).toBe(v.camera);
        continue;
      }
      if (!after || before.x[2] > Math.cosh(PAN_REACH) || after.x[2] > Math.cosh(PAN_REACH)) {
        expect(z.view.camera).toBe(v.camera);
        continue;
      }
      expect(dist(worldAt(v, u)!, worldAt(z.view, u)!) / after.scale).toBeLessThan(1e-9);
      expect(isometryError(z.view.camera)).toBeLessThan(1e-11);
      held++;
    }
    expect(held).toBeGreaterThan(150);
  });
});

describe("the view tilts with the zoom", () => {
  const deg = (r: number) => (r * 180) / Math.PI;
  it("keeps the view's tilt: one to one with the pitch at every height, level and straight down kept", () => {
    const r = rng(17);
    for (let i = 0; i < 2000; i++) {
      const h = H3_MIN_H * (H3_MAX_H / H3_MIN_H) ** r();
      const pitch = r() * H3_MAX_PITCH;
      const c = tiltOf(pitch, h);
      // above the horizon (looking up from it) the tilt is in [-1, 0), below it positive
      expect(Math.sign(c)).toBe(Math.sign(pitch - horizonAngle(h)));
      expect(c).toBeGreaterThanOrEqual(-1);
      expect(pitchOf(c, h)).toBeCloseTo(pitch, 12);
      // a higher eye looks further down for the same tilt
      const up = pitchOf(c, h * 1.5);
      if (pitch > 0 && pitch < H3_MAX_PITCH && h * 1.5 <= H3_MAX_H) expect(up).toBeGreaterThan(pitch - 1e-15);
      expect(up).toBeLessThanOrEqual(H3_MAX_PITCH);
    }
    for (const h of [H3_MIN_H, 0.3, 2, H3_MAX_H]) {
      expect(tiltWith(H3_MAX_PITCH, 0.3, h)).toBe(H3_MAX_PITCH);
      expect(tiltWith(0, 0.3, h)).toBe(0);
      expect(tiltWith(horizonAngle(0.3), 0.3, h)).toBeCloseTo(horizonAngle(h), 14);
    }
  });
  it("looks further down as the eye rises: the design notes' table from home", () => {
    // the pitch, and the horizon's angle above the view's centre
    const want: [number, number, number][] = [[0.01, 14.08, 13.51], [0.1, 19.1, 13.38], [0.3, 30, 13.06], [1, 61.02, 11.41], [2, 82.41, 7.83], [3, 88.5, 4.2], [6, 90, 0.28]];
    for (const [h, d, above] of want) {
      const p = tiltWith(H3_HOME.pitch, H3_HOME.h, h);
      expect(deg(p)).toBeCloseTo(d, 2);
      expect(deg(p - horizonAngle(h))).toBeCloseTo(above, 2);
    }
  });
  it("tilts on every zoom, holds the ground under the cursor, and comes back to the pitch it left", () => {
    let v = homeView(2, "h3");
    const p0 = h3(v).pitch;
    // the wheel's steps out to the limit and back in to the start
    for (let i = 0; i < 40; i++) v = zoomAt(v, [0, 0], 0.85, H).view;
    expect(h3(v).h).toBe(H3_MAX_H);
    expect(deg(h3(v).pitch)).toBeGreaterThan(89.7);
    // from 6 R the ground is on the screen: the screen centre shows it
    expect(frameOf(v.picture, [0, 0])).not.toBeNull();
    for (let i = 0; i < 40 && h3(v).h > H3_HOME.h; i++) v = zoomAt(v, [0, 0], Math.min(1 / 0.85, h3(v).h / H3_HOME.h), H).view;
    expect(h3(v).h).toBeCloseTo(H3_HOME.h, 12);
    expect(h3(v).pitch).toBeCloseTo(p0, 12);
    // lowering the eye lifts the view
    const low = zoomAt(homeView(2, "h3"), [0.3, -0.4], 4, H).view;
    expect(h3(low).pitch).toBeLessThan(p0);
    expect(h3(low).pitch).toBeCloseTo(tiltWith(p0, H3_HOME.h, H3_HOME.h / 4), 15);
  });
});

describe("switching to and from the plane inside H3", () => {
  it("keeps the screen centre's point, and the eye it is given", () => {
    const r = rng(9);
    for (let i = 0; i < 40; i++) {
      let v = homeView(2, "poincare");
      v = zoomAt(panBy(v, [0, 0], [r() - 0.5, r() - 0.5]), [0, 0], 1 + 4 * r(), H).view;
      const centre = worldAt(v, [0, 0])!;
      const eye: H3Picture = { h: 0.05 + r(), pitch: 0.2 + r(), fov: 1 + r() * 0.5 };
      const inside = switchModel(v, "h3", H, undefined, eye);
      expect(inside.picture).toEqual({ model: "h3", ...eye });
      // (the centre may look at the sky when the eye is high: then the eye stands on the point)
      const at = worldAt(inside, [0, 0]);
      expect(dist(at ?? foot(inside), centre)).toBeLessThan(1e-12);
      const out = switchModel(inside, "poincare", H);
      expect(dist(worldAt(out, [0, 0])!, centre)).toBeLessThan(1e-12);
      // out of H3 with the centre's scale from the eye
      if (at) expect(centreScale(out.picture) / Math.min(2 * MAX_S, centreScale(inside.picture))).toBeCloseTo(1, 12);
    }
  });
});

describe("the grid's reference scale", () => {
  it("is the centre's in the other views, inside H3 the nearest ground's", () => {
    for (const m of ["poincare", "klein", "halfplane", "local", "band"] as const) expect(referenceScale(HOME[m])).toBe(centreScale(HOME[m]));
    const r = rng(3);
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const p: Picture = { model: "h3", h: 0.01 * 300 ** r(), pitch: r() * 1.5, fov: ((40 + 60 * r()) * Math.PI) / 180 };
      let least = Infinity;
      for (let x = -89; x <= 89; x++) for (let y = -50; y <= 50; y++) least = Math.min(least, h3Frame(p, [x / 50, y / 50])?.scale ?? Infinity);
      const ref = referenceScale(p);
      if (least === Infinity) continue;
      // within a few percent of the least on a 16:9 screen (sampled every 0.02, the bottom
      // centre too, so straight down may come out a little finer)
      expect(ref / least).toBeGreaterThan(0.98);
      expect(ref / least).toBeLessThan(1.05);
      n++;
    }
    expect(n).toBeGreaterThan(25);
    // all sky
    expect(referenceScale({ model: "h3", h: 6, pitch: 0, fov: (40 * Math.PI) / 180 })).toBe(Infinity);
  });
});

describe("the grid's labels inside H3", () => {
  const settings = { on: true, kind: "cartesian" as const, unit: "earth" as const };
  it("sit below the horizon, also when the centre looks at the sky, and are none when all is sky", () => {
    for (const pic of [{ h: 0.3, pitch: 0, fov: 1.2 }, { h: 0.3, pitch: 0.5, fov: 1.2 }, { h: 0.05, pitch: 0.2, fov: 1.6 }]) {
      const v = homeView(2, "h3", pic);
      const labels = gridLabels(settings, v.grids, v.picture, 1200, H, 1);
      expect(labels.length, JSON.stringify(pic)).toBeGreaterThanOrEqual(3);
      for (const l of labels) expect(frameOf(v.picture, [(l.x - 600) / (H / 2), (H / 2 - l.y) / (H / 2)])).not.toBeNull();
    }
    const sky = homeView(2, "h3", { h: 6, pitch: 0, fov: 0.7 });
    expect(gridLabels(settings, sky.grids, sky.picture, 1200, H, 1)).toEqual([]);
  });
});

describe("the eye's readout", () => {
  it("gives the height in R and km and the horizon below level", () => {
    const thin = (t: string) => t.replace(/ /g, " ");
    const e = eyeText(0.3, "earth");
    expect(thin(e.height)).toBe("0.300 R");
    expect(thin(e.detail)).toMatch(/^1 9\d\d km · horizon 16\.9° down$/);
    expect(eyeText(1, "R").detail).toBe(`horizon ${((horizonAngle(1) * 180) / Math.PI).toFixed(1)}° down`);
  });
});
