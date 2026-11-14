// Your own tile picture as content (design notes, step 17): when it is drawn and when hidden, the
// title, seams in both modes, and the far-tile means against a dense integral over the shape.
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LOOK, type LookState } from "../../src/content/looks.ts";
import type { ContentState } from "../../src/content/scene.ts";
import { buildContent, pictureHiddenBy, sceneOf, withConstruction, withMotif, withTileImage } from "../../src/content/scene.ts";
import type { Placement, TileImageState, TileMode } from "../../src/content/tileimage.ts";
import { DEFAULT_PLACEMENT, mapUV, sampleImage, setPicture, tileImageFromRGBA } from "../../src/content/tileimage.ts";
import { homeView } from "../../src/input/camera.ts";
import type { Complex } from "../../src/math/complex.ts";
import { distanceToSide, triangleGroup } from "../../src/math/groups.ts";
import type { Vec3 } from "../../src/math/lorentz.ts";
import { identity, mink, reflectPoint } from "../../src/math/lorentz.ts";
import { fromDisk } from "../../src/math/motifs.ts";
import { samplePalette } from "../../src/content/palettes.ts";
import type { RGB } from "../../src/render/reference.ts";
import { BEVEL_WIDTH, GLOW_WIDTH, shadeTiling, smoothstep, startOf } from "../../src/render/reference.ts";
import { contentLabel } from "../../src/ui/card.ts";
import { testPicture } from "./picture-world.ts";
import { randomPoint, rng } from "./rng.ts";

const ID = "a".repeat(64);
const ALPHA_ID = "b".repeat(64);
beforeAll(() => {
  setPicture(ID, { src: "data:image/png;base64,AAAA", image: tileImageFromRGBA(testPicture(256, 192), 256, 192, ID) });
  setPicture(ALPHA_ID, { src: "data:image/png;base64,AAAB", image: tileImageFromRGBA(testPicture(160, 160, true), 160, 160, ALPHA_ID) });
});

const tile = (mode: TileMode, extra: Partial<TileImageState> = {}): TileImageState => ({ mode, place: DEFAULT_PLACEMENT, id: ID, ...extra });
const stateOf = (group: [number, number, number], t: TileImageState, look: Partial<LookState> = {}): ContentState => ({
  group,
  colouring: "parity",
  sides: [false, false, false],
  lineWidth: 0.01,
  look: { ...DEFAULT_LOOK, glow: 0, relief: 0, ...look },
  tileImage: t,
});

describe("when the picture is drawn", () => {
  it("is drawn over Lines without a motif with the tiling shown, and kept but hidden otherwise", () => {
    const s = stateOf([7, 3, 2], tile("kaleidoscope"));
    expect(buildContent(s).picture).not.toBeNull();
    expect(pictureHiddenBy(s)).toBeNull();
    const wy = withConstruction(s, "snub");
    expect(wy.tileImage).toEqual(s.tileImage);
    expect(pictureHiddenBy(wy)).toBe("construction");
    expect(buildContent(wy).picture).toBeNull();
    const mo = withMotif(s, "moths");
    expect(mo.tileImage).toEqual(s.tileImage);
    expect(pictureHiddenBy(mo)).toBe("motif");
    expect(buildContent(mo).picture).toBeNull();
    expect(pictureHiddenBy({ ...s, plain: true })).toBe("plain");
    expect(buildContent({ ...s, plain: true }).picture).toBeNull();
    // another group keeps it, and draws it
    expect(buildContent({ ...s, group: [3, 3, 4] }).picture).not.toBeNull();
    // back to Lines from a construction draws it again
    expect(buildContent(withConstruction(wy, "lines")).picture).not.toBeNull();
  });

  it("brings Lines, no motif and the tiling when it is loaded, keeping the lines", () => {
    const motif = withMotif(stateOf([6, 4, 2], tile("chiral")), "moths");
    const back = withTileImage({ ...motif, plain: true }, tile("chiral"));
    expect(back.motif).toBeUndefined();
    expect(back.plain).toBeUndefined();
    expect(back.construction).toBeUndefined();
    expect(back.sides).toEqual(motif.sides);
    expect(withTileImage(back, null).tileImage).toBeUndefined();
  });

  it("waits for its picture: none drawn until the levels are there", () => {
    expect(buildContent(stateOf([7, 3, 2], { ...tile("kaleidoscope"), id: "c".repeat(64) })).picture).toBeNull();
  });

  it("names the title", () => {
    expect(contentLabel(stateOf([7, 3, 2], tile("kaleidoscope")))).toBe("{7,3} kaleidoscope");
    expect(contentLabel(stateOf([3, 3, 4], tile("chiral")))).toBe("(3,3,4) chiral picture");
    expect(contentLabel(withMotif(stateOf([6, 4, 2], tile("chiral")), "moths"))).toBe("Moths {6,4}");
  });
});

