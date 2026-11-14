// Camera moves on the view state: zoom at a point, pan, rotate, and the re-centering that follows
// every move. Pure float64 functions (unit-tested); controls.ts turns input into calls to them.

import type { Colouring, Perm } from "../math/colourings.ts";
import type { TileMat } from "../math/tileid.ts";
import { carryTile, fitsTile, identityTile, tileIdentity } from "../math/tileid.ts";
import { carry, identityPerm } from "../math/colourings.ts";
import type { Complex } from "../math/complex.ts";
import type { TriangleGroup } from "../math/groups.ts";
import { recenter } from "../math/groups.ts";
import type { Mat3, Vec3 } from "../math/lorentz.ts";
import { ORIGIN, apply, boostX, dist, identity, inverse, mul, reorthonormalize, rotation, translationTo, transvection } from "../math/lorentz.ts";
import type { GridCameras } from "../math/grid.ts";
import { homeGrids, moveGrids } from "../math/grid.ts";
import type { DiskPicture, H3Picture, HyperboloidPicture, Model, Picture } from "../math/views.ts";
import {
  H3_HOME, H3_MAX_H, H3_MAX_PITCH, H3_MIN_H, H3_MIN_PITCH, HB_HOME, HB_MAX_DISTANCE, HB_MAX_ELEVATION, HB_MIN_DISTANCE, HB_MIN_ELEVATION, HOME, HOME_PICTURE, MAX_BAND_S,
  centreScale, easeBand, centredPicture, diskPicture, edgeDistance, frameOf, hyperboloidGap, kleinShift, tiltWith, zoomPicture,
} from "../math/views.ts";
import { keepStartNear } from "./start.ts";

export interface ViewState {
  /** World = camera * frame point. */
  camera: Mat3;
  /** Colour permutation carried by the camera (re-centering continues it, so colours never jump). */
  perm: Perm;
  /** The tiles' exact labelling carried by the camera (math/tileid.ts; Mosaic's colours), the
   *  identity when left out: re-centering continues it as it does the permutation. */
  tile?: TileMat;
  picture: Picture;
  /** Where the depth colouring counts from: the start tile is centred at origin * P (P = the world
   *  origin at home). Re-centering moves it with the world. */
  origin: Mat3;
  /** Walls added to every depth counted from that start: when the start moves nearer on a long trip
   *  (start.ts), the depths on the screen stay as they were. */
  shift: number;
  /** The unit grids' cameras (math/grid.ts): moved by every camera move, never re-centred. */
  grids: GridCameras;
}

/** The view at home: the start point at the screen centre. Inside H3 the eye (at the picture's
 *  height and pitch, H3_HOME unless given) stands back from it, as switchModel puts it; the
 *  hyperboloid's orbit (HB_HOME unless given) looks at it at the vertex. */
export function homeView(k: number, model: Model = "poincare", h3: H3Picture = H3_HOME, orbit: HyperboloidPicture = HB_HOME): ViewState {
  const home: ViewState = { camera: identity(), perm: identityPerm(k), picture: HOME[model], origin: identity(), shift: 0, grids: homeGrids() };
  if (model === "hyperboloid") return { ...home, picture: { model, ...orbit } };
  if (model !== "h3") return home;
  const picture: Picture = { model: "h3", ...h3 };
  return { ...home, ...moved(home, inverse(centreStep(picture))), picture };
}

/** The camera multiplied by N on the right, and the grid cameras with it. */
export function moved(view: ViewState, n: Mat3): Pick<ViewState, "camera" | "grids"> {
  return { camera: mul(view.camera, n), grids: moveGrids(view.grids, n) };
}

/** Beyond this distance from the camera the shader's float32 tests against the start point get
 *  unreliable (design notes, step 7): the start has moved nearer before (start.ts), and here it
 *  must, to the closest fit if no exact one was found. */
export const MAX_START_DISTANCE = 10;

/** Plane length per device pixel below which float32 can no longer place points around the camera;
 *  zoom-in stops there until precise mode (float-float) lifts the limit. The unit grid on plain
 *  content needs no world point, so it goes to MIN_FOOTPRINT_PLAIN (design notes, step 8). */
