import { describe, expect, it } from "vitest";
import { homeView, MIN_FOOTPRINT_PLAIN, panBy, rotateBy, switchModel, zoomAt, type ViewState } from "../../src/input/camera.ts";
import type { Complex } from "../../src/math/complex.ts";
import { FRAC_BITS, GRID_KINDS, UNITS, type GridCamera, type GridKind, type GridSettings, type GridUnit } from "../../src/math/grid.ts";
import { MODELS, centreScale, frameJacobian, frameOf, type Model } from "../../src/math/views.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { frameGrid, gridLines, gridPoint, gridRates } from "../../src/render/grid.ts";
import { formatValue, GAP, gridLabels, LABEL_WEIGHT, labelBox, MIN_CROSSING } from "../../src/ui/labels.ts";

const W = 900;
const H = 600;
const DPR = 1;
const u = (x: number, y: number): Complex => [(x - W / 2) / (H / 2), (H / 2 - y) / (H / 2)];

describe("label text", () => {
  it("reads like the plan: 250 m, 12.5 km, 1 250 km, 0.25 R, 22.5°", () => {
    expect(formatValue(250n, 1n, 0, "m")).toBe("250 m");
    // at steps of 100 m and 1 000 km
    expect(formatValue(12500n, 1n, -2, "m")).toBe("12.5 km");
    expect(formatValue(1250000n, 1n, -3, "m")).toBe("1 250 km");
    expect(formatValue(1n, 4n, 2, "R")).toBe("0.25 R");
    expect(formatValue(45n, 2n, 1, "deg")).toBe("22.5°");
    expect(formatValue(-3n, 1n, 0, "R")).toBe("−3 R");
    expect(formatValue(0n, 1n, 3, "m")).toBe("0 m");
    expect(formatValue(125n, 10n ** 7n, 7, "m")).toBe("12.5 µm");
    expect(formatValue(3n, 1000n, 3, "m")).toBe("3 mm");
    // 30 km and 12.34 mm, to the 10 micrometre lines of a deep zoom
    expect(formatValue(3000001234n, 10n ** 5n, 5, "m")).toBe("30.000 012 34 km");
    // rounds half away from zero, at the given decimals
    expect(formatValue(-1n, 8n, 2, "R")).toBe("−0.13 R");
    // a series keeps its decimals: 170.675 299 m, 170.675 300 m; 0.625 km, 1.250 km
    expect(formatValue(170675300n, 10n ** 6n, 6, "m")).toBe("170.675 300 m");
    expect(formatValue(1250n, 1n, 0, "m")).toBe("1.250 km");
    expect(formatValue(30n, 1n, -1, "m")).toBe("30 m");
  });
});


interface Case {
  name: string;
  model: Model;
  grid: GridSettings;
  view: (v: ViewState) => ViewState;
}

const zoomTo = (lpx: number) => (v: ViewState) => {
  while ((centreScale(v.picture) * 2) / H > lpx) v = zoomAt(v, [0.05, -0.02], 2, H, MIN_FOOTPRINT_PLAIN).view;
  return v;
};
const withCamera = (kind: GridKind, g: GridCamera) => (v: ViewState): ViewState => ({ ...v, grids: { ...v.grids, [kind]: g } });
const on = (kind: GridKind, unit: GridUnit): GridSettings => ({ on: true, kind, unit });

/** A polar centre moved here (screen units, H / 2 a unit) is well over to the lower left. */
const LOWER_LEFT: Record<Model, Complex> = { poincare: [-0.8, -0.4], klein: [-0.8, -0.4], halfplane: [-1.35, -0.75], local: [-1.35, -0.85], h3: [-1.3, -0.75], hyperboloid: [-1.3, -0.75], band: [-1.35, -0.6] };