/** The colour at world point x with an opaque picture as it is (so only the picture shows). */
function shader(group: [number, number, number], mode: TileMode, place: Placement = DEFAULT_PLACEMENT) {
  const c = buildContent(stateOf(group, tile(mode, { place })));
  const scene = sceneOf(c, homeView(2));
  const start = startOf(scene);
  return (x: Vec3, lpx = 1e-6) => shadeTiling(scene, start, identity(), x, lpx, null);
}
const near = (a: RGB, b: RGB, tol: number) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) <= tol;
/** A point off the side with normal n by the signed distance e (positive: away from T). */
const across = (x: Vec3, n: Vec3, e: number): Vec3 => {
  // move along n by the hyperbolic distance: cosh e x + sinh e n_hat (n is unit spacelike)
  const ch = Math.cosh(e);
  const sh = Math.sinh(e);
  return [ch * x[0] + sh * n[0], ch * x[1] + sh * n[1], ch * x[2] + sh * n[2]];
};
/** A point on side j of T: between its corners (j = 0: P, Q; 1: P, R; 2: Q, R), at fraction t in
 *  the Klein model. */
const onSide = (group: ReturnType<typeof triangleGroup>, j: number, t: number): Vec3 => {
  const { P, Q, R } = group.corners;
  const [a, b] = j === 0 ? [P, Q] : j === 1 ? [P, R] : [Q, R];
  const k = [a[0] / a[2] + t * (b[0] / b[2] - a[0] / a[2]), a[1] / a[2] + t * (b[1] / b[2] - a[1] / a[2])];
  const z = 1 / Math.sqrt(1 - k[0] * k[0] - k[1] * k[1]);
  return [k[0] * z, k[1] * z, z];
};
/** The unit normal of side j, pointing away from T (mink(x, n) > 0 outside). */
const outward = (group: ReturnType<typeof triangleGroup>, j: number): Vec3 => {
  const n = group.normals[j];
  const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] - n[2] * n[2]);
  return [n[0] / len, n[1] / len, -n[2] / len];
};

describe("the kaleidoscope", () => {
  const groups: [number, number, number][] = [[7, 3, 2], [3, 3, 4], [5, 4, 2], [2, 3, 7]];

  it("is the same at every image of a point under the group", () => {
    const r = rng(17);
    for (const g of groups) {
      const group = triangleGroup(...g);
      const at = shader(g, "kaleidoscope");
      for (let i = 0; i < 40; i++) {
        let x = randomPoint(r, 1.2);
        const c0 = at(x);
        for (let k = 0; k < 12; k++) x = reflectPoint(x, group.normals[Math.floor(r() * 3)]);
        expect(near(at(x), c0, 1e-9), `${g}`).toBe(true);
      }
    }
  });

  it("is continuous across all three sides", () => {
    const r = rng(5);
    for (const g of groups) {
      const group = triangleGroup(...g);
      const at = shader(g, "kaleidoscope");
      for (let j = 0; j < 3; j++) {
        const n = outward(group, j);
        for (let i = 0; i < 20; i++) {
          const x = onSide(group, j, 0.05 + 0.9 * r());
          expect(mink(x, group.normals[j])).toBeCloseTo(0, 12);
          const inner = at(across(x, n, -1e-7));
          const outer = at(across(x, n, 1e-7));
          expect(near(inner, outer, 2e-4), `${g} side ${j + 1}`).toBe(true);
        }
      }
    }
  });
});

