// Exact tile identity (math/tileid.ts): the triangle group mod a prime, the tile around P's image,
// re-centering, and the Mosaic hash.
import { describe, expect, it } from "vitest";
import { fold, isHyperbolic, recenter, triangleGroup } from "../../src/math/groups.ts";
import type { Mat3, Vec3 } from "../../src/math/lorentz.ts";
import { apply, dist, mul, reflection, rotation, translationTo } from "../../src/math/lorentz.ts";
import type { TileMat } from "../../src/math/tileid.ts";
import { applyTile, carryTile, fitsTile, identityTile, mosaicHash, stepTile, tileIdentity, tileOf, tilePrime, twoCos } from "../../src/math/tileid.ts";
import { homeView, panBy, rotateBy, settle } from "../../src/input/camera.ts";
import { parity } from "../../src/math/colourings.ts";
import { randomPoint, rng } from "./rng.ts";

const GROUPS: [number, number, number][] = [];
for (let p = 2; p <= 12; p++) for (let q = 2; q <= 12; q++) for (const r of [2, 3, 4]) if (isHyperbolic(p, q, r) && (r === 2 || (p <= 8 && q <= 8))) GROUPS.push([p, q, r]);
// and groups whose first prime of the right residues makes 2B singular
GROUPS.push([5, 5, 5], [7, 7, 7], [8, 8, 8], [20, 20, 20], [6, 16, 48], [48, 6, 16], [6, 9, 18], [10, 18, 45], [6, 34, 51]);

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The full matrix S_j, for comparing with stepTile's row update. */
function sMatrix(j: number, d: number[][], l: number): TileMat {
  const m = identityTile();
  // S_j = I + e_j d_j^T: row j gains d_j
  for (let c = 0; c < 3; c++) m[3 * j + c] = (m[3 * j + c] + d[j][c]) % l;
  return m;
}

function matMul(a: TileMat, b: TileMat, l: number): TileMat {
  const out: TileMat = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[3 * r + c] = (a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c]) % l;
  return out;
}

describe("the group mod l", () => {
  it(`keeps the relations with the right orders in ${GROUPS.length} groups`, () => {
    for (const [p, q, r] of GROUPS) {
      const t = tileIdentity({ p, q, r });
      const l = t.l;
      expect(l).toBe(tilePrime(p, q, r));
      expect(l).toBeGreaterThan(4096);
      for (let d = 2; d * d <= l; d++) expect(l % d).not.toBe(0);
      for (const m of [p, q, r]) if (m > 2) expect((l - 1) % (2 * m) === 0 || (l + 1) % (2 * m) === 0).toBe(true);
      const I = identityTile();
      for (const j of [0, 1, 2]) expect(carryTile(I, [j, j], t)).toEqual(I);
      const order = (w: number[]) => {
        let a = I;
        for (let n = 1; n <= 64; n++) {
          a = carryTile(a, w, t);
          if (same(a, I)) return n;
        }
        return -1;
      };
      expect([order([0, 1]), order([0, 2]), order([1, 2])]).toEqual([p, q, r]);
      // w is the tile around P: fixed by S_1 and S_2, moved by S_3 to w3
      expect(t.w.some((v) => v !== 0)).toBe(true);
      expect(applyTile(stepTile(I, 0, t), t.w, l)).toEqual(t.w);
      expect(applyTile(stepTile(I, 1, t), t.w, l)).toEqual(t.w);
      expect(applyTile(stepTile(I, 2, t), t.w, l)).toEqual(t.w3);
      expect(t.w3).not.toEqual(t.w);
      // and the other corners' vectors and the snub triangle's (2B v = (1, 1, 1)) are moved by the third
      expect(applyTile(stepTile(I, 1, t), t.corners[1], l)).not.toEqual(t.corners[1]);
      expect(applyTile(stepTile(I, 0, t), t.corners[2], l)).not.toEqual(t.corners[2]);
      for (const j of [0, 1, 2]) expect(applyTile(stepTile(I, j, t), t.vt, l)).not.toEqual(t.vt);
    }
  });
  it("2cos(pi/m) closes up: z + 1/z with z of order exactly 2m", () => {
    for (const m of [3, 4, 5, 7, 8, 9, 12, 20]) {
      const l = tilePrime(m, 2, 2);
      const c = twoCos(m, l);
      // the companion matrix [[c, -1], [1, 0]] has order 2m
      let [a, b, cc, d] = [1, 0, 0, 1];
      let n = 0;
      do {
        [a, b, cc, d] = [(a * c + b) % l, (l - a) % l, (cc * c + d) % l, (l - cc) % l];
        n++;
      } while (!(a === 1 && b === 0 && cc === 0 && d === 1) && n < 200);
      expect(n).toBe(2 * m);
    }
  });
  it("updates A S_j row by row as the full matrix product does", () => {
    const r = rng(3);
    for (const [p, q, rr] of [[7, 3, 2], [6, 4, 2], [3, 3, 4]] as const) {
      const t = tileIdentity({ p, q, r: rr });
      let a = identityTile();
      for (let s = 0; s < 200; s++) {
        const j = Math.floor(r() * 3);
        const want = matMul(a, sMatrix(j, t.d, t.l), t.l);
        a = stepTile(a, j, t);
        expect(a).toEqual(want);
        expect(a.every((v) => Number.isInteger(v) && v >= 0 && v < t.l)).toBe(true);
      }
      expect(fitsTile(a, t)).toBe(true);
    }
  });
});

