// The saved state (design notes, step 9): what is on the screen as one versioned object, for the
// session, presets and the text chunk of a screenshot (JSON keeps every float64 exactly, except
// that -0 reads back as 0), and as a link (readable keys for the settings, base64url float64 for
// the camera, bit exact). Reading checks every
// field and returns the state or the reason it was refused; it never throws. A tile picture (step
// 17) is saved by its id; files that must stand alone (screenshots, exported presets) also carry its
// data URL, which reading returns beside the state.

import type { ViewState } from "../input/camera.ts";
import { HB_WALL_GAP, homeView } from "../input/camera.ts";
import type { ColourSource, LookState } from "../content/looks.ts";
import { DEFAULT_LOOK, LOOKS, SOURCES } from "../content/looks.ts";
import { PALETTES } from "../content/palettes.ts";
import type { ContentState } from "../content/scene.ts";
import { colouringFor, motifProblem, wythoffOf } from "../content/scene.ts";
import { cleanMotifSpec, MOTIFS } from "../content/motifs.ts";
import type { Placement, TileImageState, TileMode } from "../content/tileimage.ts";
import { DEFAULT_PLACEMENT, PLACE_LIMITS, TILE_MODES } from "../content/tileimage.ts";
import { sha256 } from "./sha256.ts";
import { identityPerm } from "../math/colourings.ts";
import type { GridCamera, GridCameras, GridKind, GridSettings, GridUnit } from "../math/grid.ts";
import { GRID_KINDS, GRID_UNITS, homeGrids } from "../math/grid.ts";
import type { TriangleGroup } from "../math/groups.ts";
import { triangleGroup } from "../math/groups.ts";
import { fitsTile, identityTile, isIdentityTile, tileIdentity } from "../math/tileid.ts";
import type { Mat3 } from "../math/lorentz.ts";
import { identity, isometryError } from "../math/lorentz.ts";
import type { Model, Picture } from "../math/views.ts";
import type { Construction, Weights } from "../math/wythoff.ts";
import { CONSTRUCTIONS } from "../math/wythoff.ts";
import {
  H3_MAX_FOV, H3_MAX_H, H3_MAX_PITCH, H3_MIN_FOV, H3_MIN_H, H3_MIN_PITCH, HB_MAX_DISTANCE, HB_MAX_ELEVATION, HB_MAX_FOV, HB_MIN_DISTANCE, HB_MIN_ELEVATION, HB_MIN_FOV, HOME,
  MIN_BAND_GAP, MODELS, hyperboloidGap,
} from "../math/views.ts";

/** Version 2 (milestone 2) adds the band picture and the picture inside H³; later steps add their
 *  optional fields to it. */
export const VERSION = 2;

export type Accent = "ice" | "gold" | "coral" | "lime" | "lilac";
export const ACCENTS: Record<Accent, string> = { ice: "#8fd3ff", gold: "#f2c14e", coral: "#ff8a7a", lime: "#b8f06a", lilac: "#c9a8ff" };
export const ACCENT_NAMES = Object.keys(ACCENTS) as Accent[];

export interface UiState {
  accent: Accent;
}
export const DEFAULT_UI: UiState = { accent: "ice" };

/** Everything that is saved: the view, the content and the interface settings. */
export interface Snapshot {
  view: ViewState;
  content: ContentState;
  ui: UiState;
}

/** A grid camera as JSON: S0 * 2^256 as a decimal string, E0, theta. */
type SavedGrid = [string, number, number];

/** A tile picture as saved: its settings and id, and in a file that stands alone its data URL. */
export type SavedTileImage = TileImageState & { src?: string };

export interface SavedState {
  v: number;
  view: { picture: Picture; camera: number[]; perm: number[]; tile?: number[]; origin: number[]; shift?: number; grids: Record<GridKind, SavedGrid> };
  content: ContentState & { tileImage?: SavedTileImage };
  ui: UiState;
}

/** A state read back; `images` holds the data URLs a file carried, by id. */
export type Loaded = { ok: true; state: Snapshot; images?: Record<string, string> } | { ok: false; reason: string };

