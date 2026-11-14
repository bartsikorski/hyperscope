// The benchmark's scenes (design: Tests and benchmarks), shared by the benchmark page and the A/B
// runs: every view with {7,3}, {8,3} and (2,3,7), the hard cases, the costliest looks and the grid.

import { LOOKS } from "../src/content/looks.ts";
import { buildContent, PRESETS, sceneOf, withConstruction, withTileImage, type Content, type ContentState } from "../src/content/scene.ts";
import { DEFAULT_PLACEMENT, pictureEntry, setPicture, tileImageFromRGBA } from "../src/content/tileimage.ts";
import { MAX_ELL, MIN_FOOTPRINT_PLAIN, homeView, settle, zoomAt, type ViewState } from "../src/input/camera.ts";
import type { GridKind } from "../src/math/grid.ts";
import { fold } from "../src/math/groups.ts";
import { apply } from "../src/math/lorentz.ts";
import { MODELS, centreScale, frameOf, screenToU, type Model } from "../src/math/views.ts";
import type { FrameSpec } from "../src/render/gl.ts";
import { frameGrid } from "../src/render/grid.ts";
import { FADE_END } from "../src/render/reference.ts";

export interface Scene {
  name: string;
  content: Content;
  view: ViewState;
}

export const SIZES: [number, number][] = [[1920, 1080], [3840, 2160]];

export function scenes(): Scene[] {
  const byGroup = (g: string) => PRESETS.find((p) => p.content.group.join(",") === g)!;
  const out: Scene[] = [];
  for (const g of ["7,3,2", "8,3,2", "2,3,7"]) {
    const p = byGroup(g);
    const content = buildContent(p.content, p.label);
    for (const model of MODELS) out.push({ name: `${model} (${g})`, content, view: homeView(content.colouring.k, model) });
  }
  // hard cases: near the disk boundary with many folds, and the local view zoomed far out
  const c83 = buildContent(byGroup("8,3,2").content);
  let v = homeView(c83.colouring.k, "poincare");
  for (let i = 0; i < 20; i++) {
    const p = v.picture as { c: [number, number]; sigma: number; s: number };
    const b = p.c[0] * 0.6 + p.c[1] * 0.8;
    const t = (p.sigma / p.s / (b + Math.sqrt(b * b + p.sigma))) * 0.98;
    v = settle(zoomAt(v, [0.6 * t, 0.8 * t], 2, 1080).view, c83.group, c83.colouring);
  }
  out.push({ name: "poincare near the boundary (8,3,2)", content: c83, view: v });
  const c73 = buildContent(byGroup("7,3,2").content);
  out.push({ name: "local far out (7,3,2)", content: c73, view: { ...homeView(c73.colouring.k, "local"), picture: { model: "local", ell: MAX_ELL } } });
  // the costliest looks against the default one, in the half-plane (it fills the screen)
  for (const name of ["Escher", "Nebula", "Midnight"]) {
    const look = LOOKS.find((l) => l.name === name)!.look;
    const content = buildContent({ ...byGroup("7,3,2").content, look });
    out.push({ name: `halfplane (7,3,2) ${name} look`, content, view: homeView(content.colouring.k, "halfplane") });
  }
  // the unit grid over a tiling (against the same scene without it above), in Klein too, where
  // each pixel also turns its four neighbours into the grid frame; and alone, zoomed in to 1e-9 R/px
  const gridded = (model: Model, kind: GridKind) => {
    const content = buildContent({ ...byGroup("7,3,2").content, grid: { on: true, kind, unit: "earth" } });
    out.push({ name: `${model} (7,3,2) + ${kind} grid`, content, view: homeView(content.colouring.k, model) });
  };
  gridded("halfplane", "cartesian");
  gridded("poincare", "polar");
  gridded("klein", "cartesian");
  const unit = PRESETS.find((p) => p.content.plain)!;
  for (const model of ["local", "halfplane"] as const) {
    const content = buildContent(unit.content, unit.label);
    let view = homeView(content.colouring.k, model);
    while ((centreScale(view.picture) * 2) / 1080 > 1e-9) view = zoomAt(view, [0.05, -0.02], 2, 1080, MIN_FOOTPRINT_PLAIN).view;
    out.push({ name: `${model} unit grid at 1e-9 R/px`, content, view });
  }
  out.push(...laterScenes());
  return out;
}

/** The scenes of the steps after version 1 (design notes, step 18 plan): colourings, Mosaic beside
 *  the same scene coloured, Wythoff tilings, motifs, and tile pictures beside the same scene without. */
