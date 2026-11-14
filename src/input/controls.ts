// Mouse, touch, keyboard and game controllers -> camera moves. Every move is an exact isometry, so
// the point you grab stays under the cursor; zooms ride a critically damped spring and drags glide
// when released, both after mandelscope (MIT); the spring as in T. Lowe, Game Programming Gems 4
// (2004). The host re-centers and stores each new view.

import type { Complex } from "../math/complex.ts";
import type { Model } from "../math/views.ts";
import { MODELS, VIEW_KEYS } from "../math/views.ts";
import type { ViewState } from "./camera.ts";
import { look, lookDrag, orbit, orbitDrag, panBy, rotateBy, rotateDrag, walk, zoomAt } from "./camera.ts";
import type { PadButton } from "./gamepad.ts";
import { Gamepads } from "./gamepad.ts";

export interface ControlsHost {
  view(): ViewState;
  setView(v: ViewState): void;
  /** Canvas height in device pixels (the zoom-in limit depends on it). */
  height(): number;
  /** The content's zoom-in limit, plane length per device pixel (camera.ts MIN_FOOTPRINT when left out). */
  minFootprint?(): number;
  /** Rotation angle of one tiling symmetry step, 2 pi / p. */
  symmetryAngle(): number;
  home(): void;
  /** Back and forward through the history of views (Backspace, Shift+Backspace). */
  back(): void;
  forward(): void;
  nextPreset(step: 1 | -1): void;
  /** Next or previous look (L, or . and ,), palette (P) or colouring (K), grid type (T) or size of R
   *  (U), or Wythoff construction (O). */
  cycle(what: "look" | "palette" | "colouring" | "grid" | "unit" | "construction" | "motif", step: 1 | -1): void;
  /** Unit grid on or off (G). */
  toggleGrid(): void;
  /** Switch the view to another model of the plane (keys 1 to 4). */
  setModel(model: Model): void;
  /** Close the help or a panel (a controller's B); false when nothing was open. */
  dismiss?(): boolean;
  /** Hide or show the interface (a controller's View button). */
  toggleInterface?(): void;
  /** A short note for the user (a controller connected). */
  notice?(text: string): void;
  /** Controller input: the interface wakes as for the pointer and keys. */
  activity?(): void;
  /** Ask for animation frames until tick() returns false. */
  wake(): void;
}

/** True for a text field, a list or an editable element: keys typed there are not commands. */
export function isField(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}

/** Spring stiffness, 1/s (mandelscope's zoom spring). */
const OMEGA = 20;
/** Glide decay rate, 1/s; the window of drag motion before the last move that sets the release
 *  velocity (moves come once per frame, so it starts at the last move before the window); a
 *  pointer that rested longer than REST_MS before release does not glide. */
const GLIDE_DECAY = 4;
const GLIDE_WINDOW_MS = 50;
const REST_MS = 80;
/** Wheel: zoom factor 2 per 200 units of deltaY (about 1.4 per notch); Ctrl is 5 times finer. */
const WHEEL_LOG_PER_UNIT = Math.LN2 / 200;
/** Held keys: pan speed in screen units per second, rotation in radians per second. */
const KEY_PAN = 0.8;
const KEY_SPIN = 1.2;

interface Sample {
  t: number;
  u: Complex;
}

export class Controls {
  private zoom = { target: 0, pos: 0, vel: 0, anchor: [0, 0] as Complex };
  private glide = { v: [0, 0] as Complex, at: [0, 0] as Complex };
  private spin = 0;
  private bring: { from: Complex; t: number } | null = null;
  /** Held motion keys -> the time (ms) up to which their motion has been counted. */
  private held = new Map<string, number>();
  /** Seconds of motion each key is owed, so a press shorter than a frame still moves the view. */
  private owed = new Map<string, number>();
  private drag: { mode: "pan" | "rotate"; last: Complex; samples: Sample[] } | null = null;
  private pointers = new Map<number, Complex>();
  private cursor: Complex = [0, 0];
  private pads: Gamepads;
  /** A controller's stick or trigger moved the view in the last tick. */
  private padMoving = false;
  private host: ControlsHost;
  private el: HTMLElement;

