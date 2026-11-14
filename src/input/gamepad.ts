// Game controllers through the Gamepad API (design notes, "After version 1: game controller"). The
// pure part turns a pad in the browser's standard layout into rates (pan, rotation, zoom) and button
// presses; Gamepads reads every connected pad once a frame. Controls applies the result.

import type { Complex } from "../math/complex.ts";

/** Round dead zone of a stick and of a trigger. */
export const STICK_DEAD = 0.15;
export const TRIGGER_DEAD = 0.05;
/** At full deflection: pan in screen units per second, rotation in radians per second, zoom in
 *  log scale per second (4x a second). */
export const PAD_PAN = 1.2;
export const PAD_SPIN = 1.5;
export const PAD_ZOOM = Math.log(4);

/** The standard layout's buttons (w3.org/TR/gamepad, "Remapping"). */
export const BUTTONS = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, start: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
} as const;
export type PadButton = keyof typeof BUTTONS;
const NAMES = Object.keys(BUTTONS) as PadButton[];

/** What the reader needs of a browser Gamepad (a test can script one). */
export interface PadLike {
  index: number;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface PadInput {
  /** Where the screen centre moves, in screen units per second (y up, like panBy). */
  pan: Complex;
  /** Rotation in radians per second, counter-clockwise. */
  turn: number;
  /** Zoom in log scale per second, positive in: the triggers and the right stick's y. */
  zoom: number;
  /** The triggers' part of zoom alone (inside H3 the right stick's y looks up and down instead). */
  pull: number;
  /** The right stick's y as a rate in radians per second, positive up (inside H3: look up). */
  tilt: number;
  /** Buttons pressed since the last read, each once. */
  pressed: PadButton[];
}

export const NO_INPUT: PadInput = { pan: [0, 0], turn: 0, zoom: 0, pull: 0, tilt: 0, pressed: [] };

/** A stick's deflection past the dead zone: the same direction, its length 0 at the dead zone's
 *  edge and 1 at full deflection, squared in between for fine control near the centre. */
export function shapeStick(x: number, y: number, dead = STICK_DEAD): Complex {
  const m = Math.hypot(x, y);
  if (!(m > dead)) return [0, 0];
  const t = (Math.min(1, m) - dead) / (1 - dead);
  const k = (t * t) / m;
  return [x * k, y * k];
}

/** A trigger's pull past its dead zone, 0 to 1. */
export function shapeTrigger(v: number, dead = TRIGGER_DEAD): number {
  return v > dead ? Math.min(1, (v - dead) / (1 - dead)) : 0;
}

/** One pad's rates and the buttons down now; `before` is what was down at the last read. */
export function readPad(p: PadLike, before: readonly boolean[]): { input: PadInput; down: boolean[] } {
  const axis = (i: number) => p.axes[i] ?? 0;
  const button = (i: number) => p.buttons[i] ?? { pressed: false, value: 0 };
  const left = shapeStick(axis(0), axis(1));
  const right = shapeStick(axis(2), axis(3));
  // the pad's y is down: stick up moves the view up (the content down), like W
  const pan: Complex = [-left[0] * PAD_PAN, left[1] * PAD_PAN];
  const turn = -right[0] * PAD_SPIN;
  const pull = shapeTrigger(button(BUTTONS.rt).value) - shapeTrigger(button(BUTTONS.lt).value);
  const zoom = Math.max(-1, Math.min(1, pull - right[1])) * PAD_ZOOM;
  const tilt = -right[1] * PAD_SPIN;
  const down = NAMES.map((n) => button(BUTTONS[n]).pressed);
  const pressed = NAMES.filter((n, i) => down[i] && !before[i] && n !== "lt" && n !== "rt");
  return { input: { pan, turn, zoom, pull: pull * PAD_ZOOM, tilt, pressed }, down };
}

/** Every connected pad in the standard layout, read once a frame and added together. */
export class Gamepads {
  private down = new Map<number, boolean[]>();
  private any = false;
  private source: () => readonly (PadLike | null)[];

  constructor(source: () => readonly (PadLike | null)[] = () => (typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [])) {
    this.source = source;
  }

  /** True while the last read found a usable pad: it must be read again next frame. */
  get connected(): boolean {
    return this.any;
  }

  read(): PadInput {
    const pads = this.source().filter((p): p is PadLike => p !== null && p.mapping === "standard");
    this.any = pads.length > 0;
    if (!this.any) {
      this.down.clear();
      return NO_INPUT;
    }
    const sum: PadInput = { pan: [0, 0], turn: 0, zoom: 0, pull: 0, tilt: 0, pressed: [] };
    for (const p of pads) {
      const { input, down } = readPad(p, this.down.get(p.index) ?? []);
      this.down.set(p.index, down);
      sum.pan = [sum.pan[0] + input.pan[0], sum.pan[1] + input.pan[1]];
      sum.turn += input.turn;
      sum.zoom += input.zoom;
      sum.pull += input.pull;
      sum.tilt += input.tilt;
      sum.pressed.push(...input.pressed);
    }
    return sum;
  }
}
