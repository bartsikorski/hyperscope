// The shader against the CPU reference renderer, pixel by pixel (design: Tests, "GPU: vs reference").
// Pass rule: at least 99.5% of pixels within 2/255 per channel; every other pixel must sit where the
// reference itself changes by more than that when its sample moves 1e-3 px.

import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_LOOK, LOOKS } from "../../src/content/looks.ts";
import type { MotifSpec } from "../../src/math/motifs.ts";
import { buildContent, type ContentState } from "../../src/content/scene.ts";
import { centreFootprint, homeView, look, MIN_FOOTPRINT_PLAIN, orbit, panBy, rotateBy, settle, walk, zoomAt, type ViewState } from "../../src/input/camera.ts";
import type { Complex } from "../../src/math/complex.ts";
import type { GridCamera, GridKind, GridUnit } from "../../src/math/grid.ts";
import type { H3Picture, HyperboloidPicture, Model, Picture } from "../../src/math/views.ts";
import { renderView, toRGBA8 } from "../../src/render/reference.ts";
import { encodePNG } from "../../tools/png.ts";
import { shots } from "../shots.ts";
import type { TileImageState } from "../../src/content/tileimage.ts";
import { DEFAULT_PLACEMENT, setPicture, tileImageFromRGBA } from "../../src/content/tileimage.ts";
import { testPicture } from "../unit/picture-world.ts";

const SIZE = 256;
const TOL = 2;

interface Case {
  name: string;
  /** The view, Poincare when left out. */
  model?: Model;
  content: ContentState;
  /** Moves from the home view, applied with re-centering like the app does. */
  moves: (v: ViewState, settleIt: (v: ViewState) => ViewState) => ViewState;
  /** Width and height in pixels, SIZE x SIZE when left out. */
  size?: [number, number];
}

const repeat = (n: number, f: (v: ViewState) => ViewState) => (v: ViewState) => {
  for (let i = 0; i < n; i++) v = f(v);
  return v;
};
const zoom = (v: ViewState, u0: Complex, k: number) => zoomAt(v, u0, k, SIZE).view;

/** The screen point a fraction t of the way from the centre to the disk boundary in direction e. */
function towardEdge(pic: Picture, e: Complex, t: number): Complex {
  if (pic.model !== "poincare" && pic.model !== "klein") throw new Error("disk pictures only");
  const b = pic.c[0] * e[0] + pic.c[1] * e[1]; // Re(conj(c) e)
  const d = (pic.sigma / pic.s / (b + Math.sqrt(b * b + pic.sigma))) * t; // |c + s d e| = 1 at t = 1
  return [e[0] * d, e[1] * d];
}

/** Plain content under a unit grid, and grid over a tiling. */
const plainGrid = (kind: GridKind, unit: GridUnit = "km"): ContentState => ({
  group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03, plain: true, grid: { on: true, kind, unit },
});
/** Zoom 2x at u0 on plain content until a centre pixel covers at most lpx of the plane. */
const zoomTo = (lpx: number, u0: Complex) => (v: ViewState, st: (v: ViewState) => ViewState) => {
  while ((centreFootprint(v.picture) * 2) / SIZE > lpx) v = st(zoomAt(v, u0, 2, SIZE, MIN_FOOTPRINT_PLAIN).view);
  return v;
};
/** Inside H3 at home, seen from another eye. */
const eyeAt = (eye: H3Picture) => (v: ViewState): ViewState => homeView(v.perm.length, "h3", eye);
/** The hyperboloid at home, seen from another orbit (degrees for the angles). */
const orbitAt = (elevation: number, distance: number, fov: number) => (v: ViewState): ViewState =>
  homeView(v.perm.length, "hyperboloid", undefined, { elevation: (elevation * Math.PI) / 180, distance, fov: (fov * Math.PI) / 180 } satisfies HyperboloidPicture);
/** The view with one grid's camera put somewhere else (the grids do not depend on the tiling). */
const gridAt = (kind: GridKind, g: GridCamera) => (v: ViewState): ViewState => ({ ...v, grids: { ...v.grids, [kind]: g } });

/** A motif as a user would load it: (7,3,2), both curves bent, with every kind of feature. */
const LOADED: MotifSpec = {
  name: "Loaded test",
  group: [7, 3, 2],
  colouring: "r1",
  pr: [[0.0526, 0.0135], [0.0909, 0.0260], [0.12, 0.0577], [0.1422, 0.1038], [0.1971, 0.1125]],
  rq: [[0.2637, 0.0981], [0.2782, 0.0763], [0.2736, 0.0518], [0.2689, 0.0272], [0.2868, 0.0101]],
  features: [
    { kind: "shape", colour: "black", tone: 0.2, path: [[0.12, 0.0], [0.15, 0.0], [0.18, 0.0], [0.19, 0.02], [0.2, 0.04], [0.16, 0.05], [0.12, 0.0]] },
    { kind: "circle", colour: "white", centre: [0.2, 0.06], radius: 0.012 },
    { kind: "ellipse", colour: "line", tone: -0.3, centre: [0.1, 0.0], radii: [0.04, 0.012], angle: 25 },
    { kind: "stroke", colour: "tile", tone: 0.5, path: [[0.05, -0.02], [0.1, 0.03], [0.16, 0.04], [0.22, 0.02]], width: [0.01, 0.002] },
  ],
};

/** Two test pictures (tests/unit/picture-world.ts), registered here and in the page by the same
 *  bytes: an opaque 256 x 192 and a 160 x 160 with a transparent part. */
const PICTURES = [
  { id: "1".repeat(64), width: 256, height: 192, alpha: false },
  { id: "2".repeat(64), width: 160, height: 160, alpha: true },
];
for (const p of PICTURES) setPicture(p.id, { image: tileImageFromRGBA(testPicture(p.width, p.height, p.alpha), p.width, p.height, p.id) });
const pic = (mode: TileImageState["mode"], extra: Partial<TileImageState> = {}): TileImageState => ({ mode, place: DEFAULT_PLACEMENT, id: PICTURES[0].id, ...extra });

