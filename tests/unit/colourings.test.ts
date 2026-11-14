import { describe, expect, it } from "vitest";
import type { ChiralColouring, Colouring, MirrorColouring, Perm } from "../../src/math/colourings.ts";
import {
  carry,
  colourAcross,
  colourOf,
  compose,
  faces2,
  findChiralColourings,
  findColourings,
  identityPerm,
  isTransitive,
  parity,
  validate,
} from "../../src/math/colourings.ts";
import { distanceToSide, fold, isHyperbolic, recenter, triangleGroup } from "../../src/math/groups.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { apply, mul, reflectPoint, reflection, rotation, translationTo } from "../../src/math/lorentz.ts";
import { colouringFor, colouringNames } from "../../src/content/scene.ts";
import { randomPoint, rng } from "./rng.ts";

describe("colouring validator", () => {
  it("accepts parity for every group", () => {
    for (const g of [{ p: 7, q: 3, r: 2 }, { p: 5, q: 4, r: 2 }, { p: 3, q: 3, r: 4 }]) expect(validate(parity, g)).toBeNull();
  });
  it("accepts the face colouring only for even q, and says why otherwise", () => {
    expect(validate(faces2, { p: 5, q: 4, r: 2 })).toBeNull();
    expect(validate(faces2, { p: 7, q: 3, r: 2 })).toMatch(/pi\/q/);
  });
  it("rejects maps that are not involutions", () => {
    expect(validate({ name: "bad", k: 3, sigma: [[1, 2, 0], [0, 1, 2], [0, 1, 2]] }, { p: 7, q: 3, r: 2 })).toMatch(/pairs/);
  });
});

describe("colouring search", () => {
  it("finds only valid, transitive, distinct colourings", () => {
    for (const g of [{ p: 6, q: 4, r: 2 }, { p: 4, q: 6, r: 2 }, { p: 8, q: 3, r: 2 }, { p: 5, q: 4, r: 2 }]) {
      const all = findColourings(g);
      expect(all.length).toBeGreaterThan(0);
      for (const c of all) {
        expect(validate(c, g)).toBeNull();
        expect(isTransitive(c)).toBe(true);
      }
      expect(new Set(all.map((c) => JSON.stringify(c.sigma))).size).toBe(all.length);
    }
  });
  it("finds just parity for {7,3} up to 5 colours, since S_5 has no element of order 7", () => {
    const all = findColourings({ p: 7, q: 3, r: 2 }, 5);
    expect(all.length).toBe(1);
    expect(all[0].k).toBe(2);
  });
  it("returns version 1's colourings, permutations and order up to 5 colours", () => {
    let groups = 0;
    for (let p = 2; p <= 8; p++)
      for (let q = 2; q <= 8; q++)
        for (const r of [2, 3]) {
          if (!isHyperbolic(p, q, r) || (r === 3 && (p > 5 || q > 5))) continue;
          const g = { p, q, r };
          expect(findColourings(g, 5)).toEqual(legacySearch(g));
          groups++;
        }
    expect(groups).toBeGreaterThan(30);
  });
  it("finds the design's colourings with 6, 7 and 8 colours", () => {
    const counts: [[number, number, number], number[]][] = [
      [[7, 3, 2], [0, 0, 1]],
      [[8, 3, 2], [7, 0, 5]],
      [[5, 4, 2], [1, 0, 0]],
      [[6, 4, 2], [18, 0, 18]],
      [[3, 3, 4], [5, 2, 5]],
    ];
    for (const [[p, q, r], want] of counts) {
      const all = findColourings({ p, q, r });
      expect([6, 7, 8].map((k) => all.filter((c) => c.k === k).length)).toEqual(want);
      // the first ones are version 1's, in its order
      expect(all.slice(0, all.filter((c) => c.k <= 5).length)).toEqual(findColourings({ p, q, r }, 5));
    }
  });
});

