import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, LOOKS } from "../../src/content/looks.ts";
import { buildContent, classColours, mosaicColours, PRESETS, type ContentState } from "../../src/content/scene.ts";
import { samplePalette } from "../../src/content/palettes.ts";
import { identityTile, mosaicHash, tileIdentity, tileOf } from "../../src/math/tileid.ts";
import { homeView, MAX_START_DISTANCE, panBy, rotateBy, settle, worldAt, type ViewState } from "../../src/input/camera.ts";
import { START_VISIBLE } from "../../src/input/start.ts";
import { distanceToSide, fold, triangleGroup } from "../../src/math/groups.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { add, apply, dist, normalizePoint, ORIGIN, reflectPoint, rotation, scale } from "../../src/math/lorentz.ts";
import { BEVEL_WIDTH, depthAt, edgeMask, GLOW_WIDTH, mosaicColour, renderView, startOf, type RGB, type TilingStyle } from "../../src/render/reference.ts";
import { shots } from "../shots.ts";
import { randomPoint, rng } from "./rng.ts";

const heptagons: ContentState = { group: [7, 3, 2], colouring: "parity", sides: [false, false, true], lineWidth: 0.03 };

function depthOf(group: ReturnType<typeof triangleGroup>, origin: number[], x: Vec3) {
  const f = fold(x, group.normals);
  const d = [0, 1, 2].map((j) => distanceToSide(f.x, group.normals[j]));
  return depthAt(group, startOf({ group, origin }), f.word, d);
}

/** A random walk of pans and rotations, settled after each step as the app does. */
function walk(seed: number, steps: number, content: ReturnType<typeof buildContent>): ViewState[] {
  const r = rng(seed);
  let v = homeView(content.colouring.k);
  const out = [v];
  for (let i = 0; i < steps; i++) {
    v = settle(rotateBy(panBy(v, [0, 0], [0.4 * (r() - 0.5), 0.4 * (r() - 0.5)]), r() - 0.5), content.group, content.colouring);
    out.push(v);
  }
  return out;
}

describe("depth from the start triangle", () => {
  const content = buildContent(heptagons);
  const { group } = content;

  it("counts the walls between a point and the start tile's centre, leaving out walls through it", () => {
    // independent count: the mean over the 2p triangles c around P of the walls between x and c is
    // (walls not through P) + p/2, since each of the p walls through P separates x from half of them
    const r = rng(3);
    const dihedral: number[][] = [[]];
    while (dihedral.length < 2 * group.p) {
      const last = dihedral[dihedral.length - 1];
      dihedral.push([...last, dihedral.length % 2 === 1 ? 0 : 1]);
    }
    for (let i = 0; i < 1000; i++) {
      const x = randomPoint(r, 4);
      let sum = 0;
      for (const word of dihedral) {
        let y = x;
        for (const j of word) y = reflectPoint(y, group.normals[j]);
        sum += fold(y, group.normals).word.length;
      }
      expect(depthOf(group, homeView(2).origin, x).depth).toBeCloseTo(sum / (2 * group.p) - group.p / 2, 9);
    }
  });

  it("has the start tile's symmetry and is zero on the start tile", () => {
    const r = rng(4);
    const turn = (x: Vec3): Vec3 => reflectPoint(reflectPoint(x, group.normals[0]), group.normals[1]);
    for (let i = 0; i < 1000; i++) {
      const x = randomPoint(r, 4);
      const d = depthOf(group, homeView(2).origin, x);
      expect(depthOf(group, homeView(2).origin, turn(x)).depth).toBe(d.depth);
      expect(depthOf(group, homeView(2).origin, reflectPoint(x, group.normals[0])).smooth).toBeCloseTo(d.smooth, 9);
    }
    expect(depthOf(group, homeView(2).origin, group.incenter)).toMatchObject({ depth: 0, smooth: 0.5 });
  });

  it("does not change when re-centering moves the world (10^4 points along random walks)", () => {
    const r = rng(5);
    const points = Array.from({ length: 200 }, () => randomPoint(r, 4));
    const home = points.map((x) => depthOf(group, homeView(2).origin, x));
    let moved = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const views = walk(seed, 60, content);
      for (const v of views.filter((_, i) => i % 6 === 0)) {
        if (v.origin.some((m, i) => Math.abs(m - (i % 4 === 0 ? 1 : 0)) > 1e-9)) moved++;
        // the origin matrix is the product of the re-centerings: a point's coordinates now
        if (dist(apply(v.origin, ORIGIN), apply(v.camera, ORIGIN)) >= MAX_START_DISTANCE) continue;
        points.forEach((x, i) => {
          const now = depthOf(group, v.origin, apply(v.origin, x));
          expect(now.depth).toBe(home[i].depth);
          expect(now.smooth).toBeCloseTo(home[i].smooth, 6);
        });
      }
    }
    expect(moved).toBeGreaterThan(40); // the walks did re-center the world
  });

  it("is continuous across walls when smoothed", () => {
    const r = rng(9);
    const origin = walk(8, 30, content).at(-1)!.origin;
    const ends: [Vec3, Vec3][] = [[group.corners.P, group.corners.Q], [group.corners.P, group.corners.R], [group.corners.Q, group.corners.R]];
    const e = 1e-7;
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      // a point on side j, one step e inside and its mirror image just outside, both carried to a
      // random triangle of the tiling
      const j = Math.floor(r() * 3);
      const l = 0.05 + 0.9 * r();
      const m = normalizePoint(add(scale(ends[j][0], 1 - l), scale(ends[j][1], l)));
      const n = group.normals[j];
      let a = add(scale(m, Math.cosh(e)), scale(n, -Math.sinh(e)));
      let b = add(scale(m, Math.cosh(e)), scale(n, Math.sinh(e)));
      for (const k of fold(randomPoint(r, 3), group.normals).word) {
        a = reflectPoint(a, group.normals[k]);
        b = reflectPoint(b, group.normals[k]);
      }
      const da = depthOf(group, origin, a);
      const db = depthOf(group, origin, b);
      expect(Math.abs(da.depth - db.depth)).toBeLessThanOrEqual(1);
      worst = Math.max(worst, Math.abs(da.smooth - db.smooth));
    }
    expect(worst).toBeLessThan(1e-4);
  });

});

