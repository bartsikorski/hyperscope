// Content state -> what the renderer draws: the triangle group, its colouring, the look and the
// constants derived from them. Groups and colourings are built once per content and cached.

import type { RGB } from "../math/colour.ts";
import { hex } from "../math/colour.ts";
import type { Colouring } from "../math/colourings.ts";
import type { GridSettings } from "../math/grid.ts";
import { faces2, findChiralColourings, findColourings, parity, rotationOrbit, validate } from "../math/colourings.ts";
import type { TriangleGroup } from "../math/groups.ts";
import { triangleGroup } from "../math/groups.ts";
import type { Perm } from "../math/colourings.ts";
import type { Mat3 } from "../math/lorentz.ts";
import type { TileMat } from "../math/tileid.ts";
import { identityTile } from "../math/tileid.ts";
import type { Model } from "../math/views.ts";
import type { Construction, Weights, Wythoff } from "../math/wythoff.ts";
import { activeOf, snubWeights, wythoff as wythoffTables } from "../math/wythoff.ts";
import type { LineUnit, ScenePicture, Shading, TilingScene, TilingStyle } from "../render/reference.ts";
import { classMean, shadingOf } from "../render/reference.ts";
import type { Motif, MotifSpec } from "../math/motifs.ts";
import type { LookState } from "./looks.ts";
import { DEFAULT_LOOK } from "./looks.ts";
import type { MotifRef } from "./motifs.ts";
import { cleanMotifSpec, MOTIFS, motifOf, motifSpecOf } from "./motifs.ts";
import { paletteByName, paletteTable, samplePalette } from "./palettes.ts";
import type { TileImageState } from "./tileimage.ts";
import { pictureImage, pictureMap } from "./tileimage.ts";

export interface ContentState {
  group: [number, number, number];
  /** "parity", "faces", "c<n>" for the n-th mirror colouring the search finds or "r<n>" for the n-th
   *  chiral one (1-based; math/colourings.ts). */
  colouring: string;
  sides: [boolean, boolean, boolean];
  /** Line width in plane units, or in pixels when lineUnit is "px". */
  lineWidth: number;
  lineUnit?: LineUnit;
  /** How it is coloured; the default look when left out. */
  look?: LookState;
  /** No tiling, a flat fill under the unit grid (the group still re-centres the camera). */
  plain?: boolean;
  /** The unit grid; off when left out. */
  grid?: GridSettings;
  /** A Wythoff tiling (math/wythoff.ts CONSTRUCTIONS); version 1's tiling ("lines") when left out. */
  construction?: Construction;
  /** The free point's three weights (construction "free"). */
  weights?: Weights;
  /** A motif (content/motifs.ts): a built-in's id or a loaded motif's spec. Its group is the
   *  content's; it is drawn instead of a Wythoff tiling. */
  motif?: MotifRef;
  /** Your own tile picture (content/tileimage.ts): drawn over Lines without a motif while the
   *  tiling is shown, kept but hidden otherwise. */
  tileImage?: TileImageState;
}

export interface Content {
  state: ContentState;
  group: TriangleGroup;
  colouring: Colouring;
  /** The Wythoff tiling's tables, or null for version 1's. */
  wythoff: Wythoff | null;
  /** The motif compiled, or null. */
  motif: Motif | null;
  /** The tile picture as drawn, or null: none, hidden, or not decoded yet. */
  picture: ScenePicture | null;
  style: TilingStyle;
  shading: Shading;
  label: string;
}

export const BACKGROUND = hex("#05060a");
/** The fill of plain content: a shade above the background, so the picture's edge shows. */
export const PLAIN_FILL = hex("#0d1119");

export interface Preset {
  label: string;
  content: ContentState;
  /** The name of the look the gallery shows it in (looks.ts); C keeps the look on the screen. */
  look: string;
  /** The view the gallery opens it in; the view on the screen when left out. */
  model?: Model;
}

/** The built-in presets: C and Shift+C step through their tilings, the gallery opens them whole.
 *  The golden images draw each in every view with the first look, so their order matters there. */