export const MIN_FOOTPRINT = 1e-5;
export const MIN_FOOTPRINT_PLAIN = 1e-11;
/** Zoom-out limits: the disk pictures stop at this scale and past EASE_FROM slide back to the screen
 *  centre; the half-plane stops with its boundary line at Im u = -MIN_MU / 2; the local view stops
 *  where the screen's vertical half spans MAX_ELL of the plane. */
export const MAX_S = 1.25;
export const EASE_FROM = 0.5;
export const MIN_MU = 0.25;
export const MAX_ELL = 6;

/** Bring the camera's screen-centre point back into the fundamental triangle with a rotation-type
 *  symmetry, continuing the colour permutation along the same word, then re-orthonormalize. The
 *  Gram-Schmidt comes last, once the entries are small again: a long move (a pan next to the
 *  half-plane's boundary line) can leave entries near 100, and rounding grows with their square.
 *  With moveStart false (the band's strips, input/strips.ts) the depth start never moves. */
export function settle(view: ViewState, group: TriangleGroup, colouring: Colouring, moveStart = true): ViewState {
  const { g, word } = recenter(view.camera, group);
  const perm = carry(colouring, view.perm.length === colouring.k ? view.perm : identityPerm(colouring.k), word).perm;
  const ids = tileIdentity(group);
  // a matrix from another group (or none) restarts the labelling, as a permutation does
  const tile = carryTile(view.tile && fitsTile(view.tile, ids) ? view.tile : identityTile(), word, ids);
  const camera = reorthonormalize(mul(g, view.camera));
  let origin = word.length ? reorthonormalize(mul(g, view.origin)) : view.origin;
  let shift = view.shift ?? 0;
  const next = moveStart ? keepStartNear(origin, camera, group, dist(apply(origin, ORIGIN), apply(camera, ORIGIN)), MAX_START_DISTANCE) : null;
  if (next) {
    origin = next.origin;
    shift += next.shift;
  }
  return { ...view, camera, perm, tile, origin, shift };
}

/** The smallest plane length per unit of u at the screen centre, in any direction: the zoom-in limit
 *  keeps it at height MIN_FOOTPRINT / 2 or more (a centre pixel covers this times 2 / height). Klein
 *  shrinks the direction across the line to c by r = sqrt(sigma), so it reaches the limit first. */
export function centreFootprint(pic: Picture): number {
  // the plane inside H3 and the hyperboloid have their own limits, on the eye's height and the
  // orbit's distance (zoomAt)
  if (pic.model === "h3" || pic.model === "hyperboloid") return Infinity;
  return pic.model === "klein" ? Math.sqrt(pic.sigma) * centreScale(pic) : centreScale(pic);
}

export function minCentreFootprint(height: number, minFootprint = MIN_FOOTPRINT): number {
  return (height * minFootprint) / 2;
}

/** Largest centre scale of each model when centred (the zoom-out limits above). */
const MAX_CENTRE_SCALE: Record<Model, number> = { poincare: 2 * MAX_S, klein: MAX_S, halfplane: 2 / MIN_MU, local: MAX_ELL, h3: Infinity, hyperboloid: Infinity, band: MAX_BAND_S };

function zoomedOutTooFar(pic: Picture): boolean {
  switch (pic.model) {
    case "poincare": case "klein": return pic.s > MAX_S;
    case "halfplane": return pic.mu < MIN_MU;
    case "local": return pic.ell > MAX_ELL;
    case "h3": return pic.h > H3_MAX_H;
    case "hyperboloid": return pic.distance > HB_MAX_DISTANCE;
    case "band": return pic.s > MAX_BAND_S;
  }
}

/** A zoom-in aimed outside the picture or within this many pixels of its edge aims at the last
 *  point toward it from the screen centre that is this far inside (design notes, "Zooming at the
 *  edge"). Aimed at the boundary, or past it, the screen centre would run toward the boundary with
 *  every step, without end, since nothing under the cursor holds it. */
export const ANCHOR_MARGIN_PX = 8;

/** u0, or for a zoom-in the point that stands in for it when it is not well inside the picture.
 *  Aimed outside a disk, the stand-in lies as far inside the rim as the cursor is outside it (at
 *  least ANCHOR_MARGIN_PX), so the disk grows out to meet the cursor within a few notches rather than
 *  creeping along at the rim (design notes, "Zooming at the edge"). */
