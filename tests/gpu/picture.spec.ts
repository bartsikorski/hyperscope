// Your own tile picture in the real page (design notes, step 17: Tests): the card's Tile picture
// section (load, mode, tint, size, turn, drag and wheel on the preview, reset, remove, template),
// the picture hidden by a construction or a motif and back, the session after a reload, a
// screenshot that carries the picture to a fresh browser, a link without it and its note, an image
// dropped or pasted on the window, and presets written with their pictures.

import { type Browser, type Page } from "@playwright/test";
import { expect, freshContext, test } from "./fixtures.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DEFAULT_PLACEMENT } from "../../src/content/tileimage.ts";
import { readText } from "../../src/state/pngtext.ts";
import { decodePNG, encodePNG } from "../../tools/png.ts";
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
const title = (page: Page) => page.locator(".hs-title");
const shown = (page: Page) => page.evaluate(() => window.hyperscope.picture!());
const tileImage = (page: Page) =>
  page.evaluate(() => (window.hyperscope.state!() as { content: { tileImage?: { mode: string; tint?: boolean; place: { x: number; y: number; size: number; turn: number }; id: string } } }).content.tileImage);
const content = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { content: { group: number[]; construction?: string; motif?: unknown } }).content);
const note = (page: Page) => page.getByLabel("Tile picture check");
/** A browser with nothing kept: no session, no pictures. */
const freshPage = async (browser: Browser) => (await freshContext(browser, { baseURL: "http://localhost:5173", viewport: { width: 640, height: 480 } })).newPage();

/** The canvas as RGBA bytes. */
async function pixels(page: Page): Promise<Uint8Array> {
  const s = await page.evaluate(() => window.hyperscope.snapshot!());
  return new Uint8Array(Buffer.from(s.data, "base64"));
}
/** The share of pixels that differ by more than 8 levels. */
function changed(a: Uint8Array, b: Uint8Array): number {
  return 1 - compare(a, b, 8).within;
}
/** Pixels near this pure colour. */
function near(px: Uint8Array, rgb: [number, number, number]): number {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - rgb[0]) + Math.abs(px[i + 1] - rgb[1]) + Math.abs(px[i + 2] - rgb[2]) < 60) n++;
  return n;
}

/** A 240 × 160 picture in four quadrants: red, green, blue and yellow, with a white cross. */
function quadrants(): Buffer {
  const [w, h] = [240, 160];
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const c = Math.abs(x - w / 2) < 3 || Math.abs(y - h / 2) < 3 ? [255, 255, 255] : y < h / 2 ? (x < w / 2 ? [230, 20, 20] : [20, 200, 40]) : x < w / 2 ? [30, 60, 230] : [240, 220, 20];
      px.set([...c, 255], i);
    }
  return encodePNG(px, w, h);
}
const PICTURE = quadrants();
/** The picture's name: the SHA-256 of the data URL it is kept as (a small PNG is kept as it is). */
const PICTURE_ID = createHash("sha256").update(`data:image/png;base64,${PICTURE.toString("base64")}`).digest("hex");

/** Drop a file on the window. */
const drop = (page: Page, bytes: Uint8Array | string, name: string, type: string) =>
  page.evaluate(
    ([b64, name, type]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], name, { type }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [Buffer.from(bytes).toString("base64"), name, type] as const,
  );

async function openCard(page: Page) {
  await poke(page);
  await page.locator('.hs-toolbar [aria-label="Settings"]').click();
  await expect(page.locator(".hs-card")).toBeVisible();
}

/** Click and return the file that downloads: its name and bytes. */
async function download(page: Page, act: () => Promise<void>) {
  const d = page.waitForEvent("download", { timeout: 120_000 });
  await act();
  const file = await d;
  return { name: file.suggestedFilename(), bytes: new Uint8Array(readFileSync((await file.path())!)) };
}

