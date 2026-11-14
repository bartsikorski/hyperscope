// The unit grid's labels (design notes, step 8): where the finest lines drawn at strength
// LABEL_WEIGHT or more cross the left and the bottom edge of the picture (a polar grid's rays: the
// edges facing away from its centre), every first, second, fifth or tenth even line and every
// 2^p-th spreading line so that labels come GAP or more apart, with values from the grid camera's
// exact S0 and E0. Pure: main.ts puts the labels on the screen.
// The 1, 2, 5 steps follow Paul Heckbert's "Nice numbers for graph labels" (Graphics Gems, 1990).

import type { GridCameras, GridFrame, GridSettings, GridSlot } from "../math/grid.ts";
import { FRAC_BITS, spreadLog2, subdivision, UNITS } from "../math/grid.ts";
import type { Complex } from "../math/complex.ts";
import type { Picture } from "../math/views.ts";
import { centreScale, edgeDistance, frameOf, referenceScale } from "../math/views.ts";
import { bitsPhase, frameGrid, gridPoint, J_MAX, J_MIN } from "../render/grid.ts";

/** Labels sit this far inside the edge, are sampled every STEP pixels and kept GAP apart (CSS px). */
export const INSET = 12;
const STEP = 2;
export const GAP = 60;
/** How much larger than at the centre the plane length per pixel may get along the label lines. */
const SPREAD = 6;
/** Labels this close to the corner where the two edges meet are left out. */
const CORNER = 36;
/** A label's text sits above its line on the left and right edges (so they start TEXT_H below the
 *  label lines' top, where the top label line is) and right of its line on the bottom and top edges,
 *  TEXT_GAP clear of the next label. */
const TEXT_H = 16;
/** The height of a label's text (main.ts: 10 px type, line height 1.4). */
export const LINE_H = 14;
const TEXT_GAP = 12;
/** Lines are labelled where they cross the label line at 30 degrees or more (the angle's sine). */
export const MIN_CROSSING = 0.5;
/** Circles are labelled from this far out from a polar centre on the screen; its rays go to the
 *  right (top) edge when that is FAR times as far from it as the left (bottom) edge or more. */
const CENTRE_GAP = 12;
const FAR = 2;
/** The text's distance from its line, in CSS pixels (main.ts places it). */
export const TEXT_PAD = 3;
const THIN = " ";

export interface GridLabel {
  /** The left or bottom edge (a polar grid's rays: maybe the right or top edge instead), or a polar
   *  grid's radial axis. The text starts right of the label's point, on the right edge it ends left
   *  of it. */
  edge: "left" | "right" | "bottom" | "top" | "radial";
  /** Where the line crosses the label line, in CSS pixels from the top left. */
  x: number;
  y: number;
  text: string;
  family: "even" | "spread";
  /** The labelled line's level, and for a spreading line its subdivision (lines unit / 2^m apart). */
  k: number;
  m: number;
}

/** The label lines: the screen's edges, moved in (keeping the aspect) until they lie inside the
 *  picture where its scale is at most SPREAD times the centre's, then each side of their rectangle
 *  pushed back out on its own as far as that holds: a zoomed-out disk gets its labels on a
 *  rectangle inside it, the half-plane on the screen's left edge and above its crowded boundary. */