const describePicture = (p: Picture) =>
  p.model === "halfplane" ? `mu ${p.mu.toFixed(3)}` : p.model === "local" ? `ell ${p.ell.toPrecision(4)}`
    : p.model === "band" ? `gap ${Math.cos(p.y0).toExponential(2)}, s ${p.s.toExponential(2)}`
    : p.model === "h3" ? `h ${p.h.toPrecision(3)}, pitch ${((p.pitch * 180) / Math.PI).toFixed(1)}, fov ${((p.fov * 180) / Math.PI).toFixed(0)}`
    : p.model === "hyperboloid" ? `elevation ${((p.elevation * 180) / Math.PI).toFixed(1)}, distance ${p.distance.toPrecision(3)}, fov ${((p.fov * 180) / Math.PI).toFixed(0)}`
    : `sigma ${p.sigma.toExponential(2)}, lambda ${(p.sigma / p.s).toFixed(3)}`;

const CASES: Case[] = [
  { name: "7_3_parity_home", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 }, moves: (v) => v },
  {
    name: "5_4_faces_moved",
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.03 },
    moves: (v, st) => repeat(7, (w) => st(rotateBy(panBy(w, [0.3, 0.2], [-0.1, -0.15]), 0.37)))(v),
  },
  {
    name: "6_4_three_colours_edge",
    content: { group: [6, 4, 2], colouring: "c8", sides: [true, true, true], lineWidth: 0.012 },
    moves: (v, st) => repeat(3, (w) => st(zoom(panBy(w, [0.4, 0], [-0.2, 0.1]), [0.6, 0.5], 1.4)))(v),
  },
  {
    name: "2_3_7_mesh_interior",
    content: { group: [2, 3, 7], colouring: "parity", sides: [true, true, true], lineWidth: 0.008 },
    moves: (v, st) => repeat(3, (w) => st(zoom(w, [0.05, -0.1], 2)))(v),
  },
  {
    name: "8_3_parity_deep_edge",
    // keep zooming 2x at a point just inside the boundary: sigma ends near 1e-12
    content: { group: [8, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => repeat(40, (w) => st(zoom(w, towardEdge(w.picture, [0.6, 0.8], 0.98), 2)))(v),
  },
  {
    name: "3_7_parity_zoomed_out",
    content: { group: [3, 7, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => st(zoom(st(zoom(v, [0.5, 0.3], 3)), [-0.4, 0.2], 0.4)),
  },
  { name: "klein_7_3_home", model: "klein", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 }, moves: (v) => v },
  {
    name: "klein_6_4_three_colours_moved",
    model: "klein",
    content: { group: [6, 4, 2], colouring: "c8", sides: [true, true, true], lineWidth: 0.012 },
    moves: (v, st) => repeat(4, (w) => st(zoom(rotateBy(panBy(w, [0.3, -0.1], [-0.1, 0.2]), 0.3), [0.5, 0.4], 1.5)))(v),
  },
  {
    name: "klein_8_3_deep_edge",
    // toward the boundary until the zoom-in limit (the Klein footprint across the radius) stops it
    model: "klein",
    content: { group: [8, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => repeat(30, (w) => st(zoom(w, towardEdge(w.picture, [0.6, 0.8], 0.98), 2)))(v),
  },
  { name: "halfplane_7_3_home", model: "halfplane", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 }, moves: (v) => v },
  {
    name: "halfplane_5_4_faces_moved",
    model: "halfplane",
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.03 },
    moves: (v, st) => st(zoom(repeat(5, (w) => st(rotateBy(panBy(w, [0.2, 0.3], [-0.3, 0.1]), -0.4)))(v), [0.3, -0.6], 0.8)),
  },
  {
    name: "halfplane_8_3_flight_to_boundary",
    // zooming at a point just above the boundary line keeps mu nearly constant: the camera flies
    // toward an ideal point and re-centering keeps bringing it back
    model: "halfplane",
    content: { group: [8, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => repeat(40, (w) => st(zoom(w, [0.3, w.picture.model === "halfplane" ? -0.49 * w.picture.mu : 0], 2)))(v),
  },
  {
    name: "halfplane_3_7_zoomed_out",
    model: "halfplane",
    content: { group: [3, 7, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => repeat(4, (w) => st(zoom(w, [0.2, 0.1], 0.5)))(v),
  },
  { name: "local_7_3_home", model: "local", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 }, moves: (v) => v },
  {
    name: "local_6_4_three_colours_zoomed_in",
    model: "local",
    content: { group: [6, 4, 2], colouring: "c8", sides: [true, true, true], lineWidth: 0.012 },
    moves: (v, st) => repeat(3, (w) => st(zoom(rotateBy(panBy(w, [0.4, 0.1], [0, -0.2]), 0.2), [0.3, 0.2], 1.8)))(v),
  },
  {
    name: "local_4_5_zoomed_out",
    model: "local",
    content: { group: [4, 5, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => repeat(3, (w) => st(zoom(w, [-0.3, 0.2], 0.5)))(v),
  },
  // step 11: the band, at home, moved, zoomed out, and flown to its edge down to the gap limit
  { name: "band_7_3_home", model: "band", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 }, moves: (v) => v },
  {
    name: "band_5_4_faces_moved",
    model: "band",
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.03 },
    moves: (v, st) => st(zoom(repeat(5, (w) => st(rotateBy(panBy(w, [0.2, 0.3], [-0.3, 0.1]), -0.4)))(v), [0.3, -0.5], 1.6)),
  },
  {
    name: "band_3_7_zoomed_out",
    model: "band",
    content: { group: [3, 7, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => repeat(4, (w) => st(zoom(w, [0.2, 0.1], 0.5)))(v),
  },
  {
    name: "band_8_3_deep_edge",
    // zooming just inside the upper edge halves the gap with every step, down to MIN_BAND_GAP; when
    // the edge has left the screen a zoom-out brings it back
    model: "band",
    content: { group: [8, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => repeat(90, (w) => {
      const p = w.picture as { y0: number; s: number };
      const up = Math.atan2(Math.cos(p.y0), Math.sin(p.y0)) / p.s;
      return st(up < 1 ? zoom(w, [0.3, 0.98 * up], 2) : zoom(w, [0, 0], 0.5));
    })(v),
  },
  {
    name: "band_7_3_depth_lower_edge",
    model: "band",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 12 } },
    moves: (v, st) => repeat(12, (w) => st(zoom(panBy(w, [0.1, 0], [-0.1, 0]), [0.2, w.picture.model === "band" ? -0.95 * Math.atan2(Math.cos(w.picture.y0), -Math.sin(w.picture.y0)) / w.picture.s : 0], 1.8)))(v),
  },
  // the band on a wide screen, drawn in strips (input/strips.ts): at home, zoomed out to the limit,
  // with the depth colouring and with a grid
  { name: "band_7_3_wide_home", model: "band", size: [1200, 600], content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 }, moves: (v) => v },
  {
    name: "band_6_4_wide_zoomed_out",
    model: "band",
    size: [1200, 600],
    content: { group: [6, 4, 2], colouring: "c8", sides: [true, true, true], lineWidth: 0.012 },
    moves: (v, st) => repeat(4, (w) => st(zoomAt(w, [0.2, 0.1], 0.5, 600).view))(v),
  },
  {
    name: "band_5_4_wide_depth",
    model: "band",
    size: [1200, 600],
    content: { group: [5, 4, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 12 } },
    moves: (v, st) => repeat(3, (w) => st(zoomAt(panBy(w, [0.3, 0.1], [-0.2, 0]), [0.1, 0.2], 0.7, 600).view))(v),
  },
  {
    name: "band_7_3_wide_depth_far_start",
    // 7 R along the band from the depth start (it moves nearer only past 8 R), then zoomed out: the
    // strips on the far side are about 16 R from the start
    model: "band",
    size: [1200, 600],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 12 } },
    moves: (v, st) => repeat(2, (w) => st(zoomAt(w, [0, 0], 0.5, 600).view))(repeat(6, (w) => st(panBy(w, [0.3, 0], [-0.3, 0])))(v)),
  },
  {
    name: "band_7_3_wide_grid",
    model: "band",
    size: [1200, 600],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, grid: { on: true, kind: "cartesian", unit: "km" } },
    moves: (v, st) => st(rotateBy(zoomAt(v, [0.1, -0.1], 0.6, 600).view, 0.3)),
  },
  // step 12: the plane inside H3, at home, from low and level (the horizon and the tiles crowding
  // toward it), from high looking down, walked and turned, with a zoom at the cursor, depth colour
  // and the unit grid in perspective
  { name: "h3_7_3_home", model: "h3", size: [448, 252], content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 }, moves: (v) => v },
  {
    name: "h3_5_4_low_level",
    model: "h3",
    size: [448, 252],
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.03 },
    moves: eyeAt({ h: 0.03, pitch: 0.12, fov: (70 * Math.PI) / 180 }),
  },
  {
    name: "h3_6_4_high_looking_down",
    model: "h3",
    size: [448, 252],
    content: { group: [6, 4, 2], colouring: "c8", sides: [true, true, true], lineWidth: 0.012 },
    moves: eyeAt({ h: 1.5, pitch: 1.4, fov: (90 * Math.PI) / 180 }),
  },
  {
    name: "h3_8_3_walked_turned",
    model: "h3",
    size: [448, 252],
    content: { group: [8, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: (v, st) => st(zoomAt(look(repeat(5, (w) => st(walk(look(w, 0.3, 0), [0.1, 0.4])))(v), 0.2, -0.25), [0.3, -0.4], 1.6, 252).view),
  },
  {
    name: "h3_7_3_wide_fov_depth",
    model: "h3",
    size: [448, 252],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 12 } },
    moves: eyeAt({ h: 0.12, pitch: 0.35, fov: (100 * Math.PI) / 180 }),
  },
  { name: "h3_grid_cartesian_plain_home", model: "h3", size: [448, 252], content: plainGrid("cartesian", "earth"), moves: (v) => v },
  {
    name: "h3_grid_polar_7_3_moved",
    model: "h3",
    size: [448, 252],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03, grid: { on: true, kind: "polar", unit: "km" } },
    moves: (v, st) => st(look(walk(v, [0.3, -0.2]), -0.4, -0.1)),
  },
  // step 13: the hyperboloid, at home inside the bowl, from outside with the silhouette (above and
  // below the vertex's tangent plane), from inside the lower bowl through the upper sheet's
  // underside, from far out, moved, turned, orbited and zoomed at the cursor, with depth colour,
  // relief and the unit grid
  { name: "hyperboloid_7_3_home", model: "hyperboloid", size: [448, 252], content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 }, moves: (v) => v },
  {
    name: "hyperboloid_5_4_outside_silhouette",
    model: "hyperboloid",
    size: [448, 252],
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.03 },
    moves: orbitAt(25, 6, 60),
  },
  {
    name: "hyperboloid_6_4_from_below",
    model: "hyperboloid",
    size: [448, 252],
    content: { group: [6, 4, 2], colouring: "c8", sides: [true, true, true], lineWidth: 0.012 },
    moves: orbitAt(-30, 4, 60),
  },
  {
    name: "hyperboloid_8_3_lower_bowl",
    model: "hyperboloid",
    size: [448, 252],
    content: { group: [8, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: orbitAt(-90, 3, 80),
  },
  {
    name: "hyperboloid_7_3_far_out",
    model: "hyperboloid",
    size: [448, 252],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 },
    moves: orbitAt(10, 40, 40),
  },
  {
    name: "hyperboloid_5_4_moved_orbited_zoomed",
    model: "hyperboloid",
    size: [448, 252],
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.03 },
    moves: (v, st) => st(zoomAt(orbit(repeat(4, (w) => st(panBy(w, [0, 0], [0.15, -0.1])))(v), 0.6, 0.3), [0.3, -0.2], 1.7, 252).view),
  },
  {
    name: "hyperboloid_7_3_depth_relief",
    model: "hyperboloid",
    size: [448, 252],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Sand", source: "depth", density: 1 / 12, relief: 1.5, light: 135 } },
    moves: orbitAt(70, 3, 90),
  },
  { name: "hyperboloid_grid_cartesian_plain_home", model: "hyperboloid", size: [448, 252], content: plainGrid("cartesian", "earth"), moves: (v) => v },
  {
    name: "hyperboloid_grid_polar_7_3_outside",
    model: "hyperboloid",
    size: [448, 252],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03, grid: { on: true, kind: "polar", unit: "km" } },
    moves: (v, st) => st(rotateBy(orbitAt(-20, 5, 60)(v), 0.4)),
  },
  // step 14: colourings with up to 8 colours, chiral colourings, Mosaic
  {
    name: "colouring_7_3_eight_moved",
    content: { group: [7, 3, 2], colouring: "c2", sides: [true, true, true], lineWidth: 0.01, look: { ...DEFAULT_LOOK, palette: "Opal" } },
    moves: (v, st) => repeat(5, (w) => st(rotateBy(panBy(w, [0.3, 0.2], [-0.1, -0.15]), 0.37)))(v),
  },
  {
    name: "chiral_7_3_seven_moved",
    content: { group: [7, 3, 2], colouring: "r1", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Nebula" } },
    moves: (v, st) => repeat(6, (w) => st(rotateBy(panBy(w, [0.2, -0.1], [-0.12, 0.1]), -0.29)))(v),
  },
  {
    name: "klein_chiral_6_4_relief",
    model: "klein",
    content: { group: [6, 4, 2], colouring: "r4", sides: [true, false, true], lineWidth: 0.012, look: { ...DEFAULT_LOOK, palette: "Escher", relief: 0.8, glow: 0.15, lineColour: "#1c1b19" } },
    moves: (v, st) => repeat(4, (w) => st(zoom(rotateBy(panBy(w, [0.3, -0.1], [-0.1, 0.2]), 0.3), [0.5, 0.4], 1.3)))(v),
  },
  {
    name: "mosaic_7_3_set_moved",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Escher", source: "mosaic", lineColour: "#1c1b19" } },
    moves: (v, st) => repeat(5, (w) => st(rotateBy(panBy(w, [0.3, 0.2], [-0.1, -0.15]), 0.37)))(v),
  },
  {
    name: "mosaic_5_4_gradient",
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Nebula", source: "mosaic", phase: 0.3 } },
    moves: (v, st) => st(zoom(st(panBy(v, [0, 0], [0.3, -0.2])), [0.2, 0.1], 0.7)),
  },
  {
    name: "mosaic_3_7_long_trip",
    // hundreds of re-centerings: the camera's tile matrix carries the labelling all the way
    content: { group: [3, 7, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Gilded tiles", source: "mosaic", phase: 0.4 } },
    moves: (v, st) => repeat(300, (w) => st(rotateBy(panBy(w, [0, 0], [0.08, 0.01]), 0.01)))(v),
  },
  {
    name: "band_mosaic_6_4_strips",
    model: "band",
    size: [448, 252],
    content: { group: [6, 4, 2], colouring: "parity", sides: [true, true, true], lineWidth: 0.01, look: { ...DEFAULT_LOOK, palette: "Opal", source: "mosaic", relief: 0.5 } },
    moves: (v, st) => st(zoom(st(panBy(v, [0, 0], [0.2, 0.15])), [0.1, -0.2], 0.5)),
  },
  {
    name: "h3_chiral_8_3_eight",
    model: "h3",
    size: [448, 252],
    content: { group: [8, 3, 2], colouring: "r7", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Aurora" } },
    moves: (v, st) => st(rotateBy(v, 0.3)),
  },
  // step 15: Wythoff tilings, every construction (the triangle and the kite), each colour source,
  // relief and glow, a free point, odd words through the kite, the band, version 1's sides over them
  {
    name: "wy_7_3_omnitrunc_colouring_moved",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.015, construction: "111", look: { ...DEFAULT_LOOK, palette: "Opal" } },
    moves: (v, st) => repeat(5, (w) => st(rotateBy(panBy(w, [0.3, 0.2], [-0.1, -0.15]), 0.37)))(v),
  },
  {
    name: "wy_7_3_snub_mosaic_moved",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.012, construction: "snub", look: { ...DEFAULT_LOOK, palette: "Escher", source: "mosaic", lineColour: "#1c1b19" } },
    moves: (v, st) => repeat(6, (w) => st(rotateBy(panBy(w, [0.2, -0.1], [-0.12, 0.1]), -0.29)))(v),
  },
  {
    name: "wy_3_3_4_snub_colouring_relief",
    content: { group: [3, 3, 4], colouring: "parity", sides: [false, false, false], lineWidth: 0.01, construction: "snub", look: { ...DEFAULT_LOOK, palette: "Nebula", relief: 0.8, glow: 0.15 } },
    moves: (v, st) => repeat(4, (w) => st(zoom(rotateBy(panBy(w, [0.3, -0.1], [-0.1, 0.2]), 0.3), [0.5, 0.4], 1.3)))(v),
  },
  {
    name: "wy_5_4_truncated_inside_relief",
    content: { group: [5, 4, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.02, construction: "110", look: { ...DEFAULT_LOOK, palette: "Ember", source: "inside", relief: 1, glow: 0.2 } },
    moves: (v, st) => st(rotateBy(panBy(v, [0.2, 0.1], [-0.1, 0.2]), 0.3)),
  },
  {
    name: "wy_6_4_cantellated_distance_mesh",
    content: { group: [6, 4, 2], colouring: "parity", sides: [true, true, true], lineWidth: 0.01, construction: "011", look: { ...DEFAULT_LOOK, palette: "Aurora", source: "distance", density: 0.6 } },
    moves: (v, st) => st(zoom(st(panBy(v, [0, 0], [0.3, -0.2])), [0.2, 0.1], 0.7)),
  },
  {
    name: "wy_7_3_free_depth",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.015, construction: "free", weights: [0.3, 1.7, 0.6], look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 6 } },
    moves: (v, st) => repeat(3, (w) => st(rotateBy(panBy(w, [0.1, 0.3], [-0.2, -0.1]), 0.2)))(v),
  },
  {
    name: "wy_4_5_rectified_mosaic_gradient",
    content: { group: [4, 5, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.02, construction: "100", look: { ...DEFAULT_LOOK, palette: "Nebula", source: "mosaic", phase: 0.3 } },
    moves: (v, st) => repeat(40, (w) => st(rotateBy(panBy(w, [0, 0], [0.08, 0.01]), 0.01)))(v),
  },
  {
    name: "wy_2_3_7_snub_mosaic",
    content: { group: [2, 3, 7], colouring: "parity", sides: [false, false, false], lineWidth: 0.008, construction: "snub", look: { ...DEFAULT_LOOK, palette: "Gilded tiles", source: "mosaic" } },
    moves: (v, st) => st(rotateBy(panBy(v, [0.1, 0], [-0.2, 0.15]), 0.5)),
  },
  {
    name: "klein_wy_5_2_4_snub_colouring",
    model: "klein",
    content: { group: [5, 2, 4], colouring: "parity", sides: [false, false, false], lineWidth: 0.012, construction: "snub", look: { ...DEFAULT_LOOK, palette: "Opal", glow: 0.2 } },
    moves: (v, st) => repeat(3, (w) => st(rotateBy(panBy(w, [0.2, 0.2], [-0.1, -0.1]), 0.4)))(v),
  },
  {
    name: "band_wy_7_3_snub_strips",
    model: "band",
    size: [448, 252],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.01, construction: "snub", look: { ...DEFAULT_LOOK, palette: "Escher", source: "mosaic", relief: 0.5 } },
    moves: (v, st) => st(zoom(st(panBy(v, [0, 0], [0.2, 0.15])), [0.1, -0.2], 0.5)),
  },
  {
    name: "wy_7_3_regular_px_lines",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 1.5, lineUnit: "px", construction: "010", look: { ...DEFAULT_LOOK, palette: "Midnight" } },
    moves: (v, st) => repeat(3, (w) => st(zoom(w, [0.2, 0.1], 0.6)))(v),
  },
  // step 16: motifs, each built-in and a loaded one, every colour source, relief and glow, odd words,
  // re-centering, a deep zoom across a curve, other views, version 1's sides over a motif
  {
    name: "mo_shoal_chiral_relief_moved",
    content: { group: [3, 3, 4], colouring: "r2", sides: [false, false, false], lineWidth: 0.01, motif: "shoal", look: LOOKS.find((l) => l.name === "Escher")!.look },
    moves: (v, st) => repeat(5, (w) => st(rotateBy(panBy(w, [0.3, 0.2], [-0.1, -0.15]), 0.37)))(v),
  },
  {
    name: "mo_moths_mosaic_relief",
    content: { group: [6, 4, 2], colouring: "c3", sides: [false, false, false], lineWidth: 0.012, motif: "moths", look: { ...DEFAULT_LOOK, palette: "Copper & Teal", source: "mosaic", relief: 0.7, glow: 0.12, lineColour: "#1a1410" } },
    moves: (v, st) => repeat(4, (w) => st(rotateBy(panBy(w, [0.2, -0.1], [-0.12, 0.1]), -0.29)))(v),
  },
  {
    name: "mo_rosette_mosaic_gradient_cell_p",
    content: { group: [8, 3, 2], colouring: "c4", sides: [false, false, false], lineWidth: 0.01, motif: "rosette", look: { ...DEFAULT_LOOK, palette: "Nebula", source: "mosaic", phase: 0.3 } },
    moves: (v, st) => repeat(30, (w) => st(rotateBy(panBy(w, [0, 0], [0.08, 0.01]), 0.01)))(v),
  },
  {
    name: "mo_birds_depth_moved",
    content: { group: [4, 4, 3], colouring: "r2", sides: [false, false, false], lineWidth: 0.012, motif: "birds", look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 6 } },
    moves: (v, st) => repeat(3, (w) => st(rotateBy(panBy(w, [0.1, 0.3], [-0.2, -0.1]), 0.2)))(v),
  },
  {
    name: "mo_shoal_inside_glow",
    content: { group: [3, 3, 4], colouring: "r2", sides: [false, false, false], lineWidth: 0.008, motif: "shoal", look: { ...DEFAULT_LOOK, palette: "Ember", source: "inside", relief: 1, glow: 0.2 } },
    moves: (v, st) => st(rotateBy(panBy(v, [0.2, 0.1], [-0.1, 0.2]), 0.3)),
  },
  {
    name: "mo_moths_distance_deep_zoom",
    content: { group: [6, 4, 2], colouring: "c3", sides: [false, false, false], lineWidth: 0.004, motif: "moths", look: { ...DEFAULT_LOOK, palette: "Aurora", source: "distance", density: 0.6, glow: 0.3 } },
    moves: (v, st) => repeat(6, (w) => st(zoom(w, [0.21, 0.12], 2)))(v),
  },
  {
    name: "mo_rosette_colouring_sides_over",
    content: { group: [8, 3, 2], colouring: "c4", sides: [true, true, true], lineWidth: 0.006, motif: "rosette", look: { ...DEFAULT_LOOK, palette: "Opal", glow: 0.2 } },
    moves: (v, st) => st(rotateBy(panBy(v, [0.1, 0], [-0.2, 0.15]), 0.5)),
  },
  {
    name: "mo_loaded_7_3_px_lines",
    content: { group: [7, 3, 2], colouring: "r1", sides: [false, false, false], lineWidth: 1.5, lineUnit: "px", motif: LOADED, look: { ...DEFAULT_LOOK, palette: "Midnight", relief: 0.5 } },
    moves: (v, st) => repeat(3, (w) => st(rotateBy(panBy(w, [0.2, 0.2], [-0.1, -0.1]), 0.4)))(v),
  },
  {
    name: "klein_mo_birds_colouring",
    model: "klein",
    content: { group: [4, 4, 3], colouring: "r2", sides: [false, false, false], lineWidth: 0.01, motif: "birds", look: { ...DEFAULT_LOOK, palette: "Escher", lineColour: "#1c1b19" } },
    moves: (v, st) => repeat(2, (w) => st(rotateBy(panBy(w, [0.2, 0.2], [-0.1, -0.1]), 0.4)))(v),
  },
  {
    name: "band_mo_shoal_strips",
    model: "band",
    size: [448, 252],
    content: { group: [3, 3, 4], colouring: "r2", sides: [false, false, false], lineWidth: 0.01, motif: "shoal", look: { ...DEFAULT_LOOK, palette: "Escher", source: "mosaic", relief: 0.5 } },
    moves: (v, st) => st(zoom(st(panBy(v, [0, 0], [0.2, 0.15])), [0.1, -0.2], 0.5)),
  },
  {
    name: "h3_mo_moths_colouring",
    model: "h3",
    size: [448, 252],
    content: { group: [6, 4, 2], colouring: "c3", sides: [false, false, false], lineWidth: 0.01, motif: "moths", look: { ...DEFAULT_LOOK, palette: "Escher", lineColour: "#1c1b19", relief: 0.6 } },
    moves: (v) => v,
  },
  // step 17: your own tile picture, both modes, tinted, transparent, moved and turned on the picture,
  // a deep zoom (magnified), far tiles (high levels), and the views that are not conformal
  {
    name: "pic_7_3_kaleidoscope_moved",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.01, tileImage: pic("kaleidoscope"), look: { ...DEFAULT_LOOK, palette: "Escher", lineColour: "#1c1b19" } },
    moves: (v, st) => repeat(4, (w) => st(rotateBy(panBy(w, [0.3, 0.2], [-0.1, -0.15]), 0.37)))(v),
  },
  {
    name: "pic_3_3_4_chiral_relief_moved",
    content: { group: [3, 3, 4], colouring: "r2", sides: [false, false, false], lineWidth: 0.01, tileImage: pic("chiral"), look: { ...DEFAULT_LOOK, palette: "Escher", relief: 0.8, glow: 0.1 } },
    moves: (v, st) => repeat(5, (w) => st(rotateBy(panBy(w, [0.3, 0.2], [-0.1, -0.15]), -0.29)))(v),
  },
  {
    name: "pic_4_4_3_chiral_tint_alpha_depth",
    content: { group: [4, 4, 3], colouring: "r2", sides: [true, false, false], lineWidth: 0.006, tileImage: pic("chiral", { tint: true, id: PICTURES[1].id }), look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 6 } },
    moves: (v, st) => repeat(3, (w) => st(rotateBy(panBy(w, [0.1, 0.3], [-0.2, -0.1]), 0.2)))(v),
  },
  {
    name: "pic_6_4_kaleidoscope_deep_zoom",
    content: { group: [6, 4, 2], colouring: "c8", sides: [false, false, false], lineWidth: 0.01, tileImage: pic("kaleidoscope", { tint: true }), look: { ...DEFAULT_LOOK, palette: "Opal" } },
    moves: (v, st) => repeat(9, (w) => st(zoom(w, [0.21, 0.12], 2)))(v),
  },
  {
    name: "pic_5_4_chiral_placed_mosaic",
    content: { group: [5, 4, 2], colouring: "parity", sides: [false, false, true], lineWidth: 1.5, lineUnit: "px", tileImage: pic("chiral", { place: { x: 0.85, y: 0.2, size: 0.6, turn: 40 }, id: PICTURES[1].id }), look: { ...DEFAULT_LOOK, palette: "Copper & Teal", source: "mosaic" } },
    moves: (v, st) => repeat(2, (w) => st(rotateBy(panBy(w, [0.2, -0.1], [-0.12, 0.1]), 0.5)))(v),
  },
  {
    name: "klein_pic_8_3_kaleidoscope_inside_glow",
    model: "klein",
    content: { group: [8, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.01, tileImage: pic("kaleidoscope", { id: PICTURES[1].id }), look: { ...DEFAULT_LOOK, palette: "Ember", source: "inside", glow: 0.3 } },
    moves: (v, st) => st(rotateBy(panBy(v, [0.2, 0.1], [-0.1, 0.2]), 0.3)),
  },
  {
    name: "band_pic_7_3_kaleidoscope_distance_tint",
    model: "band",
    size: [448, 252],
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.01, tileImage: pic("kaleidoscope", { tint: true, id: PICTURES[1].id }), look: { ...DEFAULT_LOOK, palette: "Aurora", source: "distance", density: 0.6 } },
    moves: (v, st) => st(zoom(st(panBy(v, [0, 0], [0.2, 0.15])), [0.1, -0.2], 0.5)),
  },
  {
    name: "h3_pic_3_3_4_chiral",
    model: "h3",
    size: [448, 252],
    content: { group: [3, 3, 4], colouring: "r2", sides: [false, false, true], lineWidth: 0.01, tileImage: pic("chiral"), look: { ...DEFAULT_LOOK, palette: "Escher", lineColour: "#1c1b19" } },
    moves: (v) => v,
  },
  // step 7: every colour source, gradient colourings, glow, relief and pixel-wide lines
  {
    name: "look_6_4_gradient_colouring",
    content: { group: [6, 4, 2], colouring: "c8", sides: [true, true, true], lineWidth: 0.012, look: { ...DEFAULT_LOOK, palette: "Nebula", phase: 0.1 } },
    moves: (v, st) => st(rotateBy(panBy(v, [0.2, 0.1], [-0.1, 0.2]), 0.3)),
  },
  {
    name: "look_7_3_distance",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03, look: { ...DEFAULT_LOOK, palette: "Ember", source: "distance", density: 0.8 } },
    moves: (v, st) => st(zoom(st(panBy(v, [0, 0], [0.3, -0.2])), [0.2, 0.1], 1.5)),
  },
  {
    name: "look_7_3_depth_moved",
    // the start stays behind: depth keeps counting from the home triangle across re-centerings
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 12 } },
    moves: (v, st) => repeat(6, (w) => st(rotateBy(panBy(w, [0.3, 0.1], [-0.15, -0.05]), 0.2)))(v),
  },
  {
    name: "look_3_7_depth_long_trip",
    // far enough that the start has moved nearer several times: the shift goes into the phase
    content: { group: [3, 7, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Nebula", source: "depth", density: 1 / 10, phase: 0.2 } },
    moves: (v, st) => repeat(300, (w) => st(rotateBy(panBy(w, [0, 0], [0.08, 0.01]), 0.01)))(v),
  },
  {
    name: "klein_look_8_3_depth",
    model: "klein",
    content: { group: [8, 3, 2], colouring: "parity", sides: [true, true, true], lineWidth: 0.01, look: { ...DEFAULT_LOOK, palette: "Nebula", source: "depth", density: 1 / 16, phase: 0.3 } },
    moves: (v, st) => st(panBy(v, [0.2, 0], [-0.2, 0.1])),
  },
  {
    name: "halfplane_look_5_4_inside_glow",
    model: "halfplane",
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Porcelain", source: "inside", density: 1, glow: 0.5, lineColour: "#0d2347" } },
    moves: (v, st) => st(zoom(v, [0.1, 0.2], 1.3)),
  },
  {
    name: "look_7_3_relief",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Sand", source: "inside", density: 0.5, relief: 2, light: 135 } },
    moves: (v, st) => st(rotateBy(zoom(v, [0.2, -0.1], 2), 0.5)),
  },
  {
    name: "local_look_6_4_relief_glow",
    model: "local",
    content: { group: [6, 4, 2], colouring: "c8", sides: [true, false, true], lineWidth: 0.015, look: { ...DEFAULT_LOOK, palette: "Escher", glow: 0.3, relief: 1.2, light: 60, lineColour: "#1c1b19" } },
    moves: (v, st) => st(panBy(v, [0, 0], [0.2, 0.3])),
  },
  {
    name: "look_4_5_pixel_lines",
    content: { group: [4, 5, 2], colouring: "parity", sides: [true, true, true], lineWidth: 1.5, lineUnit: "px", look: { ...DEFAULT_LOOK, palette: "Ink & paper", lineColour: "#1c1b19" } },
    moves: (v) => v,
  },
  // at the zoom-in limit (a pixel covers 1e-5 of the plane) on the corner P of the triangle, where
  // 2p tiles meet: 6-pixel lines and the colour wedges test float32 at its tightest
  ...(["poincare", "klein", "halfplane", "local"] as const).map((model): Case => ({
    name: `${model}_7_3_at_limit`,
    model,
    content: { group: [7, 3, 2], colouring: "parity", sides: [true, true, true], lineWidth: 6e-5 },
    moves: (v, st) => repeat(25, (w) => st(zoom(w, [0.11, -0.07], 2)))(st(panBy(v, [0, 0], [0.11, -0.07]))),
  })),
  // step 8: the unit grid over a tiling and on plain content, in every view and all three kinds
  {
    name: "grid_cartesian_7_3_home",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03, grid: { on: true, kind: "cartesian", unit: "earth" } },
    moves: (v) => v,
  },
  {
    name: "grid_cartesian_porcelain_moved",
    content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Porcelain", source: "inside", density: 1, lineColour: "#0d2347" }, grid: { on: true, kind: "cartesian", unit: "R" } },
    moves: (v, st) => repeat(3, (w) => st(zoom(rotateBy(panBy(w, [0.3, 0.2], [-0.1, -0.15]), 0.3), [0.2, 0.1], 1.6)))(v),
  },
  {
    name: "grid_cartesian_plain_moved",
    content: plainGrid("cartesian"),
    moves: (v, st) => repeat(6, (w) => st(zoomAt(rotateBy(panBy(w, [0.3, 0.2], [-0.2, -0.1]), 0.4), [0.2, -0.1], 1.8, SIZE, MIN_FOOTPRINT_PLAIN).view))(v),
  },
  {
    name: "klein_grid_cartesian_plain_moved",
    model: "klein",
    content: plainGrid("cartesian", "earth"),
    moves: (v, st) => repeat(4, (w) => st(rotateBy(panBy(w, [0.3, -0.1], [-0.1, 0.2]), 0.3)))(v),
  },
  { name: "halfplane_grid_cartesian_plain_home", model: "halfplane", content: plainGrid("cartesian", "earth"), moves: (v) => v },
  {
    name: "local_grid_cartesian_plain_zoomed_in",
    model: "local",
    content: plainGrid("cartesian", "m"),
    moves: (v, st) => zoomTo(1e-4, [0.3, 0.2])(st(rotateBy(panBy(v, [0.4, 0.1], [0, -0.2]), 0.2)), st),
  },
  {
    // the precision case of the plan: 1e-9 R per pixel 30 R from the axis, X0 with 256 bits
    name: "grid_cartesian_precision_y30",
    content: plainGrid("cartesian"),
    moves: (v, st) => gridAt("cartesian", { s: (123456789n << 230n) + 987654321n, e: 30, theta: 0.4 })(zoomTo(1e-9, [0.1, -0.05])(v, st)),
  },
  {
    name: "local_grid_cartesian_limit_y_55",
    model: "local",
    content: plainGrid("cartesian", "earth"),
    moves: (v, st) => gridAt("cartesian", { s: -(77n << 240n) - 12345n, e: -55, theta: -2 })(zoomTo(1.2e-11, [0.2, 0.1])(v, st)),
  },
  { name: "grid_polar_plain_home", content: plainGrid("polar", "earth"), moves: (v) => v },
  {
    name: "grid_polar_7_3_moved",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03, grid: { on: true, kind: "polar", unit: "earth" } },
    moves: (v, st) => repeat(3, (w) => st(zoom(panBy(w, [0.2, 0.1], [-0.3, 0.1]), [0.1, 0.1], 1.5)))(v),
  },
  {
    name: "local_grid_polar_centre_zoomed_in",
    model: "local",
    content: plainGrid("polar"),
    moves: (v, st) => zoomTo(2e-6, [0, 0])(st(panBy(v, [0, 0], [1e-3, 2e-3])), st),
  },
  {
    name: "halfplane_grid_polar_precision_r30",
    model: "halfplane",
    content: plainGrid("polar"),
    moves: (v, st) => gridAt("polar", { s: (0x1234567n << 225n) + 99n, e: 30, theta: 1.1 })(zoomTo(1e-9, [0.2, 0.3])(v, st)),
  },
  { name: "halfplane_grid_horocyclic_plain_home", model: "halfplane", content: plainGrid("horocyclic", "earth"), moves: (v) => v },
  {
    name: "klein_grid_horocyclic_7_3_moved",
    model: "klein",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03, grid: { on: true, kind: "horocyclic", unit: "earth" } },
    moves: (v, st) => repeat(4, (w) => st(rotateBy(panBy(w, [0.3, -0.1], [-0.1, 0.2]), -0.3)))(v),
  },
  {
    name: "grid_horocyclic_precision_up_30",
    content: plainGrid("horocyclic"),
    moves: (v, st) => gridAt("horocyclic", { s: (98765n << 256n) + (5n << 200n), e: -30, theta: 0.4 })(zoomTo(1e-9, [-0.1, 0.05])(v, st)),
  },
  {
    name: "local_grid_horocyclic_limit_down_55",
    model: "local",
    content: plainGrid("horocyclic", "R"),
    moves: (v, st) => gridAt("horocyclic", { s: -(3n << 256n), e: 55, theta: 2.5 })(zoomTo(1.2e-11, [0.1, 0.1])(v, st)),
  },
];

