// The settings card under the icon row (design: Interface, step 9 plan): three tabs. TILING: the
// triangle group with a live check, tiling presets, the tiling on or off, which lines to draw and
// how wide, the colouring. LOOK: the looks as live previews of the current view, palettes as
// colour strips, the colour source and the look's numbers, the HUD accent. VIEW: the view, the
// distance, the position and rotation and the magnification (editable, exact), the unit grid,
// home and a link to the view. The card reads the state from its host when it refreshes and
// writes every change back through the host, which owns the state.

import type { ColourSource, LookState } from "../content/looks.ts";
import { LOOKS, SOURCES } from "../content/looks.ts";
import { bakeSrgb, paletteByName, PALETTE_NAMES } from "../content/palettes.ts";
import type { Content, ContentState } from "../content/scene.ts";
import type { MotifSpec } from "../math/motifs.ts";
import { colouringFor, colouringNames, MOTIF_IDS, motifName, pictureHiddenBy, PRESETS, readMotif, withConstruction, withMotif, withTileImage } from "../content/scene.ts";
import type { Placement, TileImage, TileImageState, TileMode } from "../content/tileimage.ts";
import { DEFAULT_PLACEMENT, encodeSrgb, mapUV, pictureEntry, pictureMap, PLACE_LIMITS, shapeEdges, SRGB_TO_LINEAR } from "../content/tileimage.ts";
import { PAIR_COLOURS } from "./template.ts";
import type { ViewState } from "../input/camera.ts";
import { validate, faces2 } from "../math/colourings.ts";
import type { GridKind, GridUnit } from "../math/grid.ts";
import { DEFAULT_GRID, fixedToNumber, GRID_KINDS, GRID_UNITS, UNITS } from "../math/grid.ts";
import { triangleGroup } from "../math/groups.ts";
import type { ShotSize } from "../render/shot.ts";
import { SHOT_LABELS, SHOT_SIZES } from "../render/shot.ts";
import type { Model } from "../math/views.ts";
import { H3_MAX_FOV, H3_MAX_H, H3_MIN_FOV, H3_MIN_H, HB_MAX_DISTANCE, HB_MIN_DISTANCE, MODELS, VIEW_KEYS } from "../math/views.ts";
import type { Construction, Weights } from "../math/wythoff.ts";
import { CONSTRUCTIONS, wythoffSymbol } from "../math/wythoff.ts";
import type { Accent, UiState } from "../state/saved.ts";
import { ACCENT_NAMES, ACCENTS } from "../state/saved.ts";
import { viewIcon } from "./icons.ts";
import { distanceText, exponentText, formatFixed, magnification, parseFixed, positionDecimals } from "./readouts.ts";
import { button, el, Field, row, section, Segmented, Select, Slider, Stepper, Toggle } from "./widgets.ts";

export interface CardHost {
  content(): Content;
  view(): ViewState;
  ui(): UiState;
  /** The index of the named look the content's look came from (it may since have been changed). */
  lookIndex(): number;
  /** Plane length in R of one CSS pixel at the screen centre. */
  pixelLength(): number;
  /** New content; the label is the preset's or tiling's name when that changed. */
  setContent(state: ContentState, label?: string): void;
  chooseLook(index: number): void;
  setModel(model: Model): void;
  setAccent(accent: Accent): void;
  /** Go to grid coordinates X (exact, S * 2^256) and Y in R, turned by theta radians. */
  place(x: bigint, y: number, theta: number): void;
  /** Zoom about the centre to 10^exponent; returns the exponent reached (the limits may stop it). */
  zoomTo(exponent: number): number;
  /** Inside H3: put the eye at height h (R) over its foot point, or change the field of view
   *  (radians), within their limits. */
  setEye(patch: { h?: number; fov?: number }): void;
  /** On the hyperboloid: put the orbit's camera at this distance (R) from the vertex, or change the
   *  field of view (radians), within their limits. */
  setOrbit(patch: { distance?: number; fov?: number }): void;
  home(): void;
  copyLink(): void;
  /** The screenshot size chosen, its pixels, and a new choice; take one. */
  shotSize(): ShotSize;
  shotPixels(size: ShotSize): [number, number];
  setShotSize(size: ShotSize): void;
  screenshot(): void;
  /** The current view with another look, `width` x `height` device pixels, RGBA top row first;
   *  null when it cannot be drawn now. */
  preview(look: LookState, width: number, height: number): Uint8Array | null;
  /** Changes whenever the previews would look different, the look aside. */
  previewKey(): string;
  /** Read a picture file as the tile picture (in this mode when there is none yet). */
  loadPicture(file: File, mode: TileMode): void;
  /** Save the template of the shape of this group and mode. */
  exportTemplate(mode: TileMode): void;
}

export type CardTab = "tiling" | "look" | "view";
const TABS: [CardTab, string][] = [["tiling", "Tiling"], ["look", "Look"], ["view", "View"]];

/** The tilings offered as one click: {p,q} is the group (p, q, 2). */
const TILINGS: [string, [number, number, number]][] = [
  ["{7,3}", [7, 3, 2]],
  ["{3,7}", [3, 7, 2]],
  ["{5,4}", [5, 4, 2]],
  ["{4,5}", [4, 5, 2]],
  ["{8,3}", [8, 3, 2]],
  ["{6,4}", [6, 4, 2]],
  ["(2,3,7)", [2, 3, 7]],
  ["(3,3,4)", [3, 3, 4]],
];
export const MIN_ORDER = 2;
export const MAX_ORDER_UI = 20;

/** Why (p, q, r) gives no hyperbolic tiling, or null when it does. */
export function groupProblem([p, q, r]: [number, number, number]): string | null {
  const sum = 1 / p + 1 / q + 1 / r;
  const shown = `1/${p} + 1/${q} + 1/${r}`;
  if (Math.abs(sum - 1) < 1e-12) return `${shown} = 1: a Euclidean tiling, not hyperbolic`;
  if (sum > 1) return `${shown} > 1: a spherical tiling, not hyperbolic`;
  return null;
}