test("the Tile picture section: template, load, mode, tint, size, turn, the preview, reset and remove", async ({ page }) => {
  await open(page);
  await refined(page);
  const before = await pixels(page);
  await openCard(page);
  await expect(note(page)).toHaveText(/^Your own picture in the tile/);
  await expect(page.locator(".hs-picture")).toBeHidden();
  await expect(page.getByRole("button", { name: "Remove the tile picture" })).toBeDisabled();
  const kaleidoscope = page.getByRole("button", { name: /^In the triangle, mirrored/ });
  const chiral = page.getByRole("button", { name: /^In the kite, turned/ });
  await expect(kaleidoscope).toHaveAttribute("aria-pressed", "true");

  // the template of the shape in the mode chosen, before there is a picture
  const template = page.getByRole("button", { name: "Save a template of the shape to draw on (PNG)" });
  let t = await download(page, () => template.click());
  expect(t.name).toBe("hyperscope-template-7-3-2-kaleidoscope.png");
  let png = decodePNG(t.bytes);
  expect([png.width, png.height]).toEqual([1024, 1024]);
  await expect(toast(page)).toHaveText("Template saved: hyperscope-template-7-3-2-kaleidoscope.png");
  await chiral.click();
  await expect(chiral).toHaveAttribute("aria-pressed", "true");
  t = await download(page, () => template.click());
  expect(t.name).toBe("hyperscope-template-7-3-2-chiral.png");
  png = decodePNG(t.bytes);
  expect([png.width, png.height]).toEqual([1024, 1024]);
  // the two templates differ (the kite against the triangle, with their ticks)
  expect(compare(png.data, decodePNG((await download(page, async () => { await kaleidoscope.click(); await template.click(); })).bytes).data, 8).within).toBeLessThan(0.97);
  await chiral.click();

  // Load picture… reads the file in the mode chosen
  await page.locator('.hs-picture-actions input[type="file"]').setInputFiles({ name: "quadrants.png", mimeType: "image/png", buffer: PICTURE });
  await expect(toast(page)).toHaveText("Tile picture: quadrants.png");
  await expect.poll(() => tileImage(page)).toEqual({ mode: "chiral", place: DEFAULT_PLACEMENT, id: PICTURE_ID });
  expect(await shown(page)).toEqual({ id: PICTURE_ID, status: "ready", drawn: true });
  await expect(title(page)).toHaveText("{7,3} chiral picture · Poincaré disk");
  await expect(note(page)).toHaveText(/^Turned about the kite's corners/);
  await expect(page.locator(".hs-picture")).toBeVisible();
  await expect(page.locator(".hs-picture-preview")).toBeVisible();
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  const chiralPx = await pixels(page);
  // the picture's colours are on the screen, which they were not before
  for (const c of [[230, 20, 20], [20, 200, 40], [30, 60, 230], [240, 220, 20]] as [number, number, number][]) {
    expect(near(before, c), `${c} before`).toBeLessThan(200);
    expect(near(chiralPx, c), `${c} with the picture`).toBeGreaterThan(1500);
  }
  // Kaleidoscope mirrors the same picture in the triangle: another tiling of it
  await kaleidoscope.click();
  await expect.poll(async () => (await tileImage(page))?.mode).toBe("kaleidoscope");
  await expect(title(page)).toHaveText("{7,3} kaleidoscope · Poincaré disk");
  await expect(note(page)).toHaveText(/^Mirrored at the triangle's sides/);
  await refined(page);
  const kalPx = await pixels(page);
  expect(changed(kalPx, chiralPx)).toBeGreaterThan(0.1);

  // the tint multiplies the picture by the look's colours; off again, the picture as it is
  const tint = page.getByRole("switch", { name: "Tint with the look's colours" });
  await tint.click();
  await expect.poll(async () => (await tileImage(page))?.tint).toBe(true);
  await refined(page);
  expect(changed(await pixels(page), kalPx)).toBeGreaterThan(0.1);
  await tint.click();
  await expect.poll(async () => (await tileImage(page))?.tint).toBeUndefined();
  await refined(page);
  expect(changed(await pixels(page), kalPx)).toBeLessThan(0.001);

  // size and turn: the sliders' ends
  const size = page.getByRole("slider", { name: "Picture size" });
  const turn = page.getByRole("slider", { name: "Picture turn" });
  await size.focus();
  await size.press("End");
  await expect.poll(async () => (await tileImage(page))?.place.size).toBeCloseTo(8, 9);
  await size.press("Home");
  await expect.poll(async () => (await tileImage(page))?.place.size).toBeCloseTo(0.05, 9);
  await turn.focus();
  await turn.press("End");
  await expect.poll(async () => (await tileImage(page))?.place.turn).toBe(180);
  await expect(page.locator(".hs-slider", { has: turn }).locator("output")).toHaveText("180°");
  await turn.press("Home");
  await expect.poll(async () => (await tileImage(page))?.place.turn).toBe(-180);
  // Reset puts it back
  await page.getByRole("button", { name: "Put the shape back in the middle of the picture" }).click();
  await expect.poll(async () => (await tileImage(page))?.place).toEqual(DEFAULT_PLACEMENT);
  await refined(page);
  expect(changed(await pixels(page), kalPx)).toBeLessThan(0.001);

  // dragging on the preview moves the shape by the picture's share dragged; the wheel resizes it
  const preview = page.locator(".hs-picture-preview");
  await preview.scrollIntoViewIfNeeded();
  const box = (await preview.boundingBox())!;
  // the 240 × 160 picture fitted in the preview (at most 200 px high), centred
  expect(box.height).toBeCloseTo(Math.min(200, Math.round((box.width * 160) / 240)), 0);
  const k = Math.min(box.width / 240, box.height / 160);
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await poke(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 20, { steps: 5 });
  await page.mouse.up();
  const moved = (await tileImage(page))!.place;
  expect(moved.x).toBeCloseTo(0.5 + 40 / (240 * k), 2);
  expect(moved.y).toBeCloseTo(0.5 + 20 / (160 * k), 2);
  expect([moved.size, moved.turn]).toEqual([DEFAULT_PLACEMENT.size, 0]);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await tileImage(page))?.place.size).toBeCloseTo(DEFAULT_PLACEMENT.size * Math.exp(0.3), 3);
  await refined(page);
  expect(changed(await pixels(page), kalPx)).toBeGreaterThan(0.1);

  // Remove: the tiling as it was, and the note back to the start
  await poke(page);
  await page.getByRole("button", { name: "Remove the tile picture" }).click();
  await expect.poll(() => tileImage(page)).toBeUndefined();
  expect(await shown(page)).toBeNull();
  await expect(title(page)).toHaveText("{7,3} heptagons · Poincaré disk");
  await expect(note(page)).toHaveText(/^Your own picture in the tile/);
  await expect(page.locator(".hs-picture")).toBeHidden();
  await refined(page);
  expect(changed(await pixels(page), before)).toBeLessThan(0.001);
});

