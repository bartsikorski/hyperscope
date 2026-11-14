// The HUD in the real page (design notes, step 9 plan: Tests that gate this step): its corners show
// the state, it fades and comes back, Tab hides it, help opens and closes, the grid's labels keep
// out of it, and none of this keeps the render loop running.

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
}

/** Wait until nothing moves and the picture has all its samples. */
const refined = (page: Page) => page.waitForFunction(() => !window.hyperscope.busy!() && !window.hyperscope.refining!(), undefined, { timeout: 60_000 });
const hudClass = (page: Page) => page.evaluate(() => document.getElementById("hud")!.className);
const frames = (page: Page) => page.evaluate(() => window.hyperscope.frames!);
const thin = (t: string | null) => t?.replace(/ /g, " ");

test("the corners show the preset, the view, the distance, the magnification and the samples", async ({ page }) => {
  await open(page);
  await refined(page);
  await expect(page.locator(".hs-brand")).toHaveText("HYPERSCOPE");
  await expect(page.locator(".hs-title")).toHaveText("{7,3} heptagons · Poincaré disk");
  expect(thin(await page.locator(".hs-distance-value").textContent())).toBe("0 R · 0 m");
  await expect(page.locator(".hs-mag sup")).toHaveText("0.00");
  await expect(page.locator(".hs-br")).toHaveText("Idle · 640×480 · 16/16");
  // a quiet refine line once the picture is done
  expect(await page.locator(".hs-refine").getAttribute("data-quiet")).toBe("");
  // 2x in at the centre (200 wheel units), then a pan: the magnification and the distance follow
  await page.mouse.move(320, 240);
  await page.mouse.wheel(0, -200);
  await refined(page);
  await expect(page.locator(".hs-mag sup")).toHaveText("0.30");
  await page.mouse.down();
  await page.mouse.move(120, 240, { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await refined(page);
  const r = await page.evaluate(() => (window.hyperscope.state!() as { view: { grids: { polar: { e: number } } } }).view.grids.polar.e);
  expect(r).toBeGreaterThan(0.5);
  const shown = thin(await page.locator(".hs-distance-value").textContent())!;
  expect(shown).toMatch(/^\d\.\d+ R · [\d ]+ km$/); // three significant digits
  expect(Number(shown.split(" R")[0])).toBeCloseTo(r, 2);
  // the view's name follows the view
  await page.keyboard.press("3");
  await expect(page.locator(".hs-title")).toHaveText("{7,3} heptagons · Half-plane");
  await expect(page.locator(".hs-mag sup")).toHaveText("0.30");
});

test("while refining: the count, a progress line and the frame rate", async ({ page }) => {
  await open(page);
  await refined(page);
  await page.keyboard.press("l");
  // the first frames of the new look, before all 16 samples are in
  await page.waitForFunction(() => {
    const p = window.hyperscope.progress!();
    return p.samples >= 1 && p.samples < p.max;
  });
  await expect(page.locator(".hs-refine-text")).toHaveText(/^Refining \d+\/16$/);
  expect(await page.locator(".hs-refine").getAttribute("data-done")).toBeNull();
  await refined(page);
  await expect(page.locator(".hs-br")).toHaveText("Idle · 640×480 · 16/16");
  // the progress line went all the way
  expect(await page.locator(".hs-bar > i").evaluate((e) => (e as HTMLElement).style.width)).toBe("100%");
});

test("the readouts dim and the chrome fades after 2.5 s at rest; movement brings them back", async ({ page }) => {
  await open(page);
  await refined(page);
  await page.mouse.move(600, 100);
  expect(await hudClass(page)).toBe("");
  await page.waitForTimeout(1500);
  expect(await hudClass(page)).toBe("");
  await page.waitForTimeout(1500);
  expect(await hudClass(page)).toBe("hs-idle");
  // the readouts at half strength once the 400 ms transition is over
  await page.waitForTimeout(500);
  expect(Number(await page.locator(".hs-tl").evaluate((e) => getComputedStyle(e).opacity))).toBeCloseTo(0.5, 2);
  await page.mouse.move(610, 110);
  expect(await hudClass(page)).toBe("");
  await page.keyboard.press("Shift");
  await page.waitForTimeout(2000);
  expect(await hudClass(page)).toBe("");
});

test("the fade and the notes keep the render loop idle", async ({ page }) => {
  await open(page);
  await refined(page);
  const n = await frames(page);
  await page.waitForTimeout(3200); // through the fade
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  expect(await frames(page)).toBe(n);
  expect(await page.evaluate(() => window.hyperscope.refining!())).toBe(false);
});

test("Tab hides everything, the grid's labels too, and shows it again", async ({ page }) => {
  await open(page);
  await page.keyboard.press("g");
  await refined(page);
  const labels = page.locator(".hs-label:not([hidden])");
  expect(await labels.count()).toBeGreaterThanOrEqual(3);
  await page.keyboard.press("Tab");
  expect(await hudClass(page)).toContain("hs-hidden");
  await expect(page.locator(".hs-tl")).toBeHidden();
  await expect(page.locator(".hs-bl")).toBeHidden();
  await expect(page.locator(".hs-br")).toBeHidden();
  await expect(labels.first()).toBeHidden();
  await expect(page.locator(".hs-toast")).toHaveText("Interface hidden: Tab shows it again");
  await expect(page.locator(".hs-toast")).toBeVisible();
  // the view still answers keys while the HUD is hidden
  await page.keyboard.press("2");
  expect(await page.evaluate(() => (window.hyperscope.state!() as { view: { picture: { model: string } } }).view.picture.model)).toBe("klein");
  await page.keyboard.press("Tab");
  expect(await hudClass(page)).not.toContain("hs-hidden");
  await expect(page.locator(".hs-tl")).toBeVisible();
  await expect(page.locator(".hs-title")).toContainText("Klein disk");
  expect(await labels.count()).toBeGreaterThanOrEqual(1);
});

test("F1 and ? open the help, Esc and its close button shut it, and it holds off the fade", async ({ page }) => {
  await open(page);
  const help = page.locator(".hs-help");
  await expect(help).toBeHidden();
  await page.keyboard.press("F1");
  await expect(help).toBeVisible();
  await expect(help).toContainText("Poincaré disk, Klein disk, half-plane, local view");
  await expect(help).toContainText("mandelscope (MIT)");
  await page.waitForTimeout(3000);
  expect(await hudClass(page)).toBe("");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await page.keyboard.press("?");
  await expect(help).toBeVisible();
  await page.locator(".hs-help .hs-close").click();
  await expect(help).toBeHidden();
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the grid's labels keep out of the readouts, and the long title wraps between its parts", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Shift+C"); // the Unit grid preset, in km
  await page.keyboard.press("4");
  await page.mouse.move(320, 240);
  await page.mouse.wheel(0, -1200);
  await refined(page);
  const title = page.locator(".hs-title");
  await expect(title).toHaveText("Unit grid · Local view · Cartesian grid, R = 1 km");
  // no part is broken inside: each sits on one line
  for (const part of await title.locator(".hs-part").all()) {
    const lines = await part.evaluate((e) => e.getClientRects().length);
    expect(lines, (await part.textContent()) ?? "").toBe(1);
  }
  const overlaps = await page.evaluate(() => {
    const boxes = [".hs-tl", ".hs-bl", ".hs-br"].map((s) => document.querySelector(s)!.getBoundingClientRect());
    return [...document.querySelectorAll<HTMLElement>(".hs-label:not([hidden])")]
      .filter((l) => {
        const r = l.getBoundingClientRect();
        return boxes.some((b) => r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom);
      })
      .map((l) => l.textContent);
  });
  expect(overlaps).toEqual([]);
  expect(await page.locator(".hs-label:not([hidden])").count()).toBeGreaterThanOrEqual(4);
});

test("the accent colour reaches the controls", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("hud")!).getPropertyValue("--accent").trim())).toBe("#8fd3ff");
});