export function zoomAnchor(pic: Picture, u0: Complex, height: number): Complex {
  const gap = pic.model === "poincare" || pic.model === "klein" ? edgeDistance(pic, u0) : 0;
  const margin = Math.max((ANCHOR_MARGIN_PX * 2) / height, gap);
  const inside = (u: Complex) => edgeDistance(pic, u) <= -margin;
  if (inside(u0)) return u0;
  // the region that far inside is convex and holds the screen centre (else the centre stands in)
  if (!inside([0, 0])) return [0, 0];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (inside([u0[0] * mid, u0[1] * mid])) lo = mid;
    else hi = mid;
  }
  return [u0[0] * lo, u0[1] * lo];
}

/** Zoom by k about the screen point u0 (k > 1 zooms in), within the zoom limits (minFootprint is
 *  the content's, per device pixel); a zoom-in at the picture's edge or outside it about zoomAnchor.
 *  Returns the new view and the factor actually applied (1 when already at the limit). */
export function zoomAt(view: ViewState, u0: Complex, k: number, height: number, minFootprint = MIN_FOOTPRINT): { view: ViewState; k: number } {
  const pic = view.picture;
  if (pic.model === "h3") return zoomH3At(view, pic, u0, k);
  if (pic.model === "hyperboloid") return zoomHyperboloidAt(view, pic, u0, k);
  if (k > 1) u0 = zoomAnchor(pic, u0, height);
  const lmin = minCentreFootprint(height, minFootprint);
  const ok = k > 1 ? (p: Picture) => centreFootprint(p) >= lmin : (p: Picture) => !zoomedOutTooFar(p);
  if (k === 1 || !ok(pic)) return { view, k: 1 };
  let step = zoomPicture(pic, u0, k);
  if (!ok(step.pic)) {
    // land on the limit: bisect on log k (lo always within the limits)
    let lo = 0;
    let hi = Math.log(k);
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (ok(zoomPicture(pic, u0, Math.exp(mid)).pic)) lo = mid;
      else hi = mid;
    }
    if (lo === 0) return { view, k: 1 };
    k = Math.exp(lo);
    step = zoomPicture(pic, u0, k);
  }
  let picture = step.pic;
  if (k < 1 && (picture.model === "poincare" || picture.model === "klein")) picture = { ...easeCentre(picture), model: picture.model };
  if (k < 1 && picture.model === "band") picture = { ...easeBand(picture), model: "band" };
  const zoomed = { ...view, ...moved(view, step.N), picture };
  if (k > 1 && picture.model === "klein") return { view: openKleinAt(zoomed, u0, k, lmin), k };
  return { view: zoomed, k };
}

/** Inside H3 a zoom by k lowers the eye (k > 1) or raises it by that factor, within H3_MIN_H and
 *  H3_MAX_H, tilts the view with it (tiltWith: further down as it rises), and moves it over the
 *  plane so that the ground under u0 stays there, as in the other views: by the transvection from
 *  where u0's ray meets the plane after the change to where it met it before. Where u0 shows sky,
 *  or ground beyond PAN_REACH (whose transvection would round badly), the eye stays over its foot
 *  point. */
function zoomH3At(view: ViewState, pic: H3Picture & { model: "h3" }, u0: Complex, k: number): { view: ViewState; k: number } {
  const h = Math.min(H3_MAX_H, Math.max(H3_MIN_H, pic.h / k));
  if (h === pic.h) return { view, k: 1 };
  return { view: holdAt(view, pic, { ...pic, h, pitch: tiltWith(pic.pitch, pic.h, h) }, u0), k: pic.h / h };
}

/** Holds the ground under u0 as a zoom inside H3 or on the hyperboloid changes the picture from pic
 *  to next: the transvection from where u0 shows the plane after to where it showed it before, or
 *  none where u0 shows nothing or a point beyond PAN_REACH (whose transvection would round badly). */
function holdAt(view: ViewState, pic: Picture, next: Picture, u0: Complex): ViewState {
  const far = Math.cosh(PAN_REACH);
  const a = frameOf(pic, u0);
  const b = frameOf(next, u0);
  const held = a && b && a.x[2] <= far && b.x[2] <= far;
  return { ...view, ...(held ? moved(view, transvection(b.x, a.x)) : {}), picture: next };
}

