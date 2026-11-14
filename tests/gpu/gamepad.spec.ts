// A scripted game controller in the real page (design notes, "After version 1: game controller"):
// navigator.getGamepads is replaced before the app loads by a pad the test moves.

import { expect, test, type Page } from "@playwright/test";

type Pad = { axes: number[]; down: number[]; lt: number; rt: number };
type ViewOf = { view: { picture: { model: string } } };

async function open(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { pad: Pad | null };
    w.pad = null;
    navigator.getGamepads = () => {
      const p = w.pad;
      if (!p) return [];
      const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: p.down.includes(i), touched: false, value: i === 6 ? p.lt : i === 7 ? p.rt : p.down.includes(i) ? 1 : 0 }));
      return [{ index: 0, id: "scripted pad", mapping: "standard", connected: true, timestamp: performance.now(), axes: p.axes, buttons } as unknown as Gamepad];
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
}

/** Set the pad (the first call also announces it, as a browser does on the first press). */
const setPad = (page: Page, p: Partial<Pad>) =>
  page.evaluate((p) => {
    const w = window as unknown as { pad: Pad | null };
    const first = w.pad === null;
    w.pad = { axes: [0, 0, 0, 0], down: [], lt: 0, rt: 0, ...p };
    if (first) window.dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: { mapping: "standard" } }));
  }, p);
const state = (page: Page) => page.evaluate(() => window.hyperscope.state!() as ViewOf);
const centre = (page: Page) => page.evaluate(() => window.hyperscope.probe!(innerWidth / 2, innerHeight / 2));
/** Plane length per pixel at the centre: smaller when zoomed in. */
const footprint = (page: Page) => page.evaluate(() => window.hyperscope.unitAt!(innerWidth / 2, innerHeight / 2));

test("the left stick pans, the right stick rotates and zooms, the triggers zoom", async ({ page }) => {
  await open(page);
  const before = await centre(page);
  const s0 = await footprint(page);
  await setPad(page, { axes: [0.9, 0, 0, 0] });
  await page.waitForTimeout(400);
  await setPad(page, {});
  const moved = await centre(page);
  expect(moved!.folded).not.toEqual(before!.folded);
  await expect(page.locator(".hs-toast")).toContainText("Controller connected");

  // held until the zoom shows (the software renderer's frames are slow), then let go
  const zoomTo = async (p: Partial<Pad>, test: string, arg: number) => {
    await setPad(page, p);
    await page.waitForFunction(([test, arg]) => {
      const f = window.hyperscope.unitAt!(innerWidth / 2, innerHeight / 2);
      return test === "below" ? f < arg : f > arg;
    }, [test, arg] as const, { timeout: 10_000 });
    await setPad(page, {});
  };
  await zoomTo({ rt: 1 }, "below", s0 / 2);
  const s1 = await footprint(page);
  await zoomTo({ axes: [0, 0, 0, 1] }, "above", s1 * 2); // right stick down: zoom out
  const aside = () => page.evaluate(() => window.hyperscope.probe!(innerWidth / 2 + 150, innerHeight / 2));
  const side = await aside();
  const still = await centre(page);
  await setPad(page, { axes: [0, 0, 1, 0] }); // right stick right: rotate about the centre
  await page.waitForTimeout(300);
  await setPad(page, {});
  expect((await aside())!.folded).not.toEqual(side!.folded);
  // the centre stays put, up to the rounding of the camera's renormalisation each frame
  const after = (await centre(page))!.folded;
  after.forEach((x: number, i: number) => expect(Math.abs(x - still!.folded[i])).toBeLessThan(1e-12));
});

test("A switches the view, B goes back, and with the sticks at rest the picture refines and stops", async ({ page }) => {
  await open(page);
  expect((await state(page)).view.picture.model).toBe("poincare");
  await setPad(page, { down: [0] });
  await page.waitForFunction(() => (window.hyperscope.state!() as ViewOf).view.picture.model === "klein");
  await setPad(page, {});
  await setPad(page, { down: [1] });
  await page.waitForFunction(() => (window.hyperscope.state!() as ViewOf).view.picture.model === "poincare");
  await setPad(page, {});
  // still connected, so the page keeps reading the pad, but nothing moves and drawing stops
  await page.waitForFunction(() => !window.hyperscope.busy!() && !window.hyperscope.refining!(), undefined, { timeout: 30_000 });
  expect((await page.evaluate(() => window.hyperscope.progress!())).samples).toBe(16);
  const frames = await page.evaluate(() => window.hyperscope.frames!);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.hyperscope.frames!)).toBe(frames);
});
