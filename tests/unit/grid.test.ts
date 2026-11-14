import { describe, expect, it } from "vitest";
import type { RGB } from "../../src/math/colour.ts";
import {
  FRAC_BITS, GRID_KINDS, gridAt, gridFrame, homeGrids, moveGrid, offsetTerm, spreadLog2, subdivision, UNITS,
  type GridCamera, type GridKind, type GridUnit,
} from "../../src/math/grid.ts";
import { boostX, mul, rotation, type Vec3 } from "../../src/math/lorentz.ts";
import { bitsPhase, boxCoverage, gridLines, J_MAX, J_MIN, shadeGrid, tentCoverage } from "../../src/render/grid.ts";
import data from "./data/grid.json";
import { rng } from "./rng.ts";

const TURN = 2 * Math.PI;
const ONE = 1n << FRAC_BITS;
const SCALE = 2 ** Number(FRAC_BITS);
const turn = (theta: number, q: Vec3): Vec3 => [Math.cos(theta) * q[0] - Math.sin(theta) * q[1], Math.sin(theta) * q[0] + Math.cos(theta) * q[1], q[2]];
/** The pixel's offset term B per unit of dS (R, or turns for polar) at E0. */
const offsetScale = (kind: GridKind, e0: number) => (kind === "cartesian" ? Math.cosh(e0) : kind === "polar" ? TURN * Math.cosh(e0) : Math.exp(-e0));
/** Plane length per unit of S along an S-direction at E. */
const spread = (kind: GridKind, e: number) => (kind === "cartesian" ? Math.cosh(e) : kind === "polar" ? TURN * Math.sinh(e) : Math.exp(-e));
const wrapAngle = (a: number) => a - TURN * Math.round(a / TURN);

describe("grid coordinates", () => {
  it("offsetTerm and gridAt match 100-digit values for E0 up to 55 and distances 1e-11 to 0.5", () => {
    const worst = { e: 0, de: 0, b: 0, ds: 0 };
    for (const p of data.points) {
      const kind = p.kind as GridKind;
      const q = p.q as Vec3;
      const o = offsetTerm(kind, p.e0, turn(p.theta, q));
      const g = gridAt(kind, { s: 0n, e: p.e0, theta: p.theta }, q);
      const bRef = Number(p.b);
      worst.e = Math.max(worst.e, Math.abs(o.e - Number(p.e)) / Math.max(1, Math.abs(Number(p.e))), Math.abs(g.e - Number(p.e)) / Math.max(1, Math.abs(Number(p.e))));
      worst.de = Math.max(worst.de, Math.abs(o.de - Number(p.de)) / p.dist);
      worst.b = Math.max(worst.b, Math.abs(o.b - bRef) / Math.max(p.dist, Math.abs(bRef)));
      worst.ds = Math.max(worst.ds, Math.abs(g.ds * offsetScale(kind, p.e0) - bRef) / Math.max(p.dist, Math.abs(bRef)));
    }
    console.log("grid coordinates, worst errors", worst);
    expect(worst.e).toBeLessThan(1e-15);
    expect(worst.de).toBeLessThan(1e-14);
    expect(worst.b).toBeLessThan(1e-14);
    expect(worst.ds).toBeLessThan(1e-14);
  });
});

describe("grid camera moves", () => {
  it("follow exact composition along random walks (deep zoom at E = 30, out to E = 55, across the polar centre)", () => {
    const report: string[] = [];
    for (const w of data.walks) {
      const kind = w.kind as GridKind;
      let g: GridCamera = { s: BigInt(w.s0), e: w.e0, theta: w.theta0 };
      let worstPos = 0;
      let worstTurn = 0;
      for (const step of w.steps) {
        const [alpha, d, beta] = step.n;
        g = moveGrid(kind, g, mul(rotation(alpha), mul(boostX(d), rotation(beta))));
        const e = Number(step.e);
        let ds = g.s - BigInt(step.s);
        if (kind === "polar") ds = ((ds % ONE) + ONE + ONE / 2n) % ONE - ONE / 2n;
        const dS = Number(ds) / SCALE;
        // position: the error in E and in S as plane lengths; orientation: theta, and for polar
        // 2 pi phi + theta, which stays well defined at the centre
        worstPos = Math.max(worstPos, Math.hypot(g.e - e, dS * spread(kind, e)));
        const dTheta = wrapAngle(g.theta - Number(step.theta) + (kind === "polar" ? TURN * dS : 0));
        worstTurn = Math.max(worstTurn, Math.abs(dTheta));
      }
      report.push(`${kind} ${w.name}: position ${worstPos.toExponential(1)}, angle ${worstTurn.toExponential(1)}`);
      expect(worstPos, `${kind} ${w.name}`).toBeLessThan(1e-12);
      expect(worstTurn, `${kind} ${w.name}`).toBeLessThan(1e-12);
    }
    console.log(report.join("\n"));
  });

  it("start at home with the grid's axes on the screen's", () => {
    for (const kind of GRID_KINDS) expect(homeGrids()[kind]).toEqual({ s: 0n, e: 0, theta: 0 });
  });
});

