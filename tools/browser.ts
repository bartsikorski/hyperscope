// Browser launch options shared by `npm run bench` and `npm run ab`: headless with software WebGL
// (SwiftShader) by default; `--headed` opens a window on the graphics card; `--channel msedge` or
// `--channel chrome` uses that installed browser instead of Playwright's Chromium.
import type { LaunchOptions } from "@playwright/test";

export function launchOptions(argv: string[]): LaunchOptions {
  const headed = argv.includes("--headed");
  const at = argv.indexOf("--channel");
  const channel = at > 0 ? argv[at + 1] : undefined;
  return {
    headless: !headed,
    channel,
    args: headed ? ["--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  };
}
