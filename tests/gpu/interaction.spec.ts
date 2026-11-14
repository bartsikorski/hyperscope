// Scripted input in the real page (design: Tests, "GPU: interaction"): the grabbed point must stay
// under the cursor within 0.5 px through drags, wheel zooms, rotation and keys.

import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { H3_HOME, tiltWith } from "../../src/math/views.ts";

type Probe = { folded: [number, number, number]; colour: number };

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
}

const probe = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => window.hyperscope.probe!(x, y), [x, y]) as Promise<Probe>;
const unitAt = (page: Page, x: number, y: number) => page.evaluate(([x, y]) => window.hyperscope.unitAt!(x, y), [x, y]);
const settle = (page: Page) => page.waitForFunction(() => !window.hyperscope.busy!(), undefined, { timeout: 10_000 });
const picture = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { view: { picture: { s: number; sigma: number; c: number[] } } }).view.picture);

/** Distance between two probes in screen pixels at (x, y); folded points are compared, so the
 *  re-centering symmetries applied in between do not matter. */
async function pixelsApart(page: Page, a: Probe, b: Probe, x: number, y: number) {
  expect(b.colour).toBe(a.colour);
  const d = Math.hypot(a.folded[0] - b.folded[0], a.folded[1] - b.folded[1], a.folded[2] - b.folded[2]);
  return d / (await unitAt(page, x, y));
}

test("a drag keeps the grabbed point under the cursor", async ({ page }) => {
  await open(page);
  const before = await probe(page, 400, 270);
  await page.mouse.move(400, 270);
  await page.mouse.down();
  await page.mouse.move(250, 180, { steps: 12 });
  expect(await pixelsApart(page, before, await probe(page, 250, 180), 250, 180)).toBeLessThan(0.5);
  await page.waitForTimeout(120); // rest before release: no glide
  await page.mouse.up();
  await settle(page);
  expect(await pixelsApart(page, before, await probe(page, 250, 180), 250, 180)).toBeLessThan(0.5);
});

test("a fast drag glides on after release and comes to rest", async ({ page }) => {
  await open(page);
  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.mouse.move(420, 240, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.hyperscope.busy!())).toBe(true);
  await settle(page);
});

test("wheel zooms in and out about the cursor", async ({ page }) => {
  await open(page);
  const at = [430, 300] as const;
  const before = await probe(page, ...at);
  const s0 = (await picture(page)).s;
  await page.mouse.move(...at);
  await page.mouse.wheel(0, -600); // 2^3 in
  await settle(page);
  expect((await picture(page)).s).toBeCloseTo(s0 / 8, 6);
  expect(await pixelsApart(page, before, await probe(page, ...at), ...at)).toBeLessThan(0.5);
  await page.mouse.wheel(0, 200); // 2x out
  await settle(page);
  expect((await picture(page)).s).toBeCloseTo(s0 / 4, 6);
  expect(await pixelsApart(page, before, await probe(page, ...at), ...at)).toBeLessThan(0.5);
});

test("double-click zooms 4x into the point", async ({ page }) => {
  await open(page);
  const before = await probe(page, 260, 200);
  const s0 = (await picture(page)).s;
  await page.mouse.dblclick(260, 200);
  await settle(page);
  expect((await picture(page)).s).toBeCloseTo(s0 / 4, 6);
  expect(await pixelsApart(page, before, await probe(page, 260, 200), 260, 200)).toBeLessThan(0.5);
});