describe("tile identities", () => {
  /** Tiles within `radius` of the origin: the identity of every sample, keyed by the tile centre. */
  function tilesNear(p: number, q: number, rr: number, radius: number, n: number, seed: number) {
    const g = triangleGroup(p, q, rr);
    const t = tileIdentity(g);
    const R = g.normals.map(reflection);
    const r = rng(seed);
    const tiles: { centre: Vec3; ids: Set<string> }[] = [];
    for (let s = 0; s < n; s++) {
      const x = randomPoint(r, radius);
      const f = fold(x, g.normals);
      let M: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      for (const j of f.word) M = mul(M, R[j]);
      const centre = apply(M, g.corners.P);
      const id = tileOf(identityTile(), f.word, t).id.join(",");
      let tile = tiles.find((u) => dist(u.centre, centre) < 1e-6);
      if (!tile) tiles.push((tile = { centre, ids: new Set() }));
      tile.ids.add(id);
    }
    return tiles;
  }
  it("are one per tile and never shared within 3 R", () => {
    for (const [p, q, r] of [[7, 3, 2], [8, 3, 2], [5, 4, 2], [4, 5, 2], [6, 4, 2], [3, 3, 4], [2, 3, 7], [3, 7, 2], [12, 3, 2], [5, 5, 5]] as const) {
      const tiles = tilesNear(p, q, r, 3, 5000, p * 100 + q * 10 + r);
      expect(tiles.length).toBeGreaterThan(15);
      expect(tiles.every((u) => u.ids.size === 1)).toBe(true);
      const ids = tiles.map((u) => [...u.ids][0]);
      expect(new Set(ids).size).toBe(ids.length);
      // and their hashes differ too
      expect(new Set(ids.map((s) => mosaicHash(s.split(",").map(Number)))).size).toBe(ids.length);
    }
  });
  it("name the tile across side 3", () => {
    const g = triangleGroup(7, 3, 2);
    const t = tileIdentity(g);
    const r = rng(8);
    for (let s = 0; s < 500; s++) {
      const f = fold(randomPoint(r, 2.5), g.normals);
      // the point just across side 3, unfolded and folded again
      let M: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      for (const j of f.word) M = mul(M, reflection(g.normals[j]));
      const y = fold(apply(M, apply(reflection(g.normals[2]), f.x)), g.normals);
      expect(tileOf(identityTile(), y.word, t).id).toEqual(tileOf(identityTile(), f.word, t).across);
    }
  });
  it("stay the same through re-centering, the camera's matrix carried along its word", () => {
    const r = rng(17);
    for (const [p, q, rr] of [[7, 3, 2], [6, 4, 2], [3, 3, 4], [8, 3, 2]] as const) {
      const g = triangleGroup(p, q, rr);
      const t = tileIdentity(g);
      for (let k = 0; k < 20; k++) {
        const cam = mul(translationTo(randomPoint(r, 5)), rotation(r() * 7));
        const { g: sym, word } = recenter(cam, g);
        const a = carryTile(identityTile(), word, t);
        expect(fitsTile(a, t)).toBe(true);
        const cam2 = mul(sym, cam);
        for (let s = 0; s < 100; s++) {
          const w = randomPoint(r, 3);
          const before = tileOf(identityTile(), fold(apply(cam, w), g.normals).word, t).id;
          const after = tileOf(a, fold(apply(cam2, w), g.normals).word, t).id;
          expect(after).toEqual(before);
        }
      }
    }
  });
});

