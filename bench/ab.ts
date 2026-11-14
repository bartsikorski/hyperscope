// A/B runs of equivalent formulas (design notes, step 10 plan). Each experiment is first checked to
// draw the same picture as the production code, then timed against it on one page, alternating
// A B / B A over four rounds so the machine's drift falls on both. A round is a batch of passes
// closed by one 1-pixel read-back, batched to at least 50 ms so the read-back's own cost does not
// count on a fast GPU. `npm run ab` runs it headless; open /bench/ab.html to run it in a browser.

import { LOOKS, type LookState } from "../src/content/looks.ts";
import { buildContent, PRESETS, type ContentState } from "../src/content/scene.ts";
import { homeView } from "../src/input/camera.ts";
import type { Model } from "../src/math/views.ts";
import { Renderer, type Experiment, type FrameSpec } from "../src/render/gl.ts";
import { renderView, toRGBA8 } from "../src/render/reference.ts";
import { MAX_SAMPLES } from "../src/render/samples.ts";
import { compare } from "../tests/gpu/compare.ts";
import { EXPERIMENTS, type BenchExperiment } from "./experiments.ts";
import { formatRow, HEADER } from "./format.ts";
import { scenes, specOf, type Scene } from "./scenes.ts";

export interface AbRow {
  experiment: string;
  scene: string;
  /** B against A at 640 x 360: share of pixels within 2 levels, the worst and mean difference. */
  within: number;
  worst: number;
  mean: number;
  /** A and B against the CPU reference (float64) at the same size and samples: within 2, mean. */
  aRef?: [number, number];
  bRef?: [number, number];
  /** Whether B passed the golden images' rule against A (99.5% within 2, worst at most 48), or is
   *  at least as close to the CPU reference as A. Timed either way, for the record. */
  equivalent: boolean;
  /** What is timed: "sample pass", "still picture" (16 samples and the display), "moving frame". */
  unit: string;
  /** Milliseconds per unit in each round, A and B. */
  a: number[];
  b: number[];
  /** Median of the rounds' B / A, and their least and largest. */
  ratio: number;
  ratioMin: number;
  ratioMax: number;
  note?: string;
}

export interface AbReport {
  date: string;
  renderer: string;
  userAgent: string;
  width: number;
  height: number;
  rows: AbRow[];
}

const WIDTH = 1920;
const HEIGHT = 1080;
const CHECK: [number, number] = [640, 360];
const ROUNDS = 4;
const MIN_BATCH_MS = 50;

// ------------------------------------------------------------------------------------- scenes
const lookOf = (name: string): LookState => LOOKS.find((l) => l.name === name)!.look;
const preset = (g: string) => PRESETS.find((p) => p.content.group.join(",") === g)!;

function scene(name: string, state: ContentState, model: Model): Scene {
  const content = buildContent(state);
  return { name, content, view: homeView(content.colouring.k, model) };
}

function sceneSets(): Record<string, Scene[]> {
  const all = scenes();
  const named = (n: string) => all.find((s) => s.name === n)!;
  const base = { ...preset("7,3,2").content };
  const inside = { ...base, look: { ...lookOf("Gilded"), source: "inside" as const } };
  const near = named("poincare near the boundary (8,3,2)");
  const nearInside: Scene = { name: "poincare near the boundary (8,3,2), inside source", content: buildContent({ ...near.content.state, look: inside.look }), view: near.view };
  const defaults = (["poincare", "klein", "halfplane", "local"] as const).map((m) => named(`${m} (7,3,2)`));
  const motifs = () => ["Shoal (3,3,4)", "Moths {6,4}", "Rosette {8,3}", "Birds (4,4,3)"].map((l) => named(`poincare ${l}`)).concat([named("halfplane Birds (4,4,3)"), named("h3 Birds (4,4,3)")]);
  return {
    "fold-dihedral": [...(["poincare", "halfplane", "local"] as const).map((m) => scene(`${m} (7,3,2), inside source`, inside, m)), nearInside],
    "reflect-branchless": [defaults[0], defaults[2], defaults[3], named("halfplane (7,3,2) Escher look"), named("halfplane (7,3,2) Nebula look")],
    "geometry-complex": [defaults[0], defaults[2], defaults[3], near],
    "footprint-derivatives": defaults,
    "uber-shader": [defaults[2], named("halfplane (7,3,2) Escher look"), named("halfplane (7,3,2) Midnight look")],
    "perm-arrays": [defaults[0], defaults[2], scene("halfplane {6,4} in eight colours", { ...preset("6,4,2").content, look: lookOf("Gilded") }, "halfplane")],
    // the steps after version 1 (design notes, step 18 plan)
    "wythoff-texture": ["Truncated {3,7}", "Omnitruncated {7,3}", "Snub {5,4}"].flatMap((l) => [named(`poincare ${l}`), named(`halfplane ${l}`)]).concat([named("poincare Snub {5,4} Mosaic"), named("poincare {7,3} free point")]),
    "motif-24": motifs(),
    "motif-32": motifs(),
    "grid-pass": [named("halfplane (7,3,2) + cartesian grid"), named("poincare (7,3,2) + polar grid"), named("klein (7,3,2) + cartesian grid"), named("local unit grid at 1e-9 R/px")],
  };
}