describe("chiral colourings", () => {
  const counts: [[number, number, number], number[]][] = [
    [[7, 3, 2], [0, 0, 0, 0, 0, 2, 1]],
    [[8, 3, 2], [1, 1, 1, 0, 3, 0, 5]],
    [[5, 4, 2], [1, 0, 0, 2, 3, 0, 0]],
    [[4, 5, 2], [1, 0, 0, 2, 3, 0, 0]],
    [[6, 4, 2], [3, 1, 4, 1, 10, 4, 14]],
    [[3, 3, 4], [0, 1, 1, 0, 3, 4, 3]],
  ];
  it("are found in the numbers design-checks/check_chiral.py found, valid, transitive and distinct", () => {
    for (const [[p, q, r], want] of counts) {
      const g = { p, q, r };
      const all = findChiralColourings(g);
      expect([2, 3, 4, 5, 6, 7, 8].map((k) => all.filter((c) => c.k === k).length)).toEqual(want);
      for (const c of all) {
        expect(validate(c, g)).toBeNull();
        expect(isTransitive(c)).toBe(true);
      }
      // distinct up to relabelling (brute force over relabellings up to 6 colours)
      const small = all.filter((c) => c.k <= 6);
      for (let i = 0; i < small.length; i++)
        for (let j = i + 1; j < small.length; j++) expect(relabelled(small[i], small[j])).toBe(false);
    }
  });
  it("refuses a pair that does not close up", () => {
    const bad: ChiralColouring = { kind: "chiral", name: "bad", k: 3, alpha: [1, 2, 0], beta: [1, 0, 2] };
    expect(validate(bad, { p: 7, q: 3, r: 2 })).toMatch(/pi\/p/);
    expect(validate({ ...bad, alpha: [1, 0] }, { p: 7, q: 3, r: 2 })).toMatch(/not a permutation/);
  });
  it("give each kite one colour, keep colours through re-centering, and name the colour across each side", () => {
    const r = rng(41);
    for (const [p, q, rr] of [[7, 3, 2], [6, 4, 2], [3, 3, 4], [8, 3, 2]] as const) {
      const g = triangleGroup(p, q, rr);
      const R = g.normals.map(reflection);
      // the middle of side 1 lies inside the kite T + s1 T
      const P = g.corners.P;
      const Q = g.corners.Q;
      const K: Vec3 = [P[0] + Q[0], P[1] + Q[1], P[2] + Q[2]];
      for (const c of findChiralColourings(g).filter((x) => x.k >= 3).slice(0, 4)) {
        const kites = new Map<string, Set<number>>();
        for (let s = 0; s < 1500; s++) {
          const x = randomPoint(r, 3);
          const f = fold(x, g.normals);
          const state = carry(c, identityPerm(c.k), f.word);
          // the kite of the even element h (h s1 for an odd word), found from the geometry
          let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
          for (const j of f.word.length % 2 ? [...f.word, 0] : f.word) M = mul(M, R[j]);
          const key = apply(M, K).map((v) => v.toFixed(6)).join(",");
          if (!kites.has(key)) kites.set(key, new Set());
          kites.get(key)!.add(colourOf(c, state));
          // across sides 2 and 3: the colour of the point just across, folded on its own
          for (const j of [1, 2]) {
            if (distanceToSide(f.x, g.normals[j]) > 0.3) continue;
            let y = reflectPoint(f.x, g.normals[j]);
            for (const i of [...f.word].reverse()) y = reflectPoint(y, g.normals[i]);
            const fy = fold(y, g.normals);
            expect(colourAcross(c, state, j)).toBe(colourOf(c, carry(c, identityPerm(c.k), fy.word)));
          }
          expect(colourAcross(c, state, 0)).toBe(colourOf(c, state));
        }
        expect([...kites.values()].every((set) => set.size === 1)).toBe(true);
        // re-centering by an even word, the permutation carried along its pairs
        for (let t = 0; t < 10; t++) {
          const cam = mul(translationTo(randomPoint(r, 5)), rotation(r() * 7));
          const { g: sym, word } = recenter(cam, g);
          expect(word.length % 2).toBe(0);
          const moved = carry(c, identityPerm(c.k), word);
          expect(moved.pending).toBe(-1);
          const cam2 = mul(sym, cam);
          for (let s = 0; s < 100; s++) {
            const w = randomPoint(r, 3);
            const a = colourOf(c, carry(c, identityPerm(c.k), fold(apply(cam, w), g.normals).word));
            const b = colourOf(c, carry(c, moved.perm, fold(apply(cam2, w), g.normals).word));
            expect(b).toBe(a);
          }
        }
      }
    }
  });
});

describe("the colourings offered", () => {
  it("come by colour count, mirror ones before chiral ones, parity and faces first", () => {
    for (const [p, q, rr] of [[7, 3, 2], [6, 4, 2], [8, 3, 2], [5, 4, 2]] as const) {
      const g = triangleGroup(p, q, rr);
      const names = colouringNames(g);
      expect(names[0]).toBe("parity");
      expect(new Set(names).size).toBe(names.length);
      const list = names.map((n) => ({ n, c: colouringFor(g, n) }));
      for (let i = 1; i < list.length; i++) {
        const [a, b] = [list[i - 1], list[i]];
        expect(a.c.k).toBeLessThanOrEqual(b.c.k);
        if (a.c.k === b.c.k) expect(a.c.kind === "chiral" && b.c.kind !== "chiral").toBe(false);
      }
      expect(list.filter((x) => x.c.kind === "chiral").every((x) => x.n.startsWith("r"))).toBe(true);
      expect(list.some((x) => x.c.k >= 6)).toBe(true);
    }
  });
});