export const PRESETS: Preset[] = [
  { label: "{7,3} heptagons", look: "Gilded", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 } },
  { label: "{5,4} pentagons", look: "Porcelain", content: { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.03 } },
  { label: "{6,4} in three colours", look: "Escher", content: { group: [6, 4, 2], colouring: "c8", sides: [true, true, true], lineWidth: 0.012 } },
  { label: "{8,3} octagons", look: "Midnight", content: { group: [8, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 } },
  { label: "{4,5} squares", look: "Blueprint", content: { group: [4, 5, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 } },
  { label: "(2,3,7) triangles", look: "Ink", content: { group: [2, 3, 7], colouring: "parity", sides: [true, true, true], lineWidth: 0.008 } },
  { label: "{3,7} triangles", look: "Nebula", content: { group: [3, 7, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.02 } },
  { label: "(3,3,4) triangles", look: "Aurora", content: { group: [3, 3, 4], colouring: "parity", sides: [true, true, true], lineWidth: 0.008 } },
  { label: "{7,3} chiral, seven colours", look: "Gilded", content: { group: [7, 3, 2], colouring: "r1", sides: [false, true, true], lineWidth: 0.012 } },
  // Wythoff tilings (step 15), chosen on test renders
  { label: "Snub {7,3}", look: "Escher", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.012, construction: "snub" } },
  { label: "Omnitruncated {7,3}", look: "Blueprint", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.01, construction: "111" } },
  { label: "Truncated {3,7}", look: "Ink", content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.012, construction: "101" } },
  { label: "Snub {5,4}", look: "Mosaic", content: { group: [5, 4, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.012, construction: "snub" } },
  // motifs (step 16), our own designs, each in the look its sheet read best in; the label is the
  // motif's name with its group (motifName), as the title shows a motif chosen by hand
  { label: "Shoal (3,3,4)", look: "Gilded", content: { group: [3, 3, 4], colouring: "r2", sides: [false, false, false], lineWidth: 0.012, motif: "shoal" } },
  { label: "Moths {6,4}", look: "Ink", content: { group: [6, 4, 2], colouring: "c3", sides: [false, false, false], lineWidth: 0.012, motif: "moths" } },
  { label: "Rosette {8,3}", look: "Mosaic", content: { group: [8, 3, 2], colouring: "c4", sides: [false, false, false], lineWidth: 0.012, motif: "rosette" } },
  { label: "Birds (4,4,3)", look: "Escher", content: { group: [4, 4, 3], colouring: "r2", sides: [false, false, false], lineWidth: 0.012, motif: "birds" } },
  {
    label: "Unit grid",
    look: "Graphite",
    content: { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03, plain: true, grid: { on: true, kind: "cartesian", unit: "km" } },
  },
];

const searched = new Map<string, { mirror: Colouring[]; chiral: Colouring[] }>();

function searchedFor(g: TriangleGroup): { mirror: Colouring[]; chiral: Colouring[] } {
  const key = `${g.p},${g.q},${g.r}`;
  let hit = searched.get(key);
  if (!hit) searched.set(key, (hit = { mirror: findColourings(g), chiral: findChiralColourings(g) }));
  return hit;
}

export function colouringFor(g: TriangleGroup, name: string): Colouring {
  if (name === "parity") return parity;
  if (name === "faces") {
    const why = validate(faces2, g);
    if (why) throw new Error(`Faces colouring does not fit (${g.p}, ${g.q}, ${g.r}): ${why}`);
    return faces2;
  }
  const m = /^([cr])(\d+)$/.exec(name);
  if (!m) throw new Error(`unknown colouring "${name}"`);
  const found = searchedFor(g);
  const list = m[1] === "c" ? found.mirror : found.chiral;
  const c = list[Number(m[2]) - 1];
  if (!c) throw new Error(`(${g.p},${g.q},${g.r}) has ${list.length} ${m[1] === "c" ? "colourings" : "chiral colourings"}, not ${m[2]}`);
  return c;
}

/** Linear colour of each class of a k-colouring: a discrete set in order (the phase shifts it by
 *  whole colours), or k evenly spaced points of a gradient starting at the phase. A discrete set with
 *  fewer colours than the colouring is used as its gradient. */
export function classColours(look: LookState, k: number): RGB[] {
  const p = paletteByName(look.palette);
  if (p.colours && p.colours.length >= k) return discreteColours(look, k);
  const table = paletteTable(p);
  return Array.from({ length: k }, (_, i) => samplePalette(table, look.phase + i / k, 0));
}

/** The first k colours of a discrete set from the phase on (in steps of one colour), as linear RGB. */
function discreteColours(look: LookState, k: number): RGB[] {
  const set = paletteByName(look.palette).colours!;
  const n = set.length;
  const shift = Math.round(look.phase * n);
  return Array.from({ length: k }, (_, i) => hex(set[(((i + shift) % n) + n) % n]));
}

/** Mosaic's colours: the whole discrete set from the phase on, or none for a gradient (it samples
 *  the palette at the phase plus each tile's hash). */