export function labelLines(picture: Picture, width: number, height: number): Rect {
  // (inside H3 with the centre on the sky: the nearest ground's, views.ts referenceScale)
  const centre = centreScale(picture);
  const most = SPREAD * (centre < Infinity ? centre : referenceScale(picture));
  const lines = (t: number): Rect => ({
    left: width / 2 - (t * width) / 2 + INSET,
    right: width / 2 + (t * width) / 2 - INSET,
    top: height / 2 - (t * height) / 2 + INSET,
    bottom: height / 2 + (t * height) / 2 - INSET,
  });
  const inside = (l: Rect) => {
    for (let i = 0; i <= 32; i++) {
      const [px, py] = [l.left + ((l.right - l.left) * i) / 32, l.top + ((l.bottom - l.top) * i) / 32];
      for (const [x, y] of [[l.left, py], [l.right, py], [px, l.top], [px, l.bottom]]) {
        const u = toU(x, y, width, height);
        const fp = frameOf(picture, u);
        if (!fp || fp.scale > most || edgeDistance(picture, u) * (height / 2) > -4) return false;
      }
    }
    return true;
  };
  const full = lines(1);
  if (inside(full)) return full;
  // inside H3 the ground fills the screen up to the horizon, not around its centre (which may be
  // sky): keep the left, right and bottom edges and bring the top down to below the horizon, where
  // the plane length per pixel is at most `most` (no labels when the bottom edge is sky)
  if (picture.model === "h3") {
    let [a, b] = [full.bottom, full.top];
    if (!inside({ ...full, top: a })) return { ...full, top: full.bottom };
    for (let i = 0; i < 20; i++) {
      const mid = (a + b) / 2;
      if (inside({ ...full, top: mid })) a = mid;
      else b = mid;
    }
    return { ...full, top: a };
  }
  let lo = 0.05;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inside(lines(mid))) lo = mid;
    else hi = mid;
  }
  let rect = lines(lo);
  for (const side of ["bottom", "left", "top", "right"] as const) {
    let [a, b] = [rect[side], full[side]];
    for (let i = 0; i < 16; i++) {
      const mid = (a + b) / 2;
      if (inside({ ...rect, [side]: mid })) a = mid;
      else b = mid;
    }
    rect = { ...rect, [side]: a };
  }
  return rect;
}

/** A rectangle in CSS px from the top left. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const toU = (x: number, y: number, width: number, height: number): Complex => [(x - width / 2) / (height / 2), (height / 2 - y) / (height / 2)];

/** The grid's labels for a picture of width x height CSS pixels at dpr device pixels each; with
 *  `measure` (a text's width in CSS pixels) labels keep clear of each other's text, of the
 *  screen's edges and of the `avoid` boxes (the HUD's readouts). A polar grid whose centre is on the screen or up to half a screen beyond it puts
 *  its rays on the right or top edge when the centre is well over to the left or bottom, where they
 *  cross squarely and come further apart; where the centre's horizontal crosses the label lines it
 *  labels the circles along it, toward the side with more room (the radial axis). */
export function gridLabels(
  settings: GridSettings | undefined, grids: GridCameras, picture: Picture, width: number, height: number, dpr: number, measure: (text: string) => number = () => 0,
  avoid: Box[] = [],
): GridLabel[] {
  const f = frameGrid(settings, grids, picture, height * dpr);
  if (!f) return [];
  const l = labelLines(picture, width, height);
  const out = (path: Path, family: "even" | "spread") => labelsAlong(f, picture, width, height, dpr, path, family, measure, avoid);
  // the vertical and the horizontal label line, each leaving out the corner where they meet
  const edges = (right: boolean, top: boolean): [Path, Path] => {
    const x = right ? l.right : l.left;
    const y = top ? l.top + TEXT_H : l.bottom;
    return [
      { edge: right ? "right" : "left", from: top ? y + CORNER : l.top + TEXT_H, to: top ? l.bottom : y - CORNER, at: (pos) => [x, pos], text: "across" },
      { edge: top ? "top" : "bottom", from: right ? l.left : x + CORNER, to: right ? x - CORNER : l.right, at: (pos) => [pos, y], text: "along" },
    ];
  };
  // one family to each edge, the way their lines cross the edges more squarely
  const byFamily = ([across, along]: [Path, Path]) => {
    const sq = (path: Path, family: "even" | "spread") => squareness(f, picture, width, height, path, family);
    const evenAcross = sq(across, "even") + sq(along, "spread") >= sq(across, "spread") + sq(along, "even");
    return clear([...out(across, evenAcross ? "even" : "spread"), ...out(along, evenAcross ? "spread" : "even")], measure);
  };
  const centre = f.kind === "polar" ? polarCentre(f, picture, width, height) : null;
  if (!centre) return byFamily(edges(false, false));
  const [cx, cy] = centre;
  const rays = edges(l.right - cx >= FAR * (cx - l.left), cy - l.top >= FAR * (l.bottom - cy));
  if (!(cy > l.top && cy < l.bottom)) return byFamily(rays);
  const radial: Path =
    l.right - cx >= cx - l.left
      ? { edge: "radial", from: Math.max(CENTRE_GAP, l.left - cx), to: l.right - cx, at: (pos) => [cx + pos, cy], text: "along" }
      : { edge: "radial", from: Math.max(CENTRE_GAP, cx - l.right), to: cx - l.left, at: (pos) => [cx - pos, cy], text: "back" };
  return clear([...out(rays[0], "spread"), ...out(rays[1], "spread"), ...out(radial, "even")], measure);
}

