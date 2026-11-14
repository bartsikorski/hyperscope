import { describe, expect, it, vi } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import { dist } from "../../src/math/lorentz.ts";
import { frameOf, MODELS, VIEW_KEYS, type DiskPicture, type Model } from "../../src/math/views.ts";
import { centreFootprint, homeView, minCentreFootprint, worldAt, type ViewState } from "../../src/input/camera.ts";
import { Controls } from "../../src/input/controls.ts";

/** Controls driven by tick() alone, with a host that only keeps the view (no DOM). */
function rig(height = 800, el: unknown = null) {
  let view: ViewState = homeView(2);
  const host = {
    view: () => view,
    setView: (v: ViewState) => (view = v),
    height: () => height,
    symmetryAngle: () => (2 * Math.PI) / 7,
    home: () => (view = homeView(2)),
    back: () => {},
    forward: () => {},
    nextPreset: () => {},
    cycle: () => {},
    toggleGrid: () => {},
    setModel: () => {},
    wake: () => {},
  };
  const controls = new Controls(host, el as HTMLElement);
  const run = (dt = 1 / 60, max = 2000) => {
    let n = 0;
    while (controls.tick(dt) && n++ < max);
    return n;
  };
  return { controls, run, get view() { return view; }, get disk() { return view.picture as DiskPicture; } };
}

describe("zoom spring", () => {
  it("lands exactly on the requested factor and keeps the anchor point", () => {
    const r = rig();
    const u: Complex = [0.4, -0.2];
    const before = worldAt(r.view, u)!;
    r.controls.zoomBy(8, u);
    const frames = r.run();
    expect(frames).toBeGreaterThan(5); // it animates
    expect(frames).toBeLessThan(120); // and settles within two seconds at 60 fps
    expect(r.disk.s).toBeCloseTo((homeView(2).picture as DiskPicture).s / 8, 12);
    expect(dist(before, worldAt(r.view, u)!) / frameOf(r.view.picture, u)!.scale).toBeLessThan(1e-9);
  });
  it("does not depend on the frame rate", () => {
    const a = rig();
    const b = rig();
    a.controls.zoomBy(5, [0.1, 0.3]);
    b.controls.zoomBy(5, [0.1, 0.3]);
    a.run(1 / 30);
    b.run(1 / 144);
    expect(a.disk.s).toBeCloseTo(b.disk.s, 12);
  });
  it("drops the pending zoom at the limit, so zooming back out acts at once", () => {
    const r = rig(800);
    r.controls.zoomBy(1e9, [0, 0]);
    r.run();
    expect(centreFootprint(r.view.picture) / minCentreFootprint(800)).toBeCloseTo(1, 6);
    expect(r.controls.busy).toBe(false);
    r.controls.zoomBy(0.5, [0, 0]);
    r.run();
    expect(centreFootprint(r.view.picture) / minCentreFootprint(800)).toBeCloseTo(2, 6);
  });
});

describe("drag release", () => {
  /** A drag at 400 px/s on an 800 x 800 element, one move per frame (as browsers deliver them),
   *  released `rest` ms after the last move; returns the glide velocity in screen units per second. */
  function release(fps: number, rest: number, jitter = 0) {
    const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), setPointerCapture: () => {} };
    const { controls } = rig(800, el);
    const c = controls as unknown as Record<string, (e: Partial<PointerEvent>) => void> & { glide: { v: Complex } };
    const at = (t: number) => ({ pointerId: 1, button: 0, timeStamp: t, clientX: 200 + 0.4 * t, clientY: 400 });
    c.pointerDown(at(0));
    let t = 0;
    for (let i = 1; t < 400; i++) {
      t = (1000 * i) / fps + (i % 2 ? jitter : -jitter);
      c.pointerMove(at(t));
    }
    c.pointerUp({ ...at(t), timeStamp: t + rest });
    return c.glide.v;
  }

  it("glides at the pointer's speed whatever the frame rate", () => {
    for (const fps of [144, 60, 35, 30, 20, 15]) {
      for (const rest of [0, 1000 / fps, 50]) {
        const v = release(fps, rest, 0.2 * (1000 / fps));
        expect(v[0]).toBeGreaterThan(0.9); // 400 px/s over a half-height of 400 px: 1 unit/s
        expect(v[0]).toBeLessThan(1.1);
        expect(Math.abs(v[1])).toBeLessThan(1e-12);
      }
    }
  });

  it("does not glide when the pointer rested before release", () => {
    for (const fps of [60, 30]) expect(release(fps, 120)).toEqual([0, 0]);
  });
});

describe("view keys", () => {
  it("every view's number key chooses it, and no other digit does", () => {
    // the handler asks whether the key went to a text field: no DOM here, so no field classes either
    for (const name of ["HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement"]) vi.stubGlobal(name, class {});
    try {
      const chosen: Model[] = [];
      const { controls } = rig();
      (controls as unknown as { host: { setModel: (m: Model) => void } }).host.setModel = (m) => chosen.push(m);
      const press = (key: string) =>
        (controls as unknown as { keyDown: (e: Partial<KeyboardEvent>) => void }).keyDown({ key, target: null, preventDefault: () => {} });
      for (const m of MODELS) {
        press(VIEW_KEYS[m]);
        expect(chosen.at(-1)).toBe(m);
      }
      expect(chosen.length).toBe(MODELS.length);
      for (const key of ["0", "8", "9"]) press(key);
      expect(chosen.length).toBe(MODELS.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
