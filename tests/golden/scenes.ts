// The golden-image scenes: every preset in every view and every look, and the unit grid's other two
// kinds over a tiling, at home, 16 samples. The PNGs
// next to this file are the accepted pictures; `npm run golden` rewrites them from the CPU reference
// renderer after a deliberate change (check the new pictures before committing them).

import { LOOKS } from "../../src/content/looks.ts";
import { buildContent, PRESETS } from "../../src/content/scene.ts";
import { homeView } from "../../src/input/camera.ts";
import type { GridSettings } from "../../src/math/grid.ts";
import { MODELS, type Model } from "../../src/math/views.ts";
import type { Shot } from "../../src/render/reference.ts";
import { MAX_SAMPLES } from "../../src/render/samples.ts";
import { shots } from "../shots.ts";

export const GOLDEN_WIDTH = 240;
export const GOLDEN_HEIGHT = 150;
export const GOLDEN_SAMPLES = MAX_SAMPLES;

export interface GoldenScene {
  name: string;
  preset: number;
  model: Model;
  /** Index into LOOKS; the default look when left out. */
  look?: number;
  /** The unit grid; the preset's own when left out. */
  grid?: GridSettings;
}

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Every preset in every view with the default look (the last preset is the unit grid's own), then
 *  every look on {7,3} in the Poincare disk and on {6,4} in three colours, cycling through the
 *  first four views, five looks in the band and four inside H3 and on the hyperboloid, then grids
 *  over tilings. */
export const GOLDEN_SCENES: GoldenScene[] = [
  ...PRESETS.flatMap((p, preset) => MODELS.map((model) => ({ name: `${slug(p.label)}_${model}`, preset, model }))),
  ...LOOKS.flatMap((l, look) => [
    { name: `look_${slug(l.name)}_${slug(PRESETS[0].label)}_poincare`, preset: 0, model: "poincare" as Model, look },
    { name: `look_${slug(l.name)}_${slug(PRESETS[2].label)}_${MODELS[look % 4]}`, preset: 2, model: MODELS[look % 4], look },
  ]),
  // the band (step 11): a look of every colour source, relief among them, and a grid
  ...[1, 3, 4, 5, 13].map((look) => ({ name: `look_${slug(LOOKS[look].name)}_${slug(PRESETS[2].label)}_band`, preset: 2, model: "band" as Model, look })),
  { name: `grid_cartesian_${slug(PRESETS[0].label)}_band`, preset: 0, model: "band", grid: { on: true, kind: "cartesian", unit: "earth" } },
  // the plane inside H3 (step 12): looks with relief, glow, distance and depth, and a grid
  ...[1, 4, 5, 12].map((look) => ({ name: `look_${slug(LOOKS[look].name)}_${slug(PRESETS[2].label)}_h3`, preset: 2, model: "h3" as Model, look })),
  { name: `grid_polar_${slug(PRESETS[0].label)}_h3`, preset: 0, model: "h3", grid: { on: true, kind: "polar", unit: "earth" } },
  // the hyperboloid (step 13): the same looks, lit, and a grid
  ...[1, 4, 5, 12].map((look) => ({ name: `look_${slug(LOOKS[look].name)}_${slug(PRESETS[2].label)}_hyperboloid`, preset: 2, model: "hyperboloid" as Model, look })),
  { name: `grid_cartesian_${slug(PRESETS[0].label)}_hyperboloid`, preset: 0, model: "hyperboloid", grid: { on: true, kind: "cartesian", unit: "earth" } },
  { name: `grid_polar_${slug(PRESETS[0].label)}_poincare`, preset: 0, model: "poincare", grid: { on: true, kind: "polar", unit: "earth" } },
  { name: `grid_horocyclic_${slug(PRESETS[1].label)}_halfplane`, preset: 1, model: "halfplane", grid: { on: true, kind: "horocyclic", unit: "earth" } },
  // Wythoff tilings (step 15) and motifs (step 16) in looks of their own: Mosaic and relief through
  // the kite, the inside source, and depth
  ...(
    [
      ["Snub {7,3}", "Mosaic", "poincare"],
      ["Snub {5,4}", "Escher", "klein"],
      ["Omnitruncated {7,3}", "Porcelain", "poincare"],
      ["Truncated {3,7}", "Nebula", "halfplane"],
      // motifs (step 16) in their presets' looks: Mosaic by the cell around P, relief and features
      ["Moths {6,4}", "Ink", "poincare"],
      ["Rosette {8,3}", "Mosaic", "klein"],
      ["Birds (4,4,3)", "Escher", "halfplane"],
      ["Shoal (3,3,4)", "Relief", "band"],
    ] as const
  ).map(([label, look, model]) => {
    const preset = PRESETS.findIndex((p) => p.label === label);
    const l = LOOKS.findIndex((x) => x.name === look);
    return { name: `look_${slug(look)}_${slug(label)}_${model}`, preset, model: model as Model, look: l };
  }),
];

/** The shot of a scene for the CPU reference (with the samples to average) and for the GPU hook. */
export function goldenShot(scene: GoldenScene): { cpu: Shot; gpu: HyperscopeShot } {
  const preset = PRESETS[scene.preset];
  const content = buildContent({ ...preset.content, look: LOOKS[scene.look ?? 0].look, grid: scene.grid ?? preset.content.grid }, preset.label);
  const view = homeView(content.colouring.k, scene.model);
  const { cpu, gpu } = shots(content, view, GOLDEN_WIDTH, GOLDEN_HEIGHT);
  return { cpu: { ...cpu, samples: GOLDEN_SAMPLES }, gpu };
}