/** How squarely a family's lines cross a label line: the mean of crossing() over 17 points along
 *  it, 1 where the lines cross at right angles, 0 where they run along it. */
function squareness(f: GridFrame, picture: Picture, width: number, height: number, path: Path, family: "even" | "spread"): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i <= 16; i++) {
    const c = crossing(f, picture, width, height, path, family, path.from + ((path.to - path.from) * i) / 16);
    if (c !== null) [sum, n] = [sum + c, n + 1];
  }
  return n ? sum / n : 0;
}

/** The sine of the angle at which the family's lines cross the label line at pos: |dc/dpos| /
 *  |grad c| for the family's coordinate c (dE, or the offset term B), from points a pixel either
 *  side; null off the picture. */
function crossing(f: GridFrame, picture: Picture, width: number, height: number, path: Path, family: "even" | "spread", pos: number): number | null {
  const coord = (x: number, y: number) => {
    const fp = frameOf(picture, toU(x, y, width, height));
    if (!fp) return null;
    const p = gridPoint(f, fp.x);
    return family === "even" ? p.de : p.b;
  };
  // polar B jumps by a full turn where the angle wraps
  const period = f.kind === "polar" && family === "spread" ? 2 * Math.PI * Math.cosh(f.camera.e) : Infinity;
  const diff = (a: number, b: number) => (period === Infinity ? a - b : a - b - period * Math.round((a - b) / period));
  const [x0, y0] = path.at(pos);
  const [x1, y1] = path.at(pos + 1);
  const [ax, ay] = [x1 - x0, y1 - y0];
  const c = [coord(x0 + ax, y0 + ay), coord(x0 - ax, y0 - ay), coord(x0 - ay, y0 + ax), coord(x0 + ay, y0 - ax)];
  if (c.some((v) => v === null)) return null;
  const along = diff(c[0]!, c[1]!);
  const g = Math.hypot(along, diff(c[2]!, c[3]!));
  return g > 0 ? Math.abs(along) / g : null;
}

/** A label's text box in CSS px: above and right of its point (on the right edge, left of it),
 *  LINE_H high. */
export function labelBox(l: Pick<GridLabel, "edge" | "x" | "y" | "text">, measure: (text: string) => number): Box {
  const w = measure(l.text);
  const x0 = l.edge === "right" ? l.x - TEXT_PAD - w : l.x + TEXT_PAD;
  return { x0, x1: x0 + w, y0: l.y - TEXT_PAD - LINE_H, y1: l.y - TEXT_PAD };
}

/** The labels in order, less any whose text would overlap the text of one before it. */
function clear(labels: GridLabel[], measure: (text: string) => number): GridLabel[] {
  const kept: Box[] = [];
  return labels.filter((l) => {
    const b = labelBox(l, measure);
    if (kept.some((k) => b.x0 < k.x1 + 4 && k.x0 < b.x1 + 4 && b.y0 < k.y1 + 2 && k.y0 < b.y1 + 2)) return false;
    kept.push(b);
    return true;
  });
}

/** Where the polar grid's centre is (CSS px), when it is on the screen or up to half a screen
 *  beyond it: the least r over a 33 x 33 sampling of that area, off its border, then a pattern
 *  search down to a quarter pixel (r has no other minimum). */
