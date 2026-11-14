import { describe, expect, it } from "vitest";
import { centreFootprint, homeView, worldAt, type ViewState } from "../../src/input/camera.ts";
import { Controls } from "../../src/input/controls.ts";
import { BUTTONS, Gamepads, PAD_PAN, PAD_SPIN, PAD_ZOOM, readPad, shapeStick, shapeTrigger, STICK_DEAD, type PadButton, type PadLike } from "../../src/input/gamepad.ts";
import { ORIGIN, apply, dist, inverse } from "../../src/math/lorentz.ts";
import { tiltWith, type H3Picture, type HyperboloidPicture, type Model } from "../../src/math/views.ts";

/** A pad in the standard layout: sticks and triggers at rest, nothing pressed. */
function pad(over: { axes?: number[]; down?: PadButton[]; lt?: number; rt?: number; mapping?: string } = {}): PadLike {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const b of over.down ?? []) buttons[BUTTONS[b]] = { pressed: true, value: 1 };
  buttons[BUTTONS.lt].value = over.lt ?? 0;
  buttons[BUTTONS.rt].value = over.rt ?? 0;
  return { index: 0, mapping: over.mapping ?? "standard", axes: over.axes ?? [0, 0, 0, 0], buttons };
}

describe("sticks and triggers", () => {
  it("ignore a resting stick, start from 0 at the dead zone's edge and reach 1 at full deflection", () => {
    expect(shapeStick(0.1, -0.1)).toEqual([0, 0]);
    const edge = shapeStick(STICK_DEAD + 1e-9, 0);
    expect(Math.hypot(...edge)).toBeLessThan(1e-12);
    expect(shapeStick(1, 0)[0]).toBeCloseTo(1, 12);
    expect(shapeStick(0, -1)[1]).toBeCloseTo(-1, 12);
  });
  it("respond smoothly (squared) and keep the direction", () => {
    const half = shapeStick(0.6, 0.8 * 0); // length 0.6
    const t = (0.6 - STICK_DEAD) / (1 - STICK_DEAD);
    expect(half[0]).toBeCloseTo(t * t, 12);
    const d = shapeStick(0.3, 0.4);
    expect(d[1] / d[0]).toBeCloseTo(0.4 / 0.3, 12);
  });
  it("are never faster on a diagonal than straight", () => {
    // pads report up to about (1, 1) in the corners of a square gate
    for (const [x, y] of [[1, 1], [0.9, 0.9], [-1, 0.7]]) expect(Math.hypot(...shapeStick(x, y))).toBeLessThanOrEqual(1 + 1e-12);
  });
  it("triggers: a dead zone, then linear to 1", () => {
    expect(shapeTrigger(0.04)).toBe(0);
    expect(shapeTrigger(1)).toBe(1);
    expect(shapeTrigger(0.525)).toBeCloseTo(0.5, 12);
  });
});

