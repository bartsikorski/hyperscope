// Wythoff tilings in the CPU reference (render/reference.ts) and the content (content/scene.ts): the
// regular tilings drawn as version 1 draws them, each point coloured by its true face (brute force,
// wythoff-world.ts), the far-tile colour weighted by the faces' areas, and the content's refusals.
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK } from "../../src/content/looks.ts";
import type { ContentState } from "../../src/content/scene.ts";
import { buildContent, sceneOf } from "../../src/content/scene.ts";
import { homeView, panBy, rotateBy, settle, type ViewState } from "../../src/input/camera.ts";
import { triangleGroup } from "../../src/math/groups.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { dist, identity, mink, reflectPoint } from "../../src/math/lorentz.ts";
import { applyTile, carryTile, faceHash, identityTile, tileIdentity } from "../../src/math/tileid.ts";
import { wythoff } from "../../src/math/wythoff.ts";
import { mosaicColour, renderView, shadeTiling, shadingOf, startOf, type RGB } from "../../src/render/reference.ts";
import { shots } from "../shots.ts";
import { randomPoint, rng } from "./rng.ts";
import { segDist, trueFace, world } from "./wythoff-world.ts";

/** A random walk of pans and rotations, settled after each step as the app does. */
function walk(seed: number, steps: number, content: ReturnType<typeof buildContent>): ViewState[] {
  const r = rng(seed);
  let v = homeView(content.colouring.k);
  const out = [v];
  for (let i = 0; i < steps; i++) {
    v = settle(rotateBy(panBy(v, [0, 0], [0.5 * (r() - 0.5), 0.5 * (r() - 0.5)]), r() - 0.5), content.group, content.colouring);
    out.push(v);
  }
  return out;
}

const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

