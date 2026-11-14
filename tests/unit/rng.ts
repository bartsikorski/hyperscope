// Deterministic random numbers for tests (mulberry32), so a failure always reproduces.
import type { Vec3 } from "../../src/math/lorentz.ts";

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random point at distance up to maxDist from the origin. */
export function randomPoint(r: () => number, maxDist: number): Vec3 {
  const d = r() * maxDist;
  const phi = r() * 2 * Math.PI;
  return [Math.sinh(d) * Math.cos(phi), Math.sinh(d) * Math.sin(phi), Math.cosh(d)];
}