function polarCentre(f: GridFrame, picture: Picture, width: number, height: number): [number, number] | null {
  const r = (x: number, y: number) => {
    const fp = frameOf(picture, toU(x, y, width, height));
    return fp ? gridPoint(f, fp.x).e : Infinity;
  };
  const N = 32;
  const at = (i: number, j: number): [number, number] => [-width / 2 + (2 * width * i) / N, -height / 2 + (2 * height * j) / N];
  let best = { i: 0, j: 0, r: Infinity };
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const v = r(...at(i, j));
      if (v < best.r) best = { i, j, r: v };
    }
  }
  if (best.i === 0 || best.j === 0 || best.i === N || best.j === N) return null;
  let [x, y] = at(best.i, best.j);
  let v = best.r;
  for (let step = (2 * Math.max(width, height)) / N; step >= 0.25; ) {
    let moved = false;
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const w = r(x + dx, y + dy);
      if (w < v) [x, y, v, moved] = [x + dx, y + dy, w, true];
    }
    if (!moved) step /= 2;
  }
  return Math.abs(x - width / 2) < width && Math.abs(y - height / 2) < height ? [x, y] : null;
}

/** A label line: positions from..to map to screen points; the labels' text runs across it (the
 *  left and right edges), along it toward larger positions, or back toward smaller ones. */
interface Path {
  edge: GridLabel["edge"];
  from: number;
  to: number;
  at: (pos: number) => [number, number];
  text: "across" | "along" | "back";
}

interface Sample {
  pos: number;
  k: number;
  /** Every q-th even line is labelled (0 for the spreading lines), at subdivision m. */
  q: number;
  m: number;
  /** The labelled lines sit at its integers: for the even lines (E / delta - b + (b mod q)) / q with
   *  b = floor(E0 / delta), for the spreading lines 2^m S / unit less floor(2^m S0 / unit). */
  phase: number;
}

/** Labelled lines are drawn at this strength or more: 0.135 opacity, clearly seen. */
export const LABEL_WEIGHT = 0.3;
/** Steps between labelled even lines, as in a plot's axis. */
const STEPS = [1, 2, 5, 10];
const mod = (a: number, q: number) => ((a % q) + q) % q;

function labelsAlong(
  f: GridFrame, picture: Picture, width: number, height: number, dpr: number, path: Path, family: "even" | "spread", measure: (text: string) => number, avoid: Box[],
): GridLabel[] {
  const samples: (Sample | null)[] = [];
  for (let pos = path.from; pos <= path.to; pos += STEP) {
    const [x, y] = path.at(pos);
    samples.push(sampleAt(f, picture, toU(x, y, width, height), (height * dpr) / 2, family, pos));
  }
  // crossings of a whole phase between neighbouring samples of the same level and subdivision
  const found: (Value & { pos: number })[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b || a.k !== b.k || a.q !== b.q || a.m !== b.m || Math.abs(b.phase - a.phase) > 0.5) continue;
    // the whole number in (lower, upper], if any
    const n = Math.floor(Math.max(a.phase, b.phase));
    if (n <= Math.min(a.phase, b.phase)) continue;
    const pos = a.pos + ((n - a.phase) / (b.phase - a.phase)) * (b.pos - a.pos);
    // a line that grazes the label line has no clear place to label
    if ((crossing(f, picture, width, height, path, family, pos) ?? 0) < MIN_CROSSING) continue;
    found.push({ pos, ...(family === "even" ? evenValue(f, a.k, a.q, n) : spreadValue(f, a.k, a.m, n)) });
  }
  // the roundest values first (0, then multiples of the coarsest steps), so where the lines'
  // spacing changes along the path the labels keep to round values; then again with the decimals
  // that the placed labels in each display unit need at most, so they read alike
  const order = [...found].sort((a, b) => b.round - a.round || a.pos - b.pos);
  const place = (shared: Map<number, number> | null) => {
    const kept: { pos: number; lo: number; hi: number; c: Value; text: string }[] = [];
    for (const c of order) {
      const text = formatValue(c.num, c.den, shared?.get(unitOf(c.num, c.den, c.base).shift) ?? c.decimals, c.base);
      const w = measure(text);
      const [x, y] = path.at(c.pos);
      const box = labelBox({ edge: path.edge, x, y, text }, measure);
      if (box.x0 < TEXT_PAD || box.x1 > width - TEXT_PAD || box.y0 < 0 || box.y1 > height || avoid.some((a) => overlap(box, a))) continue;
      // the stretch of the path the label takes: its line and, along the path, its text
      const [lo, hi] = path.text === "along" ? [c.pos, c.pos + TEXT_PAD + w] : path.text === "back" ? [c.pos - TEXT_PAD - w, c.pos] : [c.pos, c.pos];
      if (kept.some((k) => Math.abs(k.pos - c.pos) < GAP || (lo < k.hi + TEXT_GAP && k.lo < hi + TEXT_GAP))) continue;
      kept.push({ pos: c.pos, lo, hi, c, text });
    }
    return kept;
  };
  const shared = new Map<number, number>();
  for (const { c } of place(null)) {
    const shift = unitOf(c.num, c.den, c.base).shift;
    shared.set(shift, Math.max(shared.get(shift) ?? -Infinity, needed(c)));
  }
  const kept = place(shared);
  return kept
    .sort((a, b) => a.pos - b.pos)
    .map(({ pos, c, text }) => {
      const [x, y] = path.at(pos);
      return { edge: path.edge, x, y, family, text, k: c.k, m: c.m };
    });
}