function laterScenes(): Scene[] {
  benchPicture();
  const out: Scene[] = [];
  const preset = (label: string) => PRESETS.find((p) => p.label === label)!;
  const add = (name: string, state: ContentState, model: Model, view?: ViewState) => {
    const content = buildContent(state);
    out.push({ name, content, view: view ?? homeView(content.colouring.k, model) });
  };
  const mosaic = LOOKS.find((l) => l.name === "Mosaic")!.look;
  const base = preset("{7,3} heptagons").content;
  add("poincare {7,3} chiral, seven colours", preset("{7,3} chiral, seven colours").content, "poincare");
  for (const model of ["poincare", "halfplane"] as const) {
    add(`${model} {7,3} Mosaic look, colouring source`, { ...base, look: { ...mosaic, source: "colouring" } }, model);
    add(`${model} {7,3} Mosaic`, { ...base, look: mosaic }, model);
  }
  for (const label of ["Truncated {3,7}", "Omnitruncated {7,3}", "Snub {5,4}"])
    for (const model of ["poincare", "halfplane"] as const) add(`${model} ${label}`, preset(label).content, model);
  add("poincare Snub {5,4} Mosaic", { ...preset("Snub {5,4}").content, look: mosaic }, "poincare");
  add("poincare {7,3} free point", withConstruction(base, "free", [0.5, 0.3, 0.2]), "poincare");
  for (const label of ["Shoal (3,3,4)", "Moths {6,4}", "Rosette {8,3}", "Birds (4,4,3)"])
    for (const model of ["poincare", "halfplane"] as const) add(`${model} ${label}`, preset(label).content, model);
  add("h3 Birds (4,4,3)", preset("Birds (4,4,3)").content, "h3");
  // the tile picture: BENCH_PICTURE (registered by benchPicture) beside the same scene without it
  for (const mode of ["kaleidoscope", "chiral"] as const) {
    const pic = withTileImage(base, { mode, place: DEFAULT_PLACEMENT, id: BENCH_PICTURE });
    add(`poincare {7,3} ${mode} picture`, pic, "poincare");
    add(`halfplane {7,3} ${mode} picture`, pic, "halfplane");
  }
  add("halfplane {7,3} kaleidoscope picture, tinted", withTileImage(base, { mode: "kaleidoscope", tint: true, place: DEFAULT_PLACEMENT, id: BENCH_PICTURE }), "halfplane");
  add("halfplane {7,3} lines only", withTileImage(base, null), "halfplane");
  const deep = buildContent(withTileImage(base, { mode: "kaleidoscope", place: { ...DEFAULT_PLACEMENT, size: 0.2 }, id: BENCH_PICTURE }));
  let v = homeView(deep.colouring.k, "poincare");
  for (let i = 0; i < 10; i++) v = settle(zoomAt(v, [0.1, 0.05], 2, 1080).view, deep.group, deep.colouring);
  out.push({ name: "poincare {7,3} picture at 1024x zoom, finest level", content: deep, view: v });
  out.push({ name: "poincare {7,3} lines only at 1024x zoom", content: buildContent({ ...deep.state, tileImage: undefined }), view: v });
  return out;
}

/** The benchmark's tile picture: 2048 x 2048, smooth colour fields with fine detail, so every level
 *  differs. */
export const BENCH_PICTURE = "b".repeat(64);

/** Register BENCH_PICTURE's levels, once (pictures' registry, content/tileimage.ts). */
export function benchPicture(): void {
  if (pictureEntry(BENCH_PICTURE)?.image) return;
  const n = 2048;
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = 4 * (y * n + x);
      px[i] = 128 + 127 * Math.sin(x / 97 + Math.sin(y / 61));
      px[i + 1] = 128 + 127 * Math.sin(y / 53 + 2 * Math.cos(x / 89));
      px[i + 2] = ((x ^ y) & 31) * 8;
      px[i + 3] = 255;
    }
  setPicture(BENCH_PICTURE, { image: tileImageFromRGBA(px, n, n, BENCH_PICTURE) });
}

export const specOf = (s: Scene, height: number): FrameSpec => ({
  camera: s.view.camera,
  picture: s.view.picture,
  scene: sceneOf(s.content, s.view),
  grid: frameGrid(s.content.state.grid, s.view.grids, s.view.picture, height),
});

/** The fraction of the screen inside the picture, and reflections and sweeps per pixel inside it,
 *  like the shader (no fold past the fade). */
export function foldCounts(s: Scene, width: number, height: number): { coverage: number; reflections: number; sweeps: number } {
  const gw = 192;
  const gh = Math.round((gw * height) / width);
  let inside = 0;
  let reflections = 0;
  let sweeps = 0;
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const u = screenToU(((i + 0.5) * width) / gw - 0.5, ((j + 0.5) * height) / gh - 0.5, width, height);
      const f = frameOf(s.view.picture, u);
      if (!f) continue;
      inside++;
      if (s.content.state.plain || (f.scale * 2) / height / s.content.group.inradius >= FADE_END) continue;
      const r = fold(apply(s.view.camera, f.x), s.content.group.normals);
      reflections += r.word.length;
      sweeps += r.sweeps;
    }
  return { coverage: inside / (gw * gh), reflections: reflections / Math.max(1, inside), sweeps: sweeps / Math.max(1, inside) };
}
