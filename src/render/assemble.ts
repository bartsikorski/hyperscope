// Builds programs' sources from shader chunks. A sample program is header + common.glsl + one view
// chunk + one content chunk + grid.glsl + main.frag; the display program is header + colour.glsl +
// display.frag, and with the unit grid drawn once over the samples header + common.glsl + one view
// chunk + grid.glsl + colour.glsl + display.frag. The header is the only part that differs between WebGL2 and the desktop
// companion's OpenGL 3.3, so the chunks themselves stay in the common GLSL subset.

import { MAX_SWEEPS } from "../math/groups.ts";
import type { Model } from "../math/views.ts";
import colour from "../shaders/colour.glsl?raw";
import common from "../shaders/common.glsl?raw";
import tiling from "../shaders/content/tiling.glsl?raw";
import plain from "../shaders/content/plain.glsl?raw";
import displayFrag from "../shaders/display.frag?raw";
import vertex from "../shaders/fullscreen.vert?raw";
import gridChunk from "../shaders/grid.glsl?raw";
import mainFrag from "../shaders/main.frag?raw";
import band from "../shaders/views/band.glsl?raw";
import h3 from "../shaders/views/h3.glsl?raw";
import halfplane from "../shaders/views/halfplane.glsl?raw";
import hyperboloid from "../shaders/views/hyperboloid.glsl?raw";
import klein from "../shaders/views/klein.glsl?raw";
import local from "../shaders/views/local.glsl?raw";
import poincare from "../shaders/views/poincare.glsl?raw";

export type ViewKind = Model;
export type ContentKind = "tiling" | "plain";
export type Target = "webgl" | "desktop";

/** Compile-time switches: the tiling's colour source (looks.ts SOURCES order), a chiral colouring
 *  (with the colouring source; off when left out) and relief, the unit grid (0 none, 1 + its index
 *  in math/grid.ts GRID_KINDS), a Wythoff tiling (0 version 1's when left out, 1 seen through the
 *  triangle, 2 through the kite: math/wythoff.ts), a motif (math/motifs.ts) and your own tile picture
 *  (0 none, 1 kaleidoscope, 2 chiral: content/tileimage.ts). */
export interface Variant {
  source: number;
  chiral?: boolean;
  relief: boolean;
  grid: number;
  wythoff?: number;
  /** A motif (math/motifs.ts) over the kite; Wythoff is then 0. */
  motif?: boolean;
  /** Your own tile picture (content/tileimage.ts): 0 none when left out, 1 kaleidoscope, 2 chiral;
   *  Wythoff and motif are then 0. */
  image?: number;
}
export const BASIC: Variant = { source: 0, relief: false, grid: 0 };

const VIEWS: Record<ViewKind, string> = { poincare, klein, halfplane, local, h3, hyperboloid, band };
const CONTENTS: Record<ContentKind, string> = { tiling, plain };

/** GRID_ONCE: the grid drawn once in the display pass, with its coverage spread by the samples'
 *  jitter (grid.glsl gridCoverage). */
function header(target: Target, variant?: Variant, once = false): string {
  const version = target === "webgl" ? "#version 300 es\nprecision highp float;\nprecision highp int;\n" : "#version 330 core\n";
  const defines = variant
    ? `#define SOURCE ${variant.source}\n#define CHIRAL ${variant.chiral ? 1 : 0}\n#define RELIEF ${variant.relief ? 1 : 0}\n#define GRID ${variant.grid}\n#define GRID_ONCE ${once ? 1 : 0}\n#define WYTHOFF ${variant.wythoff ?? 0}\n#define MOTIF ${variant.motif ? 1 : 0}\n#define TILEIMAGE ${variant.image ?? 0}\n`
    : "";
  return `${version}#define MAX_SWEEPS ${MAX_SWEEPS}\n${defines}`;
}

export interface Chunk {
  name: string;
  /** First line of the chunk in the assembled source, counted from 1. */
  start: number;
  lines: number;
}

export interface Sources {
  vertex: string;
  fragment: string;
  /** Where each chunk sits in the fragment source, to report compile errors by chunk and line. */
  chunks: Chunk[];
}

/** Rewrites a chunk's source by its name (benchmark experiments only, bench/experiments.ts). */
export type Rewrite = (chunk: string, src: string) => string;

export function assemble(view: ViewKind, content: ContentKind, variant: Variant = BASIC, target: Target = "webgl", rewrite?: Rewrite): Sources {
  const body: [string, string][] = [
    ["common.glsl", common],
    [`views/${view}.glsl`, VIEWS[view]],
    [`content/${content}.glsl`, CONTENTS[content]],
    ["grid.glsl", gridChunk],
    ["main.frag", mainFrag],
  ];
  return join(target, variant, rewrite ? body.map(([name, src]) => [name, rewrite(name, src)]) : body);
}

/** The display program; with a view and a grid (0 none, 1 + its index in GRID_KINDS), the one that
 *  draws that grid once over the samples. */
export function assembleDisplay(target: Target = "webgl", view?: ViewKind, grid = 0): Sources {
  const display: [string, string][] = [
    ["colour.glsl", colour],
    ["display.frag", displayFrag],
  ];
  if (!view || grid === 0) return join(target, { ...BASIC, grid: 0 }, display);
  const body: [string, string][] = [
    ["common.glsl", common],
    [`views/${view}.glsl`, VIEWS[view]],
    ["grid.glsl", gridChunk],
    ...display,
  ];
  return join(target, { ...BASIC, grid }, body, true);
}

function join(target: Target, variant: Variant | undefined, body: [string, string][], once = false): Sources {
  const parts: [string, string][] = [["header", header(target, variant, once)], ...body];
  const chunks: Chunk[] = [];
  let line = 1;
  let fragment = "";
  for (const [name, src] of parts) {
    const text = src.endsWith("\n") ? src : src + "\n";
    const lines = text.split("\n").length - 1;
    chunks.push({ name, start: line, lines });
    fragment += text;
    line += lines;
  }
  return { vertex: header(target) + vertex, fragment, chunks };
}

/** Rewrites "ERROR: 0:123: ..." lines of a compile log as "content/tiling.glsl:45: ...". */
export function mapLog(log: string, chunks: Chunk[]): string {
  return log.replace(/(?:ERROR|WARNING): \d+:(\d+):/g, (whole, n: string) => {
    const at = Number(n);
    const c = chunks.find((k) => at >= k.start && at < k.start + k.lines);
    return c ? `${c.name}:${at - c.start + 1}:` : whole;
  });
}