test("right-drag rotates the grabbed point around the centre", async ({ page }) => {
  await open(page);
  const [cx, cy, r] = [320, 240, 150];
  const a = 0.3;
  const b = a + 0.7;
  const pa = [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  const pb = [cx + r * Math.cos(b), cy - r * Math.sin(b)] as const;
  const before = await probe(page, ...pa);
  await page.mouse.move(...pa);
  await page.mouse.down({ button: "right" });
  for (let i = 1; i <= 10; i++) {
    const t = a + ((b - a) * i) / 10;
    await page.mouse.move(cx + r * Math.cos(t), cy - r * Math.sin(t));
  }
  await page.waitForTimeout(120);
  await page.mouse.up({ button: "right" });
  await settle(page);
  // home view: the disk is centred, so rotation about the centre is a rigid turn on screen; the mouse
  // lands on whole pixels, so allow the rounding of the end point
  expect(await pixelsApart(page, before, await probe(page, ...pb), ...pb)).toBeLessThan(0.9);
});

test("keys: + zooms at the centre, held D pans, C changes the tiling, H goes home", async ({ page }) => {
  await open(page);
  const centre = await probe(page, 320, 240);
  const s0 = (await picture(page)).s;
  await page.keyboard.press("+");
  await settle(page);
  expect((await picture(page)).s).toBeCloseTo(s0 / 2, 6);
  expect(await pixelsApart(page, centre, await probe(page, 320, 240), 320, 240)).toBeLessThan(0.5);
  await page.keyboard.down("d");
  await page.waitForTimeout(300);
  await page.keyboard.up("d");
  await settle(page);
  const moved = await probe(page, 320, 240);
  expect(Math.hypot(moved.folded[0] - centre.folded[0], moved.folded[1] - centre.folded[1])).toBeGreaterThan(1e-3);
  await page.keyboard.press("c");
  await settle(page);
  expect(await page.evaluate(() => (window.hyperscope.state!() as { content: { group: number[] } }).content.group)).toEqual([5, 4, 2]);
  await page.keyboard.press("h");
  await settle(page);
  const st = (await page.evaluate(() => window.hyperscope.state!())) as { view: { camera: number[]; picture: { s: number } } };
  expect(st.view.camera).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  expect(st.view.picture.s).toBe(s0);
});

test("long travel keeps the camera small (re-centering)", async ({ page }) => {
  await open(page);
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(470, 240);
    await page.mouse.down();
    await page.mouse.move(170, 240, { steps: 4 });
    await page.waitForTimeout(60);
    await page.mouse.up();
  }
  await settle(page);
  const cam = (await page.evaluate(() => (window.hyperscope.state!() as { view: { camera: number[] } }).view.camera)) as number[];
  expect(Math.max(...cam.map(Math.abs))).toBeLessThan(10);
});

const model = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { view: { picture: { model: string } } }).view.picture.model);

test("keys 1 to 4 switch the view in place, keeping the point at the centre", async ({ page }) => {
  await open(page);
  await page.mouse.move(400, 200);
  await page.mouse.wheel(0, -200);
  await settle(page);
  const centre = await probe(page, 320, 240);
  const unit = await unitAt(page, 320, 240);
  for (const [key, name, label] of [["2", "klein", "Klein disk"], ["3", "halfplane", "Half-plane"], ["4", "local", "Local view"], ["1", "poincare", "Poincaré disk"]]) {
    await page.keyboard.press(key);
    await settle(page);
    expect(await model(page)).toBe(name);
    await expect(page.locator(".hs-title")).toContainText(label);
    // same world point at the centre, same plane length per pixel there
    expect(await pixelsApart(page, centre, await probe(page, 320, 240), 320, 240)).toBeLessThan(0.01);
    expect((await unitAt(page, 320, 240)) / unit).toBeCloseTo(1, 9);
    expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  }
});

