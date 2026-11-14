// The band drawn in strips (design v2, "Precision along the band"). Moving along the band's geodesic
// is an isometry, so the band shows tiles far from the screen centre at full size, and float32 places
// a point of size t only to about 65 * 2^-24 t^2. Strip k is the view moved k * DELTA along the band,
// with DELTA = BAND_STRIP cos y0 band units: its own camera re-centred on its own (with the colour
// permutation and the grid cameras carried along), drawn into the pixel columns nearest to it, with
// u shifted by k DELTA / s. Every pixel is then within DELTA / 2 along the band of its camera, about
// 0.5 R at most. All strips keep the view's depth start, so the depth colouring stays one picture;
// where a strip lies farther than START_FOG_FROM from the start, its depth colouring fades into the
// tiles' average by MAX_START_DISTANCE, since float32 cannot fold the start along from that far.

import type { Colouring } from "../math/colourings.ts";
import type { TriangleGroup } from "../math/groups.ts";
import { ORIGIN, apply, dist } from "../math/lorentz.ts";
import { bandFrame, bandMoveTo } from "../math/views.ts";
import { MAX_START_DISTANCE, moved, settle, type ViewState } from "./camera.ts";

/** Strip width in units of cos y0, the band's own length scale at the screen centre's height. */
export const BAND_STRIP = 1;
/** Strips on each side of the middle one; past them the last strip goes on and the picture fades
 *  (views.ts precisionFade). With the zoom-out limit, 12 cover a 21:9 screen. */
export const MAX_STRIPS_EACH_SIDE = 12;
/** A strip's depth colouring starts to fade this far from the start, in R. */
export const START_FOG_FROM = 8.5;

export interface Strip {
  view: ViewState;
  /** The strip's part of the screen: u's x from `from` up to, not including, `to` (infinite at
   *  the outer ends). A pixel goes with the strip that holds its centre. */
  from: number;
  to: number;
  /** Subtracted from u's x: the strip's centre on the screen. */
  du: number;
  /** The depth colouring's fade at the strip's two sides (u's x less du, then the fade at each),
   *  linear between them and constant beyond: the shader's uStrip. */
  fog: [number, number, number, number];
}

const NO_FOG: [number, number, number, number] = [0, 1, 0, 0];

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The strips of a view on a screen `aspect` (width / height) wide: one for every view but the band. */
export function stripsOf(view: ViewState, group: TriangleGroup, colouring: Colouring, aspect: number): Strip[] {
  const pic = view.picture;
  if (pic.model !== "band") return [{ view, from: -Infinity, to: Infinity, du: 0, fog: NO_FOG }];
  const step = (BAND_STRIP * Math.cos(pic.y0)) / pic.s; // one strip, in units of u
  const reach = Math.min(MAX_STRIPS_EACH_SIDE, Math.round(aspect / step));
  if (reach === 0) return [{ view, from: -Infinity, to: Infinity, du: 0, fog: NO_FOG }];
  const start = apply(view.origin, ORIGIN);
  const fogAt = (u: number) => smoothstep(START_FOG_FROM, MAX_START_DISTANCE, dist(start, apply(view.camera, bandFrame(pic, [u, 0])!.x)));
  const out: Strip[] = [];
  for (let k = -reach; k <= reach; k++) {
    const du = k * step;
    const v = k === 0 ? view : settle({ ...view, ...moved(view, bandMoveTo(pic, [du, 0])) }, group, colouring, false);
    const fog: [number, number, number, number] = [-step / 2, step / 2, fogAt(du - step / 2), fogAt(du + step / 2)];
    out.push({ view: v, from: k === -reach ? -Infinity : du - step / 2, to: k === reach ? Infinity : du + step / 2, du, fog });
  }
  return out;
}