const POLYGONS: Record<number, string> = {
  3: "triangles", 4: "squares", 5: "pentagons", 6: "hexagons", 7: "heptagons", 8: "octagons", 9: "nonagons", 10: "decagons", 11: "hendecagons", 12: "dodecagons",
};

/** The name of a tiling by its shape: {7,3} heptagons for (p, q, 2), (2,3,7) triangles otherwise. */
export function tilingName(group: [number, number, number]): string {
  const [p, q, r] = group;
  return r === 2 ? `{${p},${q}} ${POLYGONS[p] ?? `${p}-gons`}` : `(${p},${q},${r}) triangles`;
}

/** The title's name for content: a preset's own when it is that preset ({6,4} in three colours),
 *  else the motif's (Shoal (3,3,4)) or the tiling's (a Wythoff tiling's by its construction), else
 *  Unit grid or No tiling. */
export function contentLabel(c: ContentState): string {
  const wy = (x: ContentState) => x.construction ?? "lines";
  const mo = (x: ContentState) => (x.motif === undefined ? "" : typeof x.motif === "string" ? x.motif : JSON.stringify(x.motif));
  // your own picture drawn over the tiling names it
  if (c.tileImage && !c.plain && wy(c) === "lines" && c.motif === undefined) {
    const [p, q, r] = c.group;
    return `${r === 2 ? `{${p},${q}}` : `(${p},${q},${r})`} ${c.tileImage.mode === "chiral" ? "chiral picture" : "kaleidoscope"}`;
  }
  const preset = PRESETS.find(
    (p) => !!p.content.plain === !!c.plain && p.content.group.join() === c.group.join() && p.content.colouring === c.colouring && wy(p.content) === wy(c) && mo(p.content) === mo(c),
  );
  if (preset && (!c.plain || !!preset.content.grid?.on === !!c.grid?.on)) return preset.label;
  if (c.plain) return c.grid?.on ? "Unit grid" : "No tiling";
  if (c.motif !== undefined) return motifName(c.motif);
  if (wy(c) === "lines") return tilingName(c.group);
  const [p, q, r] = c.group;
  const group = r === 2 ? `{${p},${q}}` : `(${p},${q},${r})`;
  if (wy(c) === "free") return `${group} free point`;
  const name = constructionName(c.group, wy(c));
  return r === 2 ? name : `${group} ${name === "Snub" ? "snub" : name}`;
}

/** A construction's name: for (p, q, 2) the classic one (truncated {p,q}), for other groups where
 *  the generator point is ("G on side 3"). */
export function constructionName(group: [number, number, number], c: Construction): string {
  const [p, q, r] = group;
  if (c === "lines") return "Lines";
  if (c === "free") return "Free point";
  if (r === 2) {
    const pq = `{${p},${q}}`;
    const names: Record<Exclude<Construction, "lines" | "free">, string> = {
      "010": `Regular ${pq}`, "001": `Dual {${q},${p}}`, "100": `Rectified ${pq}`, "110": `Truncated ${pq}`, "101": `Truncated {${q},${p}}`, "011": `Cantellated ${pq}`, "111": `Omnitruncated ${pq}`, snub: `Snub ${pq}`,
    };
    return names[c];
  }
  const where: Record<Exclude<Construction, "lines" | "free">, string> = {
    "010": "G at Q", "001": "G at P", "100": "G at R", "110": "G on side 3", "101": "G on side 2", "011": "G on side 1", "111": "G inside", snub: "Snub",
  };
  return where[c];
}

/** A construction as the list shows it: its name and Wythoff symbol. */
export function constructionLabel(group: [number, number, number], c: Construction): string {
  if (c === "lines") return "Lines (the mirrors, version 1)";
  if (c === "free") return "Free point (drag it below)";
  return `${constructionName(group, c)}   ${wythoffSymbol({ p: group[0], q: group[1], r: group[2] }, c)}`;
}

/** The free point's triangle: P, Q and R at its corners and the point at the weights' barycentre,
 *  weight j with the corner opposite side j (w1 with R, w2 with Q, w3 with P: a weight is how far
 *  the point is from its mirror). Dragging it sets the weights; the content follows. */
export class FreePoint {
  readonly el: SVGSVGElement;
  private dot: SVGCircleElement;
  /** P, Q, R in the widget's coordinates. */
  private static readonly CORNERS: [number, number][] = [[16, 92], [144, 92], [80, 12]];

  constructor(onChange: (w: Weights) => void) {
    const ns = "http://www.w3.org/2000/svg";
    this.el = document.createElementNS(ns, "svg");
    this.el.setAttribute("viewBox", "0 0 160 104");
    this.el.setAttribute("class", "hs-free");
    this.el.setAttribute("role", "slider");
    this.el.setAttribute("aria-label", "Free point: drag it in the triangle");
    const [P, Q, R] = FreePoint.CORNERS;
    const tri = document.createElementNS(ns, "polygon");
    tri.setAttribute("points", [P, Q, R].map((c) => c.join(",")).join(" "));
    tri.setAttribute("class", "hs-free-tri");
    this.el.append(tri);
    for (const [[x, y], name, dx, dy] of [[P, "P", -10, 4], [Q, "Q", 4, 4], [R, "R", -3, -2]] as const) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", String(x + dx));
      t.setAttribute("y", String(y + dy));
      t.setAttribute("class", "hs-free-name");
      t.textContent = name;
      this.el.append(t);
    }
    this.dot = document.createElementNS(ns, "circle");
    this.dot.setAttribute("r", "5");
    this.dot.setAttribute("class", "hs-free-dot");
    this.el.append(this.dot);
    let dragging = false;
    const at = (e: PointerEvent) => {
      const box = this.el.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * 160;
      const y = ((e.clientY - box.top) / box.height) * 104;
      onChange(FreePoint.weightsAt(x, y));
    };
    this.el.addEventListener("pointerdown", (e) => {
      dragging = true;
      this.el.setPointerCapture(e.pointerId);
      at(e);
    });
    this.el.addEventListener("pointermove", (e) => dragging && at(e));
    const end = () => (dragging = false);
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);
  }

  /** The weights of a point of the widget: its barycentric coordinates, clamped into the triangle. */
  static weightsAt(x: number, y: number): Weights {
    const [[px, py], [qx, qy], [rx, ry]] = FreePoint.CORNERS;
    const det = (qy - ry) * (px - rx) + (rx - qx) * (py - ry);
    let bP = ((qy - ry) * (x - rx) + (rx - qx) * (y - ry)) / det;
    let bQ = ((ry - py) * (x - rx) + (px - rx) * (y - ry)) / det;
    let bR = 1 - bP - bQ;
    [bP, bQ, bR] = [bP, bQ, bR].map((b) => Math.max(0, b));
    const sum = bP + bQ + bR;
    return [bR / sum, bQ / sum, bP / sum];
  }

  set(w: Weights): void {
    const sum = w[0] + w[1] + w[2];
    const [P, Q, R] = FreePoint.CORNERS;
    const [a, b, c] = [w[2] / sum, w[1] / sum, w[0] / sum];
    this.dot.setAttribute("cx", (a * P[0] + b * Q[0] + c * R[0]).toFixed(2));
    this.dot.setAttribute("cy", (a * P[1] + b * Q[1] + c * R[1]).toFixed(2));
  }
}

