// Benchmark page (design: Tests and benchmarks): fixed scenes in every view at 1080p and 4K, plus
// the hard cases, timed per sample pass, with the folds per pixel counted on the CPU (the same
// algorithm as the shader, so the count does not depend on the machine). `npm run bench` runs it
// headless and saves the report; open /bench/ in a browser to run it on your graphics card.

import { Renderer, type FrameSpec } from "../src/render/gl.ts";
import { SIZES, foldCounts, scenes, specOf } from "./scenes.ts";

export interface BenchResult {
  name: string;
  width: number;
  height: number;
  /** Milliseconds per sample pass, the median of the timed runs. */
  ms: number;
  /** Fraction of the screen inside the picture (the rest costs almost nothing). */
  coverage: number;
  /** Mirror reflections and fold sweeps per pixel (pixels inside the picture), on a 192 x 108 grid
   *  (none for plain content, which does not fold). */
  reflections: number;
  sweeps: number;
}

export interface BenchReport {
  date: string;
  renderer: string;
  userAgent: string;
  floatTargets: boolean;
  timing: string;
  results: BenchResult[];
}

/** Median milliseconds per sample pass: one warm-up, then passes until 400 ms or 9 runs, each run
 *  ended by reading one pixel back (which waits for the GPU). */
function time(renderer: Renderer, spec: FrameSpec, width: number, height: number): number {
  const gl = renderer.gl;
  const target = renderer.createTarget(width, height);
  const px = new Uint8Array(8);
  const sync = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, renderer.floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, renderer.floatTargets ? new Uint16Array(4) : px);
  };
  renderer.sample(spec, target, 0);
  sync();
  const runs: number[] = [];
  const t0 = performance.now();
  while (runs.length < 3 || (runs.length < 9 && performance.now() - t0 < 400)) {
    const t = performance.now();
    renderer.sample(spec, target, runs.length + 1);
    sync();
    runs.push(performance.now() - t);
  }
  renderer.deleteTarget(target);
  runs.sort((a, b) => a - b);
  return runs[runs.length >> 1];
}

export async function runBench(onRow?: (r: BenchResult) => void): Promise<BenchReport> {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) throw new Error("WebGL2 is not available");
  const renderer = new Renderer(gl);
  const results: BenchResult[] = [];
  for (const s of scenes())
    for (const [width, height] of SIZES) {
      const counts = foldCounts(s, width, height);
      const ms = time(renderer, specOf(s, height), width, height);
      const r = { name: s.name, width, height, ms, ...counts };
      results.push(r);
      onRow?.(r);
      await new Promise((ok) => setTimeout(ok, 0)); // let the page update
    }
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    date: new Date().toISOString(),
    renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    userAgent: navigator.userAgent,
    floatTargets: renderer.floatTargets,
    timing: "median wall time per sample pass, synchronised by a 1-pixel read-back",
    results,
  };
}

// ---------------------------------------------------------------------------------------- page
const table = document.getElementById("results") as HTMLTableElement;
const runButton = document.getElementById("run") as HTMLButtonElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
let last: BenchReport | null = null;

function addRow(r: BenchResult): void {
  if (!table.rows.length) table.innerHTML = "<tr><th>scene</th><th>size</th><th>ms / sample</th><th>samples / s</th><th>inside</th><th>reflections / px</th><th>sweeps / px</th></tr>";
  const row = table.insertRow();
  for (const v of [r.name, `${r.width}×${r.height}`, r.ms.toFixed(2), (1000 / r.ms).toFixed(1), `${Math.round(100 * r.coverage)}%`, r.reflections.toFixed(2), r.sweeps.toFixed(2)]) row.insertCell().textContent = v;
}

runButton.onclick = async () => {
  runButton.disabled = true;
  table.innerHTML = "";
  last = await runBench(addRow);
  (document.getElementById("info") as HTMLElement).textContent = `${last.renderer} · float targets: ${last.floatTargets}`;
  runButton.disabled = false;
  saveButton.disabled = false;
};
saveButton.onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(last, null, 1)], { type: "application/json" }));
  a.download = `hyperscope-bench-${last!.date.slice(0, 10)}.json`;
  a.click();
};
(window as unknown as { hyperscopeBench: typeof runBench }).hyperscopeBench = runBench;