describe("the standard layout", () => {
  it("left stick pans like W A S D, right stick and triggers rotate and zoom like Q E and + -", () => {
    const left = readPad(pad({ axes: [-1, 0, 0, 0] }), []).input;
    expect(left.pan[0]).toBeCloseTo(PAD_PAN, 12); // like A: the content moves right
    const up = readPad(pad({ axes: [0, -1, 0, 0] }), []).input;
    expect(up.pan[1]).toBeCloseTo(-PAD_PAN, 12); // like W
    expect(readPad(pad({ axes: [0, 0, 1, 0] }), []).input.turn).toBeLessThan(0); // like E
    expect(readPad(pad({ axes: [0, 0, 0, -1] }), []).input.zoom).toBeCloseTo(PAD_ZOOM, 12);
    expect(readPad(pad({ rt: 1 }), []).input.zoom).toBeCloseTo(PAD_ZOOM, 12);
    expect(readPad(pad({ lt: 1 }), []).input.zoom).toBeCloseTo(-PAD_ZOOM, 12);
    // stick and trigger together are not faster than either alone
    expect(readPad(pad({ axes: [0, 0, 0, -1], rt: 1 }), []).input.zoom).toBeCloseTo(PAD_ZOOM, 12);
    // inside H3 the triggers alone set the height and the right stick's up and down the tilt
    expect(readPad(pad({ rt: 1 }), []).input.pull).toBeCloseTo(PAD_ZOOM, 12);
    expect(readPad(pad({ axes: [0, 0, 0, -1] }), []).input.pull).toBe(0);
    expect(readPad(pad({ axes: [0, 0, 0, -1] }), []).input.tilt).toBeCloseTo(PAD_SPIN, 12);
  });
  it("reports a button once per press", () => {
    const pads = new Gamepads(() => [current]);
    let current = pad({ down: ["a"] });
    expect(pads.read().pressed).toEqual(["a"]);
    expect(pads.read().pressed).toEqual([]); // still held
    current = pad();
    expect(pads.read().pressed).toEqual([]);
    current = pad({ down: ["a", "up"] });
    expect(pads.read().pressed).toEqual(["a", "up"]);
  });
  it("does not report the triggers as presses, and ignores a pad without the standard layout", () => {
    const pads = new Gamepads(() => [pad({ down: ["lt", "rt"] })]);
    expect(pads.read().pressed).toEqual([]);
    const odd = new Gamepads(() => [pad({ axes: [1, 0, 0, 0], down: ["a"], mapping: "" })]);
    expect(odd.read()).toEqual({ pan: [0, 0], turn: 0, zoom: 0, pull: 0, tilt: 0, pressed: [] });
    expect(odd.connected).toBe(false);
  });
});

/** Controls with a scripted pad and a host that keeps the view and logs commands. */
function rig(source: () => PadLike[], start: ViewState = homeView(2)) {
  let view: ViewState = start;
  const log: string[] = [];
  const host = {
    view: () => view,
    setView: (v: ViewState) => (view = v),
    height: () => 800,
    symmetryAngle: () => (2 * Math.PI) / 7,
    home: () => log.push("home"),
    back: () => log.push("back"),
    forward: () => log.push("forward"),
    nextPreset: (s: number) => log.push(`preset ${s}`),
    cycle: (what: string, s: number) => log.push(`${what} ${s}`),
    toggleGrid: () => log.push("grid"),
    setModel: (m: Model) => log.push(`model ${m}`),
    dismiss: () => false,
    toggleInterface: () => log.push("interface"),
    wake: () => {},
  };
  const controls = new Controls(host, null as unknown as HTMLElement, new Gamepads(source));
  return { controls, log, get view() { return view; } };
}

