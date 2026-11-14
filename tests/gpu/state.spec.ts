// The history of views, the saved session, the address bar and the clipboard in the real page
// (design notes, step 9: History, saved session, the address bar, the clipboard): back and forward
// return to views bit for bit, a link opened in a new page and a reload restore the state exactly,
// the address bar follows without adding browser history, and Ctrl+C / Ctrl+V carry links.

import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { fromLink, save } from "../../src/state/saved.ts";

async function open(page: Page, url = "/") {
  await page.goto(url);
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
}

const refined = (page: Page) => page.waitForFunction(() => !window.hyperscope.busy!() && !window.hyperscope.refining!(), undefined, { timeout: 60_000 });
/** The state in its saved form, as JSON: equal strings are the same state bit for bit. */
const saved = (page: Page) => page.evaluate(() => window.hyperscope.saved!());
const model = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { view: { picture: { model: string } } }).view.picture.model);
const distance = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { view: { grids: { polar: { e: number } } } }).view.grids.polar.e);
const group = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { content: { group: number[] } }).content.group);
const toast = (page: Page) => page.locator(".hs-toast");
/** Activity first, so a click never waits on the faded icon row. */
const poke = (page: Page) => page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove")));
const backButton = (page: Page) => page.locator('.hs-toolbar [aria-label="Back"]');
const forwardButton = (page: Page) => page.locator('.hs-toolbar [aria-label="Forward"]');

async function drag(page: Page, dx: number, dy: number) {
  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.mouse.move(320 + dx, 240 + dy, { steps: 6 });
  await page.waitForTimeout(150); // rest before release: no glide
  await page.mouse.up();
  await refined(page);
}

/** A view away from home: panned, zoomed and turned, with another look and the grid on. */
async function wander(page: Page) {
  await drag(page, -120, 40);
  await page.mouse.move(400, 200);
  await page.mouse.wheel(0, -300);
  await refined(page);
  await page.keyboard.press("q");
  await page.waitForTimeout(200);
  await refined(page);
  await page.keyboard.press("l");
  await page.keyboard.press("g");
  await refined(page);
}

