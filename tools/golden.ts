// Writes the golden images (tests/golden/*.png) from the CPU reference renderer: `npm run golden`, or
// `npm run golden -- 3_3_4` for only the scenes whose name contains that text (a new preset's).
import { writeFileSync } from "node:fs";
import { renderView, toRGBA8 } from "../src/render/reference.ts";
import { GOLDEN_SCENES, goldenShot } from "../tests/golden/scenes.ts";
import { encodePNG } from "./png.ts";

const t0 = performance.now();
const only = process.argv[2] ?? "";
const scenes = GOLDEN_SCENES.filter((s) => s.name.includes(only));
for (const scene of scenes) {
  const shot = goldenShot(scene).cpu;
  const png = encodePNG(toRGBA8(renderView(shot), shot.width, shot.height), shot.width, shot.height, { Software: "Hyperscope reference renderer" });
  writeFileSync(`tests/golden/${scene.name}.png`, png);
}
console.log(`${scenes.length} golden images in tests/golden, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