export function mosaicColours(look: LookState): RGB[] {
  const p = paletteByName(look.palette);
  return p.colours ? discreteColours(look, p.colours.length) : [];
}

/** The colourings offered for a group, as ContentState names, by colour count: parity, faces when it
 *  fits, the search's mirror colourings that are not one of those two, and with each count its chiral
 *  ones after the mirror ones. */
export function colouringNames(g: TriangleGroup): string[] {
  const names: [string, number][] = [["parity", 2]];
  if (!validate(faces2, g)) names.push(["faces", 2]);
  const same = (a: Colouring, b: Colouring) => a.kind !== "chiral" && b.kind !== "chiral" && a.k === b.k && a.sigma.every((s, j) => s.join() === b.sigma[j].join());
  const found = searchedFor(g);
  found.mirror.forEach((c, i) => {
    if (!same(c, parity) && !same(c, faces2)) names.push([`c${i + 1}`, c.k]);
  });
  found.chiral.forEach((c, i) => names.push([`r${i + 1}`, c.k]));
  // a stable sort keeps mirror before chiral within a count
  return names.sort((a, b) => a[1] - b[1]).map(([n]) => n);
}

export function buildContent(state: ContentState, label = ""): Content {
  const group = triangleGroup(...state.group);
  const colouring = colouringFor(group, state.colouring);
  const motif = state.motif === undefined ? null : motifOf(state.motif);
  if (motif && motif.group.p + "," + motif.group.q + "," + motif.group.r !== state.group.join()) throw new Error(`the motif ${motif.spec.name} is drawn for (${motif.spec.group.join(", ")}), not (${state.group.join(", ")})`);
  const wythoff = motif ? null : wythoffOf(group, state);
  const look = state.look ?? DEFAULT_LOOK;
  // a Wythoff tiling colours its face kinds as a colouring with that many classes
  const colours = look.source === "mosaic" ? mosaicColours(look) : classColours(look, wythoff ? wythoff.kinds : colouring.k);
  const style: TilingStyle = {
    source: look.source,
    colours,
    palette: paletteTable(paletteByName(look.palette)),
    phase: look.phase,
    density: look.density,
    sides: state.sides,
    lineWidth: state.lineWidth,
    lineUnit: state.lineUnit ?? "plane",
    lineColour: hex(look.lineColour),
    background: BACKGROUND,
    glow: look.glow,
    relief: look.relief,
    light: (look.light * Math.PI) / 180,
  };
  // a motif's tiles take the colours of colour 0's orbit under the rotations, each as often
  const mean = motif && look.source === "colouring" ? classMean(rotationOrbit(colouring).map((i) => colours[i]), rotationOrbit(colouring).length) : classMean(colours, colours.length);
  const picture = pictureHiddenBy(state) === null ? scenePicture(state.tileImage!, group) : null;
  let shading = shadingOf(group, style, mean, wythoff, motif, picture);
  if (state.plain) shading = { ...shading, rim: PLAIN_FILL };
  return { state, group, colouring, wythoff, motif, picture, style, shading, label };
}

/** The picture as the renderers draw it, or null while it is not decoded. */
function scenePicture(t: TileImageState, group: TriangleGroup): ScenePicture | null {
  const image = pictureImage(t.id);
  if (!image) return null;
  return { image, mode: t.mode, tint: !!t.tint, map: pictureMap(group, t.mode, t.place, image.width, image.height, image.levels.length) };
}

/** What hides the content's tile picture ("plain", "construction" or "motif"), "none" when there is
 *  no picture, or null when it is drawn (once decoded). */
export function pictureHiddenBy(state: ContentState): "none" | "plain" | "construction" | "motif" | null {
  if (!state.tileImage) return "none";
  if (state.plain) return "plain";
  if ((state.construction ?? "lines") !== "lines") return "construction";
  if (state.motif !== undefined) return "motif";
  return null;
}

/** The content with a tile picture, or none (null). A picture is drawn over Lines without a motif,
 *  with the tiling shown, so it sets those; the lines stay as they are. */
export function withTileImage(state: ContentState, t: TileImageState | null): ContentState {
  const next: ContentState = { ...state };
  if (t === null) {
    delete next.tileImage;
    return next;
  }
  delete next.construction;
  delete next.weights;
  delete next.motif;
  delete next.plain;
  return { ...next, tileImage: t };
}

/** The content with another construction. A Wythoff tiling chosen over version 1's turns its lines
 *  off (they can be turned back on, to show the triangles under it); Lines with no lines on gets the
 *  tile edges back. A free point starts where the construction it replaces had its point. */