/** Longest tile picture data URL a saved state may carry (characters). */
export const MAX_PICTURE_URL = 16_000_000;
const PICTURE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const PICTURE_ID = /^[0-9a-f]{64}$/;

/** Longest loaded motif a link reads (md=, base64url characters): 128 KB, well above the largest
 *  motif compileMotif takes written in full float64 (about 50 KB); it only stops a broken link. */
export const MAX_MOTIF_LINK = 131072;

/** Most sides of a triangle group a saved state may ask for (the HUD offers 2 to 20). */
export const MAX_ORDER = 64;

// --------------------------------------------------------------------------------- JSON form

export function save(s: Snapshot): SavedState {
  const grids = {} as Record<GridKind, SavedGrid>;
  for (const kind of GRID_KINDS) {
    const g = s.view.grids[kind];
    grids[kind] = [g.s.toString(), g.e, g.theta];
  }
  return {
    v: VERSION,
    view: {
      picture: pictureJson(s.view.picture),
      camera: [...s.view.camera],
      perm: [...s.view.perm],
      ...(s.view.tile && !isIdentityTile(s.view.tile) ? { tile: [...s.view.tile] } : {}),
      origin: [...s.view.origin],
      ...(s.view.shift ? { shift: s.view.shift } : {}),
      grids,
    },
    content: contentJson(s.content),
    ui: { accent: s.ui.accent },
  };
}

// the fields in one order, so that equal states save to equal text

function pictureJson(p: Picture): Picture {
  switch (p.model) {
    case "poincare": case "klein": return { model: p.model, c: [p.c[0], p.c[1]], sigma: p.sigma, s: p.s };
    case "halfplane": return { model: p.model, mu: p.mu };
    case "local": return { model: p.model, ell: p.ell };
    case "h3": return { model: p.model, h: p.h, pitch: p.pitch, fov: p.fov };
    case "hyperboloid": return { model: p.model, elevation: p.elevation, distance: p.distance, fov: p.fov };
    case "band": return { model: p.model, y0: p.y0, s: p.s };
  }
}

function contentJson(c: ContentState): ContentState {
  const l = c.look ?? DEFAULT_LOOK;
  const out: ContentState = { group: [...c.group], colouring: c.colouring, sides: [...c.sides], lineWidth: c.lineWidth };
  if (c.lineUnit !== undefined) out.lineUnit = c.lineUnit;
  out.look = { palette: l.palette, source: l.source, phase: l.phase, density: l.density, lineColour: l.lineColour, glow: l.glow, relief: l.relief, light: l.light };
  if (c.plain !== undefined) out.plain = c.plain;
  if (c.grid !== undefined) out.grid = { on: c.grid.on, kind: c.grid.kind, unit: c.grid.unit };
  // version 1's tiling ("lines") is the construction left out; the weights go with a free point only
  if (c.construction !== undefined && c.construction !== "lines") out.construction = c.construction;
  if (c.construction === "free" && c.weights) out.weights = [...c.weights];
  if (c.motif !== undefined) out.motif = typeof c.motif === "string" ? c.motif : cleanMotifSpec(c.motif);
  if (c.tileImage) {
    const t = c.tileImage;
    out.tileImage = { mode: t.mode, ...(t.tint ? { tint: true } : {}), place: { x: t.place.x, y: t.place.y, size: t.place.size, turn: t.place.turn }, id: t.id };
  }
  return out;
}

/** The saved state with its tile picture's data URL, where srcOf knows it: a file that stands alone. */
export function withPictures(s: SavedState, srcOf: (id: string) => string | undefined): SavedState {
  const t = s.content.tileImage;
  const src = t && srcOf(t.id);
  return src ? { ...s, content: { ...s.content, tileImage: { ...t, src } } } : s;
}

/** Migrations from each older version to the next. Version 2 only adds fields, so a version 1 state
 *  reads unchanged. */
const MIGRATIONS: Record<number, (o: Record<string, unknown>) => Record<string, unknown>> = { 1: (o) => o };