/** A labelled line's value num / den in its base unit, the decimals its step needs, and how round
 *  it is: log10 of the coarsest step of the family that it is a multiple of (Infinity for 0). */
interface Value {
  k: number;
  m: number;
  num: bigint;
  den: bigint;
  decimals: number;
  base: "m" | "R" | "deg";
  round: number;
}

/** The label phase at a point (render/grid.ts gridLines): of the finest lines of the family drawn
 *  at strength LABEL_WEIGHT or more (a level's weight, times `half` for the in-between spreading
 *  lines), or of the top level where that is the finest drawn; null where none is drawn. They are
 *  thinned to come GAP px apart at the plane length per pixel there: every q-th even line, the
 *  spreading lines at a coarser subdivision. */
function sampleAt(f: GridFrame, picture: Picture, u: Complex, halfHeight: number, family: "even" | "spread", pos: number): Sample | null {
  const fp = frameOf(picture, u);
  if (!fp) return null;
  const lpx = fp.scale / halfHeight;
  const { de, e, b } = gridPoint(f, fp.x);
  if (!(Math.abs(e) < 80)) return null;
  const x = Math.log10(8 * lpx) + Math.log10(UNITS[f.unit].perR);
  const kf = Math.floor(x) + 1;
  const a = kf - x;
  const slotOf = (k: number) => (k <= f.kTop && k >= f.kBase && k < f.kBase + f.slots.length ? f.slots[k - f.kBase] : null);
  if (family === "even") {
    const k = Math.min(a >= LABEL_WEIGHT ? kf : kf + 1, f.kTop);
    const slot = slotOf(k);
    if (k < kf || !slot) return null;
    const q = STEPS.find((q) => (q * slot.delta) / lpx >= GAP) ?? 10;
    const r = mod(evenBase(f, k), q);
    return { pos, k, q, m: 0, phase: (slot.phaseE + de / slot.delta + r) / q };
  }
  // the finest spreading lines strong enough, apart px apart: each drawn level's lines at m and,
  // fading in, at m + 1
  let best: { slot: GridSlot; m: number; apart: number } | null = null;
  for (const [k, weight] of [[kf, a], [kf + 1, 1]]) {
    const slot = slotOf(k);
    if (!slot) continue;
    const L = spreadLog2(f.kind, e, slot.delta);
    const m = subdivision(f.kind, L);
    const half = Math.min(1, Math.max(0, L - m));
    const apart = (slot.delta / lpx) * 2 ** (L - m);
    for (const [mm, strength, span] of [[m + 1, weight * half, apart / 2], [m, weight, apart]]) {
      if (strength >= LABEL_WEIGHT && mm - slot.m0 <= J_MAX && (!best || span < best.apart)) best = { slot, m: mm, apart: span };
    }
  }
  if (!best) return null;
  let { slot, m, apart } = best;
  // polar keeps its four rays
  for (; apart < GAP && (f.kind !== "polar" || m > 2); apart *= 2) m--;
  const j = m - slot.m0;
  if (j < J_MIN || j > J_MAX) return null;
  return { pos, k: slot.k, q: 0, m, phase: bitsPhase(slot.bits, slot.frac, j) + b * slot.uScale * 2 ** j };
}