/** On the hyperboloid a zoom by k brings the orbit's camera in (k > 1) or out by that factor, within
 *  HB_MIN_DISTANCE and HB_MAX_DISTANCE and clear of the surface (clearWall), holding the point under
 *  u0 as the other views do (holdAt). */
function zoomHyperboloidAt(view: ViewState, pic: HyperboloidPicture & { model: "hyperboloid" }, u0: Complex, k: number): { view: ViewState; k: number } {
  const to = Math.min(HB_MAX_DISTANCE, Math.max(HB_MIN_DISTANCE, pic.distance / k));
  const next = clearWall(pic, "distance", to, [HB_MIN_DISTANCE, HB_MAX_DISTANCE]);
  if (next.distance === pic.distance) return { view, k: 1 };
  return { view: holdAt(view, pic, { ...next, model: "hyperboloid" }, u0), k: pic.distance / next.distance };
}

/** The hyperboloid's camera keeps at least HB_WALL_GAP from the surface (hyperboloidGap, about the
 *  Euclidean distance): nearer, a pixel would cover less of the plane than float32 resolves. */
export const HB_WALL_GAP = 0.05;

/** The orbit moved from pic by setting one of its numbers to v (within its limits), clear of the
 *  surface: a move that would end within HB_WALL_GAP of it goes on through the wall to the first
 *  clear place beyond, or, where the limits leave none, stops at the last clear place before it.
 *  The search beyond walks 200 steps to the limit (in log distance, or in the angle), then bisects
 *  the edge. */
export function clearWall(pic: HyperboloidPicture, key: "distance" | "elevation", v: number, [lo, hi]: [number, number]): HyperboloidPicture {
  const at = (w: number): HyperboloidPicture => ({ ...pic, [key]: w });
  const clear = (w: number) => Math.abs(hyperboloidGap(at(w))) >= HB_WALL_GAP;
  if (clear(v) || v === pic[key]) return at(v);
  // the clear end of [w0, w1] next to w0 (w0 not clear, w1 clear)
  const edge = (w0: number, w1: number) => {
    for (let i = 0; i < 60; i++) {
      const mid = (w0 + w1) / 2;
      if (clear(mid)) w1 = mid;
      else w0 = mid;
    }
    return at(w1);
  };
  const limit = v > pic[key] ? hi : lo;
  const log = key === "distance";
  let prev = v;
  for (let i = 1; i <= 200; i++) {
    const w = log ? v * (limit / v) ** (i / 200) : v + ((limit - v) * i) / 200;
    if (clear(w)) return edge(prev, w);
    prev = w;
  }
  return edge(v, pic[key]);
}

/** Orbit the hyperboloid's camera: turn the tiling about the vertex by yaw (positive turns its near
 *  side to the right) and raise the camera by pitch (radians), within HB_MIN_ELEVATION and
 *  HB_MAX_ELEVATION and clear of the surface (clearWall). */
export function orbit(view: ViewState, yaw: number, pitch: number): ViewState {
  const pic = view.picture;
  if (pic.model !== "hyperboloid") return view;
  const turned = yaw === 0 ? view : { ...view, ...moved(view, rotation(-yaw)) };
  if (pitch === 0) return turned;
  const e = Math.min(HB_MAX_ELEVATION, Math.max(HB_MIN_ELEVATION, pic.elevation + pitch));
  return { ...turned, picture: { ...clearWall(pic, "elevation", e, [HB_MIN_ELEVATION, HB_MAX_ELEVATION]), model: "hyperboloid" } };
}

/** Right-drag on the hyperboloid: dragging down raises the camera (looks from higher up) and dragging
 *  sideways turns the tiling about the vertex, ORBIT_PER_UNIT radians per unit of u each. */
export const ORBIT_PER_UNIT = Math.PI / 2;
export function orbitDrag(view: ViewState, ua: Complex, ub: Complex): ViewState {
  return orbit(view, (ub[0] - ua[0]) * ORBIT_PER_UNIT, -(ub[1] - ua[1]) * ORBIT_PER_UNIT);
}