test("a construction or a motif hides the picture and keeps it; Lines and None bring it back", async ({ page }) => {
  await open(page);
  await openCard(page);
  await page.locator('.hs-picture-actions input[type="file"]').setInputFiles({ name: "quadrants.png", mimeType: "image/png", buffer: PICTURE });
  await expect.poll(async () => (await shown(page))?.drawn).toBe(true);
  const construction = page.getByRole("combobox", { name: "Construction" });
  await construction.selectOption("snub");
  await expect.poll(async () => (await content(page)).construction).toBe("snub");
  await expect(note(page)).toHaveText("Hidden: a picture is drawn over Lines. Choose Lines under Construction to see it.");
  expect(await shown(page)).toEqual({ id: PICTURE_ID, status: "ready", drawn: false });
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  await construction.selectOption("lines");
  await expect.poll(async () => (await shown(page))?.drawn).toBe(true);
  await expect(title(page)).toHaveText("{7,3} kaleidoscope · Poincaré disk");
  // a motif brings its own group; the picture waits under it
  const motif = page.getByRole("combobox", { name: "Motif" });
  await motif.selectOption("moths");
  await expect.poll(async () => (await content(page)).motif).toBe("moths");
  await expect(note(page)).toHaveText("Hidden while a motif is drawn: choose None under Motif to see it.");
  expect((await shown(page))?.drawn).toBe(false);
  await expect(title(page)).toHaveText("Moths {6,4} · Poincaré disk");
  await motif.selectOption("none");
  await expect.poll(async () => (await shown(page))?.drawn).toBe(true);
  await expect(title(page)).toHaveText("{6,4} kaleidoscope · Poincaré disk");
  expect((await content(page)).group).toEqual([6, 4, 2]);
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the picture stays after a reload, a screenshot carries it to a fresh browser, and a link without it says so", async ({ page, browser }) => {
  await open(page);
  // an image dropped on the window becomes the tile picture
  await drop(page, PICTURE, "quadrants.png", "image/png");
  await expect(toast(page)).toHaveText("Tile picture: quadrants.png");
  await expect.poll(async () => (await shown(page))?.drawn).toBe(true);
  // placed off the middle and chiral, so the link carries all of it
  await openCard(page);
  await page.getByRole("button", { name: /^In the kite, turned/ }).click();
  await page.getByRole("slider", { name: "Picture turn" }).focus();
  await page.keyboard.press("PageUp");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await tileImage(page))?.place.turn).not.toBe(0);
  await refined(page);
  const state = await saved(page);
  expect(JSON.parse(state).content.tileImage).toMatchObject({ mode: "chiral", id: PICTURE_ID });
  expect(state).not.toContain("data:image");
  const screen = await pixels(page);

  // a reload: the session names the picture and this browser still holds it
  await expect.poll(() => page.evaluate(() => localStorage.getItem("hyperscope.session"))).toBe(state);
  await open(page, "/");
  expect(await saved(page)).toBe(state);
  await expect.poll(() => shown(page)).toEqual({ id: PICTURE_ID, status: "ready", drawn: true });
  await refined(page);
  expect(compare(await pixels(page), screen, 1).within).toBeGreaterThan(0.999);

  // the link names the picture: a fresh browser says it does not hold it, and keeps its settings
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(`ti=c.${PICTURE_ID}`);
  const link = await page.evaluate(() => location.href);
  const fresh = await freshPage(browser);
  await open(fresh, link);
  await expect(toast(fresh)).toHaveText("The tile picture is not in this browser: open the screenshot or file that has it, or load it again");
  expect(await shown(fresh)).toEqual({ id: PICTURE_ID, status: "missing", drawn: false });
  expect(await saved(fresh)).toBe(state);
  await refined(fresh);
  expect(await fresh.evaluate(() => window.hyperscope.error)).toBeUndefined();
  await openCard(fresh);
  await expect(note(fresh)).toHaveText("This browser does not hold the picture: open the screenshot or file that has it, or load it again (its settings stay).");
  await expect(note(fresh)).toHaveClass(/hs-bad/);
  // loading the picture again takes the link's placement and mode
  await fresh.locator('.hs-picture-actions input[type="file"]').setInputFiles({ name: "quadrants.png", mimeType: "image/png", buffer: PICTURE });
  await expect.poll(() => shown(fresh)).toEqual({ id: PICTURE_ID, status: "ready", drawn: true });
  expect(await saved(fresh)).toBe(state);
  await fresh.context().close();

  // a screenshot carries the picture itself: dropped in a fresh browser, the same view
  const d = page.waitForEvent("download", { timeout: 120_000 });
  await page.keyboard.press("Control+s");
  const file = await d;
  const bytes = new Uint8Array(readFileSync((await file.path())!));
  const text = JSON.parse(readText(bytes, "hyperscope")!);
  expect(text.content.tileImage.src).toBe(`data:image/png;base64,${PICTURE.toString("base64")}`);
  const other = await freshPage(browser);
  await open(other);
  await drop(other, bytes, file.suggestedFilename(), "image/png");
  await expect(toast(other)).toHaveText(`The view of ${file.suggestedFilename()} loaded`);
  expect(await saved(other)).toBe(state);
  await expect.poll(() => shown(other)).toEqual({ id: PICTURE_ID, status: "ready", drawn: true });
  await refined(other);
  expect(compare(await pixels(other), screen, 1).within).toBeGreaterThan(0.999);
  // and that browser keeps it for its own session
  await open(other, "/");
  await expect.poll(() => shown(other)).toEqual({ id: PICTURE_ID, status: "ready", drawn: true });
  await other.context().close();
});