test.beforeAll(() => mkdirSync("test-results/reference", { recursive: true }));

// a grid is drawn once over the samples (still pictures), and in every sample (moving frames)
for (const c of CASES)
  for (const gridPerSample of c.content.grid?.on ? [false, true] : [false]) {
    const name = gridPerSample ? `${c.name}_per_sample` : c.name;
    test(`shader matches the reference: ${name}`, async ({ page }) => {
      const content = buildContent(c.content);
      const view = c.moves(homeView(content.colouring.k, c.model), (v) => settle(v, content.group, content.colouring));
      const [W, H] = c.size ?? [SIZE, SIZE];
      const both = shots(content, view, W, H);
      const shot = { ...both.cpu, gridPerSample };
      const hookShot = { ...both.gpu, gridPerSample };

      await page.goto("/");
      await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
      expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
      if (c.content.tileImage)
        for (const p of PICTURES)
          await page.evaluate(([id, b, w, h]) => window.hyperscope.addPicture!(id, b, w, h), [p.id, Buffer.from(testPicture(p.width, p.height, p.alpha)).toString("base64"), p.width, p.height] as [string, string, number, number]);
      const b64 = await page.evaluate((s) => window.hyperscope.renderShot!(s), hookShot);
      const gpu = new Uint8Array(Buffer.from(b64, "base64"));
      const ref = toRGBA8(renderView(shot), W, H);
      const probes = ([[1e-3, 0], [-1e-3, 0], [0, 1e-3], [0, -1e-3]] as [number, number][]).map((offset) =>
        toRGBA8(renderView({ ...shot, offset }), W, H),
      );

      let within = 0;
      let unexplained = 0;
      let worst = 0;
      const diff = new Uint8Array(gpu.length);
      for (let i = 0; i < gpu.length; i += 4) {
        const d = Math.max(Math.abs(gpu[i] - ref[i]), Math.abs(gpu[i + 1] - ref[i + 1]), Math.abs(gpu[i + 2] - ref[i + 2]));
        worst = Math.max(worst, d);
        diff[i + 3] = 255;
        if (d <= TOL) {
          within++;
          continue;
        }
        const sensitive = probes.some((p) => Math.max(Math.abs(p[i] - ref[i]), Math.abs(p[i + 1] - ref[i + 1]), Math.abs(p[i + 2] - ref[i + 2])) > TOL);
        if (sensitive) diff[i + 1] = 160;
        else {
          unexplained++;
          diff[i] = 255;
        }
      }
      const n = W * H;
      const dir = `test-results/reference/${name}`;
      writeFileSync(`${dir}_gpu.png`, encodePNG(gpu, W, H));
      writeFileSync(`${dir}_ref.png`, encodePNG(ref, W, H));
      writeFileSync(`${dir}_diff.png`, encodePNG(diff, W, H));
      console.log(`${name}: ${((100 * within) / n).toFixed(3)}% within ${TOL}/255, ${unexplained} unexplained, worst ${worst}/255, ${describePicture(view.picture)}`);
      expect(within / n).toBeGreaterThanOrEqual(0.995);
      expect(unexplained).toBe(0);
    });
  }