for (const [key, name] of [["2", "klein"], ["3", "halfplane"], ["4", "local"]]) {
  test(`${name}: drag and wheel keep the grabbed point under the cursor`, async ({ page }) => {
    await open(page);
    await page.keyboard.press(key);
    await settle(page);
    expect(await model(page)).toBe(name);
    // a drag (points above the half-plane's boundary line, which sits 0.48 of the half-height down)
    const before = await probe(page, 400, 270);
    await page.mouse.move(400, 270);
    await page.mouse.down();
    await page.mouse.move(260, 190, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await settle(page);
    expect(await pixelsApart(page, before, await probe(page, 260, 190), 260, 190)).toBeLessThan(0.5);
    // a wheel zoom 2^3 in, then 2x out
    const at = [430, 230] as const;
    const grabbed = await probe(page, ...at);
    const u0 = await unitAt(page, 320, 240);
    await page.mouse.move(...at);
    await page.mouse.wheel(0, -600);
    await settle(page);
    expect(await pixelsApart(page, grabbed, await probe(page, ...at), ...at)).toBeLessThan(0.5);
    expect((await unitAt(page, 320, 240)) / u0).toBeLessThan(0.25);
    await page.mouse.wheel(0, 200);
    await settle(page);
    expect(await pixelsApart(page, grabbed, await probe(page, ...at), ...at)).toBeLessThan(0.5);
    // H goes home in the same view
    await page.keyboard.press("h");
    await settle(page);
    expect(await model(page)).toBe(name);
  });
}

test("keys L (or . and ,), P and K switch the look, the palette and the colouring, each with a note", async ({ page }) => {
  await open(page);
  const toast = page.locator(".hs-toast");
  const content = () => page.evaluate(() => (window.hyperscope.state!() as { content: { colouring: string; look: { palette: string; lineColour: string } } }).content);
  expect((await content()).look.palette).toBe("Gilded tiles");
  await page.keyboard.press("l");
  await settle(page);
  await expect(toast).toHaveText("Look: Escher");
  expect((await content()).look.palette).toBe("Escher");
  await page.keyboard.press("Shift+L");
  await settle(page);
  await expect(toast).toHaveText("Look: Gilded");
  await page.keyboard.press(".");
  await expect(toast).toHaveText("Look: Escher");
  await page.keyboard.press(",");
  await expect(toast).toHaveText("Look: Gilded");
  expect((await content()).look.palette).toBe("Gilded tiles");
  await page.keyboard.press("p");
  await settle(page);
  await expect(toast).toHaveText("Palette: Escher");
  expect((await content()).look).toMatchObject({ palette: "Escher", lineColour: "#f2c14e" });
  // the heptagons have only the parity colouring: K cycles on the next tiling, which has six
  await page.keyboard.press("c");
  await settle(page);
  await expect(page.locator(".hs-title")).toContainText("{5,4} pentagons");
  const before = (await content()).colouring;
  await page.keyboard.press("k");
  await settle(page);
  expect((await content()).colouring).not.toBe(before);
  await expect(toast).toContainText(/^(Parity|Faces|Colouring \d+), \d colours$/);
  await page.keyboard.press("Shift+K");
  await settle(page);
  expect((await content()).colouring).toBe(before);
  expect((await content()).look.palette).toBe("Escher"); // C keeps the look and palette
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

type Label = { text: string; x: number; y: number };
/** The grid's labels on the screen: text and the point where the text is anchored (left, bottom). */
const labelsOf = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".hs-label:not([hidden])")].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent!, x: r.left, y: r.bottom };
    }),
  ) as Promise<Label[]>;
const gridState = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { content: { grid?: { on: boolean; kind: string; unit: string }; plain?: boolean } }).content);

test("keys G, T and U turn the grid on and switch its type and size of R", async ({ page }) => {
  await open(page);
  const status = page.locator(".hs-title");
  await expect(status).not.toContainText("grid,");
  expect(await labelsOf(page)).toHaveLength(0);
  await page.keyboard.press("g");
  await settle(page);
  await expect(status).toContainText("Cartesian grid, R = Earth's radius");
  expect((await gridState(page)).grid).toEqual({ on: true, kind: "cartesian", unit: "earth" });
  expect((await labelsOf(page)).length).toBeGreaterThanOrEqual(3);
  for (const kind of ["polar", "horocyclic", "Cartesian"]) {
    await page.keyboard.press("t");
    await settle(page);
    await expect(status).toContainText(`${kind} grid`);
    await expect(page.locator(".hs-toast")).toHaveText(`${kind[0].toUpperCase()}${kind.slice(1)} grid`);
    expect((await labelsOf(page)).length).toBeGreaterThanOrEqual(3);
  }
  await page.keyboard.press("u");
  await settle(page);
  await expect(status).toContainText("Cartesian grid, R = 1 km");
  expect((await labelsOf(page)).some((l) => / (k?m|mm|µm)$/.test(l.text))).toBe(true);
  await page.keyboard.press("Shift+U");
  await settle(page);
  await expect(status).toContainText("R = Earth's radius");
  // G again hides the grid and its labels, keeping its type and unit
  await page.keyboard.press("g");
  await settle(page);
  await expect(status).not.toContainText("grid,");
  expect(await labelsOf(page)).toHaveLength(0);
  expect((await gridState(page)).grid).toEqual({ on: false, kind: "cartesian", unit: "earth" });
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

test("the grid's labels follow a drag", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Shift+C"); // the Unit grid preset
  await page.keyboard.press("4"); // the local view, nearly flat at this zoom
  await page.mouse.move(320, 240);
  await page.mouse.wheel(0, -1200); // 2^6 in
  await settle(page);
  await expect(page.locator(".hs-title")).toContainText("Unit grid");
  const before = await labelsOf(page);
  const [dx, dy] = [-70, 45];
  await page.mouse.move(330, 250);
  await page.mouse.down();
  await page.mouse.move(330 + dx, 250 + dy, { steps: 10 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await settle(page);
  const after = await labelsOf(page);
  // a label still on the screen moved with its line: the left ones by dy, the bottom ones by dx
  // (the same value can be on both edges, so labels are matched on their own edge)
  const onLeft = (l: Label) => l.x < 40;
  const onBottom = (l: Label) => !onLeft(l) && l.y > 440;
  let left = 0;
  let bottom = 0;
  for (const a of after) {
    const b = before.find((l) => l.text === a.text && onLeft(l) === onLeft(a) && onBottom(l) === onBottom(a));
    if (!b) continue;
    if (onLeft(a)) {
      expect(a.y - b.y, a.text).toBeCloseTo(dy, 0);
      left++;
    } else if (onBottom(a)) {
      expect(a.x - b.x, a.text).toBeCloseTo(dx, 0);
      bottom++;
    }
  }
  expect(left).toBeGreaterThanOrEqual(1);
  expect(bottom).toBeGreaterThanOrEqual(1);
});

test("plain content zooms past the tiling limit, and a tiling zooms back out to its own", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Shift+C");
  await settle(page);
  expect((await gridState(page)).plain).toBe(true);
  await page.mouse.move(320, 240);
  for (let i = 0; i < 6 && (await unitAt(page, 320, 240)) > 1e-9; i++) {
    await page.mouse.wheel(0, -2000); // 2^10 in
    await settle(page);
  }
  const deep = await unitAt(page, 320, 240);
  expect(deep).toBeLessThan(1e-9);
  expect(deep).toBeGreaterThanOrEqual(1e-11 * 0.999);
  // the labels read a 10 micrometre grid or finer in R = Earth's radius
  expect((await labelsOf(page)).length).toBeGreaterThanOrEqual(3);
  await page.keyboard.press("c"); // back to the first tiling, at its own zoom limit
  await settle(page);
  expect((await gridState(page)).plain).toBeFalsy();
  expect(await unitAt(page, 320, 240)).toBeGreaterThanOrEqual(1e-5 * 0.999);
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});

type Eye = { model: string; h: number; pitch: number; fov: number };
const eye = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { view: { picture: Eye } }).view.picture);
const cameraOf = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { view: { camera: number[] } }).view.camera);