/** Zooming in on the Klein disk opens up its rim (design notes, "Opening the Klein rim"). Klein
 *  squashes the plane toward the rim by r = sqrt(1 - |z|^2) across it, and an even zoom cannot undo
 *  that: a rim region zoomed into stays squashed. So each zoom-in also re-projects the picture
 *  around the point under the cursor, whose r grows toward kleinOpenBound(s): squash at most 2 at 8
 *  times, 1.27 at 100 times. Per step r grows by at most the zoom factor to the power
 *  KLEIN_OPEN_RATE, so the picture changes no faster than the zoom moves it, and never past the
 *  zoom-in limit. */
export const KLEIN_OPEN_FROM = HOME_PICTURE.s;
export const KLEIN_OPEN_RATE = 0.5;

/** The least r at the cursor for Klein scale s: 1 - cbrt(s / KLEIN_OPEN_FROM), 0 from there up. */
export function kleinOpenBound(s: number): number {
  return s >= KLEIN_OPEN_FROM ? 0 : 1 - Math.cbrt(s / KLEIN_OPEN_FROM);
}

/** The Klein picture re-projected around its screen-centre point so that point's r = sqrt(sigma)
 *  becomes r1 (when larger): c shrinks toward the disk's centre and sigma grows by the same amount;
 *  s, the camera and the screen-centre point stay (as in easeCentre). */
export function openKlein(pic: DiskPicture, r1: number): DiskPicture {
  if (pic.sigma >= r1 * r1) return pic;
  const r2 = pic.c[0] ** 2 + pic.c[1] ** 2;
  const t = r2 > 0 ? Math.sqrt(Math.max(0, 1 - r1 * r1) / r2) : 0;
  // sigma = r1^2 itself, not sigma + (|c|^2 - |c'|^2), which would carry any mismatch along
  return diskPicture([pic.c[0] * t, pic.c[1] * t], Math.min(1, r1 * r1), pic.s);
}

/** After a zoom-in by k about u0: measure the picture from u0 (kleinShift), open it there, and
 *  measure it from the screen centre again. The point under u0 stays there exactly, and the
 *  re-projection is centred on it, so the region zoomed into opens in place. An opening that would
 *  pass the zoom-in limit, or put the screen centre off the disk (so that the way back cannot be
 *  computed), is cut back to the most that works, or skipped: a step that failed here used to stop
 *  the animation until the next input. */
function openKleinAt(view: ViewState, u0: Complex, k: number, lmin: number): ViewState {
  const pic = view.picture;
  if (pic.model !== "klein") return view;
  const there = kleinShift(pic, u0, pic.s);
  const r0 = Math.sqrt(there.pic.sigma);
  const want = Math.min(1, kleinOpenBound(pic.s), r0 * k ** KLEIN_OPEN_RATE);
  if (!(want > r0)) return view;
  const opened = (r1: number): ViewState | null => {
    const back = kleinShift(openKlein(there.pic, r1), [-u0[0], -u0[1]], pic.s);
    if (!(back.pic.sigma > 0 && back.pic.sigma <= 1 && back.N.every(Number.isFinite))) return null;
    return { ...view, ...moved(view, mul(there.N, back.N)), picture: { ...back.pic, model: "klein" } };
  };
  const ok = (v: ViewState | null): v is ViewState => v !== null && centreFootprint(v.picture) >= lmin;
  let out = opened(want);
  if (!ok(out)) {
    let lo = r0;
    let hi = want;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (ok(opened(mid))) lo = mid;
      else hi = mid;
    }
    out = lo === r0 ? null : opened(lo);
  }
  return out ?? view;
}

/** Zoom out about the screen centre until the zoom-in limit holds (after a switch to content with
 *  a coarser limit). */
export function clampZoom(view: ViewState, height: number, minFootprint = MIN_FOOTPRINT): ViewState {
  const lmin = minCentreFootprint(height, minFootprint);
  for (let i = 0; i < 4 && centreFootprint(view.picture) < lmin; i++) {
    const k = (centreFootprint(view.picture) / lmin) * (1 - 1e-12);
    const step = zoomPicture(view.picture, [0, 0], k);
    view = { ...view, ...moved(view, step.N), picture: step.pic };
  }
  return view;
}