const CASES: Case[] = [
  ...MODELS.flatMap((model) => GRID_KINDS.map((kind): Case => ({ name: `${model} ${kind} home`, model, grid: on(kind, "earth"), view: (v) => v }))),
  { name: "poincare cartesian moved, km", model: "poincare", grid: on("cartesian", "km"), view: (v) => zoomAt(rotateBy(panBy(v, [0.3, 0.1], [-0.2, 0]), 0.4), [0.1, 0.1], 3, H).view },
  { name: "halfplane polar moved", model: "halfplane", grid: on("polar", "m"), view: (v) => zoomAt(panBy(v, [0.3, 0.1], [-0.2, 0]), [0.1, 0.1], 5, H).view },
  // the centre right of the middle: the radial axis runs left, its text back toward the centre
  { name: "poincare polar centre on the right", model: "poincare", grid: on("polar", "km"), view: (v) => zoomAt(panBy(v, [0, 0], [0.45, -0.1]), [0.45, -0.1], 40, H).view },
  // the centre at the lower left, left of the label lines near the rim: rays on the right and top edges
  { name: "klein polar centre near the rim", model: "klein", grid: on("polar", "earth"), view: (v) => panBy(v, [0, 0], LOWER_LEFT.klein) },
  { name: "local polar centre at the lower left", model: "local", grid: on("polar", "earth"), view: (v) => panBy(v, [0, 0], LOWER_LEFT.local) },
  {
    name: "cartesian 1e-9 R/px at Y = 30",
    model: "local",
    grid: on("cartesian", "km"),
    view: (v) => withCamera("cartesian", { s: (123456789n << 230n) + 987654321n, e: 30, theta: 0.4 })(zoomTo(1e-9)(v)),
  },
  { name: "polar 1e-9 R/px at r = 30", model: "poincare", grid: on("polar", "earth"), view: (v) => withCamera("polar", { s: (0x1234567n << 225n) + 99n, e: 30, theta: 1.1 })(zoomTo(1e-9)(v)) },
  { name: "horocyclic 1e-9 R/px at h = -30", model: "halfplane", grid: on("horocyclic", "R"), view: (v) => withCamera("horocyclic", { s: -(98765n << FRAC_BITS) - (5n << 200n), e: -30, theta: 0.4 })(zoomTo(1e-9)(v)) },
];

