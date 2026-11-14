// The icon row and the settings card in the real page (step 9 plan, sub-step 3): each control
// changes what it names, a group that is not hyperbolic is refused with the reason, the position
// fields put the camera exactly where typed, the look previews leave the picture alone, the accent
// recolours only the controls and the rim, and keys typed into a field stay in the field.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { LOOKS } from "../../src/content/looks.ts";
import { motifSpecOf } from "../../src/content/motifs.ts";
import { H3_HOME, tiltWith } from "../../src/math/views.ts";
import { fromLink } from "../../src/state/saved.ts";
import { parseFixed } from "../../src/ui/readouts.ts";

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
}

const refined = (page: Page) => page.waitForFunction(() => !window.hyperscope.busy!() && !window.hyperscope.refining!(), undefined, { timeout: 60_000 });
const hudClass = (page: Page) => page.evaluate(() => document.getElementById("hud")!.className);
const thin = (t: string | null) => t?.replace(/ /g, " ");
/** Activity, so the icon row and the card do not fade while a test waits. */
const poke = (page: Page) => page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove")));
const settings = (page: Page) => page.locator('.hs-toolbar [aria-label="Settings"]');
const tab = (page: Page, name: string) => page.locator(".hs-tab", { hasText: name });

async function openCard(page: Page, which?: string) {
  await open(page);
  await settings(page).click();
  await expect(page.locator(".hs-card")).toBeVisible();
  if (which) await tab(page, which).click();
}

/** What the controls change, from the page's state (the exact X as a decimal string). */
interface Seen {
  model: string;
  group: number[];
  colouring: string;
  construction?: string;
  weights?: number[];
  motif?: string | { name: string };
  sides: boolean[];
  lineWidth: number;
  lineUnit?: string;
  plain?: boolean;
  look: Record<string, unknown>;
  grid: { on: boolean; kind: string; unit: string } | null;
  accent: string;
  x: string;
  y: number;
  theta: number;
  distance: number;
}
const seen = (page: Page): Promise<Seen> =>
  page.evaluate(() => {
    type S = { view: { picture: { model: string }; grids: Record<string, { s: bigint; e: number; theta: number }> }; content: Record<string, unknown>; ui: { accent: string } };
    const s = window.hyperscope.state!() as S;
    const c = s.view.grids.cartesian;
    return {
      ...(s.content as object),
      model: s.view.picture.model,
      grid: (s.content.grid as Seen["grid"]) ?? null,
      accent: s.ui.accent,
      x: c.s.toString(),
      y: c.e,
      theta: c.theta,
      distance: s.view.grids.polar.e,
    } as Seen;
  });
const field = <K extends keyof Seen>(page: Page, key: K) => () => seen(page).then((s) => s[key]);

/** The canvas as RGBA bytes. */
async function pixels(page: Page): Promise<{ width: number; height: number; data: Buffer }> {
  const s = await page.evaluate(() => window.hyperscope.snapshot!());
  return { width: s.width, height: s.height, data: Buffer.from(s.data, "base64") };
}

async function commit(input: Locator, text: string) {
  await input.fill(text);
  await input.press("Enter");
}