test("the depth picture stays as it was when the start moves nearer on a long trip", async ({ page }) => {
  const content = buildContent({ group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02, look: { ...DEFAULT_LOOK, palette: "Aurora", source: "depth", density: 1 / 12 } });
  let v = homeView(content.colouring.k);
  let pair: [ViewState, ViewState] | null = null;
  while (!pair) {
    const moved = rotateBy(panBy(v, [0, 0], [0.05, 0.01]), 0.003);
    const next = settle(moved, content.group, content.colouring);
    // before settling, the moved view still counts from the old start
    if (next.shift !== v.shift) pair = [moved, next];
    v = next;
  }
  await page.goto("/");
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  const draw = async (w: ViewState) => new Uint8Array(Buffer.from(await page.evaluate((s) => window.hyperscope.renderShot!(s), shots(content, w, SIZE, SIZE).gpu), "base64"));
  const [before, after] = [await draw(pair[0]), await draw(pair[1])];
  expect(pair[1].shift).not.toBe(0);
  let worst = 0;
  let off = 0;
  for (let i = 0; i < before.length; i++) {
    const d = Math.abs(before[i] - after[i]);
    worst = Math.max(worst, d);
    if (d > TOL) off++;
  }
  console.log(`start moved by ${pair[1].shift} walls: worst ${worst}/255, ${off} channels past ${TOL}`);
  expect(off).toBe(0);
});