describe("grid labels", () => {
  for (const c of CASES) {
    it(`sit on their lines, read the line's value and keep ${GAP} px apart: ${c.name}`, () => {
      const view = c.view(homeView(2, c.model));
      const labels = gridLabels(c.grid, view.grids, view.picture, W, H, DPR);
      const f = frameGrid(c.grid, view.grids, view.picture, H * DPR)!;
      // the Klein disk at home shows only a few coarse lines
      expect(labels.length, "labels").toBeGreaterThanOrEqual(c.model === "klein" ? 1 : 3);
      const perR = UNITS[f.unit].perR;
      const g = view.grids[c.grid.kind];
      for (const edge of ["left", "right", "bottom", "top", "radial"] as const) {
        const on = labels.filter((l) => l.edge === edge);
        const across = edge === "left" || edge === "right";
        for (let i = 1; i < on.length; i++) expect(Math.abs(across ? on[i].y - on[i - 1].y : on[i].x - on[i - 1].x)).toBeGreaterThanOrEqual(GAP);
        // an edge's labels in one unit read alike: the same decimals, none of them zero in all
        for (const unit of new Set(on.map((l) => l.text.replace(/^[^ °]*/, "")))) {
          const same = on.filter((l) => l.text.endsWith(unit) && !/^0[ °]/.test(l.text));
          const decimals = new Set(same.map((l) => /\.([\d\u2009]+)/.exec(l.text)?.[1].replace(/\u2009/g, "").length ?? 0));
          expect(decimals.size, same.map((l) => l.text).join(", ")).toBeLessThanOrEqual(1);
          if (same.length >= 2 && [...decimals][0] > 0) expect(same.some((l) => !/0[ °][^ ]*$/.test(l.text)), same.map((l) => l.text).join(", ")).toBe(true);
        }
      }
      for (const l of labels) {
        const fp = frameOf(view.picture, u(l.x, l.y))!;
        expect(fp, `${l.text} inside`).not.toBeNull();
        const lpx = (fp.scale * 2) / (H * DPR);
        // the frame point's change per pixel where the view is not conformal
        const jac = frameJacobian(view.picture, u(l.x, l.y), fp.x);
        const around = jac && (jac.map((v) => v.map((c) => (c * 2) / (H * DPR))) as [Vec3, Vec3]);
        // the label's point is on a drawn line of its family and level, within a twentieth of a
        // pixel, drawn at LABEL_WEIGHT or more: a spreading label's subdivision is the drawn m or
        // coarser, or the in-between lines at m + 1
        const lines = gridLines(f, fp.x, lpx, gridRates(f, fp.x, lpx, around))!;
        const level = lines.levels.find((v) => v.k === l.k)!;
        expect(level, `${l.text} level drawn`).toBeDefined();
        const between = l.family === "spread" && l.m === level.m + 1;
        if (l.family === "spread") expect(l.m, `${l.text} subdivision`).toBeLessThanOrEqual(level.m + 1);
        expect(level.weight * (between ? level.half : 1), `${l.text} strength`).toBeGreaterThanOrEqual(LABEL_WEIGHT - 1e-9);
        expect(l.family === "even" ? level.even : between ? level.between : level.spread, `${l.text} on a line`).toBeLessThan(0.05);
        // and its line crosses the label line at 30 degrees or more: the angle between the label
        // line and the line's normal (the coordinate's gradient, from the points a pixel around)
        const [dx, dy] = l.edge === "left" || l.edge === "right" ? [0, 1] : [1, 0];
        const pts = [[dx, dy], [-dx, -dy], [dy, -dx], [-dy, dx]].map(([ox, oy]) => gridPoint(f, frameOf(view.picture, u(l.x + ox, l.y + oy))!.x));
        const coord = (p: { de: number; b: number }) => (l.family === "even" ? p.de : p.b);
        const turn = c.grid.kind === "polar" && l.family === "spread" ? 2 * Math.PI * Math.cosh(g.e) : Infinity;
        const d = (a: number, b: number) => (turn === Infinity ? a - b : a - b - turn * Math.round((a - b) / turn));
        const along = d(coord(pts[0]), coord(pts[1]));
        expect(Math.abs(along) / Math.hypot(along, d(coord(pts[2]), coord(pts[3]))), `${l.text} crossing`).toBeGreaterThanOrEqual(MIN_CROSSING - 0.02);
        // and its text is the coordinate there, compared exactly with the camera's E0 and S0 so
        // the check holds at E = 30 too: label - E0 against dE, label - S0 against dS
        const { de, b } = gridPoint(f, fp.x);
        const rates = gridRates(f, fp.x, lpx, around);
        const [num, den] = parseExact(l.text);
        // the spacing of the label's lines: 10^k units, or 10^k / 2^m (polar: 1 / 2^m turns) for the
        // spreading lines; E labels are exact, S labels rounded well within it
        const spacing = l.family === "even" ? 10 ** l.k : (c.grid.kind === "polar" ? 1 : 10 ** l.k) / 2 ** l.m;
        const perUnit = BigInt(perR);
        if (l.family === "even") {
          const [en, ed] = exact(g.e);
          const diff = ratio(num * ed - en * perUnit * den, den * ed);
          expect(Math.abs(diff - de * perR), l.text).toBeLessThan(1e-9 * spacing + 0.1 * rates.ge * perR);
        } else {
          const polar = c.grid.kind === "polar";
          // S0 in the label's base unit: m or R (perR per R), or turns
          const sUnits = polar ? 1n : perUnit;
          const diff = ratio(num * (1n << FRAC_BITS) - g.s * sUnits * den, den * (1n << FRAC_BITS));
          const scale = c.grid.kind === "cartesian" ? Math.cosh(g.e) : polar ? 2 * Math.PI * Math.cosh(g.e) : Math.exp(-g.e);
          const ds = (b / scale) * (polar ? 1 : perR);
          // polar: turns, compared modulo a turn
          const miss = polar ? diff - ds - Math.round(diff - ds) : diff - ds;
          expect(Math.abs(miss), l.text).toBeLessThan(spacing / 100 + 0.1 * (rates.gb / scale) * (polar ? 1 : perR));
        }
      }
    });
  }
});