describe("depth on a long trip (the start moves nearer, design notes)", () => {
  /** Depth with the view's shift at screen points within START_VISIBLE - 0.5 of the centre. */
  const screenDepths = (v: ViewState, group: ReturnType<typeof triangleGroup>) => {
    const out: number[] = [];
    const c = worldAt(v, [0, 0])!;
    for (let i = -12; i <= 12; i++)
      for (let k = -12; k <= 12; k++) {
        const x = worldAt(v, [i / 12, k / 12]);
        if (x && dist(x, c) <= START_VISIBLE - 0.5) out.push(depthOf(group, v.origin, x).smooth + v.shift);
      }
    return out;
  };

  it("keeps every depth on the screen while panning for 20 seconds, in each preset's group", () => {
    for (const preset of PRESETS) {
      const content = buildContent(preset.content);
      const { group, colouring } = content;
      for (const angle of [0, 1, 2.2]) {
        let v: ViewState = { ...homeView(colouring.k), camera: rotation(angle) };
        let moves = 0;
        // 20 s of a controller's stick at 60 frames a second, turning a little
        for (let i = 0; i < 1200; i++) {
          const moved = rotateBy(panBy(v, [0, 0], [1.2 / 60, 0]), 0.002);
          const next = settle(moved, group, colouring);
          expect(dist(apply(next.origin, ORIGIN), apply(next.camera, ORIGIN))).toBeLessThanOrEqual(MAX_START_DISTANCE);
          if (next.shift !== moved.shift) {
            moves++;
            const before = screenDepths(moved, group);
            const after = screenDepths(next, group);
            expect(after.length).toBe(before.length);
            after.forEach((d, j) => expect(Math.abs(d - before[j])).toBeLessThan(1e-6));
          }
          v = next;
        }
        expect(moves, `${preset.label} at ${angle}`).toBeGreaterThan(3);
      }
    }
  }, 60_000);

  it("leaves the CPU reference picture as it was when the start moves", () => {
    const preset = PRESETS.find((p) => LOOKS.find((l) => l.name === p.look)?.look.source === "depth")!;
    const content = buildContent({ ...preset.content, look: LOOKS.find((l) => l.name === preset.look)!.look });
    let v = homeView(content.colouring.k);
    for (;;) {
      const moved = panBy(v, [0, 0], [0.02, 0.004]);
      const next = settle(moved, content.group, content.colouring);
      if (next.shift !== v.shift) {
        // before settling, the moved view still counts from the old start
        const before = renderView(shots(content, moved, 160, 120).cpu);
        const after = renderView(shots(content, next, 160, 120).cpu);
        let worst = 0;
        for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(before[i] - after[i]));
        expect(worst).toBeLessThan(1e-6);
        break;
      }
      v = next;
    }
  });
});

