// Screenshots in the real page (design notes, step 9: Screenshot): Ctrl+S and the camera save the
// view at the chosen size with every sample, the parts of a large one join without a seam, the
// grid's labels are drawn on top, and the PNG carries the state, so dropping it returns there.

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildContent, PRESETS } from "../../src/content/scene.ts";
import { homeView } from "../../src/input/camera.ts";
import { readText } from "../../src/state/pngtext.ts";
import { decodePNG } from "../../tools/png.ts";
import { shots } from "../shots.ts";
import { compare } from "./compare.ts";

async function open(page: Page, url = "/") {
  await page.goto(url);
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
}

const refined = (page: Page) => page.waitForFunction(() => !window.hyperscope.busy!() && !window.hyperscope.refining!(), undefined, { timeout: 60_000 });
const saved = (page: Page) => page.evaluate(() => window.hyperscope.saved!());
const poke = (page: Page) => page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove")));
const toast = (page: Page) => page.locator(".hs-toast");

/** Press the key or click, and return the PNG that downloads: its name, bytes and pixels. */
async function shoot(page: Page, act: () => Promise<void>) {
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await act();
  const file = await download;
  const bytes = new Uint8Array(readFileSync((await file.path())!));
  return { name: file.suggestedFilename(), bytes, image: decodePNG(bytes) };
}

async function drag(page: Page, dx: number, dy: number) {
  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.mouse.move(320 + dx, 240 + dy, { steps: 6 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await refined(page);
}

test("Ctrl+S saves the view on the screen as a PNG that carries it; dropping the PNG returns there", async ({ page, context }) => {
  await open(page);
  await drag(page, -110, 50);
  await refined(page);
  const state = await saved(page);
  const screen = await page.evaluate(() => window.hyperscope.snapshot!());
  const shot = await shoot(page, () => page.keyboard.press("Control+s"));
  expect(shot.name).toBe("hyperscope-7-3-heptagons-640x480.png");
  await expect(toast(page)).toHaveText("Screenshot saved: hyperscope-7-3-heptagons-640x480.png");
  expect([shot.image.width, shot.image.height]).toEqual([640, 480]);
  expect(readText(shot.bytes, "hyperscope")).toBe(state);
  // the same picture as the screen with all its samples (which adds a dither of half a step)
  const c = compare(shot.image.data, new Uint8Array(Buffer.from(screen.data, "base64")), 1);
  expect(c.within).toBeGreaterThan(0.999);
  // dropped on a fresh page, the PNG brings its view back bit for bit
  const fresh = await context.newPage();
  await open(fresh);
  await fresh.evaluate(
    ([b64, name]) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: "image/png" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [Buffer.from(shot.bytes).toString("base64"), shot.name] as const,
  );
  await expect(toast(fresh)).toHaveText(`The view of ${shot.name} loaded`);
  expect(await saved(fresh)).toBe(state);
  // a PNG without the chunk is taken as a tile picture, and one that is not a picture says so
  await fresh.evaluate(() => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const dt = new DataTransfer();
    dt.items.add(new File([png], "photo.png", { type: "image/png" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(toast(fresh)).toHaveText("Picture not loaded: photo.png: it is not a picture this browser can read");
});

test("tiles join without a seam: the parts of a picture are the picture", async ({ page }) => {
  await open(page);
  for (const [preset, model] of [[2, "poincare"], [0, "halfplane"], [PRESETS.length - 1, "local"]] as const) {
    const content = buildContent({ ...PRESETS[preset].content }, PRESETS[preset].label);
    const { gpu } = shots(content, homeView(content.colouring.k, model), 240, 150);
    const whole = Buffer.from(await page.evaluate(([s]) => window.hyperscope.renderShot!(s, 4), [gpu] as const), "base64");
    const joined = Buffer.alloc(whole.length);
    // uneven parts, so no edge falls on a power of two
    for (const t of [{ x: 0, y: 0, width: 97, height: 61 }, { x: 97, y: 0, width: 143, height: 61 }, { x: 0, y: 61, width: 97, height: 89 }, { x: 97, y: 61, width: 143, height: 89 }]) {
      const part = Buffer.from(await page.evaluate(([s, t]) => window.hyperscope.renderShot!(s, 4, t), [gpu, t] as const), "base64");
      for (let y = 0; y < t.height; y++) part.copy(joined, 4 * ((t.y + y) * 240 + t.x), 4 * y * t.width, 4 * (y + 1) * t.width);
    }
    const c = compare(new Uint8Array(joined), new Uint8Array(whole), 1);
    expect(c.within, `${PRESETS[preset].label} in ${model}`).toBeGreaterThan(0.9995);
    expect(c.worst, `${PRESETS[preset].label} in ${model}`).toBeLessThanOrEqual(48);
  }
});

test("a screenshot made in parts is the one made whole", async ({ page }) => {
  await open(page, "/?tile=200");
  await drag(page, -60, 30);
  const parts = await shoot(page, () => page.keyboard.press("Control+s"));
  await expect(toast(page)).toHaveText(/^Screenshot saved/);
  await open(page, "/"); // the session brings the view back
  const whole = await shoot(page, () => page.keyboard.press("Control+s"));
  expect(readText(parts.bytes, "hyperscope")).toBe(readText(whole.bytes, "hyperscope"));
  const c = compare(parts.image.data, whole.image.data, 1);
  expect(c.within).toBeGreaterThan(0.9995);
});

test("the size in the VIEW tab and the camera button; the grid's labels are drawn on top", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Shift+C"); // the Unit grid preset: a dark plain fill, so only labels are near white
  await refined(page);
  // where the screen shows its labels
  const boxes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".hs-label:not([hidden])")].map((l) => l.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes.length).toBeGreaterThanOrEqual(3);
  await poke(page);
  await page.locator('.hs-toolbar [aria-label="Settings"]').click();
  await page.locator(".hs-tab", { hasText: "View" }).click();
  const size = page.getByRole("combobox", { name: "Screenshot size" });
  await expect(size.locator("option").first()).toHaveText("The screen, 640 × 480");
  await size.selectOption("2x");
  await page.keyboard.press("Escape"); // the card closes, so the camera is the next click
  await page.keyboard.press("Escape");
  await poke(page);
  const shot = await shoot(page, () => page.locator('.hs-toolbar [aria-label="Screenshot"]').click());
  expect([shot.image.width, shot.image.height]).toEqual([1280, 960]);
  // near-white pixels are the labels': most fall in the screen's label boxes, scaled by 2
  const { data, width } = shot.image;
  let inside = 0;
  let outside = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.min(data[i], data[i + 1], data[i + 2]) < 200) continue;
    const [x, y] = [((i / 4) % width) / 2, Math.floor(i / 4 / width) / 2];
    if (boxes.some((b) => x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2)) inside++;
    else outside++;
  }
  expect(inside).toBeGreaterThan(100);
  expect(outside).toBeLessThan(inside / 4);
  // the size is kept for the next visit
  expect(await page.evaluate(() => localStorage.getItem("hyperscope.shot"))).toBe("2x");
});