describe("grid label layout", () => {
  // a monospaced 10 px font: 6 px a character
  const measure = (t: string) => 6 * t.length;
  for (const c of CASES) {
    it(`keeps the labels' text apart and on the screen: ${c.name}`, () => {
      const view = c.view(homeView(2, c.model));
      const labels = gridLabels(c.grid, view.grids, view.picture, W, H, DPR, measure);
      const boxes = labels.map((l) => labelBox(l, measure));
      boxes.forEach((b, i) => {
        expect(b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H, labels[i].text).toBe(true);
        for (let j = 0; j < i; j++) {
          const o = boxes[j];
          expect(b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1, `${labels[i].text} over ${labels[j].text}`).toBe(false);
        }
      });
      expect(labels.length).toBeGreaterThanOrEqual(c.model === "klein" ? 1 : 3);
    });
  }
  // the HUD's readouts at the top left, bottom left and bottom right (ui/hud.ts keepOut)
  const HUD = [
    { x0: 14, x1: 300, y0: 12, y1: 92 },
    { x0: 14, x1: 262, y0: 498, y1: 588 },
    { x0: 700, x1: 886, y0: 574, y1: 592 },
  ];
  for (const c of CASES) {
    it(`keeps the labels' text out of the HUD's readouts: ${c.name}`, () => {
      const view = c.view(homeView(2, c.model));
      const labels = gridLabels(c.grid, view.grids, view.picture, W, H, DPR, measure, HUD);
      for (const l of labels) {
        const b = labelBox(l, measure);
        for (const a of HUD) expect(b.x0 < a.x1 && a.x0 < b.x1 && b.y0 < a.y1 && a.y0 < b.y1, `${l.text} under a readout`).toBe(false);
      }
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });
  }
  // a polar centre on the screen: circles along the radial axis, rays on both edges
  for (const model of MODELS) {
    it(`labels a polar centre's circles along a radial axis and its rays at the edges: ${model}`, () => {
      const view = homeView(2, model);
      const labels = gridLabels(on("polar", "earth"), view.grids, view.picture, W, H, DPR, measure);
      const radial = labels.filter((l) => l.edge === "radial");
      // (inside H3 and on the hyperboloid a pixel's level is set by its stretch in depth, so across
      // the view, along the radial axis, the circles drawn come further apart)
      expect(radial.length).toBeGreaterThanOrEqual(model === "klein" || model === "h3" || model === "hyperboloid" ? 1 : 2);
      expect(radial.every((l) => l.family === "even" && Math.abs(l.y - H / 2) < 1)).toBe(true);
      expect(labels.filter((l) => l.edge !== "radial").every((l) => l.family === "spread")).toBe(true);
    });
    it(`labels the rays of a polar centre at the lower left on the right and top edges: ${model}`, () => {
      const view = panBy(homeView(2, model), [0, 0], LOWER_LEFT[model]);
      const labels = gridLabels(on("polar", "earth"), view.grids, view.picture, W, H, DPR, measure);
      const edges = (edge: string) => labels.filter((l) => l.edge === edge);
      expect(edges("right").length, "right").toBeGreaterThanOrEqual(1);
      // (inside H3 the top label line runs below the horizon, where the rays crowd)
      expect(edges("top").length, "top").toBeGreaterThanOrEqual(model === "h3" ? 1 : model === "klein" || model === "poincare" ? 2 : 3);
      expect(edges("left").length + edges("bottom").length).toBe(0);
      expect(edges("radial").length, "radial").toBeGreaterThanOrEqual(1);
      expect(labels.filter((l) => l.edge !== "radial").every((l) => l.family === "spread")).toBe(true);
      // on the right edge the text ends left of the line, with the same pad as elsewhere
      for (const l of edges("right")) expect(labelBox(l, measure).x1).toBeCloseTo(l.x - 3, 9);
    });
  }
});

describe("round values first", () => {
  // where the line spacing changes along an edge (the half-plane after a switch from the disk: 2 000
  // km steps above, 5 000 km below) and at home, the lines E = 0 and S = 0 through the middle of
  // the screen keep their labels
  const switched = (v: ViewState) => switchModel(homeView(2, "poincare"), v.picture.model, H);
  const cases: [string, Model, GridKind, (v: ViewState) => ViewState][] = [
    ["half-plane after a switch, horocyclic", "halfplane", "horocyclic", switched],
    ...(["poincare", "klein", "local"] as const).map((model): [string, Model, GridKind, (v: ViewState) => ViewState] => [`${model} cartesian home`, model, "cartesian", (v) => v]),
  ];
  for (const [name, model, kind, view] of cases) {
    it(`labels 0 on both edges: ${name}`, () => {
      const v = view(homeView(2, model));
      const labels = gridLabels(on(kind, "earth"), v.grids, v.picture, W, H, DPR, (t) => 6 * t.length);
      for (const edge of ["left", "bottom"]) expect(labels.some((l) => l.edge === edge && /^0 /.test(l.text)), `${edge}: ${labels.filter((l) => l.edge === edge).map((l) => l.text).join(", ")}`).toBe(true);
    });
  }
});

