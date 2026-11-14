// The motifs as content (design notes, step 16): the built-ins and their presets, choosing a motif
// and leaving it, reading a motif file, Mosaic's identities of the kites and of the polygons around
// P, and the far-tile means against a brute-force integral over the bent tile itself.
import { describe, expect, it } from "vitest";
import { LOOKS } from "../../src/content/looks.ts";
import { cleanMotifSpec, MOTIFS, motifOf, motifSpecOf } from "../../src/content/motifs.ts";
import type { ContentState } from "../../src/content/scene.ts";
import { buildContent, MOTIF_IDS, motifName, motifProblem, PRESETS, readMotif, withConstruction, withMotif } from "../../src/content/scene.ts";
import type { Complex } from "../../src/math/complex.ts";
import { featureAt, nearestOn, poincareDist, SLOTS, toDisk } from "../../src/math/motifs.ts";
import type { Mat3 } from "../../src/math/lorentz.ts";
import { apply, mul, reflection } from "../../src/math/lorentz.ts";
import { BEVEL_WIDTH, featureColour, GLOW_WIDTH, smoothstep } from "../../src/render/reference.ts";
import { applyTile, carryTile, identityTile, tileIdentity } from "../../src/math/tileid.ts";
import { contentLabel } from "../../src/ui/card.ts";
import { boundary, kiteCentre, winding } from "./motif-world.ts";
import { I } from "./wythoff-world.ts";

const presetOf = (id: string) => PRESETS.find((p) => p.content.motif === id)!;

describe("the built-in motifs", () => {
  it("compile, fit their colourings, and each has a preset named as the title names it", () => {
    expect(MOTIFS.map((m) => m.id)).toEqual(["shoal", "moths", "rosette", "birds"]);
    for (const { id, spec } of MOTIFS) {
      expect(motifProblem(id, spec.group), id).toBeNull();
      expect(cleanMotifSpec(spec), id).toEqual(spec);
      const p = presetOf(id);
      expect(p.label).toBe(motifName(id));
      expect(contentLabel(p.content)).toBe(p.label);
      expect(p.content.group).toEqual(spec.group);
      expect(p.content.colouring).toBe(spec.colouring);
      expect(p.content.sides).toEqual([false, false, false]);
      expect(LOOKS.some((l) => l.name === p.look)).toBe(true);
      const c = buildContent(p.content, p.label);
      expect(c.motif).toBe(motifOf(id));
      expect(c.wythoff).toBeNull();
      expect(c.shading.rim.every(Number.isFinite)).toBe(true);
    }
    expect(MOTIF_IDS.map(motifName)).toEqual(["Shoal (3,3,4)", "Moths {6,4}", "Rosette {8,3}", "Birds (4,4,3)"]);
    // the unit grid stays the last preset
    expect(PRESETS[PRESETS.length - 1].label).toBe("Unit grid");
  });
});

describe("choosing a motif", () => {
  const start: ContentState = { ...PRESETS[0].content, sides: [true, false, true], construction: "snub", plain: true };

  it("brings its group and colouring, goes back to Lines, shows the tiling and turns the lines off", () => {
    const s = withMotif(start, "rosette");
    expect(s.motif).toBe("rosette");
    expect(s.group).toEqual([8, 3, 2]);
    expect(s.colouring).toBe("c4");
    expect(s.sides).toEqual([false, false, false]);
    expect(s.construction).toBeUndefined();
    expect(s.plain).toBeUndefined();
    expect(contentLabel(s)).toBe("Rosette {8,3}");
    // another colouring is no longer the preset, but the title still names the motif
    expect(contentLabel({ ...s, colouring: "parity" })).toBe("Rosette {8,3}");
    // none keeps the group and gets the tile edges back; lines turned on stay as they are
    const none = withMotif(s, null);
    expect(none.motif).toBeUndefined();
    expect(none.group).toEqual([8, 3, 2]);
    expect(none.sides).toEqual([false, false, true]);
    expect(withMotif({ ...s, sides: [true, false, false] }, null).sides).toEqual([true, false, false]);
    expect(contentLabel(none)).toBe("{8,3} octagons");
  });

  it("is left by another construction, and kept by Lines", () => {
    const s = withMotif(start, "birds");
    expect(withConstruction(s, "snub").motif).toBeUndefined();
    expect(withConstruction(s, "free").motif).toBeUndefined();
    expect(withConstruction(s, "lines").motif).toBe("birds");
  });

  it("refuses a motif on another group, and a loaded one with a colouring its group does not have", () => {
    expect(motifProblem("shoal", [7, 3, 2])).toBe("Shoal is drawn for (3, 3, 4), not (7, 3, 2)");
    expect(motifProblem("nope", [7, 3, 2])).toBe('unknown motif "nope"');
    expect(motifProblem({ ...motifSpecOf("shoal"), colouring: "c99" }, [3, 3, 4])).toMatch(/^its colouring: /);
    expect(() => buildContent({ ...PRESETS[0].content, motif: "shoal" })).toThrow(/drawn for \(3, 3, 4\)/);
  });
});