describe("the chiral picture", () => {
  const groups: [number, number, number][] = [[7, 3, 2], [3, 3, 4], [4, 4, 3], [6, 4, 2]];

  it("is the same after the turns rho_P and rho_Q, and not after a mirror", () => {
    const r = rng(23);
    for (const g of groups) {
      const group = triangleGroup(...g);
      const n = group.normals;
      const at = shader(g, "chiral");
      let mirrored = 0;
      for (let i = 0; i < 40; i++) {
        const x = randomPoint(r, 1.2);
        const c0 = at(x);
        const rhoP = reflectPoint(reflectPoint(x, n[0]), n[1]);
        const rhoQ = reflectPoint(reflectPoint(x, n[0]), n[2]);
        expect(near(at(rhoP), c0, 1e-9), `${g} rho_P`).toBe(true);
        expect(near(at(rhoQ), c0, 1e-9), `${g} rho_Q`).toBe(true);
        if (!near(at(reflectPoint(x, n[0])), c0, 1e-3)) mirrored++;
      }
      expect(mirrored, `${g}`).toBeGreaterThan(30);
    }
  });

  it("is continuous across the kite's edges, where it blends toward the neighbour", () => {
    const r = rng(29);
    for (const g of groups) {
      const group = triangleGroup(...g);
      const at = shader(g, "chiral");
      for (const j of [1, 2])
        for (const flip of [false, true]) {
          // PR, QR (in T) and PR', QR' (in s1 T)
          const n = outward(group, j);
          for (let i = 0; i < 20; i++) {
            let x = onSide(group, j, 0.05 + 0.9 * r());
            let a = across(x, n, -1e-8);
            let b = across(x, n, 1e-8);
            if (flip) [x, a, b] = [x, a, b].map((y) => reflectPoint(y, group.normals[0]));
            expect(near(at(a, 0.01), at(b, 0.01), 2e-4), `${g} edge ${j + 1}${flip ? "'" : ""}`).toBe(true);
          }
        }
    }
  });
});