/** Past s = EASE_FROM the allowed |c| shrinks linearly to 0 at MAX_S, so zooming out re-centres the
 *  disk. The screen-centre point and the orientation there do not depend on c, so the camera stays. */
export function easeCentre(pic: DiskPicture): DiskPicture {
  if (pic.s <= EASE_FROM) return pic;
  const cmax = Math.min(1, Math.max(0, (MAX_S - pic.s) / (MAX_S - EASE_FROM)));
  const r2 = pic.c[0] ** 2 + pic.c[1] ** 2;
  if (r2 <= cmax * cmax) return pic;
  const t = cmax / Math.sqrt(r2);
  return diskPicture([pic.c[0] * t, pic.c[1] * t], pic.sigma + (r2 - cmax * cmax), pic.s);
}

/** Show the same place in another model: the camera stays, the new picture is centred and has the
 *  same plane length per unit of u at the screen centre, within the new model's zoom limits. Inside
 *  H3 the eye and on the hyperboloid the orbit are given (as last left, by the caller). */
export function switchModel(view: ViewState, model: Model, height: number, minFootprint = MIN_FOOTPRINT, h3: H3Picture = H3_HOME, orbit: HyperboloidPicture = HB_HOME): ViewState {
  if (view.picture.model === model) return view;
  // the plane inside H3 looks at the screen-centre point from its own eye: step back from it by the
  // centre ray's ground distance on the way in, forward again on the way out
  if (model === "h3") {
    const picture: Picture = { model: "h3", ...h3 };
    return { ...view, ...moved(view, inverse(centreStep(picture))), picture };
  }
  const from = view.picture.model === "h3" ? { ...view, ...moved(view, centreStep(view.picture)) } : view;
  // the hyperboloid's orbit looks at the vertex, the frame's origin, as the centred pictures put it
  // at the screen centre: the camera stays both ways
  if (model === "hyperboloid") return { ...from, picture: { model, ...orbit } };
  const scale = Math.min(MAX_CENTRE_SCALE[model], Math.max(minCentreFootprint(height, minFootprint), centreScale(view.picture)));
  return { ...from, picture: centredPicture(model, scale) };
}

/** For the plane inside H3, the translation from the foot point to where the screen centre's ray meets
 *  the plane, straight ahead (the identity when it looks above the horizon); otherwise the identity. */
export function centreStep(pic: Picture): Mat3 {
  const f = pic.model === "h3" ? frameOf(pic, [0, 0]) : null;
  return f ? translationTo(f.x) : identity();
}

/** Walk the plane inside H3: the foot point moves by d (x right, y forward, in screen units) times
 *  2 sinh h of the plane, so the ground under the eye crosses the screen at about the same rate from
 *  any height. */
export const WALK_PER_UNIT = 2;
export function walk(view: ViewState, d: Complex): ViewState {
  const pic = view.picture;
  if (pic.model !== "h3") return view;
  const len = Math.hypot(d[0], d[1]);
  if (len === 0) return view;
  const r = len * WALK_PER_UNIT * Math.sinh(pic.h);
  const to: Vec3 = [(Math.sinh(r) * d[0]) / len, (Math.sinh(r) * d[1]) / len, Math.cosh(r)];
  return { ...view, ...moved(view, translationTo(to)) };
}

/** Look around in the plane inside H3: turn by yaw (positive to the right, about the foot point) and
 *  tilt the view by pitch (positive down), within H3_MIN_PITCH and H3_MAX_PITCH. */
export function look(view: ViewState, yaw: number, pitch: number): ViewState {
  const pic = view.picture;
  if (pic.model !== "h3") return view;
  const turned = yaw === 0 ? view : { ...view, ...moved(view, rotation(-yaw)) };
  const p = Math.min(H3_MAX_PITCH, Math.max(H3_MIN_PITCH, pic.pitch + pitch));
  return { ...turned, picture: { ...pic, pitch: p } };
}

/** Right-drag in the plane inside H3, as a mouse look: the view turns and tilts toward the drag, half
 *  the field of view per unit of u (a drag over the screen's height turns it by the whole field). */
export function lookDrag(view: ViewState, ua: Complex, ub: Complex): ViewState {
  const pic = view.picture;
  if (pic.model !== "h3") return view;
  const k = pic.fov / 2;
  return look(view, (ub[0] - ua[0]) * k, -(ub[1] - ua[1]) * k);
}