describe("a motif file", () => {
  it("is read to the format's fields, or refused with the reason", () => {
    const file = { ...motifSpecOf("birds"), name: "My birds", author: "me", features: [{ kind: "circle", colour: "white", centre: [0.1, 0.05], radius: 0.01, extra: 1 }] };
    const r = readMotif(file);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec).not.toHaveProperty("author");
      expect(r.spec.features![0]).not.toHaveProperty("extra");
      expect(motifName(r.spec)).toBe("My birds (4,4,3)");
      expect(withMotif(PRESETS[0].content, r.spec).group).toEqual([4, 4, 3]);
    }
    const refused: [unknown, RegExp][] = [
      [[1, 2], /JSON object/],
      ["shoal", /JSON object/],
      [{ ...file, group: [3, 3, 3] }, /not a hyperbolic/],
      [{ ...file, colouring: "c99" }, /its colouring/],
      // below PQ, outside both triangles beside PR
      [{ ...file, pr: [[0.1, -0.05], [0.15, -0.05]] }, /from P to R leaves the two triangles/],
      [{ ...file, version: 9 }, /newer/],
    ];
    for (const [json, why] of refused) {
      const x = readMotif(json);
      expect(x.ok).toBe(false);
      if (!x.ok) expect(x.reason).toMatch(why);
    }
  });
});

describe("Mosaic's identities", () => {
  // the rotation group by breadth-first search from the identity kite, each kite keyed by its centre
  function kites(group: readonly [number, number, number], radius: number): { M: Mat3; word: number[] }[] {
    const m = motifOf(MOTIFS.find((b) => b.spec.group.join() === group.join())!.id);
    const R = m.group.normals.map(reflection);
    const gens: [Mat3, number[]][] = [
      [mul(R[1], R[0]), [1, 0]],
      [mul(R[0], R[1]), [0, 1]],
      [mul(R[2], R[0]), [2, 0]],
      [mul(R[0], R[2]), [0, 2]],
    ];
    const c0 = kiteCentre(m.group);
    const key = (M: Mat3) => apply(M, c0).map((v) => Math.round(v * 1e7) + 0).join();
    const seen = new Map([[key(I), 0]]);
    const out = [{ M: I, word: [] as number[] }];
    for (let i = 0; i < out.length; i++)
      for (const [G, w] of gens) {
        const M = mul(out[i].M, G);
        const k = key(M);
        if (Math.acosh(apply(M, c0)[2]) > radius) continue;
        const word = [...out[i].word, ...w];
        if (seen.has(k)) {
          // reached again by another word: the same identity (checked below through `again`)
          again.push([out[seen.get(k)!].word, word]);
          continue;
        }
        seen.set(k, out.length);
        out.push({ M, word });
      }
    return out;
  }
  let again: [number[], number[]][] = [];

  it("give every kite within distance 5 its own identity, the same by any word, and the p kites around P one polygon", () => {
    for (const { spec } of MOTIFS) {
      again = [];
      const g = spec.group;
      const ids = tileIdentity({ p: g[0], q: g[1], r: g[2] });
      const kiteId = (word: number[]) => applyTile(carryTile(identityTile(), word, ids), ids.vt, ids.l).join();
      const polygonId = (word: number[]) => applyTile(carryTile(identityTile(), word, ids), ids.w, ids.l).join();
      const list = kites(g, 5);
      expect(list.length, spec.name).toBeGreaterThan(200);
      expect(new Set(list.map((k) => kiteId(k.word))).size, spec.name).toBe(list.length);
      expect(again.length).toBeGreaterThan(list.length);
      for (const [a, b] of again) expect(kiteId(b)).toBe(kiteId(a));
      for (const [a, b] of again) expect(polygonId(b)).toBe(polygonId(a));
      // rho_P turns about P: the polygon stays, and p turns of it are its p kites
      const rhoP = [1, 0];
      const around = Array.from({ length: g[0] }, (_, i) => Array.from({ length: i }, () => rhoP).flat());
      expect(new Set(around.map(polygonId)).size).toBe(1);
      expect(new Set(around.map(kiteId)).size).toBe(g[0]);
      // polygons are told apart: the kites' polygon centres and identities pair one to one
      const centre = (word: number[]) => {
        const R = triangleNormals(g).map(reflection);
        return apply(word.reduce((M, j) => mul(M, R[j]), I), [0, 0, 1]).map((v) => Math.round(v * 1e7) + 0).join();
      };
      const byCentre = new Map<string, string>();
      const byId = new Map<string, string>();
      for (const k of list) {
        const c = centre(k.word);
        const id = polygonId(k.word);
        expect(byCentre.get(c) ?? id).toBe(id);
        expect(byId.get(id) ?? c).toBe(c);
        byCentre.set(c, id);
        byId.set(id, c);
      }
      expect(byCentre.size).toBeGreaterThan(list.length / g[0] / 2);
    }
  });
});

