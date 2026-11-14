// Hyperscope entry point: canvas and WebGL2 context, the store, the renderer and the input, and a
// render loop that runs only while the view moves or the picture is still being refined.

import "./ui/hud.css";
import { LOOKS, nearestLook } from "./content/looks.ts";
import { PALETTE_NAMES } from "./content/palettes.ts";
import type { TileImageState, TileMode } from "./content/tileimage.ts";
import { DEFAULT_PLACEMENT, pictureEntry, setPicture, tileImageFromRGBA } from "./content/tileimage.ts";
import { decodePicture, fetchPicture, pictureFromFile, storePicture, sweepPictures } from "./state/pictures.ts";
import { templateName, templatePNG } from "./ui/template.ts";
import { buildContent, colouringNames, MOTIF_IDS, motifName, PRESETS, readMotif, sceneOf, withConstruction, withMotif, withTileImage, type Content, type ContentState } from "./content/scene.ts";
import { CONSTRUCTIONS } from "./math/wythoff.ts";
import { MOTIF_FORMAT } from "./math/motifs.ts";
import { clampZoom, clearWall, homeView, MIN_FOOTPRINT, MIN_FOOTPRINT_PLAIN, placeAt, settle, switchModel, worldAt, zoomAt, type ViewState } from "./input/camera.ts";
import { Controls, isField } from "./input/controls.ts";
import { stripsOf } from "./input/strips.ts";
import type { Complex } from "./math/complex.ts";
import { carry, colourOf } from "./math/colourings.ts";
import { fold } from "./math/groups.ts";
import {
  H3_HOME, H3_MAX_FOV, H3_MAX_H, H3_MIN_FOV, H3_MIN_H, HB_HOME, HB_MAX_DISTANCE, HB_MAX_FOV, HB_MIN_DISTANCE, HB_MIN_FOV, frameOf, referenceScale, tiltWith, type H3Picture,
  type HyperboloidPicture, type Model, type Picture,
} from "./math/views.ts";
import { DEFAULT_GRID, fixedToNumber, GRID_KINDS, GRID_UNITS, homeGrids, MAX_E, UNITS, type GridKind } from "./math/grid.ts";
import { Renderer, type Accumulator, type FrameSpec } from "./render/gl.ts";
import { frameGrid } from "./render/grid.ts";
import { Progressive } from "./render/progressive.ts";
import { shotSize, SHOT_SIZES, TILE, tiles, type ShotSize, type Tile } from "./render/shot.ts";
import { readText, withText } from "./state/pngtext.ts";
import { hex } from "./math/colour.ts";
import { ViewHistory } from "./state/history.ts";
import { mergePresets, presetFile, PRESETS_KEY, readPresets, type UserPreset } from "./state/presets.ts";
import { ACCENTS, DEFAULT_UI, fromLink, homeSnapshot, load, save, toLink, withPictures, type Accent, type Loaded, type Snapshot } from "./state/saved.ts";
import { Store } from "./state/store.ts";
import { loadFonts } from "./ui/fonts.ts";
import { Card, colouringLabel, constructionLabel, contentLabel } from "./ui/card.ts";
import { copyText } from "./ui/clipboard.ts";
import { Gallery } from "./ui/gallery.ts";
import { Hud } from "./ui/hud.ts";
import { gridLabels, TEXT_PAD } from "./ui/labels.ts";
import { distanceText, eyeText, FrameRate, magnification, orbitText } from "./ui/readouts.ts";
import { Toolbar } from "./ui/toolbar.ts";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLDivElement;
const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });

window.hyperscope = { ready: false, frames: 0 };

const MODEL_NAMES: Record<Model, string> = { poincare: "Poincaré disk", klein: "Klein disk", halfplane: "Half-plane", local: "Local view", h3: "Inside H³", hyperboloid: "Hyperboloid", band: "Band" };
const GRID_NAMES: Record<GridKind, string> = { cartesian: "Cartesian", polar: "polar", horocyclic: "horocyclic" };
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** The view rests this long before it goes into the history and the look previews follow it. */
const REST_MS = 400;
/** The session is saved this long after the last change; the address bar follows at most this often. */
const SESSION_MS = 1000;
const LINK_MS = 300;
const SESSION_KEY = "hyperscope.session";
/** Your presets' pictures, device pixels (square). */
const THUMB_PX = 192;
/** The screenshot size is this device's own choice, kept apart from the saved state. */
const SHOT_KEY = "hyperscope.shot";

function fail(message: string): void {
  window.hyperscope.error = message;
  hudRoot.innerHTML = "";
  hudRoot.className = "";
  const box = document.createElement("div");
  box.className = "hs-error";
  box.textContent = message;
  hudRoot.append(box);
}

if (!gl) fail("WebGL2 is not available in this browser. Hyperscope needs a current Chrome, Edge or Firefox.");
else start(gl);

