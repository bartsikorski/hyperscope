// Progressive refinement in the running app (design: Renderer): 16 samples when still and then the
// GPU stops, a change starts over, moving frames may be drawn at a lower scale and upscaled, the
// display dithers by at most one step, and the 8-bit fallback.

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildContent, type ContentState } from "../../src/content/scene.ts";
import type { ViewState } from "../../src/input/camera.ts";
import { renderView, toRGBA8 } from "../../src/render/reference.ts";
import { encodePNG } from "../../tools/png.ts";
import { shots } from "../shots.ts";
import { compare } from "./compare.ts";

async function open(page: Page, query = "") {
  await page.goto("/" + query);
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
}
const refined = (page: Page) => page.waitForFunction(() => !window.hyperscope.refining!(), undefined, { timeout: 30_000 });
const progress = (page: Page) => page.evaluate(() => window.hyperscope.progress!());

type AppState = { view: ViewState; content: ContentState };

/** The current view (or the given state) as a hook shot of the given size, and the CPU reference. */
async function currentShot(page: Page, width: number, height: number, state?: AppState) {
  const st = state ?? ((await page.evaluate(() => window.hyperscope.state!())) as AppState);
  const { cpu: ref, gpu: shot } = shots(buildContent(st.content), st.view, width, height);
  const cpu = (samples: number) => toRGBA8(renderView({ ...ref, samples }), width, height);
  return { shot, cpu };
}

const toLinear = (v: number) => (v <= 10.31 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const toByte = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

/** Bilinear upscale in linear light, sampling like the display pass (texel centres, clamped). */
function upscale(src: Uint8Array, w: number, h: number, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  const at = (x: number, y: number, k: number) => toLinear(src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + k]);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const fx = ((X + 0.5) / W) * w - 0.5;
      const fy = ((Y + 0.5) / H) * h - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      for (let k = 0; k < 3; k++) {
        const top = at(x0, y0, k) * (1 - tx) + at(x0 + 1, y0, k) * tx;
        const bottom = at(x0, y0 + 1, k) * (1 - tx) + at(x0 + 1, y0 + 1, k) * tx;
        out[(Y * W + X) * 4 + k] = toByte(top * (1 - ty) + bottom * ty);
      }
      out[(Y * W + X) * 4 + 3] = 255;
    }
  return out;
}

const gpuShot = async (page: Page, shot: HyperscopeShot, samples: number) =>
  new Uint8Array(Buffer.from(await page.evaluate(([s, n]) => window.hyperscope.renderShot!(s, n), [shot, samples] as const), "base64"));

test("a still view refines to 16 samples, then the GPU stops; a change starts over", async ({ page }) => {
  await open(page);
  await refined(page);
  expect(await progress(page)).toEqual({ samples: 16, max: 16, scale: 1, float: true });
  const frames = await page.evaluate(() => window.hyperscope.frames!);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.hyperscope.frames!)).toBe(frames);
  await page.keyboard.press("c");
  expect((await progress(page)).samples).toBeLessThan(16);
  await refined(page);
  expect((await progress(page)).samples).toBe(16);
  expect(await page.evaluate(() => window.hyperscope.frames!)).toBeGreaterThanOrEqual(frames + 16);
});

test("the display dithers by at most one 8-bit step", async ({ page }) => {
  await open(page);
  await refined(page);
  const snap = await page.evaluate(() => window.hyperscope.snapshot!());
  const { shot } = await currentShot(page, snap.width, snap.height);
  const plain = await gpuShot(page, shot, 16);
  const c = compare(new Uint8Array(Buffer.from(snap.data, "base64")), plain, 0);
  expect(c.worst).toBe(1);
  expect(c.within).toBeLessThan(0.99); // the dither is on
});

test("moving frames at half scale are upscaled bilinearly onto the canvas", async ({ page }) => {
  await open(page, "?moving=0.5");
  await refined(page);
  // pointer moves reach the page with the next animation frame, so the state is read together with
  // the picture it shows
  let got: { p: ReturnType<NonNullable<HyperscopeHook["progress"]>>; snap: { width: number; height: number; data: string }; st: unknown } | null = null;
  await page.mouse.move(400, 260);
  await page.mouse.down();
  for (let i = 1; i <= 10 && !got; i++) {
    await page.mouse.move(400 - 6 * i, 260 - 3 * i);
    const r = await page.evaluate(() => ({ snap: window.hyperscope.snapshot!(), p: window.hyperscope.progress!(), st: window.hyperscope.state!() }));
    if (r.p.scale === 0.5) got = r;
  }
  expect(got, "a moving frame at half scale").not.toBeNull();
  const { width, height } = got!.snap;
  const { shot } = await currentShot(page, width, height, got!.st as AppState);
  await page.mouse.up();
  // the same frame (it may hold a second sample, drawn between two pointer moves) rendered at half
  // size and upscaled bilinearly in linear light, here
  const half = await gpuShot(page, { ...shot, width: width / 2, height: height / 2 }, got!.p.samples);
  const up = upscale(half, width / 2, height / 2, width, height);
  const c = compare(new Uint8Array(Buffer.from(got!.snap.data, "base64")), up, 3);
  console.log(`half-scale frame (${got!.p.samples} samples) vs half-size render upscaled: ${(100 * c.within).toFixed(3)}% within 3/255, mean ${c.mean.toFixed(3)}, worst ${c.worst}`);
  mkdirSync("test-results/refinement", { recursive: true });
  writeFileSync("test-results/refinement/moving_half.png", encodePNG(new Uint8Array(Buffer.from(got!.snap.data, "base64")), width, height));
  writeFileSync("test-results/refinement/moving_half_diff.png", encodePNG(c.diff, width, height));
  expect(c.within).toBeGreaterThanOrEqual(0.995);
  await refined(page);
  expect(await progress(page)).toMatchObject({ samples: 16, scale: 1 });
});

test("without float targets: 8-bit accumulation of 4 samples, noted under the title", async ({ page }) => {
  await open(page, "?accum=8");
  await refined(page);
  expect(await progress(page)).toEqual({ samples: 4, max: 4, scale: 1, float: false });
  await expect(page.locator(".hs-refine")).toHaveText("8-bit accumulation, 4 samples");
  await expect(page.locator(".hs-samples")).toHaveText("4/4");
  const { shot, cpu } = await currentShot(page, 256, 256);
  const c = compare(await gpuShot(page, shot, 4), cpu(4), 3);
  console.log(`8-bit, 4 samples vs reference: ${(100 * c.within).toFixed(3)}% within 3/255, mean ${c.mean.toFixed(3)}, worst ${c.worst}`);
  expect(c.within).toBeGreaterThanOrEqual(0.995);
});