describe("a controller in Controls", () => {
  it("moves the view by the same amount at 30 and 144 frames a second", () => {
    const stick = () => [pad({ axes: [0.7, -0.5, 0.4, -0.6] })];
    const a = rig(stick);
    const b = rig(stick);
    for (let i = 0; i < 30; i++) a.controls.tick(1 / 30);
    for (let i = 0; i < 144; i++) b.controls.tick(1 / 144);
    // pan, rotation and zoom do not commute exactly, so the two step sizes differ by second order
    const centre = (r: ReturnType<typeof rig>) => worldAt(r.view, [0, 0])!;
    expect(dist(centre(a), centre(b))).toBeLessThan(0.02);
    expect(centreFootprint(a.view.picture) / centreFootprint(b.view.picture)).toBeCloseTo(1, 6);
    expect(dist(centre(a), worldAt(homeView(2), [0, 0])!)).toBeGreaterThan(0.3);
  });
  it("keeps reading while a pad is connected, and rests once the sticks are let go", () => {
    let axes = [0, -1, 0, 0];
    const r = rig(() => [pad({ axes })]);
    expect(r.controls.tick(1 / 60)).toBe(true);
    expect(r.controls.busy).toBe(true);
    axes = [0.05, 0.05, 0, 0]; // inside the dead zone
    expect(r.controls.tick(1 / 60)).toBe(true); // still connected: read again next frame
    expect(r.controls.busy).toBe(false);
  });
  it("buttons: A next view, B back, X Y grid, D-pad presets and looks, L3 R3, Start, View", () => {
    let down: PadButton[] = [];
    const r = rig(() => [pad({ down })]);
    for (const b of ["a", "b", "x", "y", "up", "down", "left", "right", "l3", "r3", "start", "view"] as PadButton[]) {
      down = [b];
      r.controls.tick(1 / 60);
      down = [];
      r.controls.tick(1 / 60);
    }
    expect(r.log).toEqual([
      "model klein", "back", "grid", "grid 1", "preset 1", "preset -1", "look -1", "look 1",
      "palette 1", "colouring 1", "home", "interface",
    ]);
  });
  it("inside H3: the left stick walks, the right stick turns and tilts, the triggers set the height", () => {
    const home = homeView(2, "h3");
    const eye = (v: ViewState) => v.picture as H3Picture;
    const footOf = (v: ViewState) => apply(v.camera, ORIGIN);
    // forward: the foot point moves ahead of where it stood, straight along the view
    const walked = rig(() => [pad({ axes: [0, -1, 0, 0] })], home);
    for (let i = 0; i < 30; i++) walked.controls.tick(1 / 60);
    const ahead = apply(inverse(home.camera), footOf(walked.view));
    expect(ahead[1]).toBeGreaterThan(0.05);
    expect(Math.abs(ahead[0])).toBeLessThan(1e-12);
    expect(eye(walked.view)).toEqual(eye(home));
    // the right stick up looks up, right turns right (what was right of the centre comes to it)
    const tilted = rig(() => [pad({ axes: [0, 0, 0, -1] })], home);
    for (let i = 0; i < 10; i++) tilted.controls.tick(1 / 60);
    expect(eye(tilted.view).pitch).toBeLessThan(eye(home).pitch);
    expect(eye(tilted.view).h).toBe(eye(home).h);
    const p = worldAt(home, [0.4, -0.3])!;
    const turned = rig(() => [pad({ axes: [0, 0, 1, 0] })], home);
    for (let i = 0; i < 10; i++) turned.controls.tick(1 / 60);
    expect(Math.abs(apply(inverse(turned.view.camera), p)[0])).toBeLessThan(Math.abs(apply(inverse(home.camera), p)[0]));
    // the right trigger lowers the eye
    const lowered = rig(() => [pad({ rt: 1 })], home);
    for (let i = 0; i < 30; i++) lowered.controls.tick(1 / 60);
    expect(eye(lowered.view).h).toBeLessThan(eye(home).h * 0.8);
    // and lifts the view as it goes (the zoom's tilt)
    expect(eye(lowered.view).pitch).toBeCloseTo(tiltWith(eye(home).pitch, eye(home).h, eye(lowered.view).h), 12);
    expect(eye(lowered.view).pitch).toBeLessThan(eye(home).pitch);
  });
  it("on the hyperboloid: the right stick up raises the orbit, the triggers bring it nearer", () => {
    const home = homeView(2, "hyperboloid");
    const orbitOf = (v: ViewState) => v.picture as HyperboloidPicture;
    const raised = rig(() => [pad({ axes: [0, 0, 0, -1] })], home);
    for (let i = 0; i < 10; i++) raised.controls.tick(1 / 60);
    expect(orbitOf(raised.view).elevation).toBeGreaterThan(orbitOf(home).elevation);
    expect(orbitOf(raised.view).distance).toBe(orbitOf(home).distance);
    const nearer = rig(() => [pad({ rt: 1 })], home);
    for (let i = 0; i < 30; i++) nearer.controls.tick(1 / 60);
    expect(orbitOf(nearer.view).distance).toBeLessThan(orbitOf(home).distance * 0.8);
    expect(orbitOf(nearer.view).elevation).toBe(orbitOf(home).elevation);
  });
  it("LB and RB rotate by one symmetry step", () => {
    let down: PadButton[] = ["lb"];
    const r = rig(() => [pad({ down })]);
    r.controls.tick(1 / 60);
    down = ["lb", "rb"]; // RB pressed while LB is held: one step back
    r.controls.tick(1 / 60);
    expect(dist(worldAt(r.view, [0.3, 0.1])!, worldAt(homeView(2), [0.3, 0.1])!)).toBeLessThan(1e-12);
  });
});