test("back and forward step through the views, with the buttons and the keys", async ({ page }) => {
  await open(page);
  await expect(backButton(page)).toBeDisabled();
  await drag(page, -150, 0);
  const away = await saved(page);
  expect(await distance(page)).toBeGreaterThan(0.3);
  // the move is in the history once the view has rested
  await expect(backButton(page)).toBeEnabled();
  await expect(forwardButton(page)).toBeDisabled();
  await poke(page);
  await backButton(page).click();
  await expect.poll(() => distance(page)).toBe(0);
  await expect(backButton(page)).toBeDisabled();
  await expect(forwardButton(page)).toBeEnabled();
  await poke(page);
  await forwardButton(page).click();
  await expect.poll(() => saved(page)).toBe(away);
  // a jump keeps the view it leaves: the Klein disk, then Backspace and Shift+Backspace
  await page.keyboard.press("2");
  await expect.poll(() => model(page)).toBe("klein");
  await page.keyboard.press("Backspace");
  await expect.poll(() => saved(page)).toBe(away);
  await page.keyboard.press("Shift+Backspace");
  await expect.poll(() => model(page)).toBe("klein");
  // back once more, then a move: the views ahead are gone
  await page.keyboard.press("Backspace");
  await expect.poll(() => model(page)).toBe("poincare");
  await drag(page, 0, 80);
  await expect(forwardButton(page)).toBeDisabled();
  await page.keyboard.press("Shift+Backspace");
  await page.waitForTimeout(100);
  expect(await model(page)).toBe("poincare");
  // the history holds views, not settings: going back keeps the look
  await page.keyboard.press("l");
  await refined(page);
  const look = JSON.parse(await saved(page)).content.look;
  await page.keyboard.press("Backspace");
  await expect.poll(() => saved(page)).toBe(JSON.stringify({ ...JSON.parse(away), content: { ...JSON.parse(away).content, look } }));
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("a link opened in a new page restores the state bit for bit", async ({ page, context }) => {
  await open(page);
  await wander(page);
  const state = await saved(page);
  // the address bar follows within 300 ms
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("cam=");
  const link = await page.evaluate(() => location.href);
  const other = await context.newPage();
  await open(other, link);
  expect(await saved(other)).toBe(state);
  await other.close();
  // and in a fresh browser with nothing saved
  const fresh = await (await context.browser()!.newContext({ baseURL: "http://localhost:5173", viewport: { width: 640, height: 480 } })).newPage();
  await open(fresh, link);
  expect(await saved(fresh)).toBe(state);
  await fresh.context().close();
});

test("a reload restores the session; a link that cannot be read falls back to it, with a note", async ({ page }) => {
  await open(page);
  await wander(page);
  const state = await saved(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("hyperscope.session"))).toBe(state);
  // with no link in the address, the session
  await open(page, "/");
  expect(await saved(page)).toBe(state);
  // a link from a newer version: refused with the reason, and the session instead
  await open(page, "/?again#v=99&g=7,3,2"); // a new query, so the page loads afresh
  await expect(toast(page)).toHaveText("Link not loaded: made by a newer Hyperscope (version 99)");
  expect(await saved(page)).toBe(state);
  // the address bar then shows the view
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("cam=");
});

test("without storage (a private window) the page starts at home and works", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
  await open(page);
  expect(await page.evaluate(() => { try { return !localStorage; } catch { return true; } })).toBe(true);
  expect(await distance(page)).toBe(0);
  await drag(page, -100, 0);
  expect(await distance(page)).toBeGreaterThan(0.2);
  await page.waitForTimeout(1200); // past the session write
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the address bar follows without adding browser history; editing it loads that view", async ({ page }) => {
  await open(page);
  const entries = await page.evaluate(() => history.length);
  await drag(page, -100, 30);
  await drag(page, 60, -60);
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("cam=");
  expect(await page.evaluate(() => history.length)).toBe(entries);
  const before = await saved(page);
  // a hand-written link: {5,4} in the Klein disk
  await page.evaluate(() => (location.hash = "v=1&g=5,4,2&k=parity&m=kd"));
  await expect.poll(() => group(page)).toEqual([5, 4, 2]);
  expect(await model(page)).toBe("klein");
  await expect(toast(page)).toHaveText("Link loaded");
  await expect(page.locator(".hs-title")).toHaveText("{5,4} pentagons · Klein disk");
  // loading a link is a jump: back returns to the view (the tiling stays {5,4})
  await page.keyboard.press("Backspace");
  await expect.poll(() => model(page)).toBe("poincare");
  expect(JSON.parse(await saved(page)).view.grids).toEqual(JSON.parse(before).view.grids);
  expect(await group(page)).toEqual([5, 4, 2]);
});

test("Ctrl+C copies the link and Ctrl+V opens one; in a field they are the field's", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await wander(page);
  const state = await saved(page);
  await page.keyboard.press("Control+c");
  await expect(toast(page)).toHaveText("Link to this view copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const read = fromLink(link);
  if (!read.ok) throw new Error(read.reason);
  expect(JSON.stringify(save(read.state))).toBe(state);
  // home, then the copied link pasted back
  await page.keyboard.press("h");
  await expect.poll(() => distance(page)).toBe(0);
  await page.keyboard.press("Control+v");
  await expect.poll(() => saved(page)).toBe(state);
  await expect(toast(page)).toHaveText("Link loaded");
  // a saved state as JSON loads too
  await page.keyboard.press("h");
  await page.evaluate((text) => navigator.clipboard.writeText(text), state);
  await page.keyboard.press("Control+v");
  await expect.poll(() => saved(page)).toBe(state);
  await expect(toast(page)).toHaveText("Saved state loaded");
  // text that is no link: a note, and nothing changes
  await page.evaluate(() => navigator.clipboard.writeText("hello"));
  await page.keyboard.press("Control+v");
  await expect(toast(page)).toHaveText("Not loaded: not a Hyperscope link");
  expect(await saved(page)).toBe(state);
  // in a field, Ctrl+C and Ctrl+V are the field's own
  await poke(page);
  await page.locator('.hs-toolbar [aria-label="Settings"]').click();
  await page.locator(".hs-tab", { hasText: "View" }).click();
  const x = page.getByRole("textbox", { name: "Position X" });
  await page.evaluate(() => navigator.clipboard.writeText("0.5"));
  await x.fill("");
  await x.press("Control+v");
  await expect(x).toHaveValue("0.5");
  await x.press("Control+a");
  await x.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("0.5");
  expect(await saved(page)).toBe(state);
});