test("the settings button opens the card; Esc, after the help, closes it; it reopens on its tab", async ({ page }) => {
  await open(page);
  const card = page.locator(".hs-card");
  await expect(card).toBeHidden();
  await expect(settings(page)).toHaveAttribute("aria-expanded", "false");
  await settings(page).click();
  await expect(card).toBeVisible();
  await expect(settings(page)).toHaveAttribute("aria-expanded", "true");
  await expect(tab(page, "Tiling")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(settings(page)).toHaveAttribute("aria-expanded", "false");
  // the button closes it too, and it opens again on the tab it was left on
  await settings(page).click();
  await tab(page, "View").click();
  await settings(page).click();
  await expect(card).toBeHidden();
  await settings(page).click();
  await expect(tab(page, "View")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".hs-pane:not([hidden])")).toContainText("Where you are");
  // the help over the card: Esc closes the help first, then the card
  await page.keyboard.press("F1");
  await expect(page.locator(".hs-help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".hs-help")).toBeHidden();
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the card fades with the icon row, but not while the pointer is over it", async ({ page }) => {
  await openCard(page);
  await page.locator(".hs-card .hs-section-title").first().hover();
  await page.waitForTimeout(3000);
  expect(await hudClass(page)).toBe("");
  // over the picture (above the card, a sheet along the bottom at this width)
  await page.mouse.move(320, 150);
  await page.waitForTimeout(3000);
  expect(await hudClass(page)).toBe("hs-idle");
  await expect(page.locator(".hs-card")).toBeHidden(); // faded out: visibility hidden
  await page.mouse.move(330, 150);
  await expect(page.locator(".hs-card")).toBeVisible();
});

test("the steppers apply a hyperbolic group and refuse the others with the reason", async ({ page }) => {
  await openCard(page);
  const note = page.getByLabel("Tiling check");
  const [p, q] = ["p", "q"].map((n) => page.getByRole("textbox", { name: n, exact: true }));
  await expect(note).toHaveText("{7,3} heptagons: 1/p + 1/q + 1/r < 1, hyperbolic");
  await page.getByRole("button", { name: "q larger" }).click();
  await expect.poll(field(page, "group")).toEqual([7, 4, 2]);
  await expect(page.locator(".hs-title")).toHaveText("{7,4} heptagons · Poincaré disk");
  await expect(note).toHaveText("{7,4} heptagons: 1/p + 1/q + 1/r < 1, hyperbolic");
  // (3, 4, 2) is spherical: the steppers keep it as a draft, the picture stays
  await commit(p, "3");
  await expect(note).toHaveText("1/3 + 1/4 + 1/2 > 1: a spherical tiling, not hyperbolic");
  await expect(note).toHaveClass(/hs-bad/);
  await expect(page.locator(".hs-stepper.hs-bad")).toHaveCount(3);
  expect((await seen(page)).group).toEqual([7, 4, 2]);
  // the next change starts from the draft: (3, 6, 2) is Euclidean
  await commit(q, "6");
  await expect(note).toHaveText("1/3 + 1/6 + 1/2 = 1: a Euclidean tiling, not hyperbolic");
  // and (3, 7, 2) is hyperbolic, so it applies
  await page.getByRole("button", { name: "q larger" }).click();
  await expect.poll(field(page, "group")).toEqual([3, 7, 2]);
  await expect(page.locator(".hs-stepper.hs-bad")).toHaveCount(0);
  await expect(note).not.toHaveClass(/hs-bad/);
  await expect(page.locator(".hs-title")).toHaveText("{3,7} triangles · Poincaré disk");
  await expect(page.locator(".hs-chip", { hasText: "{3,7}" })).toHaveAttribute("aria-pressed", "true");
  // below the least order the stepper stops at 2; text that is not a number puts the value back
  await commit(p, "1");
  await expect(p).toHaveValue("2");
  await expect(note).toHaveText("1/2 + 1/7 + 1/2 > 1: a spherical tiling, not hyperbolic");
  await commit(p, "seven");
  await expect(p).toHaveValue("2");
  await commit(p, "7");
  await expect.poll(field(page, "group")).toEqual([7, 7, 2]);
  await expect(note).toHaveText("{7,7} heptagons: 1/p + 1/q + 1/r < 1, hyperbolic");
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("tiling chips, the tiling and line switches, the line width and the colouring", async ({ page }) => {
  await openCard(page);
  const chip = page.locator(".hs-chip", { hasText: "{5,4}" });
  await chip.click();
  await expect.poll(field(page, "group")).toEqual([5, 4, 2]);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hs-chip", { hasText: "{7,3}" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".hs-title")).toHaveText("{5,4} pentagons · Poincaré disk");
  // no tiling, and back
  const tiling = page.getByRole("switch", { name: "Show the tiling" });
  await tiling.click();
  await expect.poll(field(page, "plain")).toBe(true);
  await expect(tiling).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".hs-title")).toHaveText("No tiling · Poincaré disk");
  await tiling.click();
  await expect.poll(field(page, "plain")).toBe(false);
  await expect(page.locator(".hs-title")).toHaveText("{5,4} pentagons · Poincaré disk");
  // the lines from the centre to the vertices as well as the tile edges
  await page.getByRole("switch", { name: "Centre to vertices" }).click();
  await expect.poll(field(page, "sides")).toEqual([true, false, true]);
  // a width in pixels starts at 1.5 px; the slider's ends are 16 px and 0.25 px
  const width = page.getByRole("slider", { name: "Line width" });
  const shown = page.locator(".hs-slider", { has: width }).locator("output");
  await expect(shown).toHaveText("0.030");
  await page.getByRole("button", { name: "In pixels, the same width everywhere" }).click();
  await expect.poll(() => seen(page).then((s) => [s.lineUnit, s.lineWidth])).toEqual(["px", 1.5]);
  await expect(shown).toHaveText("1.50 px");
  await width.focus();
  await width.press("End");
  await expect.poll(field(page, "lineWidth")).toBeCloseTo(16, 9);
  await expect(shown).toHaveText("16.0 px");
  await width.press("Home");
  await expect.poll(field(page, "lineWidth")).toBeCloseTo(0.25, 9);
  await expect(shown).toHaveText("0.250 px");
  // the colouring list is the group's: {5,4} has the two-colour faces
  const colouring = page.getByRole("combobox", { name: "Colouring" });
  await expect(colouring.locator("option")).toContainText(["Parity, 2 colours"]);
  await colouring.selectOption("faces");
  await expect.poll(field(page, "colouring")).toBe("faces");
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the colourings are listed by their number of colours, chiral ones among them; Mosaic is a colour source", async ({ page }) => {
  await openCard(page);
  const colouring = page.getByRole("combobox", { name: "Colouring" });
  // {7,3}: one heading per count, rising, and every option under the heading of its own count
  const groups = await colouring.locator("optgroup").evaluateAll((gs) => gs.map((g) => ({ label: (g as HTMLOptGroupElement).label, options: [...g.querySelectorAll("option")].map((o) => [o.value, o.textContent ?? ""]) })));
  const ks = groups.map((g) => parseInt(g.label));
  expect(ks[0]).toBe(2);
  expect(ks.every((k, i) => i === 0 || k > ks[i - 1])).toBe(true);
  for (const g of groups) for (const [, text] of g.options) expect(text.endsWith(`, ${parseInt(g.label)} colours`)).toBe(true);
  const values = groups.flatMap((g) => g.options.map(([v]) => v));
  expect(values).toEqual(expect.arrayContaining(["parity", "r1", "r2", "r3"]));
  await colouring.selectOption("r1");
  await expect.poll(field(page, "colouring")).toBe("r1");
  await expect(colouring.locator("option:checked")).toHaveText("Chiral 1, 7 colours");
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  // the five colour sources sit inside the card, and Mosaic is one of them
  await tab(page, "Look").click();
  const sources = page.locator(".hs-pane:not([hidden]) .hs-seg").filter({ hasText: "Mosaic" });
  await expect(sources.locator(".hs-seg-btn")).toHaveText(["Colouring", "Distance", "Depth", "Inside", "Mosaic"]);
  const card = (await page.locator(".hs-card").boundingBox())!;
  for (const b of await sources.locator(".hs-seg-btn").all()) {
    const box = (await b.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(card.x);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
  }
  await sources.getByRole("button", { name: "Mosaic", exact: true }).click();
  await expect.poll(() => field(page, "look")().then((l) => l.source)).toBe("mosaic");
  await refined(page);
  // the chiral colouring stays chosen; the tiles are coloured one by one
  expect(await field(page, "colouring")()).toBe("r1");
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the Construction list, the free point's triangle, and key O", async ({ page }) => {
  await openCard(page);
  const list = page.getByRole("combobox", { name: "Construction" });
  const colouring = page.getByRole("combobox", { name: "Colouring" });
  const values = await list.locator("option").evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent ?? ""]));
  expect(values.map(([v]) => v)).toEqual(["lines", "010", "001", "100", "110", "101", "011", "111", "snub", "free"]);
  // {7,3}: the classic names with the Wythoff symbols
  expect(values.find(([v]) => v === "110")![1]).toMatch(/^Truncated \{7,3\}\s+3 2 \| 7$/);
  expect(values.find(([v]) => v === "snub")![1]).toMatch(/^Snub \{7,3\}\s+\| 7 3 2$/);
  await expect(colouring).toBeEnabled();
  // a construction turns version 1's lines off and the colouring list with them
  await list.selectOption("110");
  await expect.poll(field(page, "construction")).toBe("110");
  expect(await field(page, "sides")()).toEqual([false, false, false]);
  await expect(colouring).toBeDisabled();
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  // the free point starts where the truncation had it, and follows a drag inside the triangle
  const tri = page.locator(".hs-free");
  await expect(tri).toBeHidden();
  await list.selectOption("free");
  await expect.poll(field(page, "weights")).toEqual([1, 1, 0]);
  await expect(tri).toBeVisible();
  await tri.scrollIntoViewIfNeeded();
  const box = (await tri.boundingBox())!;
  const at = (x: number, y: number) => [box.x + (x / 160) * box.width, box.y + (y / 104) * box.height] as const;
  await page.mouse.move(...at(144, 92)); // Q
  await page.mouse.down();
  await page.mouse.move(...at(100, 70), { steps: 4 });
  await page.mouse.move(...at(80, 65), { steps: 4 });
  await page.mouse.up();
  // at (80, 65): barycentric (P, Q, R) = (0.33125, 0.33125, 0.3375), the weights (R, Q, P), to the
  // mouse's whole pixels
  await expect.poll(async () => (await field(page, "weights")())!.map((w) => Math.round(w * 100) / 100)).toEqual([0.34, 0.33, 0.33]);
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  // back to Lines: no lines were on, so the tile edges come back
  await list.selectOption("lines");
  await expect.poll(field(page, "construction")).toBeUndefined();
  expect(await field(page, "sides")()).toEqual([false, false, true]);
  await expect(colouring).toBeEnabled();
  // O and Shift+O step through the constructions (the free point is the card's)
  await page.locator("canvas").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("o");
  await expect.poll(field(page, "construction")).toBe("010");
  await page.keyboard.press("Shift+O");
  await expect.poll(field(page, "construction")).toBeUndefined();
  await page.keyboard.press("Shift+O");
  await expect.poll(field(page, "construction")).toBe("snub");
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the Motif list, Load motif… and its refusals, a motif file dropped on the window, and key M", async ({ page }) => {
  await openCard(page);
  const list = page.getByRole("combobox", { name: "Motif" });
  const note = page.getByLabel("Motif check");
  const title = page.locator(".hs-title");
  const toast = page.locator(".hs-toast");
  const options = () => list.locator("option").evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent ?? ""]));
  expect(await options()).toEqual([["none", "None"], ["shoal", "Shoal (3,3,4)"], ["moths", "Moths {6,4}"], ["rosette", "Rosette {8,3}"], ["birds", "Birds (4,4,3)"]]);
  await expect(note).toHaveText(/brings its own group/);
  // a built-in brings its group and colouring and turns the lines off
  await list.selectOption("moths");
  await expect.poll(field(page, "motif")).toBe("moths");
  expect(await field(page, "group")()).toEqual([6, 4, 2]);
  expect(await field(page, "colouring")()).toBe("c3");
  expect(await field(page, "sides")()).toEqual([false, false, false]);
  await expect(title).toHaveText("Moths {6,4} · Poincaré disk");
  await expect(note).toHaveText(/another group or construction removes it/);
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  // another group drops it
  await page.locator(".hs-chip", { hasText: "{7,3}" }).click();
  await expect.poll(field(page, "motif")).toBeUndefined();
  await expect(title).toHaveText("{7,3} heptagons · Poincaré disk");
  await expect(list).toHaveValue("none");

  // a file: the format's fields are kept, and the list offers it again
  const file = page.locator('.hs-motif-actions input[type="file"]');
  const mine = { ...motifSpecOf("birds"), name: "Mine", author: "me" };
  await file.setInputFiles({ name: "mine.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(mine)) });
  await expect.poll(async () => ((await field(page, "motif")()) as { name: string } | undefined)?.name).toBe("Mine");
  expect(await field(page, "motif")()).not.toHaveProperty("author");
  expect(await field(page, "group")()).toEqual([4, 4, 3]);
  await expect(title).toHaveText("Mine (4,4,3) · Poincaré disk");
  await expect(list).toHaveValue("loaded");
  expect((await options()).at(-1)).toEqual(["loaded", "Mine (4,4,3), loaded"]);
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  // refused files say why and leave the motif as it was
  const bad = { ...mine, pr: [[0.1, -0.05], [0.15, -0.05]] };
  await file.setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(note).toHaveText("bad.json not loaded: the curve from P to R leaves the two triangles on either side of PR");
  await expect(note).toHaveClass(/hs-bad/);
  await file.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not JSON") });
  await expect(note).toHaveText("notes.txt is not a motif file (JSON of at most 256 KB)");
  expect(((await field(page, "motif")()) as { name: string }).name).toBe("Mine");
  // None, then the loaded one again
  await list.selectOption("none");
  await expect.poll(field(page, "motif")).toBeUndefined();
  expect(await field(page, "sides")()).toEqual([false, false, true]);
  await expect(note).not.toHaveClass(/hs-bad/);
  await list.selectOption("loaded");
  await expect.poll(async () => ((await field(page, "motif")()) as { name: string } | undefined)?.name).toBe("Mine");
  // a construction other than Lines drops it
  await page.getByRole("combobox", { name: "Construction" }).selectOption("snub");
  await expect.poll(field(page, "motif")).toBeUndefined();
  expect(await field(page, "construction")()).toBe("snub");

  // M and Shift+M step through none and the built-ins
  await page.locator("canvas").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("m");
  await expect.poll(field(page, "motif")).toBe("shoal");
  expect(await field(page, "construction")()).toBeUndefined();
  await expect(toast).toHaveText("Motif: Shoal (3,3,4)");
  await page.keyboard.press("Shift+M");
  await expect.poll(field(page, "motif")).toBeUndefined();
  await expect(toast).toHaveText("No motif");
  await page.keyboard.press("Shift+M");
  await expect.poll(field(page, "motif")).toBe("birds");
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();

  // a motif file dropped on the window is drawn too; a refused one says why
  const drop = (text: string, name: string) =>
    page.evaluate(
      ([text, name]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: "application/json" }));
        window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      [text, name] as const,
    );
  await drop(JSON.stringify({ ...motifSpecOf("rosette"), name: "Dropped" }), "dropped.json");
  await expect(toast).toHaveText("Motif: Dropped {8,3}");
  expect(await field(page, "group")()).toEqual([8, 3, 2]);
  await drop(JSON.stringify(bad), "bad.json");
  await expect(toast).toHaveText("Motif not loaded: the curve from P to R leaves the two triangles on either side of PR");
  expect(((await field(page, "motif")()) as { name: string }).name).toBe("Dropped");
  await refined(page);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the look previews show the view and leave the picture alone; a click chooses a look", async ({ page }) => {
  await open(page);
  await refined(page);
  const before = await pixels(page);
  await settings(page).click();
  await tab(page, "Look").click();
  /** How many previews are drawn (a quarter of their pixels or more lit), and a hash of the first. */
  const previews = () =>
    page.evaluate(() => {
      let drawn = 0;
      let hash = 0;
      document.querySelectorAll<HTMLCanvasElement>(".hs-look-canvas").forEach((c, i) => {
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let lit = 0;
        for (let j = 0; j < d.length; j += 4) {
          if (d[j] + d[j + 1] + d[j + 2] > 60) lit++;
          if (i === 0) hash = (Math.imul(hash, 31) + d[j] + 7 * d[j + 1] + 13 * d[j + 2]) | 0;
        }
        if (lit > d.length / 16) drawn++;
      });
      return { drawn, hash };
    });
  await expect.poll(() => previews().then((p) => p.drawn), { timeout: 60_000 }).toBe(LOOKS.length);
  const first = (await previews()).hash;
  const after = await pixels(page);
  expect(after.data.equals(before.data), "the picture changed while the previews were drawn").toBe(true);
  // the current look is marked; a click on another chooses it
  const gilded = page.locator('.hs-look[aria-label="Gilded"]');
  const escher = page.locator('.hs-look[aria-label="Escher"]');
  await expect(gilded).toHaveAttribute("aria-pressed", "true");
  await escher.click();
  await expect.poll(field(page, "look")).toEqual(LOOKS[1].look);
  await expect(escher).toHaveAttribute("aria-pressed", "true");
  await expect(gilded).toHaveAttribute("aria-pressed", "false");
  // a palette, a colour source and a slider change the look, which is then no longer Escher's own
  await page.locator('.hs-palette[aria-label="Ember"]').click();
  await expect.poll(() => field(page, "look")().then((l) => l.palette)).toBe("Ember");
  await expect(escher).toHaveAttribute("aria-pressed", "false");
  await page.locator(".hs-pane:not([hidden])").getByRole("button", { name: "Distance", exact: true }).click();
  await expect.poll(() => field(page, "look")().then((l) => l.source)).toBe("distance");
  const glow = page.getByRole("slider", { name: "Glow" });
  await glow.focus();
  await glow.press("End");
  await expect.poll(() => field(page, "look")().then((l) => l.glow)).toBe(1);
  // the previews follow the view once it rests
  await page.keyboard.press("Escape"); // out of the slider, so the key below is the view's
  await page.keyboard.press("2");
  await expect.poll(field(page, "model")).toBe("klein");
  await expect.poll(() => previews().then((p) => p.hash), { timeout: 60_000 }).not.toBe(first);
  await expect.poll(() => previews().then((p) => p.drawn)).toBe(LOOKS.length);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("an accent recolours the controls and the picture's rim, and nothing else", async ({ page }) => {
  await open(page);
  await refined(page);
  const before = await pixels(page);
  await settings(page).click();
  await tab(page, "Look").click();
  const coral = page.getByRole("button", { name: "Coral" });
  await coral.click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById("hud")!).getPropertyValue("--accent").trim())).toBe("#ff8a7a");
  await expect(coral).toHaveAttribute("aria-pressed", "true");
  expect((await seen(page)).accent).toBe("coral");
  await refined(page);
  const after = await pixels(page);
  // every pixel that changed lies on the disk's rim, a ring a few pixels wide
  const { width, height } = after;
  const radii: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      if (Math.abs(after.data[i] - before.data[i]) + Math.abs(after.data[i + 1] - before.data[i + 1]) + Math.abs(after.data[i + 2] - before.data[i + 2]) > 3)
        radii.push(Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2));
    }
  expect(radii.length).toBeGreaterThan(500);
  const [lo, hi] = [Math.min(...radii), Math.max(...radii)];
  expect(hi - lo, `changed from radius ${lo.toFixed(1)} to ${hi.toFixed(1)}`).toBeLessThan(8);
});