  constructor(host: ControlsHost, el: HTMLElement, pads = new Gamepads()) {
    this.host = host;
    this.el = el;
    this.pads = pads;
  }

  /** Screen coordinates u of a client position: centred, y up, vertical extent +-1. */
  toU(clientX: number, clientY: number): Complex {
    const r = this.el.getBoundingClientRect();
    const h = r.height / 2;
    return [(clientX - r.left - r.width / 2) / h, (r.top + r.height / 2 - clientY) / h];
  }

  /** Start a spring zoom by `factor` about u (adds to a zoom already under way). */
  zoomBy(factor: number, u: Complex): void {
    this.zoom.anchor = u;
    this.zoom.target += Math.log(factor);
    this.host.wake();
  }

  /** True while a spring, glide or held key still moves the view. */
  get busy(): boolean {
    const z = this.zoom;
    return Math.abs(z.target - z.pos) > 0 || Math.abs(z.vel) > 0 || this.glide.v[0] !== 0 || this.glide.v[1] !== 0 ||
      this.spin !== 0 || this.bring !== null || this.held.size > 0 || this.owed.size > 0 || this.padMoving;
  }

  /** Advance springs, glides, held keys and controllers by dt seconds. Returns true while anything
   *  moves or a controller is connected (the Gamepad API has to be read every frame). */
  tick(dt: number): boolean {
    // a controller's buttons first: they may jump to another view, which the moves then start from
    const pad = this.pads.read();
    for (const b of pad.pressed) this.padButton(b);
    let v = this.host.view();
    const start = v;
    // zoom spring on log(scale): critically damped, solved exactly over the step
    const z = this.zoom;
    if (z.target !== z.pos || z.vel !== 0) {
      const e = z.pos - z.target;
      const decay = Math.exp(-OMEGA * dt);
      let e1 = (e + (z.vel + OMEGA * e) * dt) * decay;
      let v1 = (z.vel - OMEGA * (z.vel + OMEGA * e) * dt) * decay;
      if (Math.abs(e1) < 1e-4 && Math.abs(v1) < 1e-3) e1 = v1 = 0;
      const next = z.target + e1;
      const k = Math.exp(next - z.pos);
      const zoomed = zoomAt(v, z.anchor, k, this.host.height(), this.host.minFootprint?.());
      z.pos = next;
      z.vel = v1;
      // settled, or at a zoom limit (less applied than asked): drop what is still pending, so turning
      // the wheel back acts at once; a step that went further (the hyperboloid's camera passing
      // through the surface in one step) carries on
      if (e1 === 0 || Math.abs(Math.log(zoomed.k)) < Math.abs(Math.log(k)) - 1e-9) z.target = z.pos = z.vel = 0;
      v = zoomed.view;
    }
    // pan glide
    const g = this.glide;
    if (g.v[0] !== 0 || g.v[1] !== 0) {
      const to: Complex = [g.at[0] + g.v[0] * dt, g.at[1] + g.v[1] * dt];
      v = panBy(v, g.at, to);
      const f = Math.exp(-GLIDE_DECAY * dt);
      g.v = [g.v[0] * f, g.v[1] * f];
      if (Math.hypot(...g.v) < 2e-3) g.v = [0, 0];
    }
    if (this.spin !== 0) {
      v = rotateBy(v, this.spin * dt);
      this.spin *= Math.exp(-GLIDE_DECAY * dt);
      if (Math.abs(this.spin) < 2e-3) this.spin = 0;
    }
    // bring a point to the centre, eased over 0.35 s
    if (this.bring) {
      const b = this.bring;
      const ease = (t: number) => 1 - (1 - t) ** 3;
      const t1 = Math.min(1, b.t + dt / 0.35);
      const at = (t: number): Complex => [b.from[0] * (1 - ease(t)), b.from[1] * (1 - ease(t))];
      v = panBy(v, at(b.t), at(t1));
      b.t = t1;
      if (t1 >= 1) this.bring = null;
    }
    // held keys, by the time each was actually down
    const now = performance.now();
    for (const key of this.held.keys()) this.account(key, now);
    const secs = (...keys: string[]) => keys.reduce((sum, k) => sum + (this.owed.get(k) ?? 0), 0);
    const pan: Complex = [
      (secs("a", "arrowleft") - secs("d", "arrowright")) * KEY_PAN,
      (secs("s", "arrowdown") - secs("w", "arrowup")) * KEY_PAN,
    ];
    const inside = v.picture.model === "h3";
    // inside H3 the keys walk the eye (W forward) and turn it (Q left); elsewhere they pan and rotate
    if (pan[0] !== 0 || pan[1] !== 0) v = inside ? walk(v, [-pan[0], -pan[1]]) : panBy(v, [0, 0], pan);
    const turn = (secs("q") - secs("e")) * KEY_SPIN;
    if (turn !== 0) v = inside ? look(v, -turn, 0) : rotateBy(v, turn);
    this.owed.clear();
    // a controller's sticks and triggers, as rates over the step
    this.padMoving = pad.pan[0] !== 0 || pad.pan[1] !== 0 || pad.turn !== 0 || pad.zoom !== 0 || pad.tilt !== 0;
    if (this.padMoving) {
      this.host.activity?.();
      // inside H3: the left stick walks, the right stick turns and looks up and down, the triggers
      // change the height; on the hyperboloid the right stick's y raises and lowers the orbit and
      // the triggers change its distance; elsewhere the right stick's y zooms with them
      const inH3 = v.picture.model === "h3";
      const onHb = v.picture.model === "hyperboloid";
      const zoom = inH3 || onHb ? pad.pull : pad.zoom;
      if (pad.pan[0] !== 0 || pad.pan[1] !== 0) v = inH3 ? walk(v, [-pad.pan[0] * dt, -pad.pan[1] * dt]) : panBy(v, [0, 0], [pad.pan[0] * dt, pad.pan[1] * dt]);
      if (pad.turn !== 0) v = inH3 ? look(v, -pad.turn * dt, 0) : rotateBy(v, pad.turn * dt);
      if (inH3 && pad.tilt !== 0) v = look(v, 0, -pad.tilt * dt);
      if (onHb && pad.tilt !== 0) v = orbit(v, 0, pad.tilt * dt);
      if (zoom !== 0) v = zoomAt(v, [0, 0], Math.exp(zoom * dt), this.host.height(), this.host.minFootprint?.()).view;
    }
    if (v !== start) this.host.setView(v);
    return this.busy || this.pads.connected;
  }

