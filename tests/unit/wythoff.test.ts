// Wythoff tilings (math/wythoff.ts) against brute force over the tiling's own edges and faces, walked
// out from the origin as design-checks/check_wythoff_faces.py does: the face of every point, its
// distance to the edges, the face across the nearest edge, the faces' identities and the edge length.
import { describe, expect, it } from "vitest";
import { isHyperbolic, triangleGroup } from "../../src/math/groups.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { apply, dist, mink, reflection, reflectPoint } from "../../src/math/lorentz.ts";
import { applyTile, carryTile, faceHash, identityTile, mosaicHash, tileIdentity } from "../../src/math/tileid.ts";
import type { Construction } from "../../src/math/wythoff.ts";
import { faceAcross, generatorOf, MAX_WY_FACES, MAX_WY_LINES, snubWeights, wythoff, wythoffAt, wythoffSymbol } from "../../src/math/wythoff.ts";
import { randomPoint, rng } from "./rng.ts";
import { close, cross2, klein, segDist, toDomain, trueFace, world } from "./wythoff-world.ts";

type Named = Exclude<Construction, "lines">;
const NAMED: Named[] = ["010", "001", "100", "110", "101", "011", "111", "snub"];
const GROUPS: [number, number, number][] = [
  [7, 3, 2],
  [5, 4, 2],
  [4, 5, 2],
  [3, 3, 4],
  [2, 3, 7],
  [6, 4, 2],
  // q = 2: the kite's corner Q is no corner (its angle is pi)
  [5, 2, 4],
];