test("X, Y and rotation go exactly where typed; the magnification zooms to the power typed", async ({ page }) => {
  await openCard(page, "View");
  const [x, y, rotation, zoom] = ["Position X", "Position Y", "Rotation", "Magnification"].map((n) => page.getByRole("textbox", { name: n }));
  const distance = page.locator(".hs-card output.hs-value");
  await expect(x).toHaveValue(/^0\.0+$/);
  expect(thin(await distance.textContent())).toBe("0 R · 0 m");
  await commit(x, "1.25");
  await expect.poll(field(page, "x")).toBe(parseFixed("1.25")!.toString());
  expect((await seen(page)).distance).toBeCloseTo(1.25, 12);
  await expect.poll(async () => thin(await distance.textContent())).toBe("1.25 R · 7 960 km");
  expect(thin(await page.locator(".hs-distance-value").textContent())).toBe("1.25 R · 7 960 km");
  await commit(y, "-0.5");
  await expect.poll(field(page, "y")).toBe(-0.5);
  let s = await seen(page);
  expect(s.x).toBe(parseFixed("1.25")!.toString());
  expect(s.distance).toBeCloseTo(Math.acosh(Math.cosh(1.25) * Math.cosh(0.5)), 12);
  await commit(rotation, "30");
  await expect.poll(field(page, "theta")).toBeCloseTo(Math.PI / 6, 14);
  s = await seen(page);
  expect([s.x, s.y]).toEqual([parseFixed("1.25")!.toString(), -0.5]);
  // many more digits than a float64 holds go in exactly
  const long = "-3.14159265358979323846264338327950288";
  await commit(x, long);
  await expect.poll(field(page, "x")).toBe(parseFixed(long)!.toString());
  // once you leave a field it shows the value as it now is
  await commit(x, "1.25");
  await x.press("Escape");
  await expect(x).toHaveValue(/^1\.250+$/);
  await expect(y).toHaveValue(/^-0\.50+$/);
  await expect(rotation).toHaveValue("30.00");
  // refused: the field is marked with the reason and keeps the text; Esc puts the value back
  const box = (input: Locator) => page.locator(".hs-field", { has: input });
  await commit(x, "abc");
  await expect(box(x)).toHaveClass(/hs-bad/);
  await expect(x).toHaveAttribute("title", "Not a number");
  await expect(x).toHaveValue("abc");
  await x.press("Escape");
  await expect(box(x)).not.toHaveClass(/hs-bad/);
  await expect(x).toHaveValue(/^1\.250+$/);
  await commit(y, "2000");
  await expect(y).toHaveAttribute("title", /^At most 1.000 R from the start$/);
  await y.press("Escape");
  expect((await seen(page)).y).toBe(-0.5);
  // the magnification: 10^1 at the centre, then as far out as the view goes
  await commit(zoom, "1");
  await expect(page.locator(".hs-mag sup")).toHaveText("1.00");
  s = await seen(page);
  expect([s.x, s.y]).toEqual([parseFixed("1.25")!.toString(), -0.5]); // the centre stays put
  await commit(zoom, "-5");
  await expect(zoom).toHaveAttribute("title", /^The zoom stops at 10\^−?\d\.\d\d here$/);
  await expect(box(zoom)).toHaveClass(/hs-bad/);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("inside H3 the View tab trades the magnification for the eye's height, and adds the field of view", async ({ page }) => {
  await openCard(page, "View");
  const zoom = page.getByRole("textbox", { name: "Magnification" });
  const height = page.getByRole("textbox", { name: "Eye height" });
  const fov = page.getByRole("slider", { name: "Field of view" });
  await expect(zoom).toBeVisible();
  await expect(height).toBeHidden();
  await expect(fov).toBeHidden();
  await page.locator(".hs-card .hs-seg-views button", { hasText: "Inside H³" }).click();
  await expect(height).toBeVisible();
  await expect(zoom).toBeHidden();
  await expect(height).toHaveValue("0.300");
  await expect(page.locator(".hs-card .hs-row", { hasText: "Field of view" }).locator(".hs-slider-value")).toHaveText("70°");
  const pic = () => page.evaluate(() => (window.hyperscope.state!() as { view: { picture: { h: number; pitch: number; fov: number } } }).view.picture);
  await commit(height, "1.5");
  await expect.poll(async () => (await pic()).h).toBe(1.5);
  await expect(page.locator(".hs-eye")).toHaveText(/^1\.50\s?R$/);
  // a height typed in tilts the view as a zoom does: further down as the eye rises
  expect((await pic()).pitch).toBeCloseTo(tiltWith(H3_HOME.pitch, H3_HOME.h, 1.5), 12);
  // from the highest eye the screen centre still shows the ground
  await commit(height, "6");
  await expect.poll(async () => (await pic()).h).toBe(6);
  expect(await page.evaluate(() => window.hyperscope.probe!(320, 240))).not.toBeNull();
  await commit(height, "0.3");
  await expect.poll(async () => (await pic()).h).toBe(0.3);
  expect((await pic()).pitch).toBeCloseTo(H3_HOME.pitch, 12);
  // refused out of range, with the reason
  await commit(height, "9");
  await expect(height).toHaveAttribute("title", "From 0.01 to 6 R");
  await height.press("Escape");
  // the slider: its ends are 40 and 100 degrees, and Home keeps the field chosen
  await fov.focus();
  await page.keyboard.press("End");
  await expect.poll(async () => Math.round(((await pic()).fov * 180) / Math.PI)).toBe(100);
  await page.locator(".hs-actions button", { hasText: "Home" }).click();
  await expect.poll(async () => (await pic()).h).toBe(0.3);
  expect(Math.round(((await pic()).fov * 180) / Math.PI)).toBe(100);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("on the hyperboloid the View tab trades the magnification for the orbit's distance, and adds the field of view", async ({ page }) => {
  await openCard(page, "View");
  const zoom = page.getByRole("textbox", { name: "Magnification" });
  const distance = page.getByRole("textbox", { name: "Orbit distance" });
  const fov = page.getByRole("slider", { name: "Field of view" });
  await expect(distance).toBeHidden();
  await page.locator(".hs-card .hs-seg-views button", { hasText: "Hyperboloid" }).click();
  await expect(distance).toBeVisible();
  await expect(zoom).toBeHidden();
  await expect(distance).toHaveValue("5.00");
  await expect(page.locator(".hs-card .hs-row", { hasText: "Field of view" }).locator(".hs-slider-value")).toHaveText("50°");
  const pic = () => page.evaluate(() => (window.hyperscope.state!() as { view: { picture: { distance: number; fov: number } } }).view.picture);
  await commit(distance, "12");
  await expect.poll(async () => (await pic()).distance).toBe(12);
  await expect(page.locator(".hs-eye")).toHaveText(/^12\.0\s?R$/);
  await commit(distance, "0.5");
  await expect(distance).toHaveAttribute("title", "From 1.5 to 40 R");
  await distance.press("Escape");
  // the slider serves the orbit too, and Home keeps the field chosen
  await fov.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => Math.round(((await pic()).fov * 180) / Math.PI)).toBe(40);
  await page.locator(".hs-actions button", { hasText: "Home" }).click();
  await expect.poll(async () => (await pic()).distance).toBe(5);
  expect(Math.round(((await pic()).fov * 180) / Math.PI)).toBe(40);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("keys typed into a field stay there; Tab moves through the open card", async ({ page }) => {
  await openCard(page, "View");
  const x = page.getByRole("textbox", { name: "Position X" });
  await x.click();
  await page.keyboard.type("2g+h");
  await expect(x).toHaveValue(/2g\+h$/);
  let s = await seen(page);
  expect([s.model, s.grid?.on ?? false]).toEqual(["poincare", false]);
  expect(await page.locator(".hs-mag sup").textContent()).toBe("0.00");
  // the first Esc leaves the field (and drops the text), the second closes the card
  await page.keyboard.press("Escape");
  await expect(x).not.toBeFocused();
  await expect(x).toHaveValue(/^0\.0+$/);
  await expect(page.locator(".hs-card")).toBeVisible();
  // Tab while the card is open moves the focus on from there instead of hiding the HUD
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await hudClass(page)).not.toContain("hs-hidden");
  await expect(page.getByRole("textbox", { name: "Rotation" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".hs-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".hs-card")).toBeHidden();
  s = await seen(page);
  expect(s.model).toBe("poincare");
});

test("the unit grid's switch, type and size, the icon row's grid button, and Copy link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openCard(page, "View");
  const on = page.getByRole("switch", { name: "Show the unit grid" });
  const button = page.locator('.hs-toolbar [aria-label="Unit grid"]');
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await on.click();
  await expect.poll(field(page, "grid")).toMatchObject({ on: true, kind: "cartesian", unit: "earth" });
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hs-title")).toHaveText("{7,3} heptagons · Poincaré disk · Cartesian grid, R = Earth's radius");
  await page.getByRole("button", { name: "Polar grid" }).click();
  await expect.poll(field(page, "grid")).toMatchObject({ on: true, kind: "polar" });
  await page.getByRole("combobox", { name: "Size of R" }).selectOption("km");
  await expect.poll(field(page, "grid")).toMatchObject({ on: true, kind: "polar", unit: "km" });
  await expect(page.locator(".hs-title")).toHaveText("{7,3} heptagons · Poincaré disk · polar grid, R = 1 km");
  // the icon row's button turns it off and the card follows
  await button.click();
  await expect.poll(field(page, "grid")).toMatchObject({ on: false, kind: "polar", unit: "km" });
  await expect(on).toHaveAttribute("aria-checked", "false");
  // a link to this view, which reads back as it
  await commit(page.getByRole("textbox", { name: "Position X" }), "0.75");
  await expect.poll(field(page, "x")).toBe(parseFixed("0.75")!.toString());
  await page.getByRole("button", { name: "Copy a link to this view" }).click();
  await expect(page.locator(".hs-toast")).toHaveText("Link to this view copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/^http:\/\/localhost:5173\/#v=2&/);
  const loaded = fromLink(link);
  if (!loaded.ok) throw new Error(loaded.reason);
  expect(loaded.state.content.grid).toMatchObject({ on: false, kind: "polar", unit: "km" });
  expect(loaded.state.view.grids.cartesian.s).toBe(parseFixed("0.75"));
  expect(loaded.state.view.picture.model).toBe("poincare");
});

test("the icon row: the views, home and help; back and forward wait for the history", async ({ page }) => {
  await open(page);
  const bar = page.locator(".hs-toolbar");
  await expect(bar.locator('[aria-label="Back"]')).toBeDisabled();
  await expect(bar.locator('[aria-label="Forward"]')).toBeDisabled();
  await expect(bar.locator('[aria-label="Poincaré disk"]')).toHaveAttribute("aria-pressed", "true");
  await bar.locator('[aria-label="Klein disk"]').click();
  await expect.poll(field(page, "model")).toBe("klein");
  await expect(bar.locator('[aria-label="Klein disk"]')).toHaveAttribute("aria-pressed", "true");
  await expect(bar.locator('[aria-label="Poincaré disk"]')).toHaveAttribute("aria-pressed", "false");
  // the 4 key moves the choice too
  await page.keyboard.press("4");
  await expect(bar.locator('[aria-label="Local view"]')).toHaveAttribute("aria-pressed", "true");
  // a pan away, then Home: back at the start, in the same view
  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.mouse.move(200, 300, { steps: 6 });
  await page.mouse.up();
  await refined(page);
  expect((await seen(page)).distance).toBeGreaterThan(0.1);
  await poke(page);
  await bar.locator('[aria-label="Home"]').click();
  await expect.poll(field(page, "distance")).toBe(0);
  expect((await seen(page)).model).toBe("local");
  // the tooltips name the keys
  await expect(bar.locator('[aria-label="Home"]')).toHaveAttribute("data-tip", "Home · H");
  await expect(bar.locator('[aria-label="Half-plane"]')).toHaveAttribute("data-tip", "Half-plane · 3");
  await bar.locator('[aria-label="Help"]').click();
  await expect(page.locator(".hs-help")).toBeVisible();
});

test("below 700 px the card is a sheet along the bottom, its looks six to a row", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 700 });
  await openCard(page, "Look");
  const box = (await page.locator(".hs-card").boundingBox())!;
  expect([box.x, box.width]).toEqual([0, 600]);
  expect(box.y + box.height).toBeCloseTo(700, 0);
  expect(box.height).toBeLessThanOrEqual(0.58 * 700 + 1);
  const tops = await page.locator(".hs-look").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops.filter((t) => t === tops[0]).length).toBe(6);
  // the title moves below the icon row when they do not fit side by side
  await page.setViewportSize({ width: 500, height: 700 });
  const bar = (await page.locator(".hs-toolbar").boundingBox())!;
  const title = (await page.locator(".hs-tl").boundingBox())!;
  expect(title.y).toBeGreaterThanOrEqual(bar.y + bar.height);
});
