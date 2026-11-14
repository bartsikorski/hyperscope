// The presets gallery in the real page (design notes, step 9: Presets): the built-in presets drawn
// as pictures and opened whole, your own saved with a picture, kept across a reload, deleted with
// a confirming second click, written to a file and read back, and JSON dropped on the window.

import { type Page } from "@playwright/test";
import { expect, freshContext, test } from "./fixtures.ts";
import { readFileSync } from "node:fs";
import { LOOKS } from "../../src/content/looks.ts";
import { PRESETS } from "../../src/content/scene.ts";

async function open(page: Page, url = "/") {
  await page.goto(url);
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
}

const refined = (page: Page) => page.waitForFunction(() => !window.hyperscope.busy!() && !window.hyperscope.refining!(), undefined, { timeout: 60_000 });
const saved = (page: Page) => page.evaluate(() => window.hyperscope.saved!());
const poke = (page: Page) => page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove")));
const toast = (page: Page) => page.locator(".hs-toast");
const presetsButton = (page: Page) => page.locator('.hs-toolbar [aria-label="Presets"]');
const gallery = (page: Page) => page.locator(".hs-gallery");
const mine = (page: Page) => page.locator(".hs-gallery .hs-preset-cell .hs-preset");
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("hyperscope.presets") ?? "[]") as { name: string; thumb: string }[]);

async function openGallery(page: Page) {
  await poke(page);
  await presetsButton(page).click();
  await expect(gallery(page)).toBeVisible();
}

async function saveAs(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Name of the new preset" }).fill(name);
  await page.getByRole("button", { name: "Save the view on the screen as a preset" }).click();
  await expect(toast(page)).toHaveText(`Saved “${name}”`);
}