/** A colouring's name and its number of colours, as the list shows it. */
export function colouringLabel(name: string, k: number): string {
  const base = name === "parity" ? "Parity" : name === "faces" ? "Faces" : name[0] === "r" ? `Chiral ${name.slice(1)}` : `Colouring ${name.slice(1)}`;
  return `${base}, ${k} colours`;
}

const SOURCE_LABELS: Record<ColourSource, string> = { colouring: "Colouring", distance: "Distance", depth: "Depth", inside: "Inside", mosaic: "Mosaic" };
const KIND_LABELS: Record<GridKind, string> = { cartesian: "Cartesian", polar: "Polar", horocyclic: "Horocyclic" };
const SHORT_VIEWS: Record<Model, string> = { poincare: "Poincaré", klein: "Klein", halfplane: "Half-plane", local: "Local", h3: "Inside H³", hyperboloid: "Hyperboloid", band: "Band" };
/** Lines: tile edges are mirror 3, centre to vertices mirror 1, centre to edge midpoints mirror 2. */
const SIDES: [number, string][] = [[2, "Tile edges"], [0, "Centre to vertices"], [1, "Centre to edge midpoints"]];
const WIDTH = { plane: { min: 0.002, max: 0.2, initial: 0.03 }, px: { min: 0.25, max: 16, initial: 1.5 } };
/** Largest motif file the card reads. */
const MAX_MOTIF_FILE = 256 * 1024;
/** The look previews, CSS pixels. */
export const PREVIEW_W = 96;
export const PREVIEW_H = 64;

const sig3 = (v: number) => (v >= 100 ? v.toFixed(0) : v.toPrecision(3));
const degrees = (rad: number) => {
  let d = (rad * 180) / Math.PI;
  d -= 360 * Math.round(d / 360);
  return d === -180 ? 180 : d;
};

export class Card {
  readonly el: HTMLElement;
  private host: CardHost;
  private tab: CardTab = "tiling";
  private tabButtons = new Map<CardTab, HTMLButtonElement>();
  private panes = new Map<CardTab, HTMLElement>();
  /** Refreshes the controls of each tab from the state. */
  private refreshers = new Map<CardTab, () => void>();
  private previewGen = 0;
  private previewsShown = "";

  constructor(host: CardHost) {
    this.host = host;
    this.el = el("div", "hs-card hs-glass");
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Settings");
    const tabs = el("div", "hs-tabs");
    tabs.setAttribute("role", "tablist");
    for (const [tab, label] of TABS) {
      const b = el("button", "hs-tab", label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => this.show(tab));
      this.tabButtons.set(tab, b);
      tabs.append(b);
    }
    this.el.append(tabs);
    const build: Record<CardTab, () => [HTMLElement, () => void]> = { tiling: () => this.tilingTab(), look: () => this.lookTab(), view: () => this.viewTab() };
    for (const [tab] of TABS) {
      const [pane, refresh] = build[tab]();
      pane.classList.add("hs-pane");
      pane.setAttribute("role", "tabpanel");
      this.panes.set(tab, pane);
      this.refreshers.set(tab, refresh);
      this.el.append(pane);
    }
    this.show("tiling");
  }

  get currentTab(): CardTab {
    return this.tab;
  }

  show(tab: CardTab): void {
    this.tab = tab;
    for (const [t, b] of this.tabButtons) b.setAttribute("aria-selected", String(t === tab));
    for (const [t, p] of this.panes) p.hidden = t !== tab;
    this.refresh();
    if (tab === "look") this.renderPreviews();
  }

  /** Show the state in the visible tab. */
  refresh(): void {
    this.refreshers.get(this.tab)!();
  }

  /** The view came to rest: the look previews follow it if they show something else. */
  rested(): void {
    if (this.tab === "look" && !this.el.hidden) this.renderPreviews();
  }

  // ------------------------------------------------------------------------------- tiling