// ------------------------------------------------------------------------------------- timing
/** Passes per batch so that a batch lasts at least MIN_BATCH_MS. */
function calibrate(run: () => void, sync: () => void): number {
  run();
  sync();
  let n = 1;
  for (;;) {
    const t = performance.now();
    for (let i = 0; i < n; i++) run();
    sync();
    const dt = performance.now() - t;
    if (dt >= MIN_BATCH_MS || n >= 1024) return n;
    n = Math.min(1024, Math.max(2 * n, Math.ceil((1.2 * n * MIN_BATCH_MS) / Math.max(dt, 0.01))));
  }
}

function batch(run: () => void, sync: () => void, n: number): number {
  const t = performance.now();
  for (let i = 0; i < n; i++) run();
  sync();
  return (performance.now() - t) / n;
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

/** Alternate A and B for ROUNDS rounds (AB, BA, AB, BA), each a calibrated batch. */
function alternate(a: () => void, b: () => void, sync: () => void) {
  const na = calibrate(a, sync);
  const nb = calibrate(b, sync);
  const ta: number[] = [];
  const tb: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    if (r % 2 === 0) {
      ta.push(batch(a, sync, na));
      tb.push(batch(b, sync, nb));
    } else {
      tb.push(batch(b, sync, nb));
      ta.push(batch(a, sync, na));
    }
  }
  const ratios = ta.map((x, i) => tb[i] / x);
  return { a: ta, b: tb, ratio: median(ratios), ratioMin: Math.min(...ratios), ratioMax: Math.max(...ratios) };
}

// ------------------------------------------------------------------------------------- helpers
function colourTarget(gl: WebGL2RenderingContext, width: number, height: number) {
  const fb = gl.createFramebuffer()!;
  const rb = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  return { fb, free: () => (gl.deleteFramebuffer(fb), gl.deleteRenderbuffer(rb)) };
}

const pass = (c: { within: number; worst: number }) => c.within >= 0.995 && c.worst <= 48;

/** The CPU reference picture of a scene at the check size and 4 samples, kept per scene. */
const references = new Map<string, Uint8Array>();
function reference(s: Scene, spec: FrameSpec): Uint8Array {
  let px = references.get(s.name);
  if (!px) {
    const [width, height] = CHECK;
    px = toRGBA8(renderView({ width, height, camera: spec.camera, picture: spec.picture, scene: spec.scene, grid: spec.grid, samples: 4 }), width, height);
    references.set(s.name, px);
  }
  return px;
}