describe("shading constants", () => {
  it("measure the largest distance to the edge sides and the line share", () => {
    const g = triangleGroup(7, 3, 2);
    const c = buildContent(heptagons);
    // edge side 3 only: the farthest point is the polygon centre P
    expect(c.shading.maxInside).toBeCloseTo(distanceToSide(g.corners.P, g.normals[2]), 2);
    const all = buildContent({ ...heptagons, sides: [true, true, true] });
    expect(all.shading.maxInside).toBeCloseTo(g.inradius, 2);
    expect(all.shading.maxInside).toBeLessThanOrEqual(g.inradius + 1e-12);
    expect(edgeMask([false, false, false])).toBe(4);
    expect(c.shading.avgFactor).toBe(1);
    expect(c.shading.avgGlow).toEqual([0, 0, 0]);
  });

  it("darken the far-tile colour with relief and pull it toward the line colour with glow", () => {
    const flat = buildContent(heptagons);
    const relief = buildContent({ ...heptagons, look: { ...DEFAULT_LOOK, relief: 1 } });
    const glow = buildContent({ ...heptagons, look: { ...DEFAULT_LOOK, glow: 0.5 } });
    expect(relief.shading.avgFactor).toBeLessThan(1);
    expect(relief.shading.avgFactor).toBeGreaterThan(0.8);
    expect(glow.shading.avgFactor).toBeLessThan(1);
    expect(glow.shading.avgGlow[0]).toBeGreaterThan(0);
    for (const v of [...flat.shading.rim, ...relief.shading.rim, ...glow.shading.rim]) expect(Number.isFinite(v)).toBe(true);
  });

  // the area means as step 6 computed them, every quadrature point anew for each look
  function slowMeans(group: ReturnType<typeof triangleGroup>, style: TilingStyle) {
    const mask = edgeMask(style.sides);
    const N = 240;
    const [P, Q, R] = [group.corners.P, group.corners.Q, group.corners.R].map((x) => [x[0] / x[2], x[1] / x[2]]);
    const samples: { w: number; de: number }[] = [];
    for (let a = 0; a < N; a++)
      for (let b = 0; a + b < N; b++)
        for (const off of a + b <= N - 2 ? [1 / 3, 2 / 3] : [1 / 3]) {
          const [l1, l2] = [(a + off) / N, (b + off) / N];
          const k = [P[0] + l1 * (Q[0] - P[0]) + l2 * (R[0] - P[0]), P[1] + l1 * (Q[1] - P[1]) + l2 * (R[1] - P[1])];
          const r2 = k[0] * k[0] + k[1] * k[1];
          const x: Vec3 = [k[0] / Math.sqrt(1 - r2), k[1] / Math.sqrt(1 - r2), 1 / Math.sqrt(1 - r2)];
          let de = Infinity;
          for (let j = 0; j < 3; j++) if (mask & (1 << j)) de = Math.min(de, distanceToSide(x, group.normals[j]));
          samples.push({ w: (1 - r2) ** -1.5, de });
        }
    const maxInside = Math.max(...samples.map((q) => q.de));
    const smooth = (e1: number, x: number) => {
      const t = Math.min(1, Math.max(0, x / e1));
      return t * t * (3 - 2 * t);
    };
    let [W, A, G] = [0, 0, 0];
    let F: RGB = [0, 0, 0];
    for (const { w, de } of samples) {
      const gamma = style.glow > 0 ? style.glow * Math.exp(-de / (GLOW_WIDTH * maxInside)) : 0;
      const hp = style.relief * (1 - smooth(BEVEL_WIDTH * maxInside, de));
      const a = ((1 - gamma) / Math.sqrt(1 + hp * hp)) * w;
      W += w;
      A += a;
      G += gamma * w;
      if (style.source === "inside") {
        const c = samplePalette(style.palette, style.phase + (style.density * de) / maxInside, 0);
        F = [F[0] + c[0] * a, F[1] + c[1] * a, F[2] + c[2] * a];
      }
    }
    return { maxInside, avgFactor: A / W, glowShare: G / W, inside: F.map((v) => v * (1 / W)) };
  }

  it("are the same, bit for bit, as computing every quadrature point for each look", () => {
    for (const preset of PRESETS.slice(0, 3)) {
      for (const look of [LOOKS[0], LOOKS[3], LOOKS[4], LOOKS[12]].map((l) => l.look)) {
        const c = buildContent({ ...preset.content, look });
        const slow = slowMeans(c.group, c.style);
        expect(c.shading.maxInside).toBe(slow.maxInside);
        expect(c.shading.avgFactor).toBe(slow.avgFactor);
        expect(c.shading.avgGlow).toEqual(c.style.lineColour.map((v) => v * slow.glowShare));
        if (look.source === "inside") expect(c.shading.avgFill).toEqual(slow.inside);
      }
    }
  });

  it("colour the classes from a discrete set in order, or from evenly spaced gradient points", () => {
    const set = classColours({ ...DEFAULT_LOOK, palette: "Ink & paper" }, 3);
    expect(set.length).toBe(3);
    const shifted = classColours({ ...DEFAULT_LOOK, palette: "Ink & paper", phase: 0.25 }, 3);
    expect(shifted[0]).toEqual(set[1]);
    const grad = classColours({ ...DEFAULT_LOOK, palette: "Gilded" }, 4);
    expect(new Set(grad.map((c) => c.join())).size).toBe(4);
  });

  it("use a discrete set with fewer colours than the classes as its gradient, so no colour repeats", () => {
    for (const k of [5, 6, 7, 8]) {
      const cols = classColours({ ...DEFAULT_LOOK, palette: "Ink & paper" }, k);
      expect(cols.length).toBe(k);
      expect(new Set(cols.map((c) => c.join())).size).toBe(k);
    }
    // with enough colours the set is used as it is
    expect(classColours({ ...DEFAULT_LOOK, palette: "Escher" }, 6)).toEqual(mosaicColours({ ...DEFAULT_LOOK, palette: "Escher" }));
  });

  it("give Mosaic the whole discrete set from the phase on, or nothing for a gradient, and its mean far away", () => {
    const escher = { ...DEFAULT_LOOK, palette: "Escher", source: "mosaic" as const };
    const set = mosaicColours(escher);
    expect(set.length).toBe(6);
    expect(mosaicColours({ ...escher, phase: 1 / 6 })[0]).toEqual(set[1]);
    expect(mosaicColours({ ...escher, palette: "Nebula" })).toEqual([]);
    const c = buildContent({ ...heptagons, look: escher });
    const mean = set.reduce((m, x) => m.map((v, i) => v + x[i] / set.length) as RGB, [0, 0, 0] as RGB);
    c.shading.avgFill.forEach((v, i) => expect(v).toBeCloseTo(mean[i] * c.shading.avgFactor, 12));
    const g = buildContent({ ...heptagons, look: { ...escher, palette: "Nebula" } });
    g.shading.avgFill.forEach((v, i) => expect(v).toBeCloseTo(g.style.palette.mean[i] * g.shading.avgFactor, 12));
  });
});

describe("Mosaic", () => {
  it("colours each tile by its identity's hash, the set's colour or the gradient's", () => {
    const r = rng(12);
    for (const palette of ["Escher", "Nebula"]) {
      const c = buildContent({ ...heptagons, look: { ...DEFAULT_LOOK, palette, source: "mosaic" } });
      const ids = tileIdentity(c.group);
      const seen = new Set<string>();
      for (let s = 0; s < 400; s++) {
        const f = fold(randomPoint(r, 2.5), c.group.normals);
        const h = mosaicHash(tileOf(identityTile(), f.word, ids).id);
        const col = mosaicColour(c.style, h);
        if (palette === "Escher") expect(c.style.colours).toContainEqual(col);
        else expect(col).toEqual(samplePalette(c.style.palette, (h >>> 8) / 16777216, 0));
        seen.add(col.join());
      }
      // random enough to use most of the set
      expect(seen.size).toBeGreaterThanOrEqual(palette === "Escher" ? 5 : 20);
    }
  });
});
