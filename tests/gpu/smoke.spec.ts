import { expect, test } from "./fixtures.ts";

const decode = (b64: string) => Buffer.from(b64, "base64");

test("the page gets WebGL2, compiles the shader and draws the disk on the background", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  const state = await page.evaluate(() => ({ error: window.hyperscope.error, renderer: window.hyperscope.renderer }));
  expect(state.error).toBeUndefined();
  console.log("renderer:", state.renderer);
  const snap = await page.evaluate(() => window.hyperscope.snapshot!());
  const px = decode(snap.data);
  const at = (x: number, y: number) => [...px.subarray((y * snap.width + x) * 4, (y * snap.width + x) * 4 + 4)];
  expect(at(0, 0)).toEqual([5, 6, 10, 255]); // corner: outside the disk
  expect(at(snap.width >> 1, snap.height >> 1)).not.toEqual([5, 6, 10, 255]);
});

test("the single-file build works when opened straight from disk", async ({ page }) => {
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const file = resolve("dist/hyperscope.html");
  test.skip(!existsSync(file), "run `npm run build` first");
  await page.goto("file://" + file);
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  const snap = await page.evaluate(() => window.hyperscope.snapshot!());
  const px = decode(snap.data);
  const c = ((snap.height >> 1) * snap.width + (snap.width >> 1)) * 4;
  expect([...px.subarray(c, c + 3)]).not.toEqual([5, 6, 10]);
});