test("a pasted image becomes the tile picture; a file that is not a picture says so", async ({ page }) => {
  await open(page);
  await page.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], "image.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PICTURE.toString("base64"));
  await expect(toast(page)).toHaveText("Tile picture: image.png");
  await expect.poll(() => shown(page)).toEqual({ id: PICTURE_ID, status: "ready", drawn: true });
  // a JPEG that is not one: refused with the reason, and the picture stays
  await drop(page, "not a picture", "broken.jpg", "image/jpeg");
  await expect(toast(page)).toHaveText("Picture not loaded: broken.jpg: it is not a picture this browser can read");
  expect((await shown(page))?.id).toBe(PICTURE_ID);
  // a large picture is cut down to 2048 pixels and written again: the id is the new file's
  const [w, h] = [3000, 600];
  const big = new Uint8Array(w * h * 4);
  for (let i = 0; i < big.length; i += 4) big.set([(i / 4) % 251, ((i / 4 / w) | 0) % 239, 128, 255], i);
  await drop(page, encodePNG(big, w, h), "big.png", "image/png");
  await expect(toast(page)).toHaveText("Tile picture: big.png");
  const id = (await tileImage(page))!.id;
  expect(id).not.toBe(PICTURE_ID);
  await expect.poll(() => shown(page)).toEqual({ id, status: "ready", drawn: true });
  // opaque, so written as JPEG; 2048 × 410 (600 × 2048/3000 = 409.6)
  const size = await page.evaluate(async (id) => {
    const req = indexedDB.open("hyperscope");
    const db = await new Promise<IDBDatabase>((r) => (req.onsuccess = () => r(req.result)));
    const got = await new Promise<{ src: string }>((r) => {
      const g = db.transaction("pictures").objectStore("pictures").get(id);
      g.onsuccess = () => r(g.result);
    });
    const img = new Image();
    img.src = got.src;
    await img.decode();
    return [got.src.slice(0, 23), img.width, img.height];
  }, id);
  expect(size).toEqual(["data:image/jpeg;base64,", 2048, 410]);
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("your presets keep their pictures: exported with them, and read back in a fresh browser", async ({ page, browser }) => {
  await open(page);
  await drop(page, PICTURE, "quadrants.png", "image/png");
  await expect.poll(async () => (await shown(page))?.drawn).toBe(true);
  await refined(page);
  const state = await saved(page);
  await poke(page);
  await page.locator('.hs-toolbar [aria-label="Presets"]').click();
  await page.getByRole("textbox", { name: "Name of the new preset" }).fill("Quadrants");
  await page.getByRole("button", { name: "Save the view on the screen as a preset" }).click();
  await expect(toast(page)).toHaveText("Saved “Quadrants”");
  // the browser's own list names the picture; the file written carries it
  const kept = await page.evaluate(() => localStorage.getItem("hyperscope.presets")!);
  expect(kept).toContain(PICTURE_ID);
  expect(kept).not.toContain("data:image/png;base64,iVBOR");
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: "Write your presets to a JSON file" }).click();
  const file = await d;
  const text = readFileSync((await file.path())!, "utf8");
  const json = JSON.parse(text);
  expect(json.presets[0].state.content.tileImage).toMatchObject({ id: PICTURE_ID, src: `data:image/png;base64,${PICTURE.toString("base64")}` });

  const fresh = await freshPage(browser);
  await open(fresh);
  await drop(fresh, text, "hyperscope-presets.json", "application/json");
  await expect(toast(fresh)).toHaveText("1 preset added");
  // the gallery opens on its own; its pictures are still being drawn, so the chrome may rest first
  await expect(async () => {
    await poke(fresh);
    await fresh.locator(".hs-gallery .hs-preset-cell .hs-preset").first().click({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await expect.poll(() => saved(fresh)).toBe(state);
  await expect.poll(() => shown(fresh)).toEqual({ id: PICTURE_ID, status: "ready", drawn: true });
  await refined(fresh);
  expect(await fresh.evaluate(() => window.hyperscope.error)).toBeUndefined();
  await fresh.context().close();
});