test("inside H3 (key 5): the centre's point kept, the ground held through drags and wheel zooms, keys walk and turn", async ({ page }) => {
  await open(page);
  const centre = await probe(page, 320, 240);
  await page.keyboard.press("5");
  await settle(page);
  expect(await model(page)).toBe("h3");
  await expect(page.locator(".hs-title")).toContainText("Inside H³");
  // the HUD reads the eye's height in place of the magnification
  await expect(page.locator(".hs-mag-key")).toHaveText("Eye height");
  await expect(page.locator(".hs-eye")).toHaveText(/^0\.300 ?\s?R$/);
  await expect(page.locator(".hs-eye-detail")).toContainText("horizon 16.9° down");
  expect(await pixelsApart(page, centre, await probe(page, 320, 240), 320, 240)).toBeLessThan(0.01);
  // a drag on the ground below the centre keeps the grabbed point under the cursor
  const before = await probe(page, 400, 330);
  await page.mouse.move(400, 330);
  await page.mouse.down();
  await page.mouse.move(300, 360, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await settle(page);
  expect(await pixelsApart(page, before, await probe(page, 300, 360), 300, 360)).toBeLessThan(0.5);
  // a wheel zoom 2^3 in lowers the eye 8 times and holds the ground under the cursor; 2x out
  const at = [430, 330] as const;
  const grabbed = await probe(page, ...at);
  await page.mouse.move(...at);
  await page.mouse.wheel(0, -600);
  await settle(page);
  expect((await eye(page)).h).toBeCloseTo(0.3 / 8, 9);
  // the view lifts toward the horizon as the eye comes down (design notes: the view tilts with the zoom)
  expect((await eye(page)).pitch).toBeCloseTo(tiltWith(H3_HOME.pitch, 0.3, 0.3 / 8), 9);
  expect(await pixelsApart(page, grabbed, await probe(page, ...at), ...at)).toBeLessThan(0.5);
  await page.mouse.wheel(0, 200);
  await settle(page);
  expect((await eye(page)).h).toBeCloseTo(0.3 / 4, 9);
  expect((await eye(page)).pitch).toBeCloseTo(tiltWith(H3_HOME.pitch, 0.3, 0.3 / 4), 9);
  expect(await pixelsApart(page, grabbed, await probe(page, ...at), ...at)).toBeLessThan(0.5);
  // held W walks forward: the camera moves, the eye keeps its height and pitch
  const cam = await cameraOf(page);
  const e0 = await eye(page);
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  await settle(page);
  expect(await cameraOf(page)).not.toEqual(cam);
  expect(await eye(page)).toEqual(e0);
  // a right-drag up looks up (the pitch drops); Q and E turn, leaving the pitch alone
  await page.mouse.move(320, 300);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(320, 260, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await settle(page);
  const e1 = await eye(page);
  expect(e1.pitch).toBeLessThan(e0.pitch - 0.05);
  await page.keyboard.down("q");
  await page.waitForTimeout(200);
  await page.keyboard.up("q");
  await settle(page);
  expect((await eye(page)).pitch).toBe(e1.pitch);
  // H goes home inside H3: the start point at the centre again, from the home eye
  await page.keyboard.press("h");
  await settle(page);
  expect(await eye(page)).toMatchObject({ model: "h3", h: 0.3 });
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
  // and key 1 back to the disk keeps the centre's point
  const inside = await probe(page, 320, 240);
  await page.keyboard.press("1");
  await settle(page);
  expect(await model(page)).toBe("poincare");
  expect(await pixelsApart(page, inside, await probe(page, 320, 240), 320, 240)).toBeLessThan(0.01);
});

type Orbit = { model: string; elevation: number; distance: number; fov: number };
const orbitOf = (page: Page) => page.evaluate(() => (window.hyperscope.state!() as { view: { picture: Orbit } }).view.picture);

test("the hyperboloid (key 6): the centre's point at the vertex, the surface held through drags and wheel zooms, right-drag orbits", async ({ page }) => {
  await open(page);
  const centre = await probe(page, 320, 240);
  await page.keyboard.press("6");
  await settle(page);
  expect(await model(page)).toBe("hyperboloid");
  await expect(page.locator(".hs-title")).toContainText("Hyperboloid");
  // the HUD reads the orbit's distance in place of the magnification
  await expect(page.locator(".hs-mag-key")).toHaveText("Orbit distance");
  await expect(page.locator(".hs-eye")).toHaveText(/^5\.00\s?R$/);
  await expect(page.locator(".hs-eye-detail")).toHaveText("elevation 55.0°");
  expect(await pixelsApart(page, centre, await probe(page, 320, 240), 320, 240)).toBeLessThan(0.01);
  // a drag keeps the grabbed point under the cursor
  const before = await probe(page, 400, 300);
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(330, 330, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await settle(page);
  expect(await pixelsApart(page, before, await probe(page, 330, 330), 330, 330)).toBeLessThan(0.5);
  // a wheel zoom 2 in halves the orbit's distance and holds the point under the cursor
  const at = [380, 280] as const;
  const grabbed = await probe(page, ...at);
  await page.mouse.move(...at);
  await page.mouse.wheel(0, -200);
  await settle(page);
  expect((await orbitOf(page)).distance).toBeCloseTo(2.5, 9);
  expect(await pixelsApart(page, grabbed, await probe(page, ...at), ...at)).toBeLessThan(0.5);
  // a right-drag down raises the camera; Q turns, leaving the orbit alone
  const o0 = await orbitOf(page);
  await page.mouse.move(320, 260);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(320, 300, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await settle(page);
  const o1 = await orbitOf(page);
  expect(o1.elevation).toBeGreaterThan(o0.elevation + 0.05);
  expect(o1.distance).toBe(o0.distance);
  const cam = await cameraOf(page);
  await page.keyboard.down("q");
  await page.waitForTimeout(200);
  await page.keyboard.up("q");
  await settle(page);
  expect(await cameraOf(page)).not.toEqual(cam);
  expect(await orbitOf(page)).toEqual(o1);
  // the way out and back in finds the orbit again; H goes home
  const vertex = await probe(page, 320, 240);
  await page.keyboard.press("1");
  await settle(page);
  expect(await pixelsApart(page, vertex, await probe(page, 320, 240), 320, 240)).toBeLessThan(0.01);
  await page.keyboard.press("6");
  await settle(page);
  expect(await orbitOf(page)).toEqual(o1);
  await page.keyboard.press("h");
  await settle(page);
  expect(await orbitOf(page)).toMatchObject({ model: "hyperboloid", distance: 5 });
  expect(await page.evaluate(() => window.hyperscope.error)).toBeUndefined();
});