/** floor(E0 / delta) for level k, as math/grid.ts gridFrame takes it for the slot's phase. */
function evenBase(f: GridFrame, k: number): number {
  return Math.floor(f.camera.e * UNITS[f.unit].perR * 10 ** -k);
}

/** The labelled even line n (every q-th, counted from the one at or below E0) of level k:
 *  E = (b - (b mod q) + q n) 10^k units with b = floor(E0 / delta). */
function evenValue(f: GridFrame, k: number, q: number, n: number): Value {
  const base = evenBase(f, k);
  const j = BigInt(base - mod(base, q)) + BigInt(q) * BigInt(n);
  // the value j 10^k in units, with the decimals of the step q 10^k; round by j's factors of 10, 5, 2
  const [num, den] = k >= 0 ? [j * 10n ** BigInt(k), 1n] : [j, 10n ** BigInt(-k)];
  let round = Infinity;
  if (j !== 0n) {
    let [rest, tens] = [j < 0n ? -j : j, 0];
    while (rest % 10n === 0n) [rest, tens] = [rest / 10n, tens + 1];
    round = k + tens + (rest % 5n === 0n ? Math.log10(5) : rest % 2n === 0n ? Math.log10(2) : 0);
  }
  return { k, m: 0, num, den, decimals: -k - (q === 10 ? 1 : 0), base: f.unit === "R" ? "R" : "m", round };
}

/** The spreading line n (counted from floor(2^m S0 / unit)) of level k at subdivision m:
 *  S = (floor(2^m S0 / unit) + n) unit / 2^m, in units (R or m) or, for polar rays, degrees. */
function spreadValue(f: GridFrame, k: number, m: number, n: number): Value {
  const perR = BigInt(UNITS[f.unit].perR);
  // 2^m S0 / unit = s 2^m / (2^FRAC unit), unit = 10^k / perR R (a turn for polar)
  let num = f.camera.s;
  let den = 1n << FRAC_BITS;
  if (f.kind !== "polar") {
    num *= perR;
    if (k < 0) num *= 10n ** BigInt(-k);
    else den *= 10n ** BigInt(k);
  }
  if (m >= 0) num <<= BigInt(m);
  else den <<= BigInt(-m);
  let base = num / den;
  if (num < 0n && base * den !== num) base -= 1n;
  const i = base + BigInt(n);
  // the step unit / 2^m in display units (degrees for polar) as sNum / sDen, and the value i steps
  const [unitNum, unitDen] = f.kind === "polar" ? [360n, 1n] : k >= 0 ? [10n ** BigInt(k), 1n] : [1n, 10n ** BigInt(-k)];
  const [sNum, sDen] = m >= 0 ? [unitNum, unitDen << BigInt(m)] : [unitNum << BigInt(-m), unitDen];
  let [vNum, vDen] = [i * sNum, sDen];
  if (f.kind === "polar") {
    vNum = ((vNum % (360n * vDen)) + 360n * vDen) % (360n * vDen);
    if (vNum * 2n > 360n * vDen) vNum -= 360n * vDen; // -180 to 180 degrees
  }
  // round by the coarsest subdivision i is on: i = 2^t odd
  let round = Infinity;
  if (vNum !== 0n) {
    let [rest, t] = [i < 0n ? -i : i, 0];
    while (rest % 2n === 0n) [rest, t] = [rest / 2n, t + 1];
    round = Math.log10(Number(sNum) / Number(sDen)) + t * Math.log10(2);
  }
  return { k, m, num: vNum, den: vDen, decimals: stepDecimals(sNum, sDen), base: f.kind === "polar" ? "deg" : f.unit === "R" ? "R" : "m", round };
}

