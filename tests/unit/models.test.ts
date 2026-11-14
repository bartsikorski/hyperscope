import { describe, expect, it } from "vitest";
import { mink } from "../../src/math/lorentz.ts";
import {
  fromHalfPlane, fromKlein, fromPoincare, halfPlaneToPoincare, poincareToHalfPlane, toHalfPlane, toKlein, toPoincare,
} from "../../src/math/models.ts";
import { randomPoint, rng } from "./rng.ts";

describe("model conversions", () => {
  const r = rng(5);
  it("round-trip through Poincare, Klein and half-plane coordinates", () => {
    for (let k = 0; k < 2000; k++) {
      const x = randomPoint(r, 8);
      for (const back of [fromPoincare(toPoincare(x)), fromKlein(toKlein(x)), fromHalfPlane(toHalfPlane(x))]) {
        for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - x[i]) / x[2]).toBeLessThan(1e-9);
        expect(mink(back, back)).toBeCloseTo(-1, 6);
      }
    }
  });
  it("the half-plane image lies above the real axis and the disk image inside the unit circle", () => {
    for (let k = 0; k < 2000; k++) {
      const x = randomPoint(r, 8);
      const z = toPoincare(x);
      expect(Math.hypot(z[0], z[1])).toBeLessThan(1);
      expect(toHalfPlane(x)[1]).toBeGreaterThan(0);
    }
  });
  it("the Cayley maps are inverse to each other and send the disk centre to i", () => {
    const i = poincareToHalfPlane([0, 0]);
    expect(Math.abs(i[0]) + Math.abs(i[1] - 1)).toBe(0);
    for (let k = 0; k < 500; k++) {
      const z: [number, number] = [r() - 0.5, r() - 0.5];
      const w = halfPlaneToPoincare(poincareToHalfPlane(z));
      expect(Math.abs(w[0] - z[0]) + Math.abs(w[1] - z[1])).toBeLessThan(1e-12);
    }
  });
});