describe("a camera's tile matrix", () => {
  it("fits its own group and is refused by the checks it should fail", () => {
    const t = tileIdentity({ p: 7, q: 3, r: 2 });
    expect(fitsTile(identityTile(), t)).toBe(true);
    expect(fitsTile([1, 0, 0, 0, 1, 0, 0, 0, t.l], t)).toBe(false);
    expect(fitsTile([1, 0, 0, 0, 1, 0, 0, 0, 2], t)).toBe(false); // determinant 2
    expect(fitsTile([1, 0, 0, 0, 1, 0, 0, 0], t)).toBe(false);
    expect(fitsTile([1, 0, 0, 0, 1, 0, 0, 0, 0.5], t)).toBe(false);
    expect(fitsTile("1.0.0", t)).toBe(false);
    expect(fitsTile(carryTile(identityTile(), [0, 2, 1, 0, 2], t), t)).toBe(true);
  });
});

describe("re-centering the view", () => {
  it("carries the tile matrix, and restarts one from another group", () => {
    const g73 = triangleGroup(7, 3, 2);
    const g54 = triangleGroup(5, 4, 2);
    let v = homeView(2);
    for (let i = 0; i < 6; i++) v = settle(rotateBy(panBy(v, [0, 0], [0.3, 0.1]), 0.4), g73, parity);
    const t73 = tileIdentity(g73);
    expect(fitsTile(v.tile, t73)).toBe(true);
    expect(v.tile).not.toEqual(identityTile());
    // the same move again carries it on; under another group it starts from the identity
    const moved = rotateBy(panBy(v, [0, 0], [0.3, 0.1]), 0.4);
    const { word } = recenter(moved.camera, g73);
    expect(settle(moved, g73, parity).tile).toEqual(carryTile(v.tile!, word, t73));
    const other = settle(moved, g54, parity);
    expect(other.tile).toEqual(carryTile(identityTile(), recenter(moved.camera, g54).word, tileIdentity(g54)));
  });
});

describe("the Mosaic hash", () => {
  it("is a uint32, spreads small vectors over [0, 1) evenly, and is fixed", () => {
    const bins = new Array(16).fill(0);
    for (let a = 0; a < 40; a++)
      for (let b = 0; b < 40; b++) {
        const h = mosaicHash([a, b, (a * 7 + b) % 4099]);
        expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
        bins[h >>> 28]++;
      }
    for (const n of bins) expect(Math.abs(n - 100)).toBeLessThan(40);
    // the shader computes the same bits (GPU tests); these pin the formula
    expect(mosaicHash([0, 0, 0])).toBe(0);
    expect(mosaicHash([1, 2, 3])).toBe(hashRef(1, 2, 3));
    expect(mosaicHash([4128, 17, 2049])).toBe(hashRef(4128, 17, 2049));
  });
});

/** The hash with BigInt arithmetic mod 2^32, an independent spelling of the same formula. */
function hashRef(a: number, b: number, c: number): number {
  const M = 2n ** 32n;
  const m = (x: bigint) => ((x % M) + M) % M;
  let h = m(BigInt(a) * 0x8da6b343n) ^ m(BigInt(b) * 0xd8163841n) ^ m(BigInt(c) * 0xcb1ab31fn);
  h ^= h >> 15n;
  h = m(h * 0x2c1b3c6dn);
  h ^= h >> 12n;
  h = m(h * 0x297a2d39n);
  h ^= h >> 15n;
  return Number(h);
}