describe("Wythoff tilings in the reference", () => {
  it("draw 010 with Mosaic as version 1's Mosaic with side 3, and 001 with Inside as side 2 (r = 2)", () => {
    for (const group of [[7, 3, 2], [5, 4, 2], [4, 6, 2]] as [number, number, number][]) {
      const base: ContentState = { group, colouring: "parity", sides: [false, false, true], lineWidth: 0.03 };
      const cases = [
        { v1: [false, false, true], c: "010", look: { ...DEFAULT_LOOK, palette: "Escher", source: "mosaic" as const, glow: 0.3, relief: 0.6 } },
        { v1: [false, true, false], c: "001", look: { ...DEFAULT_LOOK, palette: "Nebula", source: "inside" as const, glow: 0.2, relief: 0.8 } },
      ];
      for (const k of cases) {
        const v1 = buildContent({ ...base, sides: k.v1 as [boolean, boolean, boolean], look: k.look });
        const wy = buildContent({ ...base, sides: [false, false, false], construction: k.c as "010", look: k.look });
        expect(wy.shading.maxInside).toBeCloseTo(v1.shading.maxInside, 12);
        expect(wy.shading.lineLengthPerArea).toBeCloseTo(v1.shading.lineLengthPerArea, 9);
        wy.shading.rim.forEach((x, i) => expect(x).toBeCloseTo(v1.shading.rim[i], 9));
        for (const view of walk(group[0], 6, v1)) {
          const a = renderView(shots(v1, view, 48, 36).cpu);
          const b = renderView(shots(wy, view, 48, 36).cpu);
          expect(maxDiff(a, b)).toBeLessThan(1e-7);
        }
      }
    }
  });

  it("colour each point by its true face: the kind's colour, or the identity's hash through the kite's odd words", () => {
    const r = rng(21);
    for (const group of [[7, 3, 2], [3, 3, 4], [5, 2, 4]] as [number, number, number][]) {
      const g = triangleGroup(...group);
      const ids = tileIdentity(g);
      const own = [...ids.corners, ids.vt];
      for (const c of ["110", "011", "111", "snub"] as const) {
        const t = wythoff(g, c);
        const w = world(g, t, 3.4);
        for (const source of ["colouring", "mosaic"] as const) {
          const content = buildContent({ group, colouring: "parity", sides: [false, false, false], lineWidth: 0, construction: c, look: { ...DEFAULT_LOOK, palette: "Escher", source, glow: 0, relief: 0 } });
          const scene = sceneOf(content, homeView(2));
          const start = startOf(scene);
          for (let s = 0; s < 60; s++) {
            const x = randomPoint(r, 1.6);
            // away from the edges, where nothing blends
            if (Math.min(...w.edges.map(([a, b]) => segDist(x, a, b))) < 1e-3) continue;
            const face = trueFace(x, w)!;
            const want: RGB =
              source === "colouring"
                ? content.style.colours[t.colourOf[face.kind]]
                : mosaicColour(content.style, faceHash(applyTile(carryTile(identityTile(), face.word, ids), own[face.kind], ids.l), face.kind, ids.l));
            expect(shadeTiling(scene, start, identity(), x, 1e-5, null)).toEqual(want);
          }
        }
      }
    }
  });

  it("weight the colouring's far-tile mean by the faces' areas", () => {
    const unit: RGB[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];
    const look = { ...DEFAULT_LOOK, source: "colouring" as const, glow: 0, relief: 0 };
    for (const group of [[7, 3, 2], [4, 5, 2], [3, 3, 4], [5, 4, 3]] as [number, number, number][]) {
      const g = triangleGroup(...group);
      const m = [g.p, g.q, g.r];
      const areaT = Math.PI * (1 - 1 / g.p - 1 / g.q - 1 / g.r);
      // omnitruncated: the face around X meets T in the quadrilateral X, the feet on X's mirrors, G,
      // with right angles at the feet: area pi - pi / m - (G's angle between the feet)
      {
        const t = wythoff(g, "111");
        const toward = (a: number) => {
          const n = g.normals[a];
          const k = mink(n, t.G);
          return [n[0] + k * t.G[0], n[1] + k * t.G[1], n[2] + k * t.G[2]] as Vec3;
        };
        const frac = [[0, 1], [0, 2], [1, 2]].map(([a, b], X) => {
          const [u, v] = [toward(a), toward(b)];
          const theta = Math.acos(mink(u, v) / Math.sqrt(mink(u, u) * mink(v, v)));
          return (Math.PI - Math.PI / m[X] - theta) / areaT;
        });
        expect(frac[0] + frac[1] + frac[2]).toBeCloseTo(1, 12);
        const content = buildContent({ group, colouring: "parity", sides: [false, false, false], lineWidth: 0, construction: "111", look });
        const sh = shadingOf(g, { ...content.style, colours: unit }, [0, 0, 0], t);
        frac.forEach((f, X) => expect(Math.abs(sh.avgFill[X] - f)).toBeLessThan(2e-3));
      }
      // snub: per kite (area 2 T) a 1/m share of each m-gon and one triangle, all of edge L
      {
        const t = wythoff(g, "snub");
        const L = dist(t.G, reflectPoint(reflectPoint(t.G, g.normals[1]), g.normals[0]));
        const polygon = (n: number) => {
          const alpha = 2 * Math.asin(Math.cos(Math.PI / n) / Math.cosh(L / 2));
          return (n - 2) * Math.PI - n * alpha;
        };
        const frac = [...m.map((n) => (n >= 3 ? polygon(n) / n : 0)), polygon(3)].map((a) => a / (2 * areaT));
        expect(frac.reduce((s, f) => s + f, 0)).toBeCloseTo(1, 12);
        const content = buildContent({ group, colouring: "parity", sides: [false, false, false], lineWidth: 0, construction: "snub", look });
        const sh = shadingOf(g, { ...content.style, colours: unit }, [0, 0, 0], t);
        const got = [0, 1, 2, 3].map((k) => (t.colourOf[k] < 0 ? 0 : t.colourOf[k] < 3 ? sh.avgFill[t.colourOf[k]] : 1 - sh.avgFill[0] - sh.avgFill[1] - sh.avgFill[2]));
        frac.forEach((f, k) => expect(Math.abs(got[k] - f)).toBeLessThan(2e-3));
      }
    }
  });

  it("add version 1's drawn sides to the tiling's edge length, and take the colours per kind", () => {
    const base: ContentState = { group: [7, 3, 2], colouring: "c1", sides: [false, false, false], lineWidth: 0.02, construction: "110" };
    const c = buildContent(base);
    expect(c.wythoff).not.toBeNull();
    expect(c.shading.lineLengthPerArea).toBeCloseTo(c.wythoff!.lengthPerArea, 12);
    const mesh = buildContent({ ...base, sides: [true, true, true] });
    const g = c.group;
    const sides = dist(g.corners.P, g.corners.Q) + dist(g.corners.P, g.corners.R) + dist(g.corners.Q, g.corners.R);
    expect(mesh.shading.lineLengthPerArea).toBeCloseTo(c.wythoff!.lengthPerArea + sides / (Math.PI * (1 - 1 / 7 - 1 / 3 - 1 / 2)), 12);
    // 110 in (7, 3, 2): heptagons and triangles... two kinds, not the colouring's count
    expect(c.style.colours.length).toBe(c.wythoff!.kinds);
    expect(buildContent({ ...base, construction: "lines" }).wythoff).toBeNull();
    expect(buildContent({ ...base, construction: undefined }).wythoff).toBeNull();
  });

  it("refuse a free point without weights, and draw one with them", () => {
    const base: ContentState = { group: [7, 3, 2], colouring: "parity", sides: [false, false, false], lineWidth: 0.02, construction: "free" };
    expect(() => buildContent(base)).toThrow(/weights/);
    expect(() => buildContent({ ...base, weights: [0, 0, 0] })).toThrow();
    const c = buildContent({ ...base, weights: [0.2, 1, 0.5] });
    expect(c.wythoff!.construction).toBe("free");
    expect(c.wythoff!.lines.length).toBe(3);
  });
});