describe("the far-tile means", () => {
  /** The dense integral over the shape (T, or the kite T u s1 T): a fine grid in w, the picture at
   *  level 0, the hyperbolic area element, de and the relief and glow factors as the quadrature
   *  takes them; a grid that shares nothing with the quadrature's points. */
  function dense(group: ReturnType<typeof triangleGroup>, c: ReturnType<typeof buildContent>, steps = 1400) {
    const pic = c.picture!;
    const style = c.style;
    const sh = c.shading;
    const mask = sh.edgeMask;
    const box = { x0: 0, x1: 0.8, y0: pic.mode === "chiral" ? -0.8 : 0, y1: 0.8 };
    let W = 0;
    let G = 0;
    let K1a = 0;
    const Kp = [0, 0, 0];
    const Kt = [0, 0, 0];
    const F = [0, 0, 0];
    const s: number[] = [0, 0, 0, 0];
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < steps; j++) {
        const w: Complex = [box.x0 + ((i + 0.5) / steps) * (box.x1 - box.x0), box.y0 + ((j + 0.5) / steps) * (box.y1 - box.y0)];
        const r2 = w[0] * w[0] + w[1] * w[1];
        if (r2 >= 0.81) continue;
        let x = fromDisk(w);
        if (w[1] < 0) x = reflectPoint(x, group.normals[0]);
        if (group.normals.some((n) => mink(x, n) > 0)) continue;
        const area = (4 / (1 - r2) ** 2) * ((box.x1 - box.x0) / steps) * ((box.y1 - box.y0) / steps);
        let de = Infinity;
        for (let k = 0; k < 3; k++) if (mask & (1 << k)) de = Math.min(de, distanceToSide(x, group.normals[k]));
        const gamma = style.glow > 0 ? style.glow * Math.exp(-de / (GLOW_WIDTH * sh.maxInside)) : 0;
        const hp = style.relief * (1 - smoothstep(0, BEVEL_WIDTH * sh.maxInside, de));
        const kf = (1 - gamma) / Math.sqrt(1 + hp * hp);
        const [u, v] = mapUV(pic.map, w);
        sampleImage(pic.image, u, v, 0, s);
        const ci = style.source === "inside" ? samplePalette(style.palette, style.phase + (style.density * de) / sh.maxInside, 0) : [0, 0, 0];
        W += area;
        G += gamma * area;
        K1a += kf * (1 - s[3]) * area;
        for (let ch = 0; ch < 3; ch++) {
          Kp[ch] += kf * s[ch] * area;
          Kt[ch] += kf * (s[ch] + 1 - s[3]) * area;
          F[ch] += ci[ch] * kf * (pic.tint ? s[ch] + 1 - s[3] : 1 - s[3]) * area;
        }
      }
    return { W, glow: G / W, fill1a: K1a / W, kp: Kp.map((v) => v / W), kt: Kt.map((v) => v / W), inside: F.map((v) => v / W) };
  }

  const cases: [string, [number, number, number], TileMode, boolean, Partial<LookState>, string][] = [
    ["{7,3} kaleidoscope", [7, 3, 2], "kaleidoscope", false, {}, ID],
    ["(3,3,4) chiral, tinted", [3, 3, 4], "chiral", true, {}, ID],
    ["{5,4} kaleidoscope with relief and glow", [5, 4, 2], "kaleidoscope", false, { relief: 1.5, glow: 0.5 }, ID],
    ["(4,4,3) chiral, transparent, inside source", [4, 4, 3], "chiral", false, { source: "inside" }, ALPHA_ID],
    ["{8,3} chiral, transparent, tinted, inside source with glow", [8, 3, 2], "chiral", true, { source: "inside", glow: 0.4 }, ALPHA_ID],
    ["{6,4} kaleidoscope, transparent, tinted, distance source", [6, 4, 2], "kaleidoscope", true, { source: "distance", relief: 1 }, ALPHA_ID],
  ];

  for (const [name, g, mode, tint, look, id] of cases)
    it(`equal a dense integral over the shape: ${name}`, () => {
      const group = triangleGroup(...g);
      const c = buildContent(stateOf(g, tile(mode, { tint, id }), look));
      const d = dense(group, c);
      const kite = (mode === "chiral" ? 2 : 1) * Math.PI * (1 - 1 / group.p - 1 / group.q - 1 / group.r);
      expect(Math.abs(d.W / kite - 1), "area").toBeLessThan(5e-4);
      const sh = c.shading;
      const want = tint ? d.kt : [d.fill1a, d.fill1a, d.fill1a];
      if (process.env.SHOW_ERR) console.log(name, Math.abs(d.W / kite - 1).toExponential(1), Math.max(...sh.fillFactor.map((v, ch) => Math.abs(v - want[ch]))).toExponential(1), Math.max(...sh.avgGlow.map((v, ch) => Math.abs(v - (c.style.lineColour[ch] * d.glow + (tint ? 0 : d.kp[ch]))))).toExponential(1), c.style.source === "inside" ? Math.max(...sh.avgFill.map((v, ch) => Math.abs(v - d.inside[ch]))).toExponential(1) : "");
      sh.fillFactor.forEach((v, ch) => expect(Math.abs(v - want[ch]), `fill factor ${ch}`).toBeLessThan(5e-4));
      const glow = c.style.lineColour.map((L, ch) => L * d.glow + (tint ? 0 : d.kp[ch]));
      sh.avgGlow.forEach((v, ch) => expect(Math.abs(v - glow[ch]), `glow and picture ${ch}`).toBeLessThan(5e-4));
      if (c.style.source === "inside") sh.avgFill.forEach((v, ch) => expect(Math.abs(v - d.inside[ch]), `inside ${ch}`).toBeLessThan(5e-4));
    });

  it("takes a look change from the kept samples, quickly", () => {
    const s = stateOf([7, 3, 2], tile("chiral"));
    buildContent(s);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) buildContent({ ...s, look: { ...s.look!, glow: 0.1 * i } });
    expect((performance.now() - t0) / 5).toBeLessThan(150);
  });
});