function start(gl: WebGL2RenderingContext): void {
  // for tests: ?accum=8 forces the 8-bit accumulation that machines without float targets get,
  // ?moving=0.5 fixes the render scale while moving, ?tile=256 draws screenshots in smaller parts
  const params = new URLSearchParams(location.search);
  const renderer = new Renderer(gl, { floatTargets: params.get("accum") !== "8" });
  const progressive = new Progressive(renderer.maxSamples);
  if (params.has("moving")) {
    progressive.movingScale = Number(params.get("moving"));
    progressive.adaptive = false;
  }
  let target: Accumulator | null = null;
  let presetIndex = 0;
  let lookIndex = 0;
  let content: Content = buildContent({ ...PRESETS[0].content, look: LOOKS[0].look }, PRESETS[0].label);
  const store = new Store({ v: 1, view: homeView(content.colouring.k), content: content.state, ui: DEFAULT_UI });

  const hud = new Hud(hudRoot);
  hud.attach();
  let accent: { name: Accent; rgb: [number, number, number] } | null = null;
  const accentRGB = () => {
    const name = store.state.ui.accent;
    if (accent?.name !== name) {
      accent = { name, rgb: hex(ACCENTS[name]) };
      hud.setAccent(ACCENTS[name]);
    }
    return accent.rgb;
  };
  /** What the GPU draws for a view of content c in a width x height picture: the band in strips
   *  (input/strips.ts), each with its own camera, colours, start and grid. */
  const specOf = (c: Content, view: ViewState, width: number, height: number): FrameSpec => {
    const part = (v: ViewState) => ({ camera: v.camera, picture: v.picture, scene: sceneOf(c, v), grid: frameGrid(c.state.grid, v.grids, v.picture, height), accent: accentRGB() });
    const strips = stripsOf(view, c.group, c.colouring, width / height);
    return { ...part(view), strips: strips.length > 1 ? strips.map((st) => ({ ...part(st.view), du: st.du, depthFog: st.fog, from: st.from, to: st.to })) : undefined };
  };
  accentRGB();
  /** The readouts that follow the state: the title, the distance and the magnification. */
  const showHud = () => {
    const { view } = store.state;
    const g = content.state.grid;
    const beyond = g?.on && !(Math.abs(view.grids[g.kind].e) <= MAX_E) ? ` (not drawn: more than ${MAX_E} R out)` : "";
    const grid = g?.on ? ` · ${GRID_NAMES[g.kind]} grid, ${UNITS[g.unit].name}${beyond}` : "";
    hud.update({
      title: `${content.label} · ${MODEL_NAMES[view.picture.model]}${grid}`,
      distance: distanceText(view.grids.polar.e, g?.unit ?? DEFAULT_GRID.unit),
      magnification: magnification(view.picture),
      eye: view.picture.model === "h3" ? { key: "Eye height", ...eyeText(view.picture.h, g?.unit ?? DEFAULT_GRID.unit) }
        : view.picture.model === "hyperboloid" ? { key: "Orbit distance", ...orbitText(view.picture) }
        : null,
    });
  };
  /** The readouts that follow the render loop: samples, size and, when given, the frame rate. */
  const showProgress = (fps?: number | null) =>
    hud.update({
      samples: progressive.n,
      maxSamples: progressive.maxSamples,
      float: renderer.floatTargets,
      width: canvas.width,
      height: canvas.height,
      ...(fps !== undefined ? { fps } : {}),
    });
  const rate = new FrameRate();
  let fpsShownAt = 0;
  showHud();
  showProgress(null);

  // the grid's labels, their text above and right of where the line crosses the label line
  const labelLayer = document.createElement("div");
  labelLayer.className = "hs-labels";
  hudRoot.prepend(labelLayer);
  // the labels' font from its longhands (some browsers leave the computed shorthand empty), to
  // measure their text
  const style = getComputedStyle(labelLayer);
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const ruler = document.createElement("canvas").getContext("2d");
  const widths = new Map<string, number>();
  const measure = (text: string) => {
    let w = widths.get(text);
    if (w === undefined) {
      if (ruler) ruler.font = font;
      w = ruler ? ruler.measureText(text).width : 6 * text.length;
      if (widths.size > 512) widths.clear();
      widths.set(text, w);
    }
    return w;
  };
  let labelKey = "";
  const showLabels = () => {
    const { view } = store.state;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const labels = w > 0 && h > 0 ? gridLabels(content.state.grid, view.grids, view.picture, w, h, canvas.height / h, measure, hud.keepOut()) : [];
    const key = labels.map((l) => `${l.edge}${l.x.toFixed(1)},${l.y.toFixed(1)}${l.text}`).join("|");
    if (key === labelKey) return;
    labelKey = key;
    while (labelLayer.children.length < labels.length) labelLayer.append(document.createElement("div"));
    for (let i = 0; i < labelLayer.children.length; i++) {
      const el = labelLayer.children[i] as HTMLDivElement;
      const l = labels[i];
      el.hidden = !l;
      if (!l) continue;
      if (el.textContent !== l.text) el.textContent = l.text;
      el.className = "hs-label";
      el.style.transform =
        l.edge === "right" ? `translate(${l.x - TEXT_PAD}px, ${l.y - TEXT_PAD}px) translate(-100%, -100%)` : `translate(${l.x + TEXT_PAD}px, ${l.y - TEXT_PAD}px) translateY(-100%)`;
    }
  };

  hud.onLayout = showLabels;
  // the bundled fonts change the labels' widths once they arrive
  void loadFonts().then(() => {
    widths.clear();
    labelKey = "";
    showLabels();
  });

  let frameRequested = false;
  let lastTime = 0;
  const wake = () => {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  };

  const minFootprint = () => (content.state.plain ? MIN_FOOTPRINT_PLAIN : MIN_FOOTPRINT);
  const setView = (v: ViewState) => store.set({ view: settle(v, content.group, content.colouring) });
  /** New content, keeping the view (zoomed out to the new content's limit if need be); a new
   *  colouring restarts its colours from the identity. The view stays bit for bit unless the
   *  tiling or the zoom limit moved it, so the history still knows it. */
  const setContent = (state: ContentState, label: string) => {
    const sameColouring = state.colouring === content.state.colouring && state.group.join() === content.state.group.join();
    content = buildContent(state, label);
    const was = store.state.view;
    let view = clampZoom(was, canvas.height, minFootprint());
    if (!sameColouring) view = settle({ ...view, perm: [] }, content.group, content.colouring);
    else if (view !== was) view = settle(view, content.group, content.colouring);
    store.set({ view, content: content.state });
  };
  const controls = new Controls(
    {
      view: () => store.state.view,
      setView,
      height: () => canvas.height,
      minFootprint,
      symmetryAngle: () => (2 * Math.PI) / content.group.p,
      home: () => goHome(),
      back: () => goBack(),
      forward: () => goForward(),
      nextPreset: (step) => {
        jumpFrom();
        presetIndex = (presetIndex + step + PRESETS.length) % PRESETS.length;
        const p = PRESETS[presetIndex];
        // the grid stays as it is, unless the preset is the unit grid's own
        setContent({ ...p.content, look: content.state.look, grid: p.content.grid ?? content.state.grid }, p.label);
      },
      toggleGrid: () => {
        const g = content.state.grid ?? DEFAULT_GRID;
        setContent({ ...content.state, grid: { ...g, on: !g.on } }, content.label);
      },
      cycle: (what, step) => {
        const state = content.state;
        const next = <T,>(list: T[], current: T) => list[(Math.max(0, list.indexOf(current)) + step + list.length) % list.length];
        if (what === "look") {
          lookIndex = (lookIndex + step + LOOKS.length) % LOOKS.length;
          setContent({ ...state, look: LOOKS[lookIndex].look }, content.label);
          hud.toast(`Look: ${LOOKS[lookIndex].name}`);
        } else if (what === "palette") {
          const palette = next(PALETTE_NAMES, state.look!.palette);
          setContent({ ...state, look: { ...state.look!, palette } }, content.label);
          hud.toast(`Palette: ${palette}`);
        } else if (what === "grid" || what === "unit") {
          const g = state.grid ?? DEFAULT_GRID;
          const grid = what === "grid" ? { ...g, on: true, kind: next(GRID_KINDS, g.kind) } : { ...g, on: true, unit: next(GRID_UNITS, g.unit) };
          setContent({ ...state, grid }, content.label);
          hud.toast(what === "grid" ? `${capital(GRID_NAMES[grid.kind])} grid` : UNITS[grid.unit].name);
        } else if (what === "construction") {
          // Lines, the named constructions and the snub; the free point is the card's
          const list = CONSTRUCTIONS.filter((c) => c !== "free");
          const c = next(list, state.construction ?? "lines");
          const st = withConstruction(state, c);
          setContent(st, contentLabel(st));
          hud.toast(`Construction: ${constructionLabel(st.group, c)}`);
        } else if (what === "motif") {
          // none and the built-ins; a loaded motif is the card's (it counts as none here)
          const ids: (string | null)[] = [null, ...MOTIF_IDS];
          const ref = next(ids, typeof state.motif === "string" ? state.motif : null);
          const st = withMotif(state, ref);
          setContent(st, contentLabel(st));
          hud.toast(ref === null ? "No motif" : `Motif: ${motifName(ref)}`);
        } else {
          setContent({ ...state, colouring: next(colouringNames(content.group), state.colouring) }, content.label);
          hud.toast(colouringLabel(content.state.colouring, content.colouring.k));
        }
      },
      setModel: (model) => chooseModel(model),
      dismiss: () => hud.dismiss(),
      toggleInterface: () => hud.setHidden(!hud.hidden),
      notice: (text) => hud.toast(text),
      activity: () => hud.poke(),
      wake,
    },
    canvas,
  );
  controls.attach();

  // ------------------------------------------------------------------ history of views
  /** A view in the history, its saved form to compare, and the tiling it was settled for. */
  interface Entry {
    view: ViewState;
    key: string;
    tiling: string;
  }
  const views = new ViewHistory<Entry>((a, b) => a.key === b.key);
  const entry = (): Entry => {
    const { view, ui } = store.state;
    return { view, key: JSON.stringify(save({ view, content: content.state, ui }).view), tiling: `${content.state.group}|${content.colouring.k}` };
  };
  /** Keep the view a jump leaves (home, another view model, a preset, a typed place, a link). */
  const jumpFrom = () => views.record(entry());
  const goTo = (e: Entry | null) => {
    if (!e) return;
    controls.stop();
    // bit for bit as it was, unless the tiling changed since: then re-centred for the new one
    const view = clampZoom(e.view, canvas.height, minFootprint());
    if (e.tiling === entry().tiling) store.set({ view });
    else setView(view);
  };
  const goBack = () => goTo(views.back(entry()));
  const goForward = () => goTo(views.forward(entry()));

  // ------------------------------------------------------------------ icon row and settings card
  const snapshot = (): Snapshot => ({ view: store.state.view, content: content.state, ui: store.state.ui });
  let pending: { state: ContentState; label: string } | null = null;
  /** Content from the card's controls, applied once per frame (a slider sends many changes). */
  const scheduleContent = (state: ContentState, label: string) => {
    const first = pending === null;
    pending = { state, label };
    if (first)
      requestAnimationFrame(() => {
        const p = pending;
        pending = null;
        if (p) setContent(p.state, p.label);
      });
  };
  /** The eye inside H3 and the hyperboloid's orbit as those views were last left: the way back in
   *  finds them again (Home keeps the field of view, a setting). */
  let lastEye: H3Picture = H3_HOME;
  let lastOrbit: HyperboloidPicture = HB_HOME;
  const remember = (picture: Picture) => {
    if (picture.model === "h3") lastEye = { h: picture.h, pitch: picture.pitch, fov: picture.fov };
    if (picture.model === "hyperboloid") lastOrbit = { elevation: picture.elevation, distance: picture.distance, fov: picture.fov };
  };
  const goHome = () => {
    controls.stop();
    jumpFrom();
    const { picture } = store.state.view;
    remember(picture);
    store.set({ view: homeView(content.colouring.k, picture.model, { ...H3_HOME, fov: lastEye.fov }, { ...HB_HOME, fov: lastOrbit.fov }) });
  };
  const chooseModel = (model: Model) => {
    controls.stop();
    jumpFrom();
    const { view } = store.state;
    remember(view.picture);
    setView(switchModel(view, model, canvas.height, minFootprint(), lastEye, lastOrbit));
  };
  /** On the hyperboloid: the orbit's distance (a jump, as a zoom typed in, kept clear of the
   *  surface) or the field of view (a setting). */
  const setOrbit = (patch: { distance?: number; fov?: number }) => {
    const { view } = store.state;
    if (view.picture.model !== "hyperboloid") return;
    controls.stop();
    if (patch.distance !== undefined) jumpFrom();
    const fov = Math.min(HB_MAX_FOV, Math.max(HB_MIN_FOV, patch.fov ?? view.picture.fov));
    const d = Math.min(HB_MAX_DISTANCE, Math.max(HB_MIN_DISTANCE, patch.distance ?? view.picture.distance));
    const picture = clearWall({ ...view.picture, fov }, "distance", d, [HB_MIN_DISTANCE, HB_MAX_DISTANCE]);
    store.set({ view: { ...view, picture: { ...picture, model: "hyperboloid" } } });
  };
  const setEye = (patch: { h?: number; fov?: number }) => {
    const { view } = store.state;
    if (view.picture.model !== "h3") return;
    controls.stop();
    // a new height is a jump, as a zoom typed in; the field of view a setting, changed in place
    if (patch.h !== undefined) jumpFrom();
    const h = Math.min(H3_MAX_H, Math.max(H3_MIN_H, patch.h ?? view.picture.h));
    const fov = Math.min(H3_MAX_FOV, Math.max(H3_MIN_FOV, patch.fov ?? view.picture.fov));
    // a height typed in tilts the view as a zoom does
    const pitch = tiltWith(view.picture.pitch, view.picture.h, h);
    store.set({ view: { ...view, picture: { ...view.picture, h, pitch, fov } } });
  };
  const toggleGrid = () => {
    const g = content.state.grid ?? DEFAULT_GRID;
    setContent({ ...content.state, grid: { ...g, on: !g.on } }, content.label);
  };
  const toolbar = new Toolbar({
    home: goHome,
    back: goBack,
    forward: goForward,
    setModel: chooseModel,
    toggleGrid,
    toggleCard: () => hud.showPanel(card.el),
    toggleGallery: () => hud.showPanel(gallery.el),
    screenshot: () => void screenshot(),
    help: () => hud.showHelp(),
  });
  const card = new Card({
    content: () => (pending ? { ...content, state: pending.state } : content),
    view: () => store.state.view,
    ui: () => store.state.ui,
    lookIndex: () => lookIndex,
    pixelLength: () => referenceScale(store.state.view.picture) / (canvas.clientHeight / 2),
    setContent: (state, label) => scheduleContent(state, label ?? content.label),
    chooseLook: (i) => {
      lookIndex = i;
      scheduleContent({ ...(pending?.state ?? content.state), look: LOOKS[i].look }, content.label);
    },
    setModel: chooseModel,
    setAccent: (accent) => store.set({ ui: { ...store.state.ui, accent } }),
    place: (s, y, theta) => {
      controls.stop();
      jumpFrom();
      const t = Math.atan2(Math.sin(theta), Math.cos(theta));
      const v = placeAt(store.state.view, fixedToNumber(s), y, t, content.group, content.colouring);
      // the walk's grid camera to within rounding; the typed values exactly
      store.set({ view: { ...v, grids: { ...v.grids, cartesian: { s, e: y, theta: t } } } });
    },
    zoomTo: (exponent) => {
      controls.stop();
      jumpFrom();
      const { view } = store.state;
      const k = 10 ** (exponent - magnification(view.picture));
      const z = zoomAt(view, [0, 0], k, canvas.height, minFootprint());
      setView(z.view);
      return magnification(z.view.picture);
    },
    setEye,
    setOrbit,
    home: goHome,
    shotSize: () => shotKind,
    shotPixels: (size) => shotSize(size, canvas.width, canvas.height),
    setShotSize: (size) => {
      shotKind = size;
      try {
        storage?.setItem(SHOT_KEY, size);
      } catch {
        // kept for this visit
      }
    },
    screenshot: () => void screenshot(),
    copyLink: () => {
      void copyText(linkHref()).then((ok) => hud.toast(ok ? "Link to this view copied" : "The browser did not let the page copy the link"));
    },
    preview: (look, w, h) => {
      try {
        const c = buildContent({ ...content.state, look });
        const { view } = store.state;
        return renderer.renderPixels(specOf(c, view, w, h), w, h, 2);
      } catch {
        return null;
      }
    },
    previewKey: () => JSON.stringify([save(snapshot()).view, { ...content.state, look: null }, store.state.ui.accent, !!content.picture]),
    loadPicture: (file, mode) => void loadPicture(file, mode),
    exportTemplate: (mode) => void exportTemplate(mode),
  });
  /** A content's picture at home in a square of `size` device pixels, RGBA top row first. */
  const drawContent = (c: Content, model: Model, size: number, samples: number) => {
    const view = homeView(c.colouring.k, model);
    return renderer.renderPixels(
      specOf(c, view, size, size),
      size,
      size,
      samples,
    );
  };
  const presetState = (i: number): ContentState => {
    const p = PRESETS[i];
    return { ...p.content, look: LOOKS.find((l) => l.name === p.look)?.look ?? LOOKS[0].look, grid: p.content.grid ?? content.state.grid };
  };
  const presetContents = new Map<string, Content>();
  const gallery = new Gallery({
    builtIn: () => PRESETS.map((p) => p.label),
    drawBuiltIn: (i, size) => {
      try {
        const state = presetState(i);
        const key = JSON.stringify(state);
        let c = presetContents.get(key);
        if (!c) presetContents.set(key, (c = buildContent(state, PRESETS[i].label)));
        return drawContent(c, PRESETS[i].model ?? store.state.view.picture.model, size, 2);
      } catch {
        return null;
      }
    },
    builtInKey: () => JSON.stringify([store.state.ui.accent, content.state.grid ?? null, store.state.view.picture.model]),
    currentBuiltIn: () => PRESETS.findIndex((p) => p.label === contentLabel(content.state)),
    chooseBuiltIn: (i) => {
      jumpFrom();
      applySnapshot({ ...homeSnapshot(presetState(i), PRESETS[i].model ?? store.state.view.picture.model), ui: store.state.ui });
    },
    user: () => userPresets,
    chooseUser: (i) => {
      const r = load(userPresets[i]?.state);
      if (!r.ok) return hud.toast(`Not loaded: ${r.reason}`);
      jumpFrom();
      applySnapshot(r.state);
    },
    saveCurrent: (name) => {
      userPresets = [...userPresets, { name, state: save(snapshot()), thumb: thumbnail() }];
      hud.toast(writePresets() ? `Saved “${name}”` : "Saved for this visit only: this browser keeps nothing for this page");
    },
    deleteUser: (i) => {
      const gone = userPresets[i];
      if (!gone) return;
      userPresets = userPresets.filter((_, j) => j !== i);
      writePresets();
      hud.toast(`Deleted “${gone.name}”`);
    },
    defaultName: () => `${content.label} · ${MODEL_NAMES[store.state.view.picture.model]}`,
    exportAll: () => void exportPresets(),
    importFile: (file) => void readFile(file),
  });
  hud.setChrome(toolbar.el, card.el, gallery.el);
  const showChrome = () => {
    const here = entry();
    toolbar.refresh({
      model: store.state.view.picture.model,
      gridOn: !!content.state.grid?.on,
      canBack: views.canBack(here),
      canForward: views.canForward(here),
      cardOpen: !card.el.hidden,
      galleryOpen: !gallery.el.hidden,
    });
  };
  hud.onPanel = (panel, open) => {
    showChrome();
    if (open && panel === card.el) card.show(card.currentTab);
    if (open && panel === gallery.el) gallery.refresh();
  };
  showChrome();

  // ------------------------------------------------------------------ session, address bar, clipboard
  /** Show a saved state: its content, view and accent. */
  const applySnapshot = (s: Snapshot) => {
    controls.stop();
    pending = null;
    lookIndex = nearestLook(s.content.look ?? LOOKS[0].look);
    const p = PRESETS.findIndex((p) => !!p.content.plain === !!s.content.plain && p.content.group.join() === s.content.group.join());
    if (p >= 0) presetIndex = p;
    content = buildContent(s.content, contentLabel(s.content));
    store.set({ view: clampZoom(s.view, canvas.height, minFootprint()), content: content.state, ui: s.ui });
  };
  /** A link (pasted, or typed into the address bar) or JSON: a saved state is a jump, a presets
   *  file adds its presets to yours. */
  const loadText = (text: string): void => {
    const t = text.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      let json: unknown;
      try {
        json = JSON.parse(t);
      } catch {
        return hud.toast("Not loaded: not a Hyperscope state");
      }
      return loadJson(json);
    }
    const r = fromLink(t);
    if (!r.ok) return hud.toast(`Not loaded: ${r.reason}`);
    jumpFrom();
    applySnapshot(r.state);
    hud.toast("Link loaded");
  };
  const loadJson = (json: unknown, loaded = "Saved state loaded"): void => {
    const presets = Array.isArray(json) || (typeof json === "object" && json !== null && (json as { hyperscope?: unknown }).hyperscope === "presets");
    if (presets) return importPresets(json);
    if (typeof json === "object" && json !== null && (json as { format?: unknown }).format === MOTIF_FORMAT) return loadMotif(json);
    const r: Loaded = load(json);
    if (!r.ok) return hud.toast(`Not loaded: ${r.reason}`);
    registerPictures(r.images);
    jumpFrom();
    applySnapshot(r.state);
    hud.toast(loaded);
  };
  /** A motif file dropped or pasted: drawn with its group, as the card's Load motif does. */
  const loadMotif = (json: unknown): void => {
    const r = readMotif(json);
    if (!r.ok) return hud.toast(`Motif not loaded: ${r.reason}`);
    const st = withMotif(content.state, r.spec);
    setContent(st, contentLabel(st));
    hud.toast(`Motif: ${motifName(r.spec)}`);
  };
  /** A file opened or dropped: a screenshot returns to its view, JSON is a state, presets or a
   *  motif, and any other picture becomes the tile picture. */
  const readFile = async (file: File): Promise<void> => {
    let json: unknown;
    try {
      if (file.type === "image/png" || /\.png$/i.test(file.name)) {
        const text = readText(new Uint8Array(await file.arrayBuffer()), "hyperscope");
        if (text === null) return loadPicture(file);
        return loadJson(JSON.parse(text), `The view of ${file.name} loaded`);
      }
      if (file.type.startsWith("image/") || /\.(jpe?g|webp|gif|avif|bmp)$/i.test(file.name)) return loadPicture(file);
      json = JSON.parse(await file.text());
    } catch {
      return hud.toast(`Not loaded: ${file.name} is not a Hyperscope file`);
    }
    loadJson(json);
  };
  const linkHref = () => `${location.href.split("#")[0]}#${toLink(snapshot())}`;

  // ------------------------------------------------------------------ tile pictures
  /** Data URLs a file carried: known from now on, and kept in this browser. */
  const registerPictures = (images?: Record<string, string>) => {
    for (const [id, src] of Object.entries(images ?? {})) {
      setPicture(id, { src, ...(pictureEntry(id)?.image ? {} : { status: "loading" as const }) });
      void storePicture(id, src);
    }
  };
  const resolving = new Set<string>();
  /** Decode the content's picture when it is not: from its data URL, else from this browser's store;
   *  the content is built again once it is. */
  const resolvePicture = () => {
    const id = content.state.tileImage?.id;
    if (!id || resolving.has(id)) return;
    const e = pictureEntry(id);
    if (e?.image || e?.status === "missing" || e?.status === "broken") return;
    resolving.add(id);
    setPicture(id, { status: "loading" });
    void (async () => {
      try {
        const src = e?.src ?? (await fetchPicture(id));
        if (!src) {
          setPicture(id, { status: "missing" });
          hud.toast("The tile picture is not in this browser: open the screenshot or file that has it, or load it again");
        } else {
          setPicture(id, { src });
          setPicture(id, { image: await decodePicture(src, id) });
        }
      } catch (err) {
        setPicture(id, { status: "broken", why: (err as Error).message });
      } finally {
        resolving.delete(id);
      }
      if (content.state.tileImage?.id === id) setContent(pending?.state ?? content.state, content.label);
      else if (!card.el.hidden) card.refresh();
    })();
  };
  /** A picture file as the tile picture: in this mode, else the picture's before or Kaleidoscope. A
   *  picture loaded after a link takes the link's settings; another one is placed afresh. */
  const loadPicture = async (file: File, mode?: TileMode): Promise<void> => {
    const name = file.name || "the picture";
    hud.toast(`Reading ${name}…`);
    try {
      const { src, id } = await pictureFromFile(file);
      // a link's picture missing here: asked for before the new one is registered, which may be it
      const was = (pending?.state ?? content.state).tileImage;
      const keep = !!was && pictureEntry(was.id)?.status === "missing";
      registerPictures({ [id]: src });
      if (!pictureEntry(id)?.image) setPicture(id, { image: await decodePicture(src, id) });
      const state = pending?.state ?? content.state;
      const t: TileImageState = { mode: mode ?? was?.mode ?? "kaleidoscope", ...(was?.tint ? { tint: true } : {}), place: keep ? was!.place : DEFAULT_PLACEMENT, id };
      const next = withTileImage(state, t);
      setContent(next, contentLabel(next));
      hud.toast(`Tile picture: ${name}`);
    } catch (e) {
      hud.toast(`Picture not loaded: ${name}: ${(e as Error).message}`);
    }
  };
  const exportTemplate = async (mode: TileMode): Promise<void> => {
    try {
      const name = templateName(content.group, mode);
      download(await templatePNG(content.group, mode), name);
      hud.toast(`Template saved: ${name}`);
    } catch (e) {
      hud.toast(`No template: ${(e as Error).message}`);
    }
  };
  /** Your presets as a file that stands alone: each with its picture's data URL. */
  const exportPresets = async (): Promise<void> => {
    if (userPresets.length === 0) return hud.toast("No presets of yours to export yet");
    const list = await Promise.all(
      userPresets.map(async (p) => {
        const id = p.state.content.tileImage?.id;
        const src = id ? (pictureEntry(id)?.src ?? (await fetchPicture(id)) ?? undefined) : undefined;
        return { ...p, state: withPictures(p.state, () => src) };
      }),
    );
    download(new Blob([JSON.stringify(presetFile(list), null, 1)], { type: "application/json" }), "hyperscope-presets.json");
    hud.toast(`${count(userPresets.length, "preset")} written to hyperscope-presets.json`);
  };
  /** The pictures the screen and your presets use (the store keeps these, and a few others). */
  const picturesInUse = () => new Set([content.state.tileImage?.id, ...userPresets.map((p) => p.state.content.tileImage?.id)].filter((id): id is string => !!id));

  // localStorage can be missing or refuse (a private window, storage full): then no session is kept
  const storage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  let sessionTimer = 0;
  const writeSession = () => {
    clearTimeout(sessionTimer);
    try {
      storage?.setItem(SESSION_KEY, JSON.stringify(save(snapshot())));
    } catch {
      // not kept
    }
  };
  const readSession = (): Snapshot | null => {
    try {
      const text = storage?.getItem(SESSION_KEY);
      const r = text ? load(JSON.parse(text)) : null;
      return r?.ok ? r.state : null;
    } catch {
      return null;
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") writeSession();
  });

  // your presets, in localStorage beside the session
  let userPresets: UserPreset[] = (() => {
    try {
      const text = storage?.getItem(PRESETS_KEY);
      return text ? readPresets(JSON.parse(text)).presets : [];
    } catch {
      return [];
    }
  })();
  const writePresets = (): boolean => {
    try {
      if (!storage) return false;
      storage.setItem(PRESETS_KEY, JSON.stringify(userPresets));
      void sweepPictures(picturesInUse());
      return true;
    } catch {
      return false;
    }
  };
  /** The view on the screen, its centre square, as a small picture (WebP where the browser writes it). */
  const thumbnail = (): string => {
    try {
      const { view } = store.state;
      const px = renderer.renderPixels(
        specOf(content, view, THUMB_PX, THUMB_PX),
        THUMB_PX,
        THUMB_PX,
        4,
      );
      const c = document.createElement("canvas");
      c.width = c.height = THUMB_PX;
      c.getContext("2d")!.putImageData(new ImageData(Uint8ClampedArray.from(px), THUMB_PX, THUMB_PX), 0, 0);
      return c.toDataURL("image/webp", 0.85);
    } catch {
      return "";
    }
  };
  const importPresets = (json: unknown) => {
    const r = readPresets(json);
    registerPictures(r.images);
    const m = mergePresets(userPresets, r.presets);
    userPresets = m.presets;
    if (m.added) writePresets();
    const refused = r.refused.length ? `; ${r.refused.length} refused (${r.refused[0]}${r.refused.length > 1 ? ", …" : ""})` : "";
    hud.toast(`${count(m.added, "preset")} added${refused}`);
    if (m.added) hud.showPanel(gallery.el, true);
    if (!gallery.el.hidden) gallery.refresh();
  };

  // a JSON file dropped on the window: a saved state opens, a presets file adds its presets
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    e.preventDefault();
    void readFile(file);
  });
  window.addEventListener("pagehide", writeSession);

  // the address bar shows the link to the view, replaced in place so the browser's history is not
  // flooded; editing it loads what it says
  let linkShown = location.hash.slice(1);
  let linkTimer = 0;
  let linkAt = -Infinity;
  const writeLink = () => {
    linkTimer = 0;
    linkAt = performance.now();
    const link = toLink(snapshot());
    if (link === linkShown) return;
    linkShown = link;
    try {
      history.replaceState(history.state, "", `${location.pathname}${location.search}#${link}`);
    } catch {
      // not allowed here (a sandboxed frame)
    }
  };
  window.addEventListener("hashchange", () => {
    const link = location.hash.slice(1);
    if (link === linkShown) return;
    linkShown = link;
    if (link) loadText(link);
  });

  // Ctrl+C copies the link unless text is selected or a field has the focus (a browser sends no
  // copy event without a selection, so this is the key itself); Ctrl+V opens a pasted link.
  // Ctrl+S and F12 (where the browser lets the page have it) save a screenshot.
  window.addEventListener("keydown", (e) => {
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if ((ctrl && e.key.toLowerCase() === "s") || (e.key === "F12" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey)) {
      e.preventDefault();
      void screenshot();
      return;
    }
    if (!ctrl || e.key.toLowerCase() !== "c") return;
    if (isField(e.target) || (window.getSelection()?.toString() ?? "") !== "") return;
    e.preventDefault();
    void copyText(linkHref()).then((ok) => hud.toast(ok ? "Link to this view copied" : "The browser did not let the page copy the link"));
  });

  // ------------------------------------------------------------------ screenshots
  let shotKind: ShotSize = (() => {
    try {
      const s = storage?.getItem(SHOT_KEY);
      return SHOT_SIZES.includes(s as ShotSize) ? (s as ShotSize) : "screen";
    } catch {
      return "screen";
    }
  })();
  let shooting = false;
  /** The view as it is now, at the chosen size with every sample, in tiles, the grid's labels on top
   *  at the screen's scale, saved as a PNG that carries the saved state. */
  const screenshot = async (): Promise<void> => {
    if (shooting) return hud.toast("A screenshot is still being made");
    shooting = true;
    try {
      const [W, H] = shotSize(shotKind, canvas.width, canvas.height);
      // the state at the moment of the shot, whatever moves while the tiles are drawn
      const shot = snapshot();
      const { view } = shot;
      const c = content;
      const spec = specOf(c, view, W, H);
      const out = document.createElement("canvas");
      [out.width, out.height] = [W, H];
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error(`this browser cannot hold a ${W} × ${H} picture`);
      const parts = tiles(W, H, Math.min(Number(params.get("tile")) || TILE, renderer.maxTile));
      for (const [n, t] of parts.entries()) {
        if (parts.length > 1) hud.toast(`Screenshot: part ${n + 1} of ${parts.length}`);
        const px = renderer.renderPixels(spec, W, H, renderer.maxSamples, t);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), t.width, t.height), t.x, t.y);
        await new Promise((r) => setTimeout(r, 0)); // let the page breathe between parts
      }
      drawLabels(ctx, W, H, view, c.state.grid);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      if (!blob) throw new Error(`the browser could not write a ${W} × ${H} PNG`);
      // the picture goes with the screenshot, so it opens anywhere
      const png = withText(new Uint8Array(await blob.arrayBuffer()), "hyperscope", JSON.stringify(withPictures(save(shot), (id) => pictureEntry(id)?.src)));
      const name = `hyperscope-${c.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "view"}-${W}x${H}.png`;
      download(new Blob([png], { type: "image/png" }), name);
      hud.toast(`Screenshot saved: ${name}`);
    } catch (e) {
      hud.toast(`No screenshot: ${(e as Error).message}`);
    } finally {
      shooting = false;
    }
  };
  /** The grid's labels on a W x H screenshot, laid out as on a screen of the same height in CSS
   *  pixels as this one, and scaled up with the picture. */
  const drawLabels = (ctx: CanvasRenderingContext2D, W: number, H: number, view: ViewState, grid: ContentState["grid"]) => {
    const k = H / (canvas.clientHeight || H);
    const labels = gridLabels(grid, view.grids, view.picture, W / k, H / k, k, measure);
    if (labels.length === 0) return;
    ctx.save();
    ctx.scale(k, k);
    ctx.font = font;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(232, 236, 244, 0.92)";
    for (const l of labels) {
      const right = l.edge === "right";
      ctx.textAlign = right ? "right" : "left";
      const [x, y] = [right ? l.x - TEXT_PAD : l.x + TEXT_PAD, l.y - TEXT_PAD];
      // the screen's halo (hud.css --halo): two dark shadows; the blur is in device pixels
      for (const [blur, alpha] of [[6, 0.7], [2, 0.95]]) {
        ctx.shadowColor = `rgba(4, 5, 8, ${alpha})`;
        ctx.shadowBlur = blur * k;
        ctx.fillText(l.text, x, y);
      }
    }
    ctx.restore();
  };
  document.addEventListener("paste", (e) => {
    if (isField(document.activeElement)) return;
    e.preventDefault();
    // a pasted picture becomes the tile picture
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file) return void loadPicture(file);
    loadText(e.clipboardData?.getData("text/plain") ?? "");
  });

  let restTimer = 0;

  store.subscribe(() => {
    resolvePicture();
    progressive.invalidate(performance.now());
    accentRGB();
    showHud();
    showChrome();
    if (!card.el.hidden) card.refresh();
    showLabels();
    clearTimeout(restTimer);
    restTimer = window.setTimeout(() => {
      views.record(entry());
      showChrome();
      card.rested();
      if (!gallery.el.hidden) gallery.refresh();
    }, REST_MS);
    clearTimeout(sessionTimer);
    sessionTimer = window.setTimeout(writeSession, SESSION_MS);
    if (!linkTimer) linkTimer = window.setTimeout(writeLink, Math.max(0, linkAt + LINK_MS - performance.now()));
    wake();
  });

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
      progressive.reset();
    }
    showProgress();
    showLabels();
    wake();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // start from the link in the address, else the saved session, else home
  let first: Snapshot | null = null;
  if (linkShown) {
    const r = fromLink(linkShown);
    if (r.ok) first = r.state;
    else hud.toast(`Link not loaded: ${r.reason}`);
  }
  first ??= readSession();
  if (first) applySnapshot(first);
  void sweepPictures(picturesInUse());
  views.record(entry());
  showChrome();

  function frame(t: number): void {
    frameRequested = false;
    const ms = lastTime ? t - lastTime : 1000 / 60;
    // real time, so a slow renderer still moves at the stick's speed; capped after a pause (the
    // springs and glides are exact for any step)
    let busy = false;
    try {
      busy = controls.tick(Math.min(0.25, ms / 1000));
    } catch (e) {
      // a step that fails is a bug, but it must not stop the frames (and leave the next input to
      // catch up in one jump): report it and carry on from here
      console.error(e);
    }
    progressive.frameTime(ms, progressive.moving(t));
    const drew = render(t);
    lastTime = busy || drew ? t : 0;
    if (drew) rate.frame(t);
    if (busy || drew) {
      wake();
      const fps = rate.rate();
      if (fps !== null && t - fpsShownAt >= 250) {
        fpsShownAt = t;
        showProgress(fps);
      } else showProgress();
    } else {
      rate.stop();
      showProgress(null);
    }
  }

  const spec = (): FrameSpec => specOf(content, store.state.view, canvas.width, canvas.height);

  /** A target as large as the canvas has its samples drawn without the unit grid, and the display
   *  draws the grid once over them; a smaller one (moving) has the grid in every sample. */
  const gridOnce = (t: Accumulator) => t.width === canvas.width && t.height === canvas.height;
  const show = (t: Accumulator, s: FrameSpec) => renderer.display(t, canvas.width, canvas.height, null, 1, gridOnce(t) ? { spec: s } : undefined);

  /** Draw the next sample, if the picture needs one, and show the result. */
  function render(now: number): boolean {
    let plan = progressive.next(now);
    if (!plan) return false;
    try {
      const w = Math.max(1, Math.round(canvas.width * plan.scale));
      const h = Math.max(1, Math.round(canvas.height * plan.scale));
      if (!target || target.width !== w || target.height !== h) {
        if (target) renderer.deleteTarget(target);
        target = renderer.createTarget(w, h);
        if (plan.index !== 0) {
          progressive.reset();
          plan = progressive.next(now)!;
        }
      }
      const s = spec();
      renderer.sample(gridOnce(target) ? { ...s, grid: null } : s, target, plan.index);
      progressive.done();
      show(target, s);
      window.hyperscope.frames = (window.hyperscope.frames ?? 0) + 1;
    } catch (e) {
      fail(String((e as Error).message ?? e));
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ hook for tests and benchmarks
  const cssToU = (x: number, y: number): Complex => {
    const h = canvas.clientHeight / 2;
    return [(x - canvas.clientWidth / 2) / h, (canvas.clientHeight / 2 - y) / h];
  };
  const shotContents = new Map<string, Content>();
  Object.assign(window.hyperscope, {
    renderer: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    renderShot: (shot: HyperscopeShot, samples = 1, tile?: Tile) => {
      const key = JSON.stringify(shot.content);
      let c = shotContents.get(key);
      if (!c) shotContents.set(key, (c = buildContent(shot.content)));
      const settings = shot.content.grid;
      const gc = shot.gridCamera;
      const grids = homeGrids();
      if (settings && gc) grids[settings.kind] = { s: BigInt(gc.s), e: gc.e, theta: gc.theta };
      const view: ViewState = { camera: shot.camera, picture: shot.picture as Picture, perm: shot.cameraPerm, tile: shot.cameraTile, origin: shot.origin, shift: shot.shift ?? 0, grids };
      const { accent: _, ...spec } = specOf(c, view, shot.width, shot.height);
      if (spec.strips) spec.strips = spec.strips.map(({ accent: _a, ...p }) => p);
      return base64(renderer.renderPixels(spec, shot.width, shot.height, samples, tile, shot.gridPerSample));
    },
    snapshot: () => {
      // draw what a pending frame would, so the picture shows the current state
      if (!target || frameRequested) render(performance.now());
      show(target!, spec());
      return { width: canvas.width, height: canvas.height, data: base64(renderer.readCanvas()) };
    },
    progress: () => ({ samples: progressive.n, max: progressive.maxSamples, scale: progressive.scale, float: renderer.floatTargets }),
    state: () => store.state,
    saved: () => JSON.stringify(save(snapshot())),
    worldAt: (x: number, y: number) => worldAt(store.state.view, cssToU(x, y)),
    probe: (x: number, y: number) => {
      const { view } = store.state;
      const P = worldAt(view, cssToU(x, y));
      if (!P) return null;
      const f = fold(P, content.group.normals);
      return { folded: f.x, colour: colourOf(content.colouring, carry(content.colouring, view.perm, f.word)) };
    },
    unitAt: (x: number, y: number) => {
      const f = frameOf(store.state.view.picture, cssToU(x, y));
      return f ? f.scale / (canvas.clientHeight / 2) : NaN;
    },
    addPicture: (id: string, rgba: string, width: number, height: number) => {
      setPicture(id, { image: tileImageFromRGBA(Uint8Array.from(atob(rgba), (c) => c.charCodeAt(0)), width, height, id) });
    },
    picture: () => {
      const id = content.state.tileImage?.id;
      return id ? { id, status: pictureEntry(id)?.status ?? "loading", drawn: !!content.picture } : null;
    },
    busy: () => controls.busy,
    // a connected controller keeps frames coming; refining is samples still to draw, or motion
    refining: () => frameRequested && (controls.busy || progressive.n < progressive.maxSamples),
  });
  window.hyperscope.ready = true;
}

/** "1 preset", "3 presets". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Offer a file to save. */
function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function base64(px: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return btoa(bin);
}
