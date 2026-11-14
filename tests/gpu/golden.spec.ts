// Golden images (design: Tests, "GPU: golden"): every preset in every view, refined to 16 samples on
// the GPU, against the accepted pictures in tests/golden (written by `npm run golden` from the CPU
// reference with the same sample positions). Pass rule: 99.5% of pixels within 2/255, a mean
// difference under 0.25/255, and no pixel off by more than 48/255 (three of its 16 samples landing
// on the other side of a full-contrast edge).

import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodePNG, encodePNG } from "../../tools/png.ts";
import { GOLDEN_SAMPLES, GOLDEN_SCENES, goldenShot } from "../golden/scenes.ts";
import { compare } from "./compare.ts";

test.beforeAll(() => mkdirSync("test-results/golden", { recursive: true }));

test("golden images", async ({ page }) => {
  // 182 pictures of 16 samples take about two minutes on the software renderer
  test.setTimeout(600_000);
  await page.goto("/");
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  const failures: string[] = [];
  for (const scene of GOLDEN_SCENES) {
    const shot = goldenShot(scene).gpu;
    const golden = decodePNG(readFileSync(`tests/golden/${scene.name}.png`));
    expect([golden.width, golden.height]).toEqual([shot.width, shot.height]);
    const b64 = await page.evaluate(([s, n]) => window.hyperscope.renderShot!(s, n), [shot, GOLDEN_SAMPLES] as const);
    const gpu = new Uint8Array(Buffer.from(b64, "base64"));
    const c = compare(gpu, golden.data, 2);
    const ok = c.within >= 0.995 && c.mean < 0.25 && c.worst <= 48;
    console.log(`${scene.name}: ${(100 * c.within).toFixed(3)}% within 2/255, mean ${c.mean.toFixed(3)}/255, worst ${c.worst}/255${ok ? "" : "  FAIL"}`);
    if (!ok) failures.push(scene.name);
    writeFileSync(`test-results/golden/${scene.name}_gpu.png`, encodePNG(gpu, shot.width, shot.height));
    writeFileSync(`test-results/golden/${scene.name}_diff.png`, encodePNG(c.diff, shot.width, shot.height));
  }
  expect(failures).toEqual([]);
});