describe("mirror colourings along a word", () => {
  it("carry, colourOf and colourAcross are version 1's composition", () => {
    const r = rng(5);
    const g = triangleGroup(6, 4, 2);
    for (const c of findColourings(g)) {
      for (let s = 0; s < 40; s++) {
        const word = fold(randomPoint(r, 3), g.normals).word;
        let P = identityPerm(c.k);
        for (const j of word) P = compose(P, c.sigma[j]);
        const state = carry(c, identityPerm(c.k), word);
        expect(state).toEqual({ perm: P, pending: -1 });
        expect(colourOf(c, state)).toBe(P[0]);
        for (const j of [0, 1, 2]) expect(colourAcross(c, state, j)).toBe(P[c.sigma[j][0]]);
      }
    }
  });
});

/** True when b is a relabelling of a (same kind and colour count). */
function relabelled(a: Colouring, b: Colouring): boolean {
  if (a.kind !== b.kind || a.k !== b.k) return false;
  const gens = (c: Colouring) => (c.kind === "chiral" ? [c.alpha, c.beta] : c.sigma);
  const ga = gens(a);
  const gb = gens(b);
  for (const t of permutations(a.k)) {
    const ti: Perm = [];
    t.forEach((v, i) => (ti[v] = i));
    if (ga.every((s, j) => compose(t, compose(s, ti)).join() === gb[j].join())) return true;
  }
  return false;
}

// ----------------------------------------------------------------------------- version 1's search

function involutions(k: number): Perm[] {
  const out: Perm[] = [];
  const rec = (p: Perm, i: number) => {
    if (i === k) return out.push([...p]);
    if (p[i] !== -1) return rec(p, i + 1);
    p[i] = i;
    rec(p, i + 1);
    for (let j = i + 1; j < k; j++)
      if (p[j] === -1) {
        p[i] = j;
        p[j] = i;
        rec(p, i + 1);
        p[j] = -1;
      }
    p[i] = -1;
  };
  rec(new Array(k).fill(-1), 0);
  return out;
}

function permutations(k: number): Perm[] {
  if (k === 0) return [[]];
  const out: Perm[] = [];
  for (const p of permutations(k - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), k - 1, ...p.slice(i)]);
  return out;
}

function canonical(sigma: Perm[], relabels: Perm[]): string {
  let best = "";
  for (const t of relabels) {
    const inv: Perm = [];
    t.forEach((v, i) => (inv[v] = i));
    const key = sigma.map((s) => compose(t, compose(s, inv)).join("")).join("|");
    if (best === "" || key < best) best = key;
  }
  return best;
}

/** Version 1's findColourings, verbatim but for its name: every involution triple, in order. */
function legacySearch(g: { p: number; q: number; r: number }, maxK = 5): MirrorColouring[] {
  const found: MirrorColouring[] = [];
  for (let k = 2; k <= maxK; k++) {
    const inv = involutions(k);
    const relabels = permutations(k);
    const seen = new Set<string>();
    for (const a of inv)
      for (const b of inv)
        for (const c of inv) {
          const col: MirrorColouring = { name: "", k, sigma: [a, b, c] };
          if (validate(col, g) !== null || !isTransitive(col)) continue;
          const key = canonical(col.sigma, relabels);
          if (seen.has(key)) continue;
          seen.add(key);
          found.push(col);
        }
  }
  found.forEach((c, i) => (c.name = `Colouring ${i + 1} (${c.k} colours)`));
  return found;
}

describe("colours are a property of the tile", () => {
  it("re-centering the camera leaves 10^4 sample colours unchanged", () => {
    const r = rng(21);
    for (const [pqr, pickK] of [[[6, 4, 2], 4], [[5, 4, 2], 2], [[8, 4, 2], 3]] as const) {
      const g = triangleGroup(pqr[0], pqr[1], pqr[2]);
      const cols = findColourings({ p: pqr[0], q: pqr[1], r: pqr[2] });
      const col = cols.find((c) => c.k === pickK) ?? cols[0];
      const colourAt = (cam: number[], perm: number[], w: [number, number, number]) => {
        let P = perm;
        for (const j of fold(apply(cam, w), g.normals).word) P = compose(P, col.sigma[j]);
        return P[0];
      };
      for (let k = 0; k < 20; k++) {
        const cam = mul(translationTo(randomPoint(r, 5)), rotation(r() * 7));
        const { g: sym, word } = recenter(cam, g);
        let perm = identityPerm(col.k);
        for (const j of word) perm = compose(perm, col.sigma[j]);
        const cam2 = mul(sym, cam);
        for (let s = 0; s < 500; s++) {
          const w = randomPoint(r, 3);
          expect(colourAt(cam2, perm, w)).toBe(colourAt(cam, identityPerm(col.k), w));
        }
      }
    }
  });
});
