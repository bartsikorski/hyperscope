// The depth colouring's start tile on a long trip (design notes, "Depth on a long trip"). The
// shader folds the start point s along with each pixel, in float32, and that stops being reliable
// past MAX_START_DISTANCE from the camera. Before then the start moves to a tile centre s' nearer the
// camera, chosen so that every wall count on the screen changes by the same whole number, which the
// view keeps as `shift`: depth from s = depth from s' + shift, and the picture does not change.
//
// Why a nearer tile can be exact: depth(x) counts the walls between x and s, leaving out those
// through s. If s' lies inside the bundle of geodesics from the visible disk to s, a wall separating
// x from s separates x from s' or s' from s, never both, and the second kind is the same for every
// x. What can differ: a wall through s' or through s that crosses the visible disk. The candidates
// are tested on points of that disk, in float64, and the first that matches everywhere is taken.

import type { TriangleGroup } from "../math/groups.ts";
import { distanceToSide, fold } from "../math/groups.ts";
import type { Mat3, Vec3 } from "../math/lorentz.ts";
import { ORIGIN, apply, dist, identity, mul, reflection } from "../math/lorentz.ts";
import { depthAt, startOf, type Start } from "../render/reference.ts";

/** Past this distance from the camera the start is moved; MAX_START_DISTANCE stays the hard limit. */
export const START_SOFT = 8;
/** Radius around the camera in which the depth must not change: past it the tiles are smaller than
 *  the fade needs at 4K in the zoomed-out disk (design notes). */
export const START_VISIBLE = 5.5;
/** Distances from the camera, along the way to the old start, where a new start is looked for:
 *  the farthest first, so the start moves as seldom as possible. */
export const START_TRIES = [6.5, 6, 5.5, 7, 5];
/** Sideways offsets of the candidate points from that way, in R. */
const SIDEWAYS = [0, 0.25, -0.25, 0.5, -0.5];
const RINGS = [0, 0.4, 0.8, 1.2, 1.6, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
const ANGLES = 64;

/** Points of the visible disk around the camera's screen centre, as world points. */
function samplesAround(camera: Mat3): Vec3[] {
  const out: Vec3[] = [];
  for (const r of RINGS) {
    const n = r === 0 ? 1 : r < 1 ? 16 : ANGLES;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * (i + 0.5 * (r % 1 > 0 ? 1 : 0))) / n;
      out.push(apply(camera, [Math.sinh(r) * Math.cos(a), Math.sinh(r) * Math.sin(a), Math.cosh(r)]));
    }
  }
  return out;
}

/** The point at distance t from a toward b, moved sideways by `side` (both in R). */
function pointToward(a: Vec3, b: Vec3, t: number, side: number): Vec3 {
  const d = dist(a, b);
  const k1 = Math.sinh(d - t) / Math.sinh(d);
  const k2 = Math.sinh(t) / Math.sinh(d);
  const q: Vec3 = [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  if (side === 0) return q;
  // unit tangent at q perpendicular to the way: the normal of the plane through a, b and the hyperboloid's centre
  const n: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], -(a[0] * b[1] - a[1] * b[0])];
  const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] - n[2] * n[2]);
  const c = Math.cosh(side);
  const s = Math.sinh(side) / len;
  return [q[0] * c + n[0] * s, q[1] * c + n[1] * s, q[2] * c + n[2] * s];
}

/** The isometry that maps the home start tile to the tile around q (its centre is S * ORIGIN). */
function tileAround(q: Vec3, group: TriangleGroup): Mat3 {
  let m = identity();
  for (const j of fold(q, group.normals).word) m = mul(m, reflection(group.normals[j]));
  return m;
}

/** A start nearer the camera that leaves every depth on the screen as it is, with the number of walls
 *  to add to its count; null when none of the candidates fits. With `exact` false it returns the
 *  candidate that changes the fewest test points instead (the hard limit, where the start must move). */
export function nearerStart(origin: Mat3, camera: Mat3, group: TriangleGroup, exact = true): { origin: Mat3; shift: number } | null {
  const c = apply(camera, ORIGIN);
  const s = apply(origin, ORIGIN);
  const points = samplesAround(camera).map((x) => {
    const f = fold(x, group.normals);
    return { word: f.word, d: [0, 1, 2].map((j) => distanceToSide(f.x, group.normals[j])) };
  });
  const depths = (start: Start) => points.map((p) => depthAt(group, start, p.word, p.d).smooth);
  const old = depths(startOf({ group, origin }));
  const tried: Vec3[] = [];
  let best: { origin: Mat3; shift: number; misses: number } | null = null;
  for (const t of START_TRIES) {
    if (t >= dist(c, s)) continue;
    for (const side of SIDEWAYS) {
      const m = tileAround(pointToward(c, s, t, side), group);
      const centre = apply(m, ORIGIN);
      if (tried.some((p) => dist(p, centre) < 1e-6)) continue;
      tried.push(centre);
      const now = depths(startOf({ group, origin: m }));
      const shift = Math.round(old[0] - now[0]);
      const misses = old.filter((v, i) => Math.abs(v - now[i] - shift) >= 1e-6).length;
      if (misses === 0) return { origin: m, shift };
      if (!best || misses < best.misses) best = { origin: m, shift, misses };
    }
  }
  return exact || !best ? null : { origin: best.origin, shift: best.shift };
}

/** How much farther the camera must get from the start before a search that found nothing is
 *  tried again (a search takes a few milliseconds; while moving it would otherwise run every frame). */
const RETRY_AFTER = 0.2;
let failedAt = -Infinity;

/** settle's step: past START_SOFT the start moves to an exact nearer tile when there is one, and at
 *  MAX_START_DISTANCE to the closest fit; `d` is the start's distance from the camera. */
export function keepStartNear(origin: Mat3, camera: Mat3, group: TriangleGroup, d: number, hard: number): { origin: Mat3; shift: number } | null {
  if (d <= START_SOFT) return null;
  if (d <= hard && Math.abs(d - failedAt) < RETRY_AFTER) return null;
  const next = nearerStart(origin, camera, group, d <= hard);
  failedAt = next ? -Infinity : d;
  return next;
}