describe("grid label density", () => {
  // the local view zoomed in until it is flat, then through a decade in steps of 2^(1/4): labels
  // on the finest lines drawn at LABEL_WEIGHT or more come at most 80 10^0.3 px apart (even lines)
  // or 2^0.3 times that (spreading lines, which at m are up to twice their level's spacing apart)
  for (const kind of GRID_KINDS) {
    it(`labels both edges at every zoom of a decade, ${kind}`, () => {
      let view = zoomTo(1e-4)(homeView(2, "local"));
      for (let i = 0; i < 14; i++) {
        const labels = gridLabels(on(kind, "earth"), view.grids, view.picture, W, H, DPR);
        for (const edge of ["left", "bottom"] as const) {
          const on = labels.filter((l) => l.edge === edge);
          const at = on.map((l) => (edge === "left" ? l.y : l.x));
          expect(at.length, `${edge} at step ${i}`).toBeGreaterThanOrEqual(2);
          for (let n = 1; n < at.length; n++) expect(at[n] - at[n - 1], `${edge} at step ${i}`).toBeLessThan(80 * 10 ** LABEL_WEIGHT * 2 ** LABEL_WEIGHT + 2);
          // neighbours are neighbouring labelled lines: even lines 1, 2, 5 or 10 times 10^k apart
          // (at a multiple of that), spreading lines one step of their subdivision apart
          for (let n = 1; n < on.length; n++) {
            const [a, b] = [on[n - 1], on[n]];
            const value = (l: typeof a) => Number(parseExact(l.text)[0]) / Number(parseExact(l.text)[1]);
            if (a.family === "even") {
              const q = Math.abs(value(b) - value(a)) / 10 ** a.k;
              expect([1, 2, 5, 10].some((s) => Math.abs(q - s) < 1e-6), `${a.text} to ${b.text}`).toBe(true);
              const at = value(a) / (Math.round(q) * 10 ** a.k);
              expect(Math.abs(at - Math.round(at)), a.text).toBeLessThan(1e-6);
            } else {
              const step = (kind === "polar" ? 1 : 10 ** a.k) / 2 ** a.m;
              let d = Math.abs(value(b) - value(a));
              if (kind === "polar") d = Math.min(d, 1 - d);
              expect(d / step, `${a.text} to ${b.text}`).toBeCloseTo(1, 1);
            }
          }
        }
        view = zoomAt(view, [0, 0], 2 ** 0.25, H, MIN_FOOTPRINT_PLAIN).view;
      }
    });
  }
});

/** A float64 as an exact fraction. */
function exact(x: number): [bigint, bigint] {
  let k = 0;
  while (!Number.isInteger(x * 2 ** k)) k++;
  return [BigInt(x * 2 ** k), 1n << BigInt(k)];
}

const ratio = (num: bigint, den: bigint) => {
  // scale both down together so Number() keeps the ratio's precision
  const shift = BigInt(Math.max(0, den.toString(2).length - 1000));
  return Number(num >> shift) / Number(den >> shift);
};

/** A label's value as an exact fraction of its base unit (m, R, or turns for degrees). */
function parseExact(text: string): [bigint, bigint] {
  const t = text.replace(/\u2009/g, "").replace("\u2212", "-");
  const m = /^(-?)(\d+)(?:\.(\d+))?\s*(km|mm|µm|m|R|°)$/.exec(t);
  if (!m) throw new Error(`label "${text}"`);
  const decimals = m[3]?.length ?? 0;
  let num = BigInt(m[2] + (m[3] ?? "")) * (m[1] ? -1n : 1n);
  let den = 10n ** BigInt(decimals);
  const unit = m[4];
  if (unit === "km") num *= 1000n;
  if (unit === "mm") den *= 1000n;
  if (unit === "µm") den *= 1000000n;
  if (unit === "°") den *= 360n;
  return [num, den];
}
