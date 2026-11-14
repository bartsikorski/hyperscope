// Writes reference pictures from the CPU renderer into out/: `npm run reference`.
import { mkdirSync, writeFileSync } from "node:fs";
import { buildContent, sceneOf, type ContentState } from "../src/content/scene.ts";
import { findColourings } from "../src/math/colourings.ts";
import { homeView } from "../src/input/camera.ts";
import type { Model } from "../src/math/views.ts";
import { renderView, toRGBA8 } from "../src/render/reference.ts";
import { encodePNG } from "./png.ts";

const SIZE = Number(process.env.SIZE ?? 1024);
const SS = Number(process.env.SS ?? 4);
mkdirSync("out", { recursive: true });

function shot(name: string, state: ContentState, model: Model = "poincare") {
  const content = buildContent(state);
  const view = homeView(content.colouring.k, model);
  const t0 = performance.now();
  const lin = renderView({ width: SIZE, height: SIZE, camera: view.camera, picture: view.picture, ss: SS, scene: sceneOf(content, view) });
  const ms = performance.now() - t0;
  writeFileSync(`out/${name}.png`, encodePNG(toRGBA8(lin, SIZE, SIZE), SIZE, SIZE, { Software: "Hyperscope reference renderer" }));
  console.log(`out/${name}.png  (${state.group.join(",")}) ${content.colouring.name} ${model}  ${SIZE}x${SIZE} ss${SS}  ${(ms / 1000).toFixed(1)} s`);
}

const heptagons: ContentState = { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 };
shot("reference_7_3_parity", heptagons);
shot("reference_5_4_faces", { group: [5, 4, 2], colouring: "faces", sides: [false, false, true], lineWidth: 0.03 });
const c64 = findColourings({ p: 6, q: 4, r: 2 });
console.log(`{6,4}: ${c64.length} colourings with up to 5 colours:`, c64.map((c) => c.k).join(" "));
const pick = Math.max(1, c64.findIndex((c) => c.k === 3) + 1);
shot("reference_6_4_colouring", { group: [6, 4, 2], colouring: `c${pick}`, sides: [true, true, true], lineWidth: 0.012 });
shot("reference_7_3_klein", heptagons, "klein");
shot("reference_7_3_halfplane", heptagons, "halfplane");
shot("reference_7_3_local", heptagons, "local");