describe("per-frame slot data", () => {
  it("gives frac(2^(m0 + j) S0 / unit) for j from -32 to 30 like a direct BigInt computation", () => {
    const r = rng(81);
    let worst = 0;
    for (let n = 0; n < 60; n++) {
      const kind = GRID_KINDS[n % 3];
      const unit = (["earth", "km", "m", "R"] as GridUnit[])[n % 4];
      const s = BigInt(Math.floor(r() * 2 ** 50)) * (1n << 206n) + BigInt(Math.floor(r() * 2 ** 50)) + (kind === "polar" ? 0n : BigInt(Math.floor((r() - 0.5) * 2e4)) * ONE);
      const g: GridCamera = { s: kind === "polar" ? s % ONE : s, e: kind === "polar" ? 1 + r() * 50 : (r() - 0.5) * 100, theta: 0 };
      const f = gridFrame(kind, unit, g, 10 ** (-11 + r() * 8))!;
      for (const slot of f.slots) {
        const perR = BigInt(UNITS[unit].perR);
        for (let j = J_MIN; j <= J_MAX; j++) {
          const m = slot.m0 + j;
          // 2^m S0 / unit as num / den
          let num = g.s;
          let den = ONE;
          if (kind !== "polar") {
            num *= perR;
            if (slot.k < 0) num *= 10n ** BigInt(-slot.k);
            else den *= 10n ** BigInt(slot.k);
          }
          if (m >= 0) num <<= BigInt(m);
          else den <<= BigInt(-m);
          const rem = ((num % den) + den) % den;
          const exact = Number((rem << 64n) / den) / 2 ** 64;
          const got = bitsPhase(slot.bits, slot.frac, j);
          const err = Math.abs(wrapAngle(TURN * (got - exact))) / TURN;
          worst = Math.max(worst, err / 2 ** Math.max(0, j));
        }
      }
    }
    console.log("slot phase, worst error / 2^j", worst);
    expect(worst).toBeLessThan(2 ** -50);
  });
});

describe("grid lines at deep zoom", () => {
  it("pass through points exactly on lines to within 1e-4 px (1e-9 and 1e-11 R per pixel, E0 to 55, S0 with 256 bits)", () => {
    const report: string[] = [];
    for (const c of data.lines) {
      const kind = c.kind as GridKind;
      const g: GridCamera = { s: BigInt(c.s0), e: c.e0, theta: c.theta };
      const f = gridFrame(kind, c.unit as GridUnit, g, c.lpx)!;
      let worst = 0;
      for (const p of c.points) {
        const lines = gridLines(f, p.q as Vec3, c.lpx)!;
        const level = lines.levels.find((l) => l.k === p.k);
        expect(level, `${kind} ${c.unit} level ${p.k}`).toBeDefined();
        expect(level!.m).toBe(p.m);
        worst = Math.max(worst, p.family === "even" ? level!.even : level!.spread);
      }
      report.push(`${kind} ${c.unit} E0 ${c.e0} at ${c.lpx} R/px: ${c.points.length} points, worst ${worst.toExponential(1)} px`);
      expect(worst, `${kind} ${c.unit} E0 ${c.e0}`).toBeLessThan(1e-4);
    }
    console.log(report.join("\n"));
  });

  it("do not depend on which levels the frame sends, as long as the pixel's are among them", () => {
    const r = rng(7);
    for (const kind of GRID_KINDS) {
      const g: GridCamera = { s: 12345n << 200n, e: kind === "polar" ? 3 : -1.5, theta: 0.4 };
      for (let n = 0; n < 200; n++) {
        const lpx = 10 ** (-9 + r() * 6);
        const q: Vec3 = [(r() - 0.5) * 600 * lpx, (r() - 0.5) * 600 * lpx, 0];
        q[2] = Math.sqrt(1 + q[0] ** 2 + q[1] ** 2);
        const a = gridLines(gridFrame(kind, "km", g, lpx)!, q, lpx);
        const b = gridLines(gridFrame(kind, "km", g, lpx * 20)!, q, lpx);
        expect(b!.levels.map((l) => l.k)).toEqual(a!.levels.map((l) => l.k));
        b!.levels.forEach((l, i) => {
          expect(Math.abs(l.even - a!.levels[i].even)).toBeLessThan(1e-6);
          expect(Math.abs(l.spread - a!.levels[i].spread)).toBeLessThan(1e-6);
        });
      }
    }
  });
});