  /** A controller button, on its press (design notes, "After version 1: game controller"). */
  private padButton(b: PadButton): void {
    const h = this.host;
    h.activity?.();
    switch (b) {
      case "a": {
        this.stop();
        h.setModel(MODELS[(MODELS.indexOf(h.view().picture.model) + 1) % MODELS.length]);
        break;
      }
      case "b":
        if (!h.dismiss?.()) {
          this.stop();
          h.back();
        }
        break;
      case "x": h.toggleGrid(); break;
      case "y": h.cycle("grid", 1); break;
      case "lb": this.apply(rotateBy(h.view(), h.symmetryAngle())); break;
      case "rb": this.apply(rotateBy(h.view(), -h.symmetryAngle())); break;
      case "up": h.nextPreset(1); break;
      case "down": h.nextPreset(-1); break;
      case "left": h.cycle("look", -1); break;
      case "right": h.cycle("look", 1); break;
      case "l3": h.cycle("palette", 1); break;
      case "r3": h.cycle("colouring", 1); break;
      case "start": this.stop(); h.home(); break;
      case "view": h.toggleInterface?.(); break;
    }
  }

  /** Add the time since `key` was last counted to what it is owed (at most a second per frame). */
  private account(key: string, now: number): void {
    const since = this.held.get(key);
    if (since === undefined) return;
    this.owed.set(key, Math.min(1, (this.owed.get(key) ?? 0) + (now - since) / 1000));
    this.held.set(key, now);
  }

  /** Drop running springs, glides and the bring-to-centre (before a jump to another view). */
  stop(): void {
    this.zoom = { target: 0, pos: 0, vel: 0, anchor: [0, 0] };
    this.glide.v = [0, 0];
    this.spin = 0;
    this.bring = null;
  }