describe("Wythoff tables", () => {
  it("fit the shader in every group up to 8 and in large ones, and the snub's edges are equal", () => {
    const groups: [number, number, number][] = [[20, 3, 2], [3, 20, 2], [20, 20, 2], [2, 3, 20], [20, 20, 20], [12, 12, 12], [64, 3, 2], [2, 4, 64], [64, 64, 64], [2, 64, 64], [3, 64, 64], [64, 64, 3]];
    for (let p = 2; p <= 8; p++) for (let q = 2; q <= 8; q++) for (const r of [2, 3, 4]) if (isHyperbolic(p, q, r)) groups.push([p, q, r]);
    let most = [0, 0];
    for (const [p, q, r] of groups) {
      const g = triangleGroup(p, q, r);
      for (const c of NAMED) {
        const t = wythoff(g, c);
        expect(t.lines.length).toBeLessThanOrEqual(MAX_WY_LINES);
        expect(t.faces.length).toBeLessThanOrEqual(MAX_WY_FACES);
        expect(t.matching).toBeGreaterThan(0);
        most = [Math.max(most[0], t.lines.length), Math.max(most[1], t.faces.length)];
        // every face's mask names listed lines; each line has two different faces
        for (const f of t.faces) expect(f.mask >> t.lines.length).toBe(0);
        for (const [a, b] of t.sides) expect(a).not.toBe(b);
        // every kind that exists is a face that meets the domain
        for (let k = 0; k < 4; k++) if (t.colourOf[k] >= 0) expect(t.faces.slice(0, t.matching).some((f) => f.kind === k)).toBe(true);
      }
      const G = generatorOf(g, snubWeights(g));
      const L = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => dist(G, reflectPoint(reflectPoint(G, g.normals[b]), g.normals[a])));
      expect(Math.max(...L) - Math.min(...L)).toBeLessThan(1e-12);
    }
    expect(most[0]).toBeLessThanOrEqual(12);
  });

  it("put every point in its own face, at its distance to the nearest edge", () => {
    const r = rng(15);
    for (const [p, q, rr] of GROUPS) {
      const g = triangleGroup(p, q, rr);
      for (const c of [...NAMED, "free"] as Named[]) {
        const t = wythoff(g, c, c === "free" ? [0.3, 1.7, 0.6] : undefined);
        const w = world(g, t);
        for (let s = 0; s < 120; s++) {
          const x = randomPoint(r, 2);
          const truth = Math.min(...w.edges.map(([a, b]) => segDist(x, a, b)));
          if (truth < 1e-7) continue;
          const { y, M } = toDomain(g, t, x);
          const hit = wythoffAt(t, y);
          // exactly one face fits
          let bits = 0;
          t.lines.forEach((m, e) => (bits |= mink(y, m) > 0 ? 1 << e : 0));
          expect(t.faces.slice(0, t.matching).filter((f) => ((bits ^ f.want) & f.mask) === 0).length).toBe(1);
          const own = trueFace(x, w)!;
          expect(close(apply(M, t.faces[hit.face].centre), own.centre)).toBe(true);
          expect(t.faces[hit.face].kind).toBe(own.kind);
          expect(Math.abs(hit.de - truth)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("know the face across the nearest edge, on both sides of random edges", () => {
    const r = rng(16);
    for (const [p, q, rr] of GROUPS) {
      const g = triangleGroup(p, q, rr);
      for (const c of [...NAMED, "free"] as Named[]) {
        const t = wythoff(g, c, c === "free" ? [1.2, 0.4, 0.9] : undefined);
        const w = world(g, t);
        const near = w.edges.filter(([a, b]) => Math.min(a[2], b[2]) < Math.cosh(1.6));
        for (let s = 0; s < 40; s++) {
          const [A, B] = near[Math.floor(r() * near.length)];
          const d = dist(A, B);
          const u = 0.15 + 0.7 * r();
          const k = 1 / Math.sinh(d);
          const mid: Vec3 = [0, 1, 2].map((i) => (Math.sinh((1 - u) * d) * A[i] + Math.sinh(u * d) * B[i]) * k) as Vec3;
          const c3: Vec3 = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], -(A[0] * B[1] - A[1] * B[0])];
          const n = c3.map((v) => v / Math.sqrt(mink(c3, c3))) as Vec3;
          const eps = 1e-5 * (0.5 + r());
          for (const sgn of [1, -1]) {
            const x = mid.map((v, i) => v * Math.cosh(eps) + sgn * Math.sinh(eps) * n[i]) as Vec3;
            const xo = mid.map((v, i) => v * Math.cosh(eps) - sgn * Math.sinh(eps) * n[i]) as Vec3;
            const { y, M } = toDomain(g, t, x);
            const hit = wythoffAt(t, y);
            const across = t.faces[faceAcross(t, hit.face, hit.line)];
            const other = trueFace(xo, w)!;
            expect(close(apply(M, across.centre), other.centre)).toBe(true);
            expect(across.kind).toBe(other.kind);
          }
        }
      }
    }
  });

  it("name every face by its identity: the same by the pixel's word, distinct within 3 R", () => {
    const r = rng(17);
    for (const [p, q, rr] of GROUPS) {
      const g = triangleGroup(p, q, rr);
      const ids = tileIdentity(g);
      const own = [...ids.corners, ids.vt];
      const idOf = (word: number[], kind: number) => applyTile(carryTile(identityTile(), word, ids), own[kind], ids.l);
      for (const c of NAMED) {
        const t = wythoff(g, c);
        const w = world(g, t, 3.6);
        const hashes = new Set<number>();
        const within = w.faces.filter((f) => f.centre[2] < Math.cosh(3));
        for (const f of within) hashes.add(faceHash(idOf(f.word, f.kind), f.kind, ids.l));
        expect(hashes.size).toBe(within.length);
        for (let s = 0; s < 60; s++) {
          const x = randomPoint(r, 1.8);
          const { y, word, M } = toDomain(g, t, x);
          const hit = wythoffAt(t, y);
          const face = t.faces[hit.face];
          // the shader's route: the camera's matrix along the fold word, applied to the face's vector
          const mine = applyTile(carryTile(identityTile(), word, ids), face.id, ids.l);
          const truth = w.faces.find((h) => close(h.centre, apply(M, face.centre)))!;
          expect(mine).toEqual(idOf(truth.word, truth.kind));
        }
      }
    }
  });

  it("give the faces around P exactly step 14's tile identity", () => {
    for (const [p, q, rr] of GROUPS) {
      const g = triangleGroup(p, q, rr);
      const ids = tileIdentity(g);
      expect(faceHash(ids.w, 0, ids.l)).toBe(mosaicHash(ids.w));
      expect(wythoff(g, "111").faces[0].id).toEqual(ids.w);
    }
  });

  it("measure the edge length per area as the edges clipped to the domain", () => {
    for (const [p, q, rr] of GROUPS) {
      const g = triangleGroup(p, q, rr);
      for (const c of [...NAMED, "free"] as Named[]) {
        const t = wythoff(g, c, c === "free" ? [0.3, 1.7, 0.6] : undefined);
        const R = g.normals.map(reflection);
        const C = [g.corners.P, g.corners.Q, g.corners.R];
        const dom = (t.kite ? [C[0], C[2], C[1], apply(R[0], C[2])] : C).map(klein);
        const area = Math.PI * (1 - 1 / p - 1 / q - 1 / rr) * (t.kite ? 2 : 1);
        let L = 0;
        for (const [a, b] of world(g, t, 3.2).edges) L += clipped(a, b, dom);
        expect(t.lengthPerArea / (L / area)).toBeCloseTo(1, 6);
      }
    }
  });

  it("are named by their Wythoff symbols", () => {
    const g = { p: 7, q: 3, r: 2 };
    expect(["010", "001", "100", "110", "101", "011", "111", "snub"].map((c) => wythoffSymbol(g, c as Exclude<Named, "free">))).toEqual(["3 | 7 2", "7 | 3 2", "2 | 7 3", "3 2 | 7", "7 2 | 3", "7 3 | 2", "7 3 2 |", "| 7 3 2"]);
  });

  it("refuse a free point without weights", () => {
    const g = triangleGroup(7, 3, 2);
    expect(() => wythoff(g, "free", [0, 0, 0])).toThrow();
    expect(() => wythoff(g, "free", [1, -1, 0])).toThrow();
    expect(wythoff(g, "free", [0, 1, 0]).lines.length).toBe(1);
  });
});

/** Twice the length of segment ab inside the convex polygon dom (Klein: straight), once when it lies
 *  along dom's boundary: the line share's convention. */
function clipped(a: Vec3, b: Vec3, dom: [number, number][]): number {
  const ka = klein(a);
  const kb = klein(b);
  let t0 = 0;
  let t1 = 1;
  let area = 0;
  for (let i = 0; i < dom.length; i++) area += dom[i][0] * dom[(i + 1) % dom.length][1] - dom[(i + 1) % dom.length][0] * dom[i][1];
  const sgn = Math.sign(area);
  let boundary = false;
  for (let i = 0; i < dom.length; i++) {
    const p0 = dom[i];
    const p1 = dom[(i + 1) % dom.length];
    const fa = sgn * cross2(p0, p1, ka);
    const fb = sgn * cross2(p0, p1, kb);
    if (Math.abs(fa) < 1e-10 && Math.abs(fb) < 1e-10) {
      boundary = true;
      continue;
    }
    if (fa < 0 && fb < 0) return 0;
    if (fa < 0) t0 = Math.max(t0, fa / (fa - fb));
    else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
  }
  if (t1 <= t0) return 0;
  const pt = (s: number): Vec3 => {
    const k = [ka[0] + s * (kb[0] - ka[0]), ka[1] + s * (kb[1] - ka[1])];
    const z = 1 / Math.sqrt(1 - k[0] * k[0] - k[1] * k[1]);
    return [k[0] * z, k[1] * z, z];
  };
  const L = dist(pt(t0), pt(t1));
  return boundary ? L : 2 * L;
}