export function withConstruction(state: ContentState, c: Construction, weights?: Weights): ContentState {
  const was = state.construction ?? "lines";
  const next: ContentState = { ...state, construction: c };
  delete next.weights;
  // a motif is drawn over Lines only
  if (c !== "lines") delete next.motif;
  if (c === "lines") {
    delete next.construction;
    if (!state.sides.some(Boolean)) next.sides = [false, false, true];
    return next;
  }
  if (was === "lines") next.sides = [false, false, false];
  if (c === "free")
    next.weights = weights ?? (was === "free" || was === "lines" ? (state.weights ?? [1, 1, 1]) : was === "snub" ? snubWeights(triangleGroup(...state.group)) : activeOf(was));
  return next;
}

/** The content with a motif, or none (null). A motif brings its group and default colouring, draws
 *  over version 1's tiling (Construction goes back to Lines), shows the tiling if it was off and
 *  turns the lines off (they can be turned back on); none gets the tile edges back when no lines
 *  are on. */
export function withMotif(state: ContentState, ref: MotifRef | null): ContentState {
  const next: ContentState = { ...state };
  if (ref === null) {
    delete next.motif;
    if (!state.sides.some(Boolean)) next.sides = [false, false, true];
    return next;
  }
  const spec = motifSpecOf(ref);
  delete next.construction;
  delete next.weights;
  delete next.plain;
  return { ...next, motif: ref, group: [...spec.group], colouring: spec.colouring, sides: [false, false, false] };
}

/** Why a motif cannot be drawn with this group (refused, made for another group, or its colouring
 *  does not fit its group), or null when it can. */
export function motifProblem(ref: MotifRef, group: readonly [number, number, number]): string | null {
  let m: Motif;
  try {
    m = motifOf(ref);
  } catch (e) {
    return (e as Error).message;
  }
  const g = m.spec.group;
  if (g.join() !== group.join()) return `${m.spec.name} is drawn for (${g.join(", ")}), not (${group.join(", ")})`;
  try {
    colouringFor(m.group, m.spec.colouring);
  } catch (e) {
    return `its colouring: ${(e as Error).message}`;
  }
  return null;
}

/** A motif file read: its spec (the format's fields only), or why it was refused. */
export function readMotif(json: unknown): { ok: true; spec: MotifSpec } | { ok: false; reason: string } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false, reason: "a motif is a JSON object" };
  const spec = cleanMotifSpec(json);
  const g = spec.group;
  const why = motifProblem(spec, Array.isArray(g) && g.length === 3 ? (g as [number, number, number]) : [0, 0, 0]);
  return why ? { ok: false, reason: why } : { ok: true, spec };
}

/** The motif's name with its group, as the title shows it: Shoal (3,3,4), Moths {6,4}. */
export function motifName(ref: MotifRef): string {
  const spec = motifSpecOf(ref);
  const [p, q, r] = spec.group;
  return `${spec.name} ${r === 2 ? `{${p},${q}}` : `(${p},${q},${r})`}`;
}

/** The built-in motifs' ids, for the M key and the card's list. */
export const MOTIF_IDS = MOTIFS.map((m) => m.id);

/** The content's Wythoff tables, or null for version 1's tiling. */
export function wythoffOf(group: TriangleGroup, state: Pick<ContentState, "construction" | "weights">): Wythoff | null {
  const c = state.construction ?? "lines";
  if (c === "lines") return null;
  if (c === "free" && !state.weights) throw new Error("a free point needs its weights");
  return wythoffTables(group, c, state.weights);
}

/** What the renderers draw for this content seen from a view. */
export function sceneOf(content: Content, view: { perm: Perm; tile?: TileMat; origin: Mat3; shift?: number }): TilingScene {
  return {
    group: content.group,
    colouring: content.colouring,
    cameraPerm: view.perm,
    cameraTile: view.tile ?? identityTile(),
    style: shifted(content.style, view.shift ?? 0),
    shading: content.shading,
    origin: view.origin,
    plain: content.state.plain,
    wythoff: content.wythoff,
    motif: content.motif,
    picture: content.picture,
  };
}

/** The depth colouring counts `shift` more walls than from the view's start (camera.ts ViewState):
 *  palettes repeat with period 1, so this is a phase, reduced in float64. */
export function shifted(style: TilingStyle, shift: number): TilingStyle {
  if (style.source !== "depth" || shift === 0) return style;
  const t = style.phase + style.density * shift;
  return { ...style, phase: t - Math.floor(t) };
}