  private tilingTab(): [HTMLElement, () => void] {
    const host = this.host;
    const pane = el("div");
    let draft: [number, number, number] | null = null;
    const note = el("div", "hs-note");
    note.setAttribute("aria-live", "polite");
    note.setAttribute("aria-label", "Tiling check");
    const apply = (group: [number, number, number]) => {
      const problem = groupProblem(group);
      draft = problem ? group : null;
      steppers.forEach((s) => s.mark(problem !== null));
      if (problem) {
        note.textContent = problem;
        note.classList.add("hs-bad");
        return;
      }
      const state = host.content().state;
      if (group.join() === state.group.join()) return refresh();
      // the colouring stays when it fits the new group: parity always, faces when it is valid
      const g = triangleGroup(...group);
      const colouring = state.colouring === "faces" && !validate(faces2, g) ? "faces" : "parity";
      // a motif is drawn for its own group: another group drops it
      const next: ContentState = { ...state, group, colouring };
      delete next.motif;
      host.setContent(next, state.plain ? undefined : contentLabel(next));
    };
    const steppers = (["p", "q", "r"] as const).map(
      (name, i) =>
        new Stepper(name, MIN_ORDER, MAX_ORDER_UI, (v) => {
          const g = [...(draft ?? host.content().state.group)] as [number, number, number];
          g[i] = v;
          apply(g);
        }),
    );
    const groupRow = el("div", "hs-group");
    steppers.forEach((s, i) => {
      const cell = el("div", "hs-group-cell");
      cell.append(el("span", "hs-group-name", "pqr"[i]), s.el);
      groupRow.append(cell);
    });
    const chips = el("div", "hs-chips");
    const chipButtons = TILINGS.map(([label, group]) => {
      const b = button(label, `${tilingName(group)}`, () => apply(group), { className: "hs-chip", tip: false });
      chips.append(b);
      return [b, group] as const;
    });
    const tiling = new Toggle("Show the tiling", (on) => {
      const state = host.content().state;
      const next = { ...state, plain: !on };
      host.setContent(next, contentLabel(next));
    });

    const sides = SIDES.map(([j, label]) => {
      const t = new Toggle(label, (on) => {
        const state = host.content().state;
        const next = [...state.sides] as [boolean, boolean, boolean];
        next[j] = on;
        host.setContent({ ...state, sides: next });
      });
      return [j, t] as const;
    });
    const width = new Slider("Line width", {
      ...WIDTH.plane,
      log: true,
      format: (v) => v.toFixed(3),
      onInput: (v) => host.setContent({ ...host.content().state, lineWidth: v }),
    });
    const unit = new Segmented<"plane" | "px">(
      [
        { value: "plane", content: "Plane", label: "In plane units, so lines thin out toward the edge" },
        { value: "px", content: "Pixels", label: "In pixels, the same width everywhere" },
      ],
      (u) => {
        const state = host.content().state;
        if ((state.lineUnit ?? "plane") !== u) host.setContent({ ...state, lineUnit: u, lineWidth: WIDTH[u].initial });
      },
    );
    const colouring = new Select<string>("Colouring", (name) => host.setContent({ ...host.content().state, colouring: name }));
    const colouringNote = el("div", "hs-note", "A construction colours its faces by kind: the colouring applies to Lines.");
    let listedFor = "";
    const construction = new Select<Construction>("Construction", (c) => {
      const state = host.content().state;
      const next = withConstruction(state, c);
      host.setContent(next, contentLabel(next));
    });
    const free = new FreePoint((w) => {
      const next = withConstruction(host.content().state, "free", w);
      host.setContent(next, contentLabel(next));
    });
    let constructionsFor = "";

    // the motif: none, a built-in, or one loaded from a file (kept here for the visit once loaded)
    let loaded: MotifSpec | null = null;
    let loadError: string | null = null;
    const motif = new Select<string>("Motif", (v) => {
      loadError = null;
      const ref = v === "none" ? null : v === "loaded" ? loaded : v;
      if (v === "loaded" && !loaded) return refresh();
      const next = withMotif(host.content().state, ref);
      host.setContent(next, contentLabel(next));
    });
    const motifNote = el("div", "hs-note");
    motifNote.setAttribute("aria-live", "polite");
    motifNote.setAttribute("aria-label", "Motif check");
    const motifFile = el("input");
    motifFile.type = "file";
    motifFile.accept = ".json,application/json";
    motifFile.hidden = true;
    const loadMotif = async (file: File) => {
      let json: unknown;
      try {
        if (file.size > MAX_MOTIF_FILE) throw new Error();
        json = JSON.parse(await file.text());
      } catch {
        loadError = `${file.name} is not a motif file (JSON of at most 256 KB)`;
        return refresh();
      }
      const r = readMotif(json);
      if (!r.ok) {
        loadError = `${file.name} not loaded: ${r.reason}`;
        return refresh();
      }
      loadError = null;
      loaded = r.spec;
      const next = withMotif(host.content().state, r.spec);
      host.setContent(next, contentLabel(next));
    };
    motifFile.addEventListener("change", () => {
      if (motifFile.files?.[0]) void loadMotif(motifFile.files[0]);
      motifFile.value = "";
    });
    const motifActions = el("div", "hs-actions hs-motif-actions");
    motifActions.append(button("Load motif…", "Read a motif from a JSON file", () => motifFile.click(), { className: "hs-action", tip: false }), motifFile);

    // your own tile picture: the mode (kept here for the template and the next picture while there is
    // none), the tint, a preview to drag the shape on, its size and turn
    let draftMode: TileMode = "kaleidoscope";
    const picture = () => host.content().state.tileImage;
    const setPicture = (t: TileImageState | null) => {
      const next = withTileImage(host.content().state, t);
      host.setContent(next, contentLabel(next));
    };
    const place = (patch: Partial<Placement>) => {
      const t = picture();
      if (!t) return;
      const p = { ...t.place, ...patch };
      const [lo, hi] = PLACE_LIMITS.xy;
      p.x = Math.min(hi, Math.max(lo, p.x));
      p.y = Math.min(hi, Math.max(lo, p.y));
      p.size = Math.min(PLACE_LIMITS.size[1], Math.max(PLACE_LIMITS.size[0], p.size));
      setPicture({ ...t, place: p });
    };
    const pictureFile = el("input");
    pictureFile.type = "file";
    pictureFile.accept = "image/*";
    pictureFile.hidden = true;
    pictureFile.addEventListener("change", () => {
      if (pictureFile.files?.[0]) host.loadPicture(pictureFile.files[0], picture()?.mode ?? draftMode);
      pictureFile.value = "";
    });
    const removePicture = button("Remove", "Remove the tile picture", () => setPicture(null), { className: "hs-action", tip: false });
    const pictureActions = el("div", "hs-actions hs-picture-actions");
    pictureActions.append(
      button("Load picture…", "Read a picture file into the tile", () => pictureFile.click(), { className: "hs-action", tip: false }),
      removePicture,
      button("Template", "Save a template of the shape to draw on (PNG)", () => host.exportTemplate(picture()?.mode ?? draftMode), { className: "hs-action", tip: false }),
      pictureFile,
    );
    const pictureMode = new Segmented<TileMode>(
      [
        { value: "kaleidoscope", content: "Kaleidoscope", label: "In the triangle, mirrored at its sides: always seamless" },
        { value: "chiral", content: "Chiral", label: "In the kite, turned about its corners: draw it to match along edges of one colour" },
      ],
      (m) => {
        draftMode = m;
        const t = picture();
        if (t && t.mode !== m) setPicture({ ...t, mode: m });
        else refresh();
      },
    );
    const tint = new Toggle("Tint with the look's colours", (on) => {
      const t = picture();
      if (!t) return;
      const next: TileImageState = { ...t, tint: on };
      if (!on) delete next.tint;
      setPicture(next);
    });
    const preview = el("canvas", "hs-picture-preview");
    preview.setAttribute("aria-label", "The picture with the shape on it: drag to move the shape");
    const size = new Slider("Picture size", { min: PLACE_LIMITS.size[0], max: PLACE_LIMITS.size[1], log: true, format: (v) => v.toFixed(2), onInput: (v) => place({ size: v }) });
    const turn = new Slider("Picture turn", { min: -180, max: 180, format: (v) => `${v.toFixed(0)}°`, onInput: (v) => place({ turn: Math.round(v) }) });
    const resetPlace = button("Reset", "Put the shape back in the middle of the picture", () => place({ ...DEFAULT_PLACEMENT }), { className: "hs-action", tip: false });
    const pictureNote = el("div", "hs-note");
    pictureNote.setAttribute("aria-live", "polite");
    pictureNote.setAttribute("aria-label", "Tile picture check");
    const pictureControls = el("div", "hs-picture");
    pictureControls.append(tint.el, preview, row("Size", size.el), row("Turn", turn.el), resetPlace);
    // the preview: the picture fitted in the canvas, the shape over it, partner edges in one colour
    let shown = "";
    let drawnAt = { x: 0, y: 0, w: 1, h: 1 };
    const thumbs = new Map<TileImage, HTMLCanvasElement>();
    const thumbOf = (img: TileImage, want: number) => {
      let c = thumbs.get(img);
      if (c) return c;
      // the first level at most twice the preview's width, made straight again for a 2D canvas
      const lv = img.levels.find((l) => l.width <= 2 * want) ?? img.levels[img.levels.length - 1];
      const px = new Uint8ClampedArray(lv.data.length);
      for (let i = 0; i < px.length; i += 4) {
        const a = lv.data[i + 3];
        for (let k = 0; k < 3; k++) px[i + k] = a === 255 || a === 0 ? lv.data[i + k] : encodeSrgb(SRGB_TO_LINEAR[lv.data[i + k]] / (a / 255));
        px[i + 3] = a;
      }
      c = el("canvas");
      c.width = lv.width;
      c.height = lv.height;
      c.getContext("2d")?.putImageData(new ImageData(px, lv.width, lv.height), 0, 0);
      thumbs.clear();
      thumbs.set(img, c);
      return c;
    };
    const drawPreview = () => {
      const t = picture();
      const img = t ? pictureEntry(t.id)?.image : undefined;
      const cssW = preview.clientWidth || 292;
      const key = t && img ? JSON.stringify([t, cssW, host.content().state.group]) : "";
      if (key === shown) return;
      shown = key;
      preview.hidden = !img;
      if (!t || !img) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssH = Math.min(200, Math.round((cssW * img.height) / img.width));
      preview.style.height = `${cssH}px`;
      preview.width = Math.round(cssW * dpr);
      preview.height = Math.round(cssH * dpr);
      const ctx = preview.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      const k = Math.min(cssW / img.width, cssH / img.height);
      drawnAt = { w: img.width * k, h: img.height * k, x: (cssW - img.width * k) / 2, y: (cssH - img.height * k) / 2 };
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(thumbOf(img, cssW * dpr), drawnAt.x, drawnAt.y, drawnAt.w, drawnAt.h);
      const group = host.content().group;
      const m = pictureMap(group, t.mode, t.place, img.width, img.height, img.levels.length);
      ctx.lineJoin = "round";
      for (const e of shapeEdges(group, t.mode, 32)) {
        ctx.beginPath();
        e.points.forEach((w, i) => {
          const [u, v] = mapUV(m, w);
          const [x, y] = [drawnAt.x + u * drawnAt.w, drawnAt.y + v * drawnAt.h];
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.strokeStyle = "rgba(4, 5, 8, 0.75)";
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = e.pair === 2 ? "#ffffff" : PAIR_COLOURS[e.pair];
        ctx.lineWidth = 1.75;
        ctx.stroke();
      }
    };
    let drag: { x: number; y: number; px: number; py: number } | null = null;
    preview.addEventListener("pointerdown", (e) => {
      const t = picture();
      if (!t) return;
      drag = { x: e.clientX, y: e.clientY, px: t.place.x, py: t.place.y };
      preview.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    preview.addEventListener("pointermove", (e) => {
      if (!drag) return;
      place({ x: drag.px + (e.clientX - drag.x) / drawnAt.w, y: drag.py + (e.clientY - drag.y) / drawnAt.h });
    });
    const endDrag = () => (drag = null);
    preview.addEventListener("pointerup", endDrag);
    preview.addEventListener("pointercancel", endDrag);
    preview.addEventListener(
      "wheel",
      (e) => {
        const t = picture();
        if (!t) return;
        e.preventDefault();
        place({ size: t.place.size * Math.exp(-e.deltaY * 0.0015) });
      },
      { passive: false },
    );

    pane.append(
      section("Group", groupRow, note, chips),
      section("Tiling", tiling.el),
      section("Motif", motif.el, motifActions, motifNote),
      section("Tile picture", pictureMode.el, pictureActions, pictureControls, pictureNote),
      section("Construction", construction.el, free.el),
      section("Lines", ...sides.map(([, t]) => t.el), row("Width", width.el), row("Unit", unit.el)),
      section("Colouring", colouring.el, colouringNote),
    );

    const refresh = () => {
      const c = host.content();
      const state = c.state;
      if (!draft) {
        steppers.forEach((s, i) => (s.set(state.group[i]), s.mark(false)));
        note.textContent = `${tilingName(state.group)}: 1/p + 1/q + 1/r < 1, hyperbolic`;
        note.classList.remove("hs-bad");
      }
      for (const [b, g] of chipButtons) b.setAttribute("aria-pressed", String(g.join() === state.group.join()));
      tiling.set(!state.plain);
      for (const [j, t] of sides) t.set(state.sides[j]);
      const u = state.lineUnit ?? "plane";
      unit.set(u);
      width.range(WIDTH[u].min, WIDTH[u].max, u === "px" ? (v) => `${sig3(v)} px` : (v) => v.toFixed(3));
      width.set(state.lineWidth);
      // the colourings of a group are searched once; a large group can take a moment
      const key = state.group.join();
      if (key !== listedFor) {
        listedFor = key;
        const names = colouringNames(c.group);
        colouring.options(
          names.map((n) => {
            const k = colouringFor(c.group, n).k;
            return { value: n, label: colouringLabel(n, k), group: `${k} colours` };
          }),
        );
      }
      colouring.set(state.colouring);
      const shown = state.construction ?? "lines";
      colouring.el.disabled = shown !== "lines";
      colouringNote.hidden = shown === "lines";
      if (constructionsFor !== key) {
        constructionsFor = key;
        construction.options(CONSTRUCTIONS.map((x) => ({ value: x, label: constructionLabel(state.group, x) })));
      }
      construction.set(shown);
      free.el.style.display = shown === "free" ? "" : "none";
      if (shown === "free" && state.weights) free.set(state.weights);
      // a loaded motif on the screen (from a link or a saved state) is offered again later
      if (state.motif !== undefined && typeof state.motif !== "string") loaded = state.motif;
      motif.options([
        { value: "none", label: "None" },
        ...MOTIF_IDS.map((id) => ({ value: id, label: motifName(id) })),
        ...(loaded ? [{ value: "loaded", label: `${motifName(loaded)}, loaded` }] : []),
      ]);
      motif.set(state.motif === undefined ? "none" : typeof state.motif === "string" ? state.motif : "loaded");
      motifNote.classList.toggle("hs-bad", loadError !== null);
      motifNote.textContent =
        loadError ?? (state.motif === undefined ? "A motif bends the tile edges into a shape and draws on it; it brings its own group." : "Drawn for its group: another group or construction removes it.");
      // the tile picture
      const t = state.tileImage;
      const entry = t ? pictureEntry(t.id) : undefined;
      pictureMode.set(t?.mode ?? draftMode);
      removePicture.disabled = !t;
      pictureControls.hidden = !t || !entry?.image;
      if (t) {
        tint.set(!!t.tint);
        size.set(t.place.size);
        turn.set(t.place.turn);
      }
      drawPreview();
      const hidden = pictureHiddenBy(state);
      const status = entry?.status ?? "loading";
      pictureNote.classList.toggle("hs-bad", !!t && (status === "missing" || status === "broken"));
      pictureNote.textContent = !t
        ? "Your own picture in the tile: mirrored at the triangle's sides (Kaleidoscope) or turned in the kite (Chiral). Draw a chiral one on the template, so its edges match."
        : status === "missing"
          ? "This browser does not hold the picture: open the screenshot or file that has it, or load it again (its settings stay)."
          : status === "broken"
            ? `The picture could not be read: ${entry?.why ?? "unknown reason"}.`
            : status === "loading"
              ? "Reading the picture…"
              : hidden === "construction"
                ? "Hidden: a picture is drawn over Lines. Choose Lines under Construction to see it."
                : hidden === "motif"
                  ? "Hidden while a motif is drawn: choose None under Motif to see it."
                  : hidden === "plain"
                    ? "Hidden: the tiling is off."
                    : t.mode === "chiral"
                      ? "Turned about the kite's corners: seamless where the picture matches along edges of one colour (see the template). Drag the preview to move the kite."
                      : "Mirrored at the triangle's sides, so always seamless. Drag the preview to move the triangle; the wheel resizes it.";
    };
    return [pane, refresh];
  }

  // --------------------------------------------------------------------------------- look

  private looks: { button: HTMLButtonElement; canvas: HTMLCanvasElement }[] = [];

  private lookTab(): [HTMLElement, () => void] {
    const host = this.host;
    const pane = el("div");
    const gallery = el("div", "hs-looks");
    this.looks = LOOKS.map((l, i) => {
      const canvas = el("canvas", "hs-look-canvas");
      canvas.width = PREVIEW_W;
      canvas.height = PREVIEW_H;
      const b = button(canvas, l.name, () => host.chooseLook(i), { className: "hs-look", tip: false });
      b.append(el("span", "hs-look-name", l.name));
      gallery.append(b);
      return { button: b, canvas };
    });

    const strips = el("div", "hs-palettes");
    const paletteButtons = PALETTE_NAMES.map((name) => {
      const p = paletteByName(name);
      const strip = el("span", "hs-strip");
      if (p.colours) {
        const n = p.colours.length;
        strip.style.background = `linear-gradient(90deg, ${p.colours.map((c, i) => `${c} ${(100 * i) / n}% ${(100 * (i + 1)) / n}%`).join(", ")})`;
      } else {
        const stops = bakeSrgb(p, 32).map((c, i) => `rgb(${c.map((v) => Math.round(255 * v)).join(" ")}) ${((100 * i) / 31).toFixed(1)}%`);
        strip.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
      }
      const b = button(strip, name, () => look({ palette: name }), { className: "hs-palette", tip: false });
      b.append(el("span", "hs-palette-name", name));
      strips.append(b);
      return [b, name] as const;
    });

    const look = (patch: Partial<LookState>) => {
      const state = host.content().state;
      host.setContent({ ...state, look: { ...state.look!, ...patch } });
    };
    const source = new Segmented<ColourSource>(
      SOURCES.map((s) => ({ value: s, content: SOURCE_LABELS[s], label: SOURCE_LABELS[s] })),
      (s) => look({ source: s }),
    );
    const phase = new Slider("Phase", { min: 0, max: 1, format: (v) => v.toFixed(2), onInput: (v) => look({ phase: v }) });
    const density = new Slider("Density", { min: 0.02, max: 20, log: true, format: sig3, onInput: (v) => look({ density: v }) });
    const glow = new Slider("Glow", { min: 0, max: 1, format: (v) => v.toFixed(2), onInput: (v) => look({ glow: v }) });
    const relief = new Slider("Relief", { min: 0, max: 4, format: (v) => v.toFixed(2), onInput: (v) => look({ relief: v }) });
    const light = new Slider("Light", { min: 0, max: 360, format: (v) => `${v.toFixed(0)}°`, onInput: (v) => look({ light: v }) });
    const lineColour = el("input", "hs-colour");
    lineColour.type = "color";
    lineColour.setAttribute("aria-label", "Line colour");
    lineColour.addEventListener("input", () => look({ lineColour: lineColour.value }));
    const accents = new Segmented<Accent>(
      ACCENT_NAMES.map((a) => {
        const dot = el("span", "hs-swatch");
        dot.style.background = ACCENTS[a];
        return { value: a, content: dot, label: `${a[0].toUpperCase()}${a.slice(1)}` };
      }),
      (a) => host.setAccent(a),
      "hs-swatches",
    );

    pane.append(
      section("Looks", gallery),
      section("Palette", strips),
      section("Colour", row("Source", source.el), row("Phase", phase.el), row("Density", density.el)),
      section("Lines and light", row("Line colour", lineColour), row("Glow", glow.el), row("Relief", relief.el), row("Light", light.el)),
      section("Interface", row("Accent", accents.el)),
    );

    const refresh = () => {
      const state = host.content().state;
      const l = state.look!;
      const i = host.lookIndex();
      const same = (a: LookState, b: LookState) => (Object.keys(a) as (keyof LookState)[]).every((k) => a[k] === b[k]);
      this.looks.forEach((p, j) => p.button.setAttribute("aria-pressed", String(j === i && same(LOOKS[j].look, l))));
      for (const [b, name] of paletteButtons) b.setAttribute("aria-pressed", String(name === l.palette));
      source.set(l.source);
      phase.set(l.phase);
      density.set(l.density);
      glow.set(l.glow);
      relief.set(l.relief);
      light.set(l.light);
      if (document.activeElement !== lineColour && lineColour.value !== l.lineColour) lineColour.value = l.lineColour;
      accents.set(host.ui().accent);
    };
    return [pane, refresh];
  }

  /** Draw the look previews of the current view, a few per task so the page stays responsive;
   *  a newer request drops what an older one has left to do. */
  private renderPreviews(): void {
    const key = this.host.previewKey();
    if (key === this.previewsShown) return;
    this.previewsShown = key;
    const gen = ++this.previewGen;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const [w, h] = [Math.round(PREVIEW_W * dpr), Math.round(PREVIEW_H * dpr)];
    let i = 0;
    const next = () => {
      if (gen !== this.previewGen || this.el.hidden || this.tab !== "look") {
        if (gen === this.previewGen) this.previewsShown = "";
        return;
      }
      for (const end = Math.min(LOOKS.length, i + 2); i < end; i++) {
        const px = this.host.preview(LOOKS[i].look, w, h);
        const canvas = this.looks[i].canvas;
        if (!px) continue;
        if (canvas.width !== w) [canvas.width, canvas.height] = [w, h];
        canvas.getContext("2d")?.putImageData(new ImageData(Uint8ClampedArray.from(px), w, h), 0, 0);
      }
      if (i < LOOKS.length) setTimeout(next, 0);
    };
    setTimeout(next, 0);
  }

  // --------------------------------------------------------------------------------- view

  private viewTab(): [HTMLElement, () => void] {
    const host = this.host;
    const pane = el("div");
    const views = new Segmented<Model>(
      MODELS.map((m) => {
        const content = el("span", "hs-view-choice");
        content.append(viewIcon(m), el("span", "", SHORT_VIEWS[m]));
        return { value: m, content, label: SHORT_VIEWS[m], key: VIEW_KEYS[m] };
      }),
      (m) => host.setModel(m),
      "hs-seg hs-seg-views",
    );
    const distance = el("output", "hs-value");
    const cartesian = () => host.view().grids.cartesian;
    const x = new Field("Position X", (text) => {
      const s = parseFixed(text);
      if (s === null) return "Not a number";
      if (Math.abs(fixedToNumber(s)) > 1000) return "At most 1\u2009000 R from the start";
      host.place(s, cartesian().e, cartesian().theta);
      return null;
    }, { unit: "R" });
    const y = new Field("Position Y", (text) => {
      const v = Number(text.replace(/−/g, "-"));
      if (!Number.isFinite(v) || text.trim() === "") return "Not a number";
      if (Math.abs(v) > 1000) return "At most 1\u2009000 R from the start";
      host.place(cartesian().s, v, cartesian().theta);
      return null;
    }, { unit: "R" });
    const rotation = new Field("Rotation", (text) => {
      const v = Number(text.replace(/−/g, "-"));
      if (!Number.isFinite(v) || text.trim() === "") return "Not a number";
      host.place(cartesian().s, cartesian().e, (v * Math.PI) / 180);
      return null;
    }, { unit: "°" });
    const zoom = new Field("Magnification", (text) => {
      const v = Number(text.replace(/−/g, "-"));
      if (!Number.isFinite(v) || text.trim() === "") return "Not a number";
      const got = host.zoomTo(v);
      return Math.abs(got - v) > 0.005 ? `The zoom stops at 10^${exponentText(got)} here` : null;
    }, { prefix: "10^" });
    // inside H3: the eye's height in place of the magnification, and the field of view
    const eye = new Field("Eye height", (text) => {
      const v = Number(text.replace(/−/g, "-"));
      if (!Number.isFinite(v) || text.trim() === "") return "Not a number";
      if (v < H3_MIN_H || v > H3_MAX_H) return `From ${H3_MIN_H} to ${H3_MAX_H} R`;
      host.setEye({ h: v });
      return null;
    }, { unit: "R" });
    // on the hyperboloid: the orbit's distance from the vertex
    const orbit = new Field("Orbit distance", (text) => {
      const v = Number(text.replace(/−/g, "-"));
      if (!Number.isFinite(v) || text.trim() === "") return "Not a number";
      if (v < HB_MIN_DISTANCE || v > HB_MAX_DISTANCE) return `From ${HB_MIN_DISTANCE} to ${HB_MAX_DISTANCE} R`;
      host.setOrbit({ distance: v });
      return null;
    }, { unit: "R" });
    // inside H3 and on the hyperboloid alike (views.ts gives both the same range)
    const fov = new Slider("Field of view", {
      min: degrees(H3_MIN_FOV),
      max: degrees(H3_MAX_FOV),
      format: (v) => `${Math.round(v)}°`,
      onInput: (v) => {
        const rad = (Math.round(v) * Math.PI) / 180;
        if (host.view().picture.model === "hyperboloid") host.setOrbit({ fov: rad });
        else host.setEye({ fov: rad });
      },
    });
    const eyeRow = row("Eye height", eye.el);
    const orbitRow = row("Orbit distance", orbit.el);
    const zoomRow = row("Magnification", zoom.el);
    const fovRow = row("Field of view", fov.el);
    const gridOn = new Toggle("Show the unit grid", (on) => {
      const state = host.content().state;
      host.setContent({ ...state, grid: { ...(state.grid ?? DEFAULT_GRID), on } });
    });
    const grid = (patch: { kind?: GridKind; unit?: GridUnit }) => {
      const state = host.content().state;
      host.setContent({ ...state, grid: { ...(state.grid ?? DEFAULT_GRID), on: true, ...patch } });
    };
    const kind = new Segmented<GridKind>(
      GRID_KINDS.map((k) => ({ value: k, content: KIND_LABELS[k], label: `${KIND_LABELS[k]} grid` })),
      (k) => grid({ kind: k }),
    );
    const unit = new Select<GridUnit>("Size of R", (u) => grid({ unit: u }));
    unit.options(GRID_UNITS.map((u) => ({ value: u, label: UNITS[u].name })));
    const shot = new Select<ShotSize>("Screenshot size", (s) => host.setShotSize(s));
    const actions = el("div", "hs-actions");
    actions.append(
      button("Home", "Home", () => host.home(), { className: "hs-action", tip: false }),
      button("Copy link", "Copy a link to this view", () => host.copyLink(), { className: "hs-action", tip: false }),
      button("Screenshot", "Save a screenshot", () => host.screenshot(), { className: "hs-action", tip: false }),
    );

    pane.append(
      section("View", views.el, fovRow),
      section(
        "Where you are",
        row("Distance", distance),
        row("X", x.el),
        row("Y", y.el),
        row("Rotation", rotation.el),
        zoomRow,
        eyeRow,
        orbitRow,
      ),
      section("Unit grid", gridOn.el, row("Type", kind.el), row("Size of R", unit.el)),
      section("Screenshot", row("Size", shot.el)),
      actions,
    );

    const refresh = () => {
      const v = host.view();
      const state = host.content().state;
      const g = state.grid ?? DEFAULT_GRID;
      views.set(v.picture.model);
      const d = distanceText(v.grids.polar.e, g.unit);
      if (distance.textContent !== d) distance.textContent = d;
      const decimals = positionDecimals(host.pixelLength());
      const c = v.grids.cartesian;
      x.set(formatFixed(c.s, decimals));
      // Y is a float64: no more decimals than its 15 or so significant digits hold
      y.set(c.e.toFixed(Math.min(decimals, Math.max(3, 15 - Math.max(0, Math.ceil(Math.log10(Math.abs(c.e) + 1)))))));
      rotation.set(degrees(c.theta).toFixed(2));
      const inside = v.picture.model === "h3";
      const onSurface = v.picture.model === "hyperboloid";
      zoomRow.hidden = inside || onSurface;
      eyeRow.hidden = !inside;
      orbitRow.hidden = !onSurface;
      fovRow.hidden = !inside && !onSurface;
      if (v.picture.model === "h3") {
        eye.set(v.picture.h.toPrecision(3));
        fov.set(degrees(v.picture.fov));
      } else if (v.picture.model === "hyperboloid") {
        orbit.set(v.picture.distance.toPrecision(3));
        fov.set(degrees(v.picture.fov));
      } else zoom.set(exponentText(magnification(v.picture)).replace("−", "-"));
      gridOn.set(g.on);
      kind.set(g.kind);
      unit.set(g.unit);
      shot.options(
        SHOT_SIZES.map((s) => {
          const [w, h] = host.shotPixels(s);
          const size = `${w} × ${h}`;
          return { value: s, label: SHOT_LABELS[s] === size ? size : `${SHOT_LABELS[s]}, ${size}` };
        }),
      );
      shot.set(host.shotSize());
    };
    return [pane, refresh];
  }
}