export function load(json: unknown): Loaded {
  try {
    if (!isObject(json)) return refuse("not a Hyperscope state");
    let o = json;
    const v = o.v;
    if (!Number.isInteger(v) || (v as number) < 1) return refuse("not a Hyperscope state (no version)");
    if ((v as number) > VERSION) return refuse(`made by a newer Hyperscope (version ${v})`);
    for (let n = v as number; n < VERSION; n++) o = MIGRATIONS[n](o);
    const images: Record<string, string> = {};
    const content = readContent(o.content, images);
    const group = triangleGroup(...content.group);
    const view = readView(o.view, colouringFor(group, content.colouring).k, group);
    const ui = readUi(o.ui ?? {});
    return { ok: true, state: { view, content, ui }, ...(Object.keys(images).length ? { images } : {}) };
  } catch (e) {
    return refuse((e as Error).message);
  }
}

// --------------------------------------------------------------------------------- link form

const MODEL_KEYS: Record<Model, string> = { poincare: "pd", klein: "kd", halfplane: "hp", local: "lv", h3: "h3", hyperboloid: "hb", band: "bd" };
/** Link keys of the look fields, written only where the look differs from the named one. */
const LOOK_KEYS: [keyof LookState, string][] = [
  ["palette", "pal"], ["source", "src"], ["phase", "ph"], ["density", "dn"], ["lineColour", "lc"], ["glow", "gw"], ["relief", "rl"], ["light", "li"],
];
const GRID_KEYS: Record<GridKind, string> = { cartesian: "gx", polar: "gp", horocyclic: "gh" };