/** The decimals the value needs once rounded to its step's: fewer by its trailing zeros (none for 0). */
function needed(c: Value): number {
  let d = c.decimals;
  const [top, bottom] = d >= 0 ? [c.num * 10n ** BigInt(d), c.den] : [c.num, c.den * 10n ** BigInt(-d)];
  let r = (2n * (top < 0n ? -top : top) + bottom) / (2n * bottom);
  if (r === 0n) return -Infinity;
  while (r % 10n === 0n) [r, d] = [r / 10n, d - 1];
  return d;
}

/** The decimals that tell multiples of the step num / den apart: none for an integer step (less
 *  one per trailing zero), exact while that takes a few (22.5 degrees, 0.125 km), else two more
 *  than its first digit's. */
function stepDecimals(num: bigint, den: bigint): number {
  const g = gcd(num, den);
  [num, den] = [num / g, den / g];
  if (den === 1n) {
    let zeros = 0;
    while (num !== 0n && num % 10n === 0n) [num, zeros] = [num / 10n, zeros + 1];
    return -zeros;
  }
  const exact = exactDecimals(den);
  return exact <= 9 ? exact : Math.ceil(-Math.log10(Number(num) / Number(den)) - 1e-9) + 2;
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

/** Decimals that num / den needs for any num, den = 2^a 5^b: max(a, b). */
function exactDecimals(den: bigint): number {
  let twos = 0;
  let fives = 0;
  while (den % 2n === 0n) [den, twos] = [den / 2n, twos + 1];
  while (den % 5n === 0n) [den, fives] = [den / 5n, fives + 1];
  return Math.max(twos, fives);
}

/** num / den rounded to `decimals` decimals of the base unit (metres, R or degrees; negative for a
 *  step of tens or more), all of them shown so a series of labels reads alike, long runs of digits
 *  grouped in threes; metres switch to km, mm or µm by size, with the decimals shifted to match. */
export function formatValue(num: bigint, den: bigint, decimals: number, base: "m" | "R" | "deg"): string {
  if (den < 0n) [num, den] = [-num, -den];
  const neg = num < 0n;
  if (neg) num = -num;
  const { unit, shift } = unitOf(num, den, base);
  // round(num 10^(d + shift) / (den 10^shift ...)): the value in the display unit with d decimals
  const d = Math.max(0, decimals + shift);
  const p = d - shift;
  const top = p >= 0 ? num * 10n ** BigInt(p) : num;
  const bottom = p >= 0 ? den : den * 10n ** BigInt(-p);
  const r = (2n * top + bottom) / (2n * bottom);
  if (r === 0n) return `0${unit}`;
  const digits = r.toString().padStart(d + 1, "0");
  const int = digits.slice(0, digits.length - d);
  const frac = digits.slice(digits.length - d);
  const groups = (t: string, fromLeft: boolean) => {
    const parts: string[] = [];
    if (fromLeft) for (let i = 0; i < t.length; i += 3) parts.push(t.slice(i, i + 3));
    else for (let i = t.length; i > 0; i -= 3) parts.unshift(t.slice(Math.max(0, i - 3), i));
    return parts.join(THIN);
  };
  const intText = int.length > 3 ? groups(int, false) : int;
  const fracText = frac.length > 4 ? groups(frac, true) : frac;
  return `${neg ? "\u2212" : ""}${intText}${fracText ? "." + fracText : ""}${unit}`;
}

/** The display unit of num / den: metres switch to km, mm or µm by size (shift: its power of ten). */
function unitOf(num: bigint, den: bigint, base: "m" | "R" | "deg"): { unit: string; shift: number } {
  if (base === "R") return { unit: " R", shift: 0 };
  if (base === "deg") return { unit: "°", shift: 0 };
  if ((num < 0n) !== (den < 0n)) num = -num;
  if (num < 0n) [num, den] = [-num, -den];
  if (num >= 1000n * den) return { unit: " km", shift: 3 };
  if (num >= den || num === 0n) return { unit: " m", shift: 0 };
  if (num * 1000n >= den) return { unit: " mm", shift: -3 };
  return { unit: " µm", shift: -6 };
}
