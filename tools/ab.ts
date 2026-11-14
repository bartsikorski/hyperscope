// Runs the A/B page (bench/ab.html) in Chromium and saves the report: `npm run ab` (headless,
// software WebGL here), `npm run ab -- --headed` (a window on your graphics card), with
// `--channel msedge` or `--channel chrome` to use the browser already installed instead of
// Playwright's own. `--only fold-dihedral,grid-pass` runs only those. Reports go to
// bench/results/<date>_<renderer>_ab.json (_ab_<names> with --only) and a readable .txt beside it.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import type { AbReport, AbRow } from "../bench/ab.ts";
import { formatRow, HEADER } from "../bench/format.ts";
import { launchOptions } from "./browser.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const only = arg("--only")?.split(",");
const server = await createServer({ server: { port: 5174, strictPort: false, hmr: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls!.local[0];
const browser = await chromium.launch(launchOptions(process.argv));
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  await page.goto(url + "bench/ab.html");
  await page.waitForFunction(() => "hyperscopeAB" in window);
  page.on("console", (m) => { if (!m.text().includes("GL Driver Message")) console.log(m.text()); });
  console.log(HEADER);
  await page.exposeFunction("abRow", (r: AbRow) => console.log(formatRow(r)));
  const report = (await page.evaluate((only) => {
    const w = window as unknown as { hyperscopeAB: (o?: string[], f?: (r: unknown) => void) => Promise<unknown>; abRow: (r: unknown) => void };
    return w.hyperscopeAB(only, (r) => w.abRow(r));
  }, only)) as AbReport;
  mkdirSync("bench/results", { recursive: true });
  const slug = report.renderer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const file = `bench/results/${report.date.slice(0, 10)}_${slug}_ab${only ? `_${only.join("+")}` : ""}`;
  writeFileSync(`${file}.json`, JSON.stringify(report, null, 1));
  writeFileSync(`${file}.txt`, `${report.renderer}\n${report.userAgent}\n${report.width} x ${report.height}, ${report.date}\n\n${HEADER}\n${report.rows.map(formatRow).join("\n")}\n`);
  console.log(`\n${report.renderer}\n${file}.json\n${file}.txt`);
} finally {
  await browser.close();
  await server.close();
}