async function drag(page: Page, dx: number, dy: number) {
  await page.mouse.move(200, 240);
  await page.mouse.down();
  await page.mouse.move(200 + dx, 240 + dy, { steps: 6 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await refined(page);
}

/** Drop a file with this text on the window. */
const drop = (page: Page, text: string, name: string) =>
  page.evaluate(
    ([text, name]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name, { type: "application/json" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [text, name] as const,
  );

test("the gallery draws the built-in presets and opens one whole: tiling, look, home", async ({ page }) => {
  await open(page);
  await drag(page, -100, 0);
  const before = await saved(page);
  await openGallery(page);
  await expect(presetsButton(page)).toHaveAttribute("aria-expanded", "true");
  const builtIn = gallery(page).locator(".hs-presets").first().locator(".hs-preset");
  await expect(builtIn).toHaveCount(PRESETS.length);
  // every picture drawn: opaque, and not one flat colour (the unit grid's is mostly dark)
  const drawn = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLCanvasElement>(".hs-gallery canvas")].filter((c) => {
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        const colours = new Set<number>();
        for (let j = 0; j < d.length; j += 4) {
          if (d[j + 3] === 255) opaque++;
          colours.add((d[j] << 16) | (d[j + 1] << 8) | d[j + 2]);
        }
        return opaque === d.length / 4 && colours.size > 16;
      }).length,
    );
  await expect.poll(drawn, { timeout: 60_000 }).toBe(PRESETS.length);
  await expect(builtIn.first()).toHaveAttribute("aria-pressed", "true");
  // {5,4} pentagons: its tiling and colouring, its look, at home in the view on the screen
  await page.locator('.hs-preset[aria-label="{5,4} pentagons"]').click();
  await expect(page.locator(".hs-title")).toHaveText("{5,4} pentagons · Poincaré disk");
  const s = JSON.parse(await saved(page));
  expect(s.content).toMatchObject({ group: [5, 4, 2], colouring: "faces", look: LOOKS.find((l) => l.name === "Porcelain")!.look });
  expect(s.view.camera).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  await expect(page.locator('.hs-preset[aria-label="{5,4} pentagons"]')).toHaveAttribute("aria-pressed", "true");
  // a jump: Backspace returns to the view before it (the tiling stays)
  await page.keyboard.press("Backspace");
  await expect.poll(async () => JSON.parse(await saved(page)).view.grids).toEqual(JSON.parse(before).view.grids);
  // the settings card and the gallery take turns under the icon row; Esc closes
  await poke(page);
  await page.locator('.hs-toolbar [aria-label="Settings"]').click();
  await expect(page.locator(".hs-card")).toBeVisible();
  await expect(gallery(page)).toBeHidden();
  await expect(presetsButton(page)).toHaveAttribute("aria-expanded", "false");
  await presetsButton(page).click();
  await expect(page.locator(".hs-card")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(gallery(page)).toBeHidden();
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("your presets: saved with a picture, opened, kept across a reload, deleted on a second click", async ({ page }) => {
  await open(page);
  await openGallery(page);
  await expect(gallery(page)).toContainText("None yet.");
  await page.keyboard.press("l"); // Escher
  await drag(page, -120, 40);
  const here = await saved(page);
  await poke(page);
  await saveAs(page, "Escher walk");
  await expect(mine(page)).toHaveCount(1);
  await expect(mine(page).locator("img")).toHaveAttribute("src", /^data:image\/(webp|png);base64,/);
  expect((await stored(page)).map((p) => p.name)).toEqual(["Escher walk"]);
  // a name left empty is what the title says
  await poke(page);
  await page.getByRole("button", { name: "Save the view on the screen as a preset" }).click();
  await expect(toast(page)).toHaveText("Saved “{7,3} heptagons · Poincaré disk”");
  // away, then back through the preset
  await page.keyboard.press("h");
  await page.keyboard.press("p");
  await refined(page);
  await poke(page);
  await mine(page).first().click();
  await expect.poll(() => saved(page)).toBe(here);
  // after a reload they are still there
  await open(page, "/");
  await openGallery(page);
  await expect(mine(page)).toHaveCount(2);
  // the first click on × asks, the second deletes
  const cell = page.locator(".hs-gallery .hs-preset-cell").first();
  await cell.hover();
  await cell.locator(".hs-delete").click();
  await expect(cell.locator(".hs-delete")).toHaveText("Delete?");
  await expect(mine(page)).toHaveCount(2);
  await cell.locator(".hs-delete").click();
  await expect(toast(page)).toHaveText("Deleted “Escher walk”");
  await expect(mine(page)).toHaveCount(1);
  expect((await stored(page)).map((p) => p.name)).toEqual(["{7,3} heptagons · Poincaré disk"]);
});

test("export writes your presets to a file; import and a drop read them back, refusing what does not load", async ({ page }) => {
  await open(page);
  await openGallery(page);
  // nothing to export yet
  await page.getByRole("button", { name: "Write your presets to a JSON file" }).click();
  await expect(toast(page)).toHaveText("No presets of yours to export yet");
  await saveAs(page, "Home");
  await drag(page, -80, 0);
  await poke(page);
  await saveAs(page, "Moved");
  const moved = await saved(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Write your presets to a JSON file" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("hyperscope-presets.json");
  const text = readFileSync((await file.path())!, "utf8");
  const json = JSON.parse(text);
  expect(json).toMatchObject({ hyperscope: "presets", v: 1 });
  expect(json.presets.map((p: { name: string }) => p.name)).toEqual(["Home", "Moved"]);
  await expect(toast(page)).toHaveText("2 presets written to hyperscope-presets.json");
  // in a fresh browser: import the file with one broken preset added
  const fresh = await (await freshContext(page.context().browser()!, { baseURL: "http://localhost:5173", viewport: { width: 640, height: 480 } })).newPage();
  await open(fresh);
  await openGallery(fresh);
  const broken = { ...json, presets: [...json.presets, { name: "Flat", state: { ...json.presets[0].state, content: { ...json.presets[0].state.content, group: [4, 4, 2] } } }] };
  await fresh.locator('.hs-gallery input[type="file"]').setInputFiles({ name: "p.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(broken)) });
  await expect(toast(fresh)).toHaveText(/^2 presets added; 1 refused \(Flat: .+\)$/);
  await expect(mine(fresh)).toHaveCount(2);
  // the same file again adds nothing
  await drop(fresh, text, "hyperscope-presets.json");
  await expect(toast(fresh)).toHaveText("0 presets added");
  await expect(mine(fresh)).toHaveCount(2);
  // a saved state dropped on the window opens it
  await drop(fresh, moved, "view.json");
  await expect(toast(fresh)).toHaveText("Saved state loaded");
  expect(await saved(fresh)).toBe(moved);
  // and junk is refused with its name
  await drop(fresh, "not json", "notes.json");
  await expect(toast(fresh)).toHaveText("Not loaded: notes.json is not a Hyperscope file");
  await fresh.context().close();
});