  private apply(v: ViewState): void {
    this.host.setView(v);
  }

  /** Listen on the element and the window; returns a function that removes the listeners. */
  attach(): () => void {
    const el = this.el;
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(t, f as EventListener, o);
      return () => el.removeEventListener(t, f as EventListener, o);
    };
    const onWin = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(t, f as EventListener);
      return () => window.removeEventListener(t, f as EventListener);
    };
    const off = [
      on("pointerdown", (e) => this.pointerDown(e)),
      on("pointermove", (e) => this.pointerMove(e)),
      on("pointerup", (e) => this.pointerUp(e)),
      on("pointercancel", (e) => this.pointerUp(e)),
      on("wheel", (e) => this.wheel(e), { passive: false }),
      on("dblclick", (e) => this.zoomBy(4, this.toU(e.clientX, e.clientY))),
      on("contextmenu", (e) => e.preventDefault()),
      onWin("keydown", (e) => this.keyDown(e)),
      onWin("keyup", (e) => {
        const key = e.key.toLowerCase();
        this.account(key, performance.now());
        this.held.delete(key);
        this.host.wake();
      }),
      onWin("blur", () => this.held.clear()),
      // pads show up after their first button press; from then on tick() reads them every frame
      onWin("gamepadconnected", (e) => {
        const usable = e.gamepad.mapping === "standard";
        this.host.notice?.(usable ? "Controller connected" : "Controller not used: its buttons have no standard layout");
        this.host.wake();
      }),
      onWin("gamepaddisconnected", () => {
        this.host.notice?.("Controller disconnected");
        this.host.wake();
      }),
    ];
    return () => off.forEach((f) => f());
  }

  private pointerDown(e: PointerEvent): void {
    const u = this.toU(e.clientX, e.clientY);
    this.cursor = u;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, u);
    this.glide.v = [0, 0];
    this.spin = 0;
    this.bring = null;
    if (e.button === 1) {
      e.preventDefault();
      this.bring = { from: u, t: 0 };
      this.host.wake();
      return;
    }
    if (this.pointers.size > 1) {
      this.drag = null; // two fingers: pinch, twist and pan in pointerMove
      return;
    }
    this.drag = { mode: e.button === 2 ? "rotate" : "pan", last: u, samples: [{ t: e.timeStamp, u }] };
  }

  private pointerMove(e: PointerEvent): void {
    const u = this.toU(e.clientX, e.clientY);
    this.cursor = u;
    const prevPointer = this.pointers.get(e.pointerId);
    if (prevPointer && this.pointers.size === 2) {
      // two pointers: the midpoint pans, the spread zooms, the turn rotates
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const mid0: Complex = [(prevPointer[0] + other[0]) / 2, (prevPointer[1] + other[1]) / 2];
      const mid1: Complex = [(u[0] + other[0]) / 2, (u[1] + other[1]) / 2];
      const d0 = Math.hypot(prevPointer[0] - other[0], prevPointer[1] - other[1]);
      const d1 = Math.hypot(u[0] - other[0], u[1] - other[1]);
      const a0 = Math.atan2(prevPointer[1] - other[1], prevPointer[0] - other[0]);
      const a1 = Math.atan2(u[1] - other[1], u[0] - other[0]);
      let v = panBy(this.host.view(), mid0, mid1);
      if (d0 > 1e-6) v = zoomAt(v, mid1, d1 / d0, this.host.height(), this.host.minFootprint?.()).view;
      v = rotateBy(v, a1 - a0);
      this.pointers.set(e.pointerId, u);
      this.apply(v);
      return;
    }
    if (prevPointer) this.pointers.set(e.pointerId, u);
    const d = this.drag;
    if (!d) return;
    const v = this.host.view();
    const turn = v.picture.model === "h3" ? lookDrag : v.picture.model === "hyperboloid" ? orbitDrag : rotateDrag;
    this.apply(d.mode === "pan" ? panBy(v, d.last, u) : turn(v, d.last, u));
    d.last = u;
    d.samples.push({ t: e.timeStamp, u });
    while (d.samples.length > 2 && e.timeStamp - d.samples[1].t >= GLIDE_WINDOW_MS) d.samples.shift();
  }

  private pointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    this.drag = null;
    if (!d || this.pointers.size > 0) return;
    // release velocity over the last 50 ms of motion, from the last move before them; none if the
    // pointer rested before release
    const s = d.samples;
    const b = s[s.length - 1];
    if (s.length < 2 || e.timeStamp - b.t > REST_MS) return;
    let i = s.length - 2;
    while (i > 0 && b.t - s[i].t < GLIDE_WINDOW_MS) i--;
    const a = s[i];
    const span = (b.t - a.t) / 1000;
    if (span < 0.005) return;
    if (d.mode === "pan") {
      this.glide = { v: [(b.u[0] - a.u[0]) / span, (b.u[1] - a.u[1]) / span], at: b.u };
    } else if (this.host.view().picture.model === "h3" || this.host.view().picture.model === "hyperboloid") {
      // a mouse look or an orbit keeps no momentum: the view stops where the pointer let go
      return;
    } else {
      this.spin = (Math.atan2(b.u[1], b.u[0]) - Math.atan2(a.u[1], a.u[0])) / span;
      if (Math.abs(this.spin) > 100) this.spin = 0; // passed through the centre
    }
    this.host.wake();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const u = this.toU(e.clientX, e.clientY);
    this.cursor = u;
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1; // lines, pages -> pixels
    if (e.shiftKey) {
      this.apply(rotateBy(this.host.view(), (-delta * unit * Math.PI) / 1800));
      return;
    }
    this.zoomBy(Math.exp(-delta * unit * WHEEL_LOG_PER_UNIT * (e.ctrlKey ? 0.2 : 1)), u);
  }

  private keyDown(e: KeyboardEvent): void {
    // Ctrl and Cmd keys are the browser's and the page's own (Ctrl+C copies a link, not C)
    if (isField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    // zoom: a tap is 2x, holding the key keeps zooming
    const zoomStep = e.repeat ? Math.SQRT2 : 2;
    switch (key) {
      case "+": case "=": case "pageup": this.zoomBy(zoomStep, [0, 0]); break;
      case "-": case "_": case "pagedown": this.zoomBy(1 / zoomStep, [0, 0]); break;
      case "z": this.zoomBy(zoomStep, this.cursor); break;
      case "x": this.zoomBy(1 / zoomStep, this.cursor); break;
      case "[": this.apply(rotateBy(this.host.view(), this.host.symmetryAngle())); break;
      case "]": this.apply(rotateBy(this.host.view(), -this.host.symmetryAngle())); break;
      case "h": this.stop(); this.host.home(); break;
      case "backspace": this.stop(); if (e.shiftKey) this.host.forward(); else this.host.back(); break;
      case "c": this.host.nextPreset(e.shiftKey ? -1 : 1); break;
      case "l": this.host.cycle("look", e.shiftKey ? -1 : 1); break;
      case ".": this.host.cycle("look", 1); break;
      case ",": this.host.cycle("look", -1); break;
      case "p": this.host.cycle("palette", e.shiftKey ? -1 : 1); break;
      case "k": this.host.cycle("colouring", e.shiftKey ? -1 : 1); break;
      case "o": this.host.cycle("construction", e.shiftKey ? -1 : 1); break;
      case "m": this.host.cycle("motif", e.shiftKey ? -1 : 1); break;
      case "g": this.host.toggleGrid(); break;
      case "t": this.host.cycle("grid", e.shiftKey ? -1 : 1); break;
      case "u": this.host.cycle("unit", e.shiftKey ? -1 : 1); break;
      case "w": case "a": case "s": case "d": case "q": case "e":
      case "arrowup": case "arrowdown": case "arrowleft": case "arrowright":
        if (!this.held.has(key)) this.held.set(key, performance.now());
        this.host.wake();
        break;
      default: {
        // the number keys choose a view, from the table the toolbar and the card also show
        const model = (Object.keys(VIEW_KEYS) as Model[]).find((m) => VIEW_KEYS[m] === key);
        if (!model) return;
        this.stop();
        this.host.setModel(model);
      }
    }
    e.preventDefault();
  }
}