/** Pans grab points at most this far from the screen centre, in R. The transvection between two
 *  points is formed from entries near the square of their t, so its rounding grows with cosh^4 of
 *  their distance: 1e-9 at 3 R, 1e-4 at 5 R, 1e3 at 8 R, and past 4 R a grabbed point no longer
 *  follows the cursor to 1e-9 of a screen (tests/unit/camera.test.ts). The band shows such points
 *  in a few pixels along both edges, the disks next to their rims; float32 resolves little there. */
export const PAN_REACH = 4;

/** Move the world so the point under ua comes to ub (both must be inside the picture). When either
 *  lies beyond PAN_REACH both are pulled toward the screen centre by the same factor, so the pan
 *  keeps its direction and moves the world less than the cursor. */
export function panBy(view: ViewState, ua: Complex, ub: Complex): ViewState {
  const far = Math.cosh(PAN_REACH);
  const grab = (t: number) => {
    const a = frameOf(view.picture, [ua[0] * t, ua[1] * t]);
    const b = frameOf(view.picture, [ub[0] * t, ub[1] * t]);
    return a && b && a.x[2] <= far && b.x[2] <= far ? { a, b } : null;
  };
  let g = grab(1);
  if (!g) {
    if (!frameOf(view.picture, ua) || !frameOf(view.picture, ub) || !grab(0)) return view;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (grab(mid)) lo = mid;
      else hi = mid;
    }
    g = grab(lo);
    if (!g) return view;
  }
  return { ...view, ...moved(view, transvection(g.b.x, g.a.x)) };
}

/** Rotate the view by theta about the screen-centre point (counter-clockwise on screen). */
export function rotateBy(view: ViewState, theta: number): ViewState {
  return { ...view, ...moved(view, rotation(-theta)) };
}

/** Rotate so the point under ua turns to the direction of ub, seen from the screen-centre point. */
export function rotateDrag(view: ViewState, ua: Complex, ub: Complex): ViewState {
  const a = frameOf(view.picture, ua);
  const b = frameOf(view.picture, ub);
  if (!a || !b || Math.hypot(...a.w) < 1e-9 || Math.hypot(...b.w) < 1e-9) return view;
  return rotateBy(view, Math.atan2(b.w[1], b.w[0]) - Math.atan2(a.w[1], a.w[0]));
}

/** The world point under the screen point u, or null outside the picture. */
export function worldAt(view: ViewState, u: Complex): Vec3 | null {
  const f = frameOf(view.picture, u);
  return f ? apply(view.camera, f.x) : null;
}

/** Longest single move of placeAt; re-centering after each keeps the camera's entries small. */
const PLACE_STEP = 1;

/** The view at Cartesian grid coordinates X along the start's base line and Y from it (Fermi
 *  coordinates, in R), turned so that the grid's X direction makes `theta` with the screen's x axis
 *  there (the grid camera's theta), keeping the picture. It walks there from the start point in
 *  steps of at most PLACE_STEP, first along the base line and then along the perpendicular
 *  geodesic (which keeps X and the orientation), re-centering after each step as panning does, so
 *  the camera, colours and the other grid cameras are those of a real trip. The caller overwrites
 *  the Cartesian grid camera with the exact values afterwards. */
export function placeAt(view: ViewState, x: number, y: number, theta: number, group: TriangleGroup, colouring: Colouring): ViewState {
  let v: ViewState = { ...view, camera: identity(), perm: identityPerm(colouring.k), tile: identityTile(), origin: identity(), shift: 0, grids: homeGrids() };
  const quarter = rotation(Math.PI / 2);
  const back = rotation(-Math.PI / 2);
  const walk = (d: number, along: "x" | "y") => {
    const n = Math.ceil(Math.abs(d) / PLACE_STEP);
    for (let i = 0; i < n; i++) {
      const step = along === "x" ? boostX(d / n) : mul(quarter, mul(boostX(d / n), back));
      v = settle({ ...v, ...moved(v, step) }, group, colouring);
    }
  };
  walk(x, "x");
  walk(y, "y");
  // rotateBy(phi) turns the grid camera's theta by -phi
  return rotateBy(v, v.grids.cartesian.theta - theta);
}
