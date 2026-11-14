// The browser tests' own `test`: every page starts with no game controller, whatever is plugged
// into the machine that runs them. A connected controller is read every frame, so it keeps the
// render loop busy (Controls.busy), and a stick that rests a little off centre moves the view; on a
// PC with a controller attached that broke the tests that wait for a still picture or check where
// the view is. gamepad.spec.ts scripts its own pad and keeps Playwright's plain `test`.

import { test as base, type Browser, type BrowserContext, type BrowserContextOptions } from "@playwright/test";

/** Hide the machine's controllers from the page: no pads, and no connect or disconnect events. */
export function noGamepads(): void {
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, value: () => [] });
  for (const type of ["gamepadconnected", "gamepaddisconnected"]) window.addEventListener(type, (e) => e.stopImmediatePropagation(), true);
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(noGamepads);
    await use(context);
  },
});

/** A new browser context (nothing kept from the test's own), with the controllers hidden too. */
export async function freshContext(browser: Browser, options: BrowserContextOptions): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await context.addInitScript(noGamepads);
  return context;
}

export { expect } from "@playwright/test";
