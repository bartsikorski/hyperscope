// Runs the benchmark page in Chromium and saves the report: `npm run bench` (headless, software
// WebGL here), `npm run bench -- --headed` (a visible window on your graphics card; add `--channel
// msedge` or `chrome` to use the installed browser). Reports go to
// bench/results/<date>_<renderer>[_<tag>].json; `-- --tag step7` adds the tag.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import type { BenchReport } from "../bench/bench.ts";
import { launchOptions } from "./browser.ts";

const tagAt = process.argv.indexOf("--tag");
const tag = tagAt > 0 ? `_${process.argv[tagAt + 1]}` : "";
const server = await createServer({ server: { port: 5174, strictPort: false, hmr: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls!.local[0];
const browser = await chromium.launch(launchOptions(process.argv));
try {
  const page = await browser.newPage();
  await page.goto(url + "bench/");
  await page.waitForFunction(() => "hyperscopeBench" in window);
  // the driver notes about read-back stalls are the synchronisation the timing relies on
  page.on("console", (m) => { if (!m.text().includes("GL Driver Message")) console.log(m.text()); });
  const report = (await page.evaluate(() =>
    (window as unknown as { hyperscopeBench: () => Promise<unknown> }).hyperscopeBench(),
  )) as BenchReport;
  mkdirSync("bench/results", { recursive: true });
  const slug = report.renderer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const file = `bench/results/${report.date.slice(0, 10)}_${slug}${tag}.json`;
  writeFileSync(file, JSON.stringify(report, null, 1));
  console.log(`${report.renderer}\n`);
  console.log(`${"scene".padEnd(52)} size        ms/sample  samples/s  inside  refl/px  sweeps/px`);
  for (const r of report.results)
    console.log(`${r.name.padEnd(52)} ${`${r.width}x${r.height}`.padEnd(11)} ${r.ms.toFixed(2).padStart(9)} ${(1000 / r.ms).toFixed(1).padStart(10)} ${`${Math.round(100 * r.coverage)}%`.padStart(7)} ${r.reflections.toFixed(2).padStart(8)} ${r.sweeps.toFixed(2).padStart(10)}`);
  console.log(`\n${file}`);
} finally {
  await browser.close();
  await server.close();
}