// ------------------------------------------------------------------------------------- runs
function runExperiment(renderer: Renderer, exp: BenchExperiment, s: Scene): AbRow {
  const gl = renderer.gl;
  const row = { experiment: exp.name, scene: s.name, unit: "sample pass" };
  // B's own scene, when B differs by its data (the same picture drawn from other numbers)
  const sb = exp.sceneB?.(s) ?? s;
  // equivalence: 4 samples at the check size
  const check = specOf(s, CHECK[1]);
  renderer.experiment = null;
  const pa = renderer.renderPixels(check, CHECK[0], CHECK[1], 4);
  renderer.experiment = exp;
  const pb = renderer.renderPixels(specOf(sb, CHECK[1]), CHECK[0], CHECK[1], 4);
  renderer.experiment = null;
  const c = compare(pb, pa, 2);
  let eq: Pick<AbRow, "within" | "worst" | "mean" | "equivalent" | "aRef" | "bRef"> = { within: c.within, worst: c.worst, mean: c.mean, equivalent: pass(c) };
  if (!eq.equivalent) {
    // which of the two is nearer the truth: the CPU reference in float64
    const ref = reference(s, check);
    const ca = compare(pa, ref, 2);
    const cb = compare(pb, ref, 2);
    eq = { ...eq, aRef: [ca.within, ca.mean], bRef: [cb.within, cb.mean], equivalent: cb.within >= ca.within && cb.mean <= ca.mean };
  }
  // timing at full size
  const spec = specOf(s, HEIGHT);
  const specB = sb === s ? spec : specOf(sb, HEIGHT);
  const target = renderer.createTarget(WIDTH, HEIGHT);
  let k = 0;
  const run = (e: Experiment | null) => () => {
    renderer.experiment = e;
    renderer.sample(e ? specB : spec, target, 1 + (k++ % 15));
  };
  const px = new Uint16Array(4);
  const sync = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    if (renderer.floatTargets) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.HALF_FLOAT, px);
    else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  };
  const t = alternate(run(null), run(exp), sync);
  renderer.experiment = null;
  renderer.deleteTarget(target);
  const notes = [eq.equivalent ? "" : "not equivalent", curveError(s, sb)].filter((n) => n);
  return { ...row, ...eq, ...t, note: notes.length ? notes.join("; ") : undefined };
}

/** For a motif drawn with other curves in B: how far B's curves stray from A's, in plane units (the
 *  disk's 2|dw| near its centre, an upper bound there). */
function curveError(a: Scene, b: Scene): string {
  const ma = a.content.motif;
  const mb = b.content.motif;
  if (!ma || !mb || ma === mb) return "";
  const off = (pts: [number, number][], poly: [number, number][]) => {
    let worst = 0;
    for (const p of pts) {
      let best = Infinity;
      for (let i = 0; i + 1 < poly.length; i++) {
        const [ax, ay] = poly[i];
        const [ex, ey] = [poly[i + 1][0] - ax, poly[i + 1][1] - ay];
        const t = Math.min(1, Math.max(0, ((p[0] - ax) * ex + (p[1] - ay) * ey) / (ex * ex + ey * ey || 1)));
        best = Math.min(best, Math.hypot(p[0] - ax - t * ex, p[1] - ay - t * ey));
      }
      worst = Math.max(worst, best);
    }
    return 2 * worst;
  };
  const e = Math.max(off(ma.c1 as [number, number][], mb.c1 as [number, number][]), off(ma.c2 as [number, number][], mb.c2 as [number, number][]));
  return `B's curves within ${e.toExponential(1)} of A's (${mb.c1.length} points)`;
}

/** The uber-shader's other cost: compiling. Every variant of one view in fresh renderers, A as one
 *  program each, B as one program for all; the time to the first finished pass of each. */
function compileRow(gl: WebGL2RenderingContext, exp: Experiment, s: Scene): AbRow {
  const variants = LOOKS.filter((l, i) => LOOKS.findIndex((m) => m.look.source === l.look.source && (m.look.relief > 0) === (l.look.relief > 0)) === i);
  const time = (e: Experiment | null) => {
    const r = new Renderer(gl);
    r.experiment = e;
    const target = r.createTarget(64, 64);
    const t = performance.now();
    for (const l of variants) {
      const spec = specOf({ ...s, content: buildContent({ ...s.content.state, look: l.look }) }, 64);
      r.sample(spec, target, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, r.floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, r.floatTargets ? new Uint16Array(4) : new Uint8Array(4));
    const dt = performance.now() - t;
    r.deleteTarget(target);
    return dt;
  };
  const a = time(null);
  const b = time(exp);
  return {
    experiment: exp.name,
    scene: `${s.view.picture.model}: compile ${variants.length} variants`,
    unit: "compile",
    within: 1,
    worst: 0,
    mean: 0,
    equivalent: true,
    a: [a],
    b: [b],
    ratio: b / a,
    ratioMin: b / a,
    ratioMax: b / a,
    note: "one run each, first use in a fresh renderer (the browser may cache compiled shaders)",
  };
}

/** The unit grid in every sample (A) or once over them in the display pass (B, production since
 *  step 10). */
function runGridPass(renderer: Renderer, s: Scene): AbRow[] {
  const gl = renderer.gl;
  // equivalence: a still picture at the check size
  const [cw, ch] = CHECK;
  const check = specOf(s, ch);
  const pa = renderer.renderPixels(check, cw, ch, MAX_SAMPLES, undefined, true);
  const pb = renderer.renderPixels(check, cw, ch, MAX_SAMPLES);
  const c = compare(pb, pa, 2);
  const eq = { within: c.within, worst: c.worst, mean: c.mean, equivalent: pass(c) };
  const row = { experiment: "grid-pass", scene: s.name };
  // timing: a still picture (16 samples and the display), and a moving frame (one sample at half
  // scale, displayed at full size)
  const rows: AbRow[] = [];
  const screen = colourTarget(gl, WIDTH, HEIGHT);
  const sync = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, screen.fb);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  };
  for (const [unit, scale, samples] of [["still picture", 1, MAX_SAMPLES], ["moving frame", 0.5, 1]] as const) {
    const [w, h] = [Math.round(WIDTH * scale), Math.round(HEIGHT * scale)];
    const spec = specOf(s, h);
    const full = specOf(s, HEIGHT);
    const target = renderer.createTarget(w, h);
    const a = () => {
      for (let i = 0; i < samples; i++) renderer.sample(spec, target, i);
      renderer.display(target, WIDTH, HEIGHT, screen.fb, 1);
    };
    const b = () => {
      for (let i = 0; i < samples; i++) renderer.sample({ ...spec, grid: null }, target, i);
      renderer.display(target, WIDTH, HEIGHT, screen.fb, 1, { spec: full });
    };
    rows.push({ ...row, ...eq, unit, ...alternate(a, b, sync), note: eq.equivalent ? undefined : "outside the golden rule: look at the pictures" });
    renderer.deleteTarget(target);
  }
  screen.free();
  return rows;
}

