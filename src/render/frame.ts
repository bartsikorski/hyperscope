// Packs one frame's numbers into the std140 `Frame` block declared in shaders/common.glsl.
// Offsets are in 4-byte words and must match the block's comments.

import type { Perm } from "../math/colourings.ts";
import { MAX_COLOURS, pairPerms } from "../math/colourings.ts";
import { identityTile, tileIdentity } from "../math/tileid.ts";
import { MAX_WY_FACES, MAX_WY_LINES } from "../math/wythoff.ts";
import type { Motif } from "../math/motifs.ts";
import { MAX_CURVE_POINTS, MAX_FEATURE_POINTS, MAX_FEATURES } from "../math/motifs.ts";
import type { GridFrame } from "../math/grid.ts";
import { UNITS } from "../math/grid.ts";
import type { Mat3 } from "../math/lorentz.ts";
import type { Picture } from "../math/views.ts";
import { viewUniform } from "../math/views.ts";
import type { RGB, TilingScene } from "./reference.ts";
import { AXIS_OPACITY, AXIS_WIDTH_PX, CENTRE_DOT_PX, DARK, DARK_BAND, GRID_OPACITY } from "./grid.ts";
import { BEVEL_WIDTH, FADE_END, FADE_START, GLOW_WIDTH, ICE, RING_ALPHA, RING_WIDTH_PX, startOf } from "./reference.ts";

export const FRAME_WORDS = 448;
/** The Motif block (tiling.glsl, binding 1). */
export const MOTIF_WORDS = 1116;

export interface FrameInput {
  /** Size of the render target in pixels (the canvas times the render scale). */
  width: number;
  height: number;
  camera: Mat3;
  picture: Picture;
  scene: TilingScene;
  /** Edge ring colour, ICE when left out. */
  accent?: RGB;
  /** This sample's offset in pixels, x right and y down (samples.ts); the pixel centre when left out. */
  offset?: [number, number];
  /** The unit grid's numbers for this frame (math/grid.ts gridFrame); no grid when left out. */
  grid?: GridFrame | null;
  /** Subtracted from u's x: a band strip's centre on the screen (input/strips.ts); 0 when left out. */
  du?: number;
  /** A band strip's depth fog (input/strips.ts Strip.fog); none when left out. */
  depthFog?: [number, number, number, number];
}

/** Three bits per colour, colour i in bits 3i..3i+2. */
export function packPerm(p: Perm): number {
  let v = 0;
  for (let i = 0; i < p.length; i++) v |= p[i] << (3 * i);
  return v >>> 0;
}