const triangleNormals = (g: readonly [number, number, number]) => motifOf(MOTIFS.find((b) => b.spec.group.join() === g.join())!.id).group.normals;

describe("the far-tile means", () => {
  it("match a brute-force integral over the bent tile (grid in the disk, winding number, distance to its edge)", () => {
    for (const { id } of MOTIFS) {
      const preset = presetOf(id);
      const m = motifOf(id);
      // relief, glow and a tile-slot feature toned all count
      const content = buildContent({ ...preset.content, look: { ...LOOKS[1].look, glow: 0.3, relief: 0.8 } });
      const { style, shading } = content;
      const loop = boundary(m, 4).map(toDisk);
      loop.push(loop[0]);
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const w of loop) [x0, y0, x1, y1] = [Math.min(x0, w[0]), Math.min(y0, w[1]), Math.max(x1, w[0]), Math.max(y1, w[1])];
      const h = 0.0025;
      let W = 0;
      let A = 0;
      const B = [0, 0, 0];
      const maxInside = shading.maxInside;
      for (let x = x0 + h / 2; x < x1; x += h)
        for (let y = y0 + h / 2; y < y1; y += h) {
          const w: Complex = [x, y];
          if (winding(loop, w) === 0) continue;
          const r2 = x * x + y * y;
          const dA = (4 / (1 - r2) ** 2) * h * h;
          const de = poincareDist(w, nearestOn(w, loop));
          const fi = m.features.length ? featureAt(m, w) : -1;
          let a = 1;
          let b = [0, 0, 0];
          if (fi >= 0) {
            const f = m.features[fi];
            a = SLOTS[f.slot] === "tile" ? (f.tone > 0 ? 1 - f.tone : 1 + f.tone) : 0;
            b = featureColour(f, style, [0, 0, 0]);
          } else {
            const hp = style.relief * (1 - smoothstep(0, BEVEL_WIDTH * maxInside, de));
            const gamma = style.glow * Math.exp(-de / (GLOW_WIDTH * maxInside));
            a = (1 - gamma) / Math.sqrt(1 + hp * hp);
            b = style.lineColour.map((c) => c * gamma);
          }
          W += dA;
          A += a * dA;
          for (let k = 0; k < 3; k++) B[k] += b[k] * dA;
        }
      const g = m.group;
      const kite = 2 * Math.PI * (1 - 1 / g.p - 1 / g.q - 1 / g.r);
      expect(Math.abs(W / kite - 1), `${id} area`).toBeLessThan(2e-3);
      expect(Math.abs(A / W - shading.avgFactor), `${id} fill`).toBeLessThan(1.5e-3);
      for (let k = 0; k < 3; k++) expect(Math.abs(B[k] / W - shading.avgGlow[k]), `${id} glow and features`).toBeLessThan(1.5e-3);
    }
  });
});