export async function runAB(only?: string[], onRow?: (r: AbRow) => void): Promise<AbReport> {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) throw new Error("WebGL2 is not available");
  const renderer = new Renderer(gl);
  const sets = sceneSets();
  const rows: AbRow[] = [];
  const emit = async (r: AbRow) => {
    rows.push(r);
    onRow?.(r);
    await new Promise((ok) => setTimeout(ok, 0));
  };
  for (const exp of EXPERIMENTS) {
    if (only && !only.includes(exp.name)) continue;
    for (const s of sets[exp.name]) await emit(runExperiment(renderer, exp, s));
    if (exp.name === "uber-shader") await emit(compileRow(gl, exp, sets[exp.name][0]));
  }
  if (!only || only.includes("grid-pass")) {
    for (const s of sets["grid-pass"]) for (const r of runGridPass(renderer, s)) await emit(r);
  }
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    date: new Date().toISOString(),
    renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    userAgent: navigator.userAgent,
    width: WIDTH,
    height: HEIGHT,
    rows,
  };
}

/** The pictures of one experiment's scene, A and B, at the check size (to look at a difference). */
export function pictures(name: string, sceneIndex: number): { a: Uint8Array; b: Uint8Array; width: number; height: number } {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;
  const gl = canvas.getContext("webgl2")!;
  const renderer = new Renderer(gl);
  const s = sceneSets()[name][sceneIndex];
  const [w, h] = CHECK;
  const spec = specOf(s, h);
  if (name === "grid-pass") return { a: renderer.renderPixels(spec, w, h, MAX_SAMPLES, undefined, true), b: renderer.renderPixels(spec, w, h, MAX_SAMPLES), width: w, height: h };
  const a = renderer.renderPixels(spec, w, h, 4);
  const exp = EXPERIMENTS.find((e) => e.name === name)!;
  renderer.experiment = exp;
  const b = renderer.renderPixels(exp.sceneB ? specOf(exp.sceneB(s), h) : spec, w, h, 4);
  return { a, b, width: w, height: h };
}

// ---------------------------------------------------------------------------------------- page
if (typeof document !== "undefined" && document.getElementById("run")) {
  const out = document.getElementById("results") as HTMLPreElement;
  const runButton = document.getElementById("run") as HTMLButtonElement;
  runButton.onclick = async () => {
    runButton.disabled = true;
    out.textContent = HEADER + "\n";
    const report = await runAB(undefined, (r) => (out.textContent += formatRow(r) + "\n"));
    (document.getElementById("info") as HTMLElement).textContent = report.renderer;
    runButton.disabled = false;
  };
}
(window as unknown as { hyperscopeAB: typeof runAB; hyperscopePictures: typeof pictures }).hyperscopeAB = runAB;
(window as unknown as { hyperscopePictures: typeof pictures }).hyperscopePictures = pictures;