export function packFrame(f: FrameInput, buf = new ArrayBuffer(FRAME_WORDS * 4)): ArrayBuffer {
  const fl = new Float32Array(buf);
  const ui = new Uint32Array(buf);
  fl.fill(0);
  const { camera: m, picture: pic, scene } = f;
  const { group, colouring, style, shading: sh } = scene;
  if (colouring.k > MAX_COLOURS) throw new Error(`at most ${MAX_COLOURS} colours, got ${colouring.k}`);
  if (style.colours.length > MAX_COLOURS) throw new Error(`at most ${MAX_COLOURS} colours, got ${style.colours.length}`);
  if (import.meta.env?.DEV && m.some((v) => Math.abs(v) > 1e4)) console.warn("camera entry above 1e4 sent to the GPU", m);
  // mat3 in std140: three columns, each padded to a vec4; Mat3 is row-major
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) fl[4 * j + i] = m[3 * i + j];
  fl.set(viewUniform(pic), 12);
  fl.set([f.width, f.height, 2 / f.height, f.du ?? 0], 16);
  group.normals.forEach((n, j) => fl.set(n, 20 + 4 * j));
  style.colours.forEach((c, i) => fl.set(c, 32 + 4 * i));
  fl.set([...style.lineColour, style.lineWidth], 64);
  fl.set(style.background, 68);
  fl.set([...sh.rim, group.inradius], 72);
  fl.set([FADE_START, FADE_END], 76);
  if (colouring.kind === "chiral") {
    // tiling.glsl pairPerm's slots: tau_01, tau_02, tau_10, tau_12, tau_20, tau_21
    const t = pairPerms(colouring);
    ui.set([packPerm(scene.cameraPerm), 0, 0, 0], 80);
    ui.set([t[0][1], t[0][2], t[1][0], t[1][2], t[2][0], t[2][1]].map(packPerm), 212);
  } else ui.set([packPerm(scene.cameraPerm), ...colouring.sigma.map(packPerm)], 80);
  // the colour count: the colouring's (a Wythoff tiling's kinds), or for Mosaic its discrete set's (0 for
  // a gradient)
  const wy = scene.wythoff;
  const count = style.source === "mosaic" ? style.colours.length : wy ? wy.kinds : colouring.k;
  ui.set([count, style.sides.reduce((mask, on, j) => mask | (on ? 1 << j : 0), 0), sh.edgeMask, style.lineUnit === "px" ? 1 : 0], 84);
  if (style.source === "mosaic") {
    const ids = tileIdentity(group);
    const a = scene.cameraTile ?? identityTile();
    for (let r = 0; r < 3; r++) ui.set([a[3 * r], a[3 * r + 1], a[3 * r + 2]], 220 + 4 * r);
    ids.d.forEach((d, r) => ui.set([...d, r === 0 ? ids.l : 0], 232 + 4 * r));
    ui.set(ids.w, 244);
    ui.set(ids.w3, 248);
  }
  if (wy) {
    if (wy.lines.length > MAX_WY_LINES || wy.faces.length > MAX_WY_FACES) throw new Error(`a Wythoff tiling of ${wy.lines.length} lines and ${wy.faces.length} faces does not fit the Frame block`);
    wy.lines.forEach((m, e) => fl.set([...m, wy.sides[e][0] + 32 * wy.sides[e][1]], 252 + 4 * e));
    wy.faces.forEach((f, i) => {
      ui.set([f.mask, f.want, f.kind + 16 * Math.max(0, wy.colourOf[f.kind]), 0], 316 + 4 * i);
      ui.set([...f.id, f.kind], 380 + 4 * i);
    });
    ui.set([wy.lines.length, wy.matching, wy.faces.length, 0], 444);
  }
  const [ox, oy] = f.offset ?? [0, 0];
  fl.set([ox, -oy, RING_WIDTH_PX, RING_ALPHA], 88);
  fl.set(f.accent ?? ICE, 92);
  fl.set([style.phase, style.density, sh.maxInside, style.glow], 96);
  fl.set([GLOW_WIDTH * sh.maxInside, BEVEL_WIDTH * sh.maxInside, style.relief, sh.lineLengthPerArea], 100);
  const start = startOf(scene);
  fl.set([Math.cos(style.light), Math.sin(style.light), start.tol], 104);
  fl.set([...sh.avgFill, sh.avgFactor], 108);
  fl.set(sh.avgGlow, 112);
  fl.set([...start.s, start.walls], 116);
  const g = f.grid;
  if (g) {
    const { e, theta } = g.camera;
    fl.set([Math.cos(theta), Math.sin(theta), Math.tanh(e), g.kind === "horocyclic" ? Math.exp(e) : Math.cosh(e)], 120);
    fl.set([e, g.s0, g.kBase, g.kTop], 124);
    fl.set([Math.log10(UNITS[g.unit].perR), GRID_OPACITY, AXIS_OPACITY, AXIS_WIDTH_PX], 128);
    fl.set([CENTRE_DOT_PX, DARK, DARK_BAND], 132);
    g.slots.forEach((s, i) => {
      const hi = Math.fround(s.frac);
      fl.set([s.phaseE, 1 / s.delta, hi, s.frac - hi], 136 + 4 * i);
      fl.set([s.uScale, s.m0, s.delta, Math.log2(s.delta)], 168 + 4 * i);
      ui[200 + i] = s.bits;
    });
  }
  fl.set(f.depthFog ?? [0, 1, 0, 0], 208);
  return buf;
}

/** Packs a motif into the std140 `Motif` block declared in shaders/content/tiling.glsl (word offsets
 *  as its comments give them). It changes only with the content, so the renderer uploads it then. */
export function packMotif(m: Motif, buf = new ArrayBuffer(MOTIF_WORDS * 4)): ArrayBuffer {
  const fl = new Float32Array(buf);
  const ui = new Uint32Array(buf);
  fl.fill(0);
  if (m.c1.length > MAX_CURVE_POINTS || m.c2.length > MAX_CURVE_POINTS || m.features.length > MAX_FEATURES) throw new Error("the motif does not fit the Motif block");
  fl.set([...m.turnP, ...m.turnQ], 0);
  fl.set([...m.awayPR, ...m.awayQR], 4);
  fl.set([Math.cosh(m.dPQ), Math.sinh(m.dPQ)], 8);
  ui.set([m.c1.length, m.c2.length, m.features.length, m.cell], 12);
  fl.set(m.bound1, 16);
  fl.set(m.bound2, 20);
  // Mosaic's cell: the kite's vector (fixed by no reflection) as a snub triangle's, or the polygon's
  // around P (tileid.ts faceHash of kind 3, or mosaicHash, which is faceHash of kind 0)
  const ids = tileIdentity(m.group);
  ui.set(m.cell === 1 ? [...ids.w, 0] : [...ids.vt, 3], 24);
  m.c1.forEach((w, i) => fl.set(w, 28 + 2 * i));
  m.c2.forEach((w, i) => fl.set(w, 124 + 2 * i));
  let first = 0;
  m.features.forEach((f, i) => {
    ui.set([f.kind, f.slot, first, f.points.length], 220 + 4 * i);
    fl.set(f.geo, 316 + 4 * i);
    fl.set([...f.rot, f.tone], 412 + 4 * i);
    fl.set(f.bound, 508 + 4 * i);
    f.points.forEach((p, k) => fl.set(p, 604 + 4 * (first + k)));
    first += f.points.length;
  });
  if (first > MAX_FEATURE_POINTS) throw new Error("the motif's features do not fit the Motif block");
  return buf;
}
