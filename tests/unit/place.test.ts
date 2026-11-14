import { describe, expect, it } from "vitest";
import { homeView, placeAt } from "../../src/input/camera.ts";
import { findColourings } from "../../src/math/colourings.ts";
import { fixedToNumber } from "../../src/math/grid.ts";
import { fold, triangleGroup } from "../../src/math/groups.ts";
import { ORIGIN, apply, boostX, mul, rotation } from "../../src/math/lorentz.ts";
import { rng } from "./rng.ts";

const group = triangleGroup(7, 3, 2);
const colouring = findColourings(group)[0];
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

describe("placing the view at grid coordinates", () => {
  const r = rng(11);
  const cases: [number, number, number][] = [
    [0, 0, 0],
    [1.5, 0, 0],
    [0, -2.25, 1],
    [-3.7, 2.2, -2.5],
    [30, 0.5, 0.25],
    [0.75, -40, 3],
    ...Array.from({ length: 20 }, (): [number, number, number] => [12 * (r() - 0.5), 12 * (r() - 0.5), 7 * (r() - 0.5)]),
  ];
  for (const [x, y, theta] of cases) {
    it(`arrives at X = ${x.toFixed(3)}, Y = ${y.toFixed(3)}, theta = ${theta.toFixed(3)}`, () => {
      const v = placeAt(homeView(colouring.k), x, y, theta, group, colouring);
      const g = v.grids.cartesian;
      // the walk's own grid cameras, before the caller writes the exact values over them
      const tol = 1e-12 * Math.max(1, Math.abs(x) + Math.abs(y));
      expect(Math.abs(fixedToNumber(g.s) - x)).toBeLessThan(tol);
      expect(Math.abs(g.e - y)).toBeLessThan(tol);
      expect(Math.abs(wrap(g.theta - theta))).toBeLessThan(1e-11);
      // the distance from the start, by the polar grid: cosh r = cosh X cosh Y
      const rExact = Math.acosh(Math.cosh(x) * Math.cosh(y));
      expect(Math.abs(v.grids.polar.e - rExact)).toBeLessThan(1e-11 * Math.max(1, rExact));
      // re-centering kept the camera small
      expect(Math.max(...v.camera.map(Math.abs))).toBeLessThan(10);
      // the screen centre is the point boostX(X) boostY(Y) o, up to the tiling's symmetries
      if (Math.abs(x) + Math.abs(y) < 8) {
        const p = apply(mul(boostX(x), mul(rotation(Math.PI / 2), boostX(y))), ORIGIN);
        const a = fold(apply(v.camera, ORIGIN), group.normals).x;
        const b = fold(p, group.normals).x;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-9);
      }
    });
  }
});