describe("grid opacity", () => {
  const DARK: RGB = [0.02, 0.025, 0.03];
  const ACCENT: RGB = [0.27, 0.65, 1];
  const diff = (a: RGB, b: RGB) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

  it("changes continuously while zooming through the levels", () => {
    const r = rng(19);
    for (const kind of GRID_KINDS) {
      const g: GridCamera = { s: 0n, e: kind === "polar" ? 2 : 0.5, theta: 0.3 };
      const points: Vec3[] = Array.from({ length: 40 }, () => {
        const d = 10 ** (-5 + r() * 3);
        const a = r() * TURN;
        return [Math.sinh(d) * Math.cos(a), Math.sinh(d) * Math.sin(a), Math.cosh(d)];
      });
      let worst = 0;
      let prev: RGB[] | null = null;
      // lpx from 1e-3 to 1e-8 R per pixel in steps of 0.05 %
      for (let lpx = 1e-3; lpx > 1e-8; lpx /= 1.0005) {
        const f = gridFrame(kind, "km", g, lpx)!;
        const cols = points.map((q) => shadeGrid(f, DARK, q, lpx, ACCENT));
        if (prev) cols.forEach((c, i) => (worst = Math.max(worst, diff(c, prev![i]))));
        prev = cols;
      }
      expect(worst, kind).toBeLessThan(0.01);
    }
  });

  it("changes continuously where the spreading lines subdivide", () => {
    for (const kind of GRID_KINDS) {
      const unit: GridUnit = "R";
      const lpx = 1e-4;
      const delta = 1e-2; // the middle level at this lpx, weight 1
      let worst = 0;
      let crossings = 0;
      for (const n of kind === "polar" ? [3, 4, 6] : kind === "cartesian" ? [1, 2, 5] : [-1, 1, 3]) {
        // E where L = n: the camera sits on it and the point moves across in E
        const eStar = kind === "cartesian" ? Math.acosh(2 ** n) : kind === "polar" ? Math.asinh((2 ** n * delta) / TURN) : -n * Math.LN2;
        const g: GridCamera = { s: 0n, e: eStar, theta: 0 };
        const f = gridFrame(kind, unit, g, lpx)!;
        for (const sOffset of [0.37, 1.5, 2.25]) {
          // a point near an in-between line at m + 1, then moving across L = n in E
          const sx = ((kind === "polar" ? 1 : delta) * sOffset) / 2 ** n;
          let prev: RGB | null = null;
          let lastM: number | null = null;
          for (let k = -5000; k <= 5000; k++) {
            const de = k * 1e-3 * lpx;
            const q = pointAt(kind, eStar, sx, eStar + de);
            const c = shadeGrid(f, DARK, q, lpx, ACCENT);
            if (prev) worst = Math.max(worst, diff(c, prev));
            prev = c;
            const m = subdivision(kind, spreadLog2(kind, eStar + de, delta));
            if (lastM !== null && m !== lastM) crossings++;
            lastM = m;
          }
        }
      }
      expect(crossings, kind).toBeGreaterThanOrEqual(9);
      expect(worst, kind).toBeLessThan(0.01);
    }
  });
});

/** The frame point (camera at S = 0, E0, theta = 0) of the point at S = s, E = e, in float64. */
function pointAt(kind: GridKind, e0: number, s: number, e: number): Vec3 {
  switch (kind) {
    case "cartesian": {
      // boostY(-e0) boostX(s) boostY(e) o
      const p: Vec3 = [Math.sinh(s) * Math.cosh(e), Math.sinh(e), Math.cosh(s) * Math.cosh(e)];
      return [p[0], Math.cosh(e0) * p[1] - Math.sinh(e0) * p[2], -Math.sinh(e0) * p[1] + Math.cosh(e0) * p[2]];
    }
    case "polar": {
      // boostX(-e0) rotation(2 pi s) boostX(e) o
      const p: Vec3 = [Math.sinh(e) * Math.cos(TURN * s), Math.sinh(e) * Math.sin(TURN * s), Math.cosh(e)];
      return [Math.cosh(e0) * p[0] - Math.sinh(e0) * p[2], p[1], -Math.sinh(e0) * p[0] + Math.cosh(e0) * p[2]];
    }
    case "horocyclic": {
      const u = Math.exp(-e);
      const p: Vec3 = [s * u, Math.sinh(e) + (s * s * u) / 2, Math.cosh(e) + (s * s * u) / 2];
      return [p[0], Math.cosh(e0) * p[1] - Math.sinh(e0) * p[2], -Math.sinh(e0) * p[1] + Math.cosh(e0) * p[2]];
    }
  }
}

describe("line coverage drawn once over the samples", () => {
  // the tent is the box of one pixel spread by the samples' jitter of half a pixel either side
  const integral = (f: (d: number) => number) => {
    let sum = 0;
    for (let d = -4; d <= 4; d += 1e-3) sum += f(d) * 1e-3;
    return sum;
  };
  it("keeps a line's ink: summed across the line it is the line's width, like the box", () => {
    for (const w of [0.5, 1, 1.5, 3]) {
      expect(integral((d) => tentCoverage(d, w))).toBeCloseTo(w, 3);
      expect(integral((d) => boxCoverage(d, w))).toBeCloseTo(w, 3);
    }
  });
  it("is the box averaged over a jitter of half a pixel either side", () => {
    for (const w of [1, 1.5])
      for (const d of [0, 0.3, 0.75, 1.2, 1.9]) expect(tentCoverage(d, w)).toBeCloseTo(integral((o) => (Math.abs(o) <= 0.5 ? boxCoverage(d + o, w) : 0)), 3);
  });
  it("covers a wide line fully and nothing a pixel past its edge", () => {
    expect(tentCoverage(0, 4)).toBe(1);
    expect(tentCoverage(1.5 + 1, 3)).toBe(0);
  });
});