/** The state as a link's hash, without the "#". */
export function toLink(s: Snapshot): string {
  const { view, content, ui } = s;
  const out: [string, string][] = [["v", String(VERSION)], ["m", MODEL_KEYS[view.picture.model]]];
  out.push(["g", content.group.join(",")], ["k", content.colouring], ["sd", content.sides.map((b) => (b ? 1 : 0)).join("")], ["lw", String(content.lineWidth)]);
  if (content.lineUnit === "px") out.push(["lu", "px"]);
  if (content.plain) out.push(["plain", "1"]);
  if (content.grid) out.push(["grid", `${content.grid.on ? "on" : "off"}.${content.grid.kind}.${content.grid.unit}`]);
  if (content.construction && content.construction !== "lines") out.push(["wy", content.construction]);
  if (content.construction === "free" && content.weights) out.push(["wyw", content.weights.join(",")]);
  // a built-in motif by its id, a loaded one as its JSON
  if (typeof content.motif === "string") out.push(["mo", content.motif]);
  else if (content.motif) out.push(["md", b64(new TextEncoder().encode(JSON.stringify(cleanMotifSpec(content.motif))))]);
  // a tile picture by its settings and id, never its bytes
  const ti = content.tileImage;
  if (ti) {
    out.push(["ti", `${ti.mode === "chiral" ? "c" : "k"}.${ti.id}`]);
    if (ti.tint) out.push(["tit", "1"]);
    const p = ti.place;
    if (p.x !== DEFAULT_PLACEMENT.x || p.y !== DEFAULT_PLACEMENT.y || p.size !== DEFAULT_PLACEMENT.size || p.turn !== DEFAULT_PLACEMENT.turn) out.push(["tip", [p.x, p.y, p.size, p.turn].join(",")]);
  }
  // the named look with the fewest fields to change, then those fields
  const look = content.look ?? DEFAULT_LOOK;
  const diff = (l: LookState) => LOOK_KEYS.filter(([f]) => l[f] !== look[f]);
  const named = LOOKS.reduce((best, l) => (diff(l.look).length < diff(best.look).length ? l : best));
  out.push(["look", named.name]);
  for (const [f, key] of diff(named.look)) out.push([key, String(look[f])]);
  if (ui.accent !== DEFAULT_UI.accent) out.push(["acc", ui.accent]);
  // the picture and the camera only where they are not home
  const homePicture = pictureNumbers(HOME[view.picture.model]);
  if (pictureNumbers(view.picture).some((x, i) => x !== homePicture[i])) out.push(["pc", b64(f64(pictureNumbers(view.picture)))]);
  if (!isIdentity(view.camera)) out.push(["cam", b64(f64(view.camera))]);
  if (!isIdentity(view.origin)) out.push(["org", b64(f64(view.origin))]);
  if (view.shift) out.push(["dsh", String(view.shift)]);
  if (view.perm.some((p, i) => p !== i)) out.push(["perm", view.perm.join(".")]);
  if (view.tile && !isIdentityTile(view.tile)) out.push(["tid", view.tile.join(".")]);
  const home = homeGrids();
  for (const kind of GRID_KINDS) {
    const g = view.grids[kind];
    if (g.s !== home[kind].s || g.e !== home[kind].e || g.theta !== home[kind].theta) out.push([GRID_KEYS[kind], b64(gridBytes(g))]);
  }
  return out.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

/** A link's hash (with or without the "#", or a whole URL) read back. Fields left out take their
 *  home or default values, so a short hand-written link works too. */
export function fromLink(link: string): Loaded {
  try {
    const hash = link.includes("#") ? link.slice(link.indexOf("#") + 1) : link;
    const q = new URLSearchParams(hash);
    const v = q.has("v") ? Number(q.get("v")) : 1;
    if (!Number.isInteger(v) || v < 1) return refuse("not a Hyperscope link");
    if (v > VERSION) return refuse(`made by a newer Hyperscope (version ${v})`);
    if (![...q.keys()].some((k) => ["g", "m", "cam", "look"].includes(k))) return refuse("not a Hyperscope link");
    const get = (key: string) => q.get(key) ?? undefined;
    const model = (Object.keys(MODEL_KEYS) as Model[]).find((m) => MODEL_KEYS[m] === (get("m") ?? "pd"));
    if (!model) return refuse(`unknown view "${get("m")}"`);

    const group = (get("g") ?? "7,3,2").split(",").map(Number);
    const sides = (get("sd") ?? "001").split("").map((c) => c === "1");
    const named = LOOKS.find((l) => l.name === (get("look") ?? LOOKS[0].name));
    if (!named) return refuse(`unknown look "${get("look")}"`);
    const look: Record<string, unknown> = { ...named.look };
    for (const [f, key] of LOOK_KEYS) {
      const val = get(key);
      if (val !== undefined) look[f] = typeof named.look[f] === "number" ? Number(val) : val;
    }
    const contentIn: Record<string, unknown> = { group, colouring: get("k") ?? "parity", sides, lineWidth: Number(get("lw") ?? 0.03), look };
    if (get("lu")) contentIn.lineUnit = get("lu");
    if (get("plain") === "1") contentIn.plain = true;
    const grid = get("grid");
    if (grid !== undefined) {
      const [on, kind, unit] = grid.split(".");
      contentIn.grid = { on: on === "on", kind, unit };
    }
    if (get("wy") !== undefined) contentIn.construction = get("wy");
    if (get("wyw") !== undefined) contentIn.weights = get("wyw")!.split(",").map(Number);
    if (get("mo") !== undefined) contentIn.motif = get("mo");
    const md = get("md");
    if (md !== undefined) {
      if (md.length > MAX_MOTIF_LINK) throw new Error("the motif in the link is too long");
      const bytes = unb64(md);
      let spec: unknown;
      try {
        spec = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new Error("the motif in the link is not readable");
      }
      contentIn.motif = spec;
    }
    const ti = get("ti");
    if (ti !== undefined) {
      const m = /^([kc])\.([0-9a-f]{64})$/.exec(ti);
      if (!m) throw new Error("the tile picture in the link is not readable");
      const tip = get("tip")?.split(",").map(Number);
      const place = tip ? { x: tip[0], y: tip[1], size: tip[2], turn: tip[3] } : DEFAULT_PLACEMENT;
      if (tip && tip.length !== 4) throw new Error("the tile picture's placement is not four numbers");
      contentIn.tileImage = { mode: m[1] === "c" ? "chiral" : "kaleidoscope", tint: get("tit") === "1", place, id: m[2] };
    }
    const content = readContent(contentIn, {});
    const tg = triangleGroup(...content.group);
    const k = colouringFor(tg, content.colouring).k;

    const home = homeView(k, model);
    const nums = (key: string, n: number) => {
      const val = get(key);
      if (val === undefined) return undefined;
      const a = fromF64(unb64(val));
      if (a.length !== n) throw new Error(`"${key}" holds ${a.length} numbers, not ${n}`);
      return a;
    };
    const pc = nums("pc", model === "poincare" || model === "klein" ? 4 : model === "h3" || model === "hyperboloid" ? 3 : model === "band" ? 2 : 1);
    const picture = pc ? pictureFrom(model, pc) : home.picture;
    const grids = {} as Record<GridKind, SavedGrid>;
    for (const kind of GRID_KINDS) {
      const val = get(GRID_KEYS[kind]);
      const g = val === undefined ? home.grids[kind] : gridFromBytes(unb64(val));
      grids[kind] = [g.s.toString(), g.e, g.theta];
    }
    const perm = get("perm")?.split(".").map(Number) ?? identityPerm(k);
    const tile = get("tid")?.split(".").map(Number);
    const view = readView({ picture, camera: nums("cam", 9) ?? home.camera, perm, tile, origin: nums("org", 9) ?? identity(), shift: get("dsh") === undefined ? 0 : Number(get("dsh")), grids }, k, tg);
    const ui = readUi({ accent: get("acc") ?? DEFAULT_UI.accent });
    return { ok: true, state: { view, content, ui } };
  } catch (e) {
    return refuse((e as Error).message);
  }
}

// ------------------------------------------------------------------------------- checking

const refuse = (reason: string): Loaded => ({ ok: false, reason });
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const finite = (x: unknown, what: string): number => {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(`${what} is not a number`);
  return x;
};
function oneOf<T extends string>(x: unknown, list: readonly T[], what: string): T {
  if (!list.includes(x as T)) throw new Error(`unknown ${what} "${String(x)}"`);
  return x as T;
}

function readMatrix(x: unknown, what: string): Mat3 {
  if (!Array.isArray(x) || x.length !== 9) throw new Error(`${what} is not a 3 x 3 matrix`);
  const m = x.map((v, i) => finite(v, `${what}[${i}]`));
  if (!(m[8] > 0) || !(isometryError(m) < 1e-6 * Math.max(1, m[8] * m[8]))) throw new Error(`${what} is not a hyperbolic motion`);
  return m;
}

function readPicture(x: unknown): Picture {
  if (!isObject(x)) throw new Error("the picture is missing");
  const model = oneOf(x.model, MODELS, "view");
  if (model === "poincare" || model === "klein") {
    const c = x.c;
    if (!Array.isArray(c) || c.length !== 2) throw new Error("the disk's centre is missing");
    const [c0, c1] = [finite(c[0], "the disk's centre"), finite(c[1], "the disk's centre")];
    const sigma = finite(x.sigma, "sigma");
    const s = finite(x.s, "the disk's scale");
    // sigma = 1 - |c|^2 is kept directly, so either may be off by a rounding near its end
    if (!(sigma > 0 && sigma <= 1 + 1e-12 && c0 * c0 + c1 * c1 <= 1 + 1e-12 && s > 0)) throw new Error("the disk picture is out of range");
    return { model, c: [c0, c1], sigma, s };
  }
  if (model === "halfplane") {
    const mu = finite(x.mu, "the half-plane's height");
    if (!(mu > 0)) throw new Error("the half-plane picture is out of range");
    return { model, mu };
  }
  if (model === "band") {
    const y0 = finite(x.y0, "the band height");
    const s = finite(x.s, "the band's scale");
    // the zoom keeps cos y0 >= MIN_BAND_GAP; a rounding below it is let through
    if (!(Math.abs(y0) < Math.PI / 2 && Math.cos(y0) >= MIN_BAND_GAP / 2 && s > 0)) throw new Error("the band picture is out of range");
    return { model, y0, s };
  }
  // the controls keep each number within its range; a rounding past an end is let through
  const within = (v: number, lo: number, hi: number) => v >= lo - 1e-12 * Math.max(1, Math.abs(lo)) && v <= hi + 1e-12 * Math.max(1, Math.abs(hi));
  if (model === "h3") {
    const h = finite(x.h, "the eye's height");
    const pitch = finite(x.pitch, "the view's pitch");
    const fov = finite(x.fov, "the field of view");
    if (!(within(h, H3_MIN_H, H3_MAX_H) && within(pitch, H3_MIN_PITCH, H3_MAX_PITCH) && within(fov, H3_MIN_FOV, H3_MAX_FOV))) throw new Error("the picture inside H³ is out of range");
    return { model, h, pitch, fov };
  }
  if (model === "hyperboloid") {
    const elevation = finite(x.elevation, "the orbit's elevation");
    const distance = finite(x.distance, "the orbit's distance");
    const fov = finite(x.fov, "the field of view");
    const picture = { elevation, distance, fov };
    // and the camera clear of the surface, as the controls keep it (camera.ts clearWall)
    if (!(within(elevation, HB_MIN_ELEVATION, HB_MAX_ELEVATION) && within(distance, HB_MIN_DISTANCE, HB_MAX_DISTANCE) && within(fov, HB_MIN_FOV, HB_MAX_FOV) && Math.abs(hyperboloidGap(picture)) >= HB_WALL_GAP * (1 - 1e-9)))
      throw new Error("the hyperboloid picture is out of range");
    return { model, ...picture };
  }
  const ell = finite(x.ell, "the local view's scale");
  if (!(ell > 0)) throw new Error("the local picture is out of range");
  return { model, ell };
}

function readGrid(x: unknown, kind: GridKind): GridCamera {
  if (!Array.isArray(x) || x.length !== 3 || typeof x[0] !== "string" || !/^-?\d+$/.test(x[0])) throw new Error(`the ${kind} grid camera is not readable`);
  const e = finite(x[1], `the ${kind} grid's E`);
  const theta = finite(x[2], `the ${kind} grid's angle`);
  if (Math.abs(e) > 1e6) throw new Error(`the ${kind} grid camera is out of range`);
  return { s: BigInt(x[0]), e, theta };
}

function readView(x: unknown, k: number, group: TriangleGroup): ViewState {
  if (!isObject(x)) throw new Error("the view is missing");
  const picture = readPicture(x.picture);
  const camera = readMatrix(x.camera, "the camera");
  const origin = readMatrix(x.origin, "the start tile");
  const p = x.perm;
  const isPerm = Array.isArray(p) && p.length === k && p.every((i) => Number.isInteger(i) && i >= 0 && i < k) && new Set(p).size === k;
  if (!isObject(x.grids)) throw new Error("the grid cameras are missing");
  const grids = {} as GridCameras;
  for (const kind of GRID_KINDS) grids[kind] = readGrid(x.grids[kind], kind);
  // a permutation that does not fit the colouring restarts it, as re-centering does
  const shift = x.shift === undefined ? 0 : x.shift;
  if (!Number.isSafeInteger(shift)) throw new Error("the depth shift is not a whole number");
  // so does a tile matrix that does not fit the group (math/tileid.ts fitsTile)
  const tile = fitsTile(x.tile, tileIdentity(group)) ? [...(x.tile as number[])] : identityTile();
  return { picture, camera, perm: isPerm ? (p as number[]) : identityPerm(k), tile, origin, shift: shift as number, grids };
}

function readLook(x: unknown): LookState {
  if (!isObject(x)) throw new Error("the look is missing");
  const palette = x.palette;
  if (typeof palette !== "string" || !PALETTES.some((p) => p.name === palette)) throw new Error(`unknown palette "${String(palette)}"`);
  const source: ColourSource = oneOf(x.source, SOURCES, "colour source");
  const lineColour = x.lineColour;
  if (typeof lineColour !== "string" || !/^#[0-9a-fA-F]{6}$/.test(lineColour)) throw new Error("the line colour is not a #rrggbb colour");
  const look: LookState = {
    palette,
    source,
    phase: finite(x.phase, "the phase"),
    density: finite(x.density, "the density"),
    lineColour,
    glow: finite(x.glow, "the glow"),
    relief: finite(x.relief, "the relief"),
    light: finite(x.light, "the light angle"),
  };
  if (!(look.density > 0 && look.glow >= 0 && look.glow <= 1 && look.relief >= 0 && look.relief <= 4)) throw new Error("the look's settings are out of range");
  return look;
}

/** A tile picture's settings, id and data URL (which sets the id, and goes into `images`). */
function readTileImage(x: unknown, images: Record<string, string>): TileImageState {
  if (!isObject(x)) throw new Error("the tile picture is not readable");
  const mode: TileMode = oneOf(x.mode, TILE_MODES, "tile picture mode");
  if (x.tint !== undefined && typeof x.tint !== "boolean") throw new Error("the tile picture's tint is not on or off");
  const p = x.place;
  if (!isObject(p)) throw new Error("the tile picture's placement is missing");
  const place: Placement = { x: finite(p.x, "the picture's x"), y: finite(p.y, "the picture's y"), size: finite(p.size, "the picture's size"), turn: finite(p.turn, "the picture's turn") };
  const [lo, hi] = PLACE_LIMITS.xy;
  const [smin, smax] = PLACE_LIMITS.size;
  if (!(place.x >= lo && place.x <= hi && place.y >= lo && place.y <= hi && place.size >= smin && place.size <= smax && Math.abs(place.turn) <= 360)) throw new Error("the tile picture's placement is out of range");
  let id: string;
  if (x.src !== undefined) {
    const src = x.src;
    if (typeof src !== "string" || src.length > MAX_PICTURE_URL || !PICTURE_URL.test(src)) throw new Error("the tile picture is not a PNG, JPEG or WebP data URL of at most 16 MB");
    id = sha256(src);
    images[id] = src;
  } else {
    if (typeof x.id !== "string" || !PICTURE_ID.test(x.id)) throw new Error("the tile picture's id is not readable");
    id = x.id;
  }
  return { mode, ...(x.tint ? { tint: true } : {}), place, id };
}

function readContent(x: unknown, images: Record<string, string>): ContentState {
  if (!isObject(x)) throw new Error("the content is missing");
  const g = x.group;
  if (!Array.isArray(g) || g.length !== 3 || !g.every((n) => Number.isInteger(n) && n >= 2 && n <= MAX_ORDER)) throw new Error("the triangle group is not three whole numbers from 2 to 64");
  const group = g as [number, number, number];
  triangleGroup(...group); // throws unless hyperbolic
  if (typeof x.colouring !== "string") throw new Error("the colouring is missing");
  colouringFor(triangleGroup(...group), x.colouring); // throws unless it fits
  const s = x.sides;
  if (!Array.isArray(s) || s.length !== 3 || !s.every((b) => typeof b === "boolean" || b === 0 || b === 1)) throw new Error("the sides are not three on/off values");
  const lineUnit = x.lineUnit === undefined ? undefined : oneOf(x.lineUnit, ["plane", "px"] as const, "line unit");
  const lineWidth = finite(x.lineWidth, "the line width");
  if (!(lineWidth > 0 && lineWidth <= (lineUnit === "px" ? 64 : 1))) throw new Error("the line width is out of range");
  const content: ContentState = { group, colouring: x.colouring, sides: s.map(Boolean) as [boolean, boolean, boolean], lineWidth, look: readLook(x.look ?? DEFAULT_LOOK) };
  if (lineUnit) content.lineUnit = lineUnit;
  if (x.plain === true) content.plain = true;
  if (x.grid !== undefined) content.grid = readGridSettings(x.grid);
  if (x.construction !== undefined) {
    const c: Construction = oneOf(x.construction, CONSTRUCTIONS, "construction");
    if (c !== "lines") content.construction = c;
    if (c === "free") content.weights = readWeights(x.weights);
    wythoffOf(triangleGroup(...group), content); // throws unless the tables fit the shader
  }
  if (x.motif !== undefined) {
    if (content.construction !== undefined) throw new Error("a motif is drawn over the Lines construction only");
    const m = x.motif;
    if (typeof m === "string") {
      if (!MOTIFS.some((b) => b.id === m)) throw new Error(`unknown motif "${m}"`);
    } else if (!isObject(m)) throw new Error("the motif is not readable");
    const ref = typeof m === "string" ? m : cleanMotifSpec(m as never);
    const why = motifProblem(ref, group);
    if (why) throw new Error(`motif refused: ${why}`);
    content.motif = ref;
  }
  if (x.tileImage !== undefined) content.tileImage = readTileImage(x.tileImage, images);
  return content;
}

/** A free point's weights: three numbers of at least 0, not all 0 (math/wythoff.ts generatorOf). */
function readWeights(x: unknown): Weights {
  if (!Array.isArray(x) || x.length !== 3) throw new Error("a free point needs three weights");
  const w = x.map((v, i) => finite(v, `weight ${i + 1}`)) as Weights;
  if (!w.every((v) => v >= 0) || !w.some((v) => v > 0) || !w.every((v) => v <= 1e6)) throw new Error("a free point's weights must be from 0 to 10^6, not all 0");
  return w;
}

function readGridSettings(x: unknown): GridSettings {
  if (!isObject(x) || typeof x.on !== "boolean") throw new Error("the grid settings are not readable");
  return { on: x.on, kind: oneOf<GridKind>(x.kind, GRID_KINDS, "grid"), unit: oneOf<GridUnit>(x.unit, GRID_UNITS, "size of R") };
}

function readUi(x: unknown): UiState {
  if (!isObject(x)) throw new Error("the interface settings are not readable");
  return { accent: x.accent === undefined ? DEFAULT_UI.accent : oneOf(x.accent, ACCENT_NAMES, "accent") };
}

// ------------------------------------------------------------------------------- bytes

function pictureNumbers(p: Picture): number[] {
  switch (p.model) {
    case "poincare": case "klein": return [p.c[0], p.c[1], p.sigma, p.s];
    case "halfplane": return [p.mu];
    case "local": return [p.ell];
    case "h3": return [p.h, p.pitch, p.fov];
    case "hyperboloid": return [p.elevation, p.distance, p.fov];
    case "band": return [p.y0, p.s];
  }
}

function pictureFrom(model: Model, a: number[]): Picture {
  const raw =
    model === "poincare" || model === "klein" ? { model, c: [a[0], a[1]], sigma: a[2], s: a[3] }
    : model === "halfplane" ? { model, mu: a[0] }
    : model === "band" ? { model, y0: a[0], s: a[1] }
    : model === "h3" ? { model, h: a[0], pitch: a[1], fov: a[2] }
    : model === "hyperboloid" ? { model, elevation: a[0], distance: a[1], fov: a[2] }
    : { model, ell: a[0] };
  return readPicture(raw);
}

const isIdentity = (m: Mat3) => m.every((v, i) => v === (i % 4 === 0 ? 1 : 0));

function f64(a: readonly number[]): Uint8Array {
  const out = new Uint8Array(a.length * 8);
  const dv = new DataView(out.buffer);
  a.forEach((v, i) => dv.setFloat64(i * 8, v, true));
  return out;
}

function fromF64(b: Uint8Array): number[] {
  if (b.length % 8) throw new Error("a number field has a broken length");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return Array.from({ length: b.length / 8 }, (_, i) => dv.getFloat64(i * 8, true));
}

/** A grid camera: a sign byte, E0 and theta as float64, then |S0 * 2^256| as big-endian bytes. */
function gridBytes(g: GridCamera): Uint8Array {
  let m = g.s < 0n ? -g.s : g.s;
  const mag: number[] = [];
  while (m > 0n) {
    mag.unshift(Number(m & 0xffn));
    m >>= 8n;
  }
  const out = new Uint8Array(17 + mag.length);
  out[0] = g.s < 0n ? 1 : 0;
  out.set(f64([g.e, g.theta]), 1);
  out.set(mag, 17);
  return out;
}

function gridFromBytes(b: Uint8Array): GridCamera {
  if (b.length < 17 || b.length > 17 + 64 || b[0] > 1) throw new Error("a grid camera in the link is not readable");
  const [e, theta] = fromF64(b.subarray(1, 17));
  let s = 0n;
  for (const byte of b.subarray(17)) s = (s << 8n) | BigInt(byte);
  return { s: b[0] ? -s : s, e, theta };
}

function b64(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("a field of the link is not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** For tests and the HUD: the home snapshot of a content state. */
export function homeSnapshot(content: ContentState, model: Model = "poincare"): Snapshot {
  const k = colouringFor(triangleGroup(...content.group), content.colouring).k;
  return { view: homeView(k, model), content, ui: { ...DEFAULT_UI } };
}
