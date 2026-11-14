// The tile picture's template (design notes, step 17: Template): the shape drawn on a 1024 x 1024
// sheet at the default placement, so a drawing made on it loads back in place. For the chiral mode,
// partner edges share a colour and carry matching ticks; for the kaleidoscope, T's three mirrors.

import type { TileMode } from "../content/tileimage.ts";
import { templateGeometry, TEMPLATE_PX } from "../content/tileimage.ts";
import type { TriangleGroup } from "../math/groups.ts";

const PAPER = "#f4f1ea";
const OUTSIDE = "#ddd7cb";
const INSIDE = "#fffdf8";
const INK = "#2b2a28";
/** Edge colours by pair: PR and PR', QR and QR', a mirror side. */
export const PAIR_COLOURS = ["#c2412d", "#2463a8", "#4a4a4a"];

/** The group as the title writes it: {7,3} or (3,3,4). */
const groupName = (g: TriangleGroup) => (g.r === 2 ? `{${g.p},${g.q}}` : `(${g.p},${g.q},${g.r})`);

/** The template drawn on a canvas of TEMPLATE_PX square. */
export function drawTemplate(group: TriangleGroup, mode: TileMode): HTMLCanvasElement {
  const t = templateGeometry(group, mode);
  const S = TEMPLATE_PX;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("this browser cannot draw the template");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, S, S);
  // the shape on a shaded sheet
  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(24, 96, S - 48, S - 192);
  ctx.beginPath();
  t.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = INSIDE;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const e of t.edges) {
    ctx.beginPath();
    e.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = PAIR_COLOURS[e.pair];
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  // ticks across the paired edges, numbered from P or Q
  ctx.font = "600 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const k of t.ticks) {
    const e = t.edges[k.edge];
    const [x, y] = k.at;
    const [nx, ny] = k.normal;
    ctx.beginPath();
    ctx.moveTo(x - 11 * nx, y - 11 * ny);
    ctx.lineTo(x + 11 * nx, y + 11 * ny);
    ctx.strokeStyle = PAIR_COLOURS[e.pair];
    ctx.lineWidth = 3;
    ctx.stroke();
    // the number on the side away from the shape's middle
    const mid = t.outline.reduce((m, p) => [m[0] + p[0] / t.outline.length, m[1] + p[1] / t.outline.length], [0, 0]);
    const side = (x - mid[0]) * nx + (y - mid[1]) * ny >= 0 ? 1 : -1;
    ctx.fillStyle = PAIR_COLOURS[e.pair];
    ctx.fillText(String(k.index), x + side * 24 * nx, y + side * 24 * ny);
  }
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.fillStyle = INK;
  for (const k of t.corners) ctx.fillText(k.name, k.at[0] + 30 * k.out[0], k.at[1] + 30 * k.out[1]);
  // the title and how the edges match
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.fillText(`Hyperscope tile template · ${groupName(group)} · ${mode === "chiral" ? "chiral" : "kaleidoscope"}`, 28, 52);
  ctx.font = "400 18px system-ui, sans-serif";
  ctx.fillStyle = "#55514a";
  ctx.fillText("Draw inside the white shape, then load the picture with Load picture… in Hyperscope.", 28, 80);
  const lines =
    mode === "chiral"
      ? [
          "Edges of one colour meet in the tiling. Across PR the picture goes on from PR′, turned about P;",
          "across QR it goes on from QR′, turned about Q. Ticks with the same number meet.",
        ]
      : ["The three sides are mirrors: the picture is reflected across each, so it is always seamless.", "P, Q and R are where 2p, 2q and 2r triangles meet."];
  lines.forEach((l, i) => ctx.fillText(l, 28, S - 60 + 28 * i));
  return c;
}

/** The template as a PNG. */
export function templatePNG(group: TriangleGroup, mode: TileMode): Promise<Blob> {
  const c = drawTemplate(group, mode);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("the browser could not write the template"))), "image/png"));
}

/** The template's file name: hyperscope-template-7-3-2-chiral.png. */
export function templateName(group: TriangleGroup, mode: TileMode): string {
  return `hyperscope-template-${group.p}-${group.q}-${group.r}-${mode}.png`;
}
