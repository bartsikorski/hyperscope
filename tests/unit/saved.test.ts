import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LOOKS } from "../../src/content/looks.ts";
import { cleanMotifSpec, motifSpecOf } from "../../src/content/motifs.ts";
import { PALETTE_NAMES } from "../../src/content/palettes.ts";
import { colouringFor, colouringNames, PRESETS, type ContentState } from "../../src/content/scene.ts";
import { HB_WALL_GAP, homeView, panBy, rotateBy, settle, switchModel, zoomAt, type ViewState } from "../../src/input/camera.ts";
import { GRID_KINDS, GRID_UNITS, FRAC_BITS } from "../../src/math/grid.ts";
import { triangleGroup } from "../../src/math/groups.ts";
import { MODELS, hyperboloidGap } from "../../src/math/views.ts";
import { CONSTRUCTIONS } from "../../src/math/wythoff.ts";
import { crc32, readText, withText } from "../../src/state/png.ts";
import { ACCENT_NAMES, fromLink, homeSnapshot, load, MAX_MOTIF_LINK, save, toLink, type Snapshot } from "../../src/state/saved.ts";
import type { Complex } from "../../src/math/complex.ts";
import type { MotifSpec, Point } from "../../src/math/motifs.ts";
import { compileMotif, MAX_CURVE_POINTS, MOTIF_FORMAT, MOTIF_VERSION, toDisk } from "../../src/math/motifs.ts";
import { decodePNG, encodePNG } from "../../tools/png.ts";
import { rng } from "./rng.ts";

const H = 1080;

/** A random state: a preset's tiling with a random colouring, look, grid and accent, seen through
 *  a random walk of zooms, pans, turns and model switches, with grid cameras far out. */
function randomSnapshot(r: () => number): Snapshot {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const preset = pick(PRESETS).content;
  const group = triangleGroup(...preset.group);
  const colouring = pick(colouringNames(group));
  const c = colouringFor(group, colouring);
  const content: ContentState = {
    ...preset,
    colouring,
    sides: [r() < 0.5, r() < 0.5, r() < 0.5],
    lineWidth: 0.001 + r() * 0.05,
    look: { ...pick(LOOKS).look, palette: pick(PALETTE_NAMES), phase: r(), glow: r(), relief: r() < 0.5 ? 0 : r(), light: r() * 360 },
    grid: { on: r() < 0.5, kind: pick(GRID_KINDS), unit: pick(GRID_UNITS) },
  };
  if (r() < 0.3) content.lineUnit = "px";
  // a motif's preset keeps its motif over Lines, half of them as a loaded motif; of the others half
  // a Wythoff tiling, some a free point
  if (content.motif !== undefined) {
    if (r() < 0.5) content.motif = cleanMotifSpec(motifSpecOf(content.motif));
  } else if (r() < 0.5) {
    content.construction = pick(CONSTRUCTIONS.filter((x) => x !== "lines"));
    if (content.construction === "free") content.weights = [r(), 3 * r() + 1e-3, r() < 0.3 ? 0 : r()];
  } else delete content.construction;
  // a third keep a tile picture (drawn or hidden) by its id, anywhere on the picture
  if (r() < 0.3)
    content.tileImage = {
      mode: r() < 0.5 ? "chiral" : "kaleidoscope",
      ...(r() < 0.5 ? { tint: true } : {}),
      place: { x: r() * 3 - 1, y: r() * 3 - 1, size: 0.05 + r() * 7.95, turn: (r() - 0.5) * 720 },
      id: Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join(""),
    };
  let v: ViewState = homeView(c.k, pick(MODELS));
  for (let i = 0; i < 12; i++) {
    const u: [number, number] = [r() * 1.6 - 0.8, r() * 1.6 - 0.8];
    const step = r();
    if (step < 0.35) v = zoomAt(v, u, Math.exp(r() * 6 - 1.5), H).view;
    else if (step < 0.7) v = panBy(v, u, [u[0] + r() - 0.5, u[1] + r() - 0.5]);
    else if (step < 0.85) v = rotateBy(v, r() * 7);
    else v = switchModel(v, pick(MODELS), H);
    v = settle(v, group, c);
  }
  // inside H3: any pitch and field of view; on the hyperboloid any orbit clear of the surface
  if (v.picture.model === "h3") v = { ...v, picture: { ...v.picture, pitch: (r() * Math.PI) / 2, fov: ((40 + 60 * r()) * Math.PI) / 180 } };
  while (v.picture.model === "hyperboloid") {
    const picture = { model: v.picture.model, elevation: (r() - 0.5) * Math.PI, distance: 1.5 * (40 / 1.5) ** r(), fov: ((40 + 60 * r()) * Math.PI) / 180 };
    if (Math.abs(hyperboloidGap(picture)) < HB_WALL_GAP) continue;
    v = { ...v, picture };
    break;
  }
  // grid cameras far out: S0 beyond 2^64, E0 up to 50, either sign
  for (const kind of GRID_KINDS) {
    const big = (BigInt(Math.floor(r() * 2 ** 52)) << 80n) + BigInt(Math.floor(r() * 2 ** 50));
    v.grids[kind] = { s: r() < 0.5 ? -big : big, e: (r() - 0.5) * 100, theta: (r() - 0.5) * 7 };
  }
  // the depth start moved nearer on a long trip, either way
  if (r() < 0.5) v = { ...v, shift: Math.round((r() - 0.5) * 2000) };
  return { view: v, content, ui: { accent: pick(ACCENT_NAMES) } };
}

/** Bit-exact comparison: every float through its bit pattern (so -0 and NaN would show too);
 *  with `zero`, -0 counts as 0 (JSON writes both as 0). */
function bits(s: Snapshot, zero = false): string {
  const f = new Float64Array(1);
  const u = new Uint32Array(f.buffer);
  return JSON.stringify(s, (_, x) => {
    if (typeof x === "bigint") return `big:${x}`;
    if (typeof x === "number") {
      f[0] = zero && x === 0 ? 0 : x;
      return `f:${u[0]}:${u[1]}`;
    }
    // keys in one order, so only the values count
    if (x && typeof x === "object" && !Array.isArray(x)) return Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)));
    return x;
  });
}

/** The look as the content state carries it: the default look made explicit. */
const normal = (s: Snapshot): Snapshot => ({ ...s, content: { ...s.content, look: s.content.look ?? LOOKS[0].look } });

describe("saved state", () => {
  it("keeps every bit through JSON (-0 aside) and through the link, over 1000 random states", () => {
    const r = rng(9);
    for (let i = 0; i < 1000; i++) {
      const s = randomSnapshot(r);
      const viaJson = load(JSON.parse(JSON.stringify(save(s))));
      expect(viaJson.ok, viaJson.ok ? "" : viaJson.reason).toBe(true);
      if (viaJson.ok) expect(bits(viaJson.state)).toBe(bits(normal(s), true));
      const viaLink = fromLink(toLink(s));
      expect(viaLink.ok, viaLink.ok ? "" : viaLink.reason).toBe(true);
      if (viaLink.ok) expect(bits(viaLink.state)).toBe(bits(normal(s)));
    }
  });

  it("writes a short link at home and reads a hand-written one", () => {
    const home = homeSnapshot(PRESETS[0].content);
    const link = toLink(home);
    expect(link).toBe("v=2&m=pd&g=7%2C3%2C2&k=parity&sd=001&lw=0.03&look=Gilded");
    const short = fromLink("#g=5,4,2&m=kd&k=faces&look=Escher");
    expect(short.ok).toBe(true);
    if (short.ok) {
      expect(short.state.content.group).toEqual([5, 4, 2]);
      expect(short.state.view.picture.model).toBe("klein");
      expect(short.state.content.look).toEqual(LOOKS[1].look);
      expect(short.state.view.camera).toEqual(homeView(2).camera);
    }
    // a whole URL works too
    expect(fromLink(`https://example.org/hyperscope.html#${link}`).ok).toBe(true);
  });

  it("keeps loading this version 1 link", () => {
    // written by version 1 after a zoom, a pan and a turn, the half-plane, {5,4} faces, Nebula with
    // another palette, the polar grid in km, the gold accent; do not change it
    const V1 =
      "v=1&m=hp&g=5%2C4%2C2&k=faces&sd=101&lw=0.02&grid=on.polar.km&look=Nebula&pal=Aurora&gw=0.5&acc=gold&pc=zszMzMzMCEA" +
      "&cam=_fC5WtFb8L8o3b9_qYWIv5jb3sgFTMs_RHMmcVm5jj_nHeN-DADwvz8-zKOrJ5C_w3b0t0tSy79yqiv9aHuKPwqsE3yaXPA_" +
      "&org=p_SXm3fj6b9eWnUEI8_iPwAAAAAAAAAAXlp1BCPP4r-n9Jebd-PpvwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPA_&perm=1.0" +
      "&gx=AV5G_E1rn8E__2zThuni5L8pON3hBtzRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
      "&gp=AJqZmZmZmfE_AAAAAAAA4D-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
      "&gh=AVpxd-_Ca78_FR_s7zsB3r8vQFFic4SMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const r = fromLink(V1);
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    if (!r.ok) return;
    const s = r.state;
    expect(s.view.picture).toEqual({ model: "halfplane", mu: 3.1000000000000005 });
    expect(s.content).toMatchObject({ group: [5, 4, 2], colouring: "faces", sides: [true, false, true], lineWidth: 0.02, grid: { on: true, kind: "polar", unit: "km" } });
    expect(s.content.look).toEqual({ ...LOOKS[5].look, palette: "Aurora", glow: 0.5 });
    expect(s.ui.accent).toBe("gold");
    expect(s.view.perm).toEqual([1, 0]);
    expect(s.view.grids.polar).toEqual({ s: 1n << (FRAC_BITS - 1n), e: 1.1, theta: 0.5 });
    expect(s.view.camera[8]).toBe(1.0226082655669892);
    expect(s.view.origin[8]).toBe(1);
  });

  it("keeps a band picture next to its edge through the file and the link", () => {
    const snap = homeSnapshot(PRESETS[0].content, "band");
    const deep = { ...snap, view: { ...snap.view, picture: { model: "band" as const, y0: -(Math.PI / 2 - 3e-12), s: 1e-12 } } };
    const viaJson = load(JSON.parse(JSON.stringify(save(deep))));
    const viaLink = fromLink(toLink(deep));
    expect(toLink(deep)).toContain("m=bd");
    for (const r of [viaJson, viaLink]) {
      expect(r.ok, r.ok ? "" : r.reason).toBe(true);
      if (r.ok) expect(r.state.view.picture).toEqual(deep.view.picture);
    }
  });

  it("refuses broken input with a reason and never throws", () => {
    const home = save(homeSnapshot(PRESETS[0].content));
    expect(home.content.look).toEqual(LOOKS[0].look);
    const broken: [unknown, RegExp][] = [
      [null, /not a Hyperscope state/],
      [{ ...home, v: 3 }, /newer Hyperscope \(version 3\)/],
      [{ ...home, v: 0 }, /no version/],
      [{ ...home, content: { ...home.content, group: [3, 3, 3] } }, /not a hyperbolic triangle group/],
      [{ ...home, content: { ...home.content, group: [7, 3, 2.5] } }, /three whole numbers/],
      [{ ...home, content: { ...home.content, colouring: "c99" } }, /colourings, not 99/],
      [{ ...home, content: { ...home.content, look: { ...home.content.look, palette: "Nope" } } }, /unknown palette/],
      [{ ...home, content: { ...home.content, look: { ...home.content.look, lineColour: "red" } } }, /#rrggbb/],
      [{ ...home, view: { ...home.view, camera: [2, 0, 0, 0, 1, 0, 0, 0, 1] } }, /not a hyperbolic motion/],
      [{ ...home, view: { ...home.view, camera: [1, 0, 0, 0, 1, 0, 0, 0, NaN] } }, /not a number/],
      [{ ...home, view: { ...home.view, shift: 0.5 } }, /depth shift is not a whole number/],
      [{ ...home, view: { ...home.view, picture: { model: "poincare", c: [0, 0], sigma: 0, s: 1 } } }, /out of range/],
      [{ ...home, view: { ...home.view, picture: { model: "sphere" } } }, /unknown view/],
      [{ ...home, view: { ...home.view, picture: { model: "band", y0: Math.PI / 2, s: 1 } } }, /band picture is out of range/],
      [{ ...home, view: { ...home.view, picture: { model: "band", y0: 0.3, s: 0 } } }, /band picture is out of range/],
      [{ ...home, view: { ...home.view, picture: { model: "h3", h: 7, pitch: 0.5, fov: 1.2 } } }, /inside H³ is out of range/],
      [{ ...home, view: { ...home.view, picture: { model: "h3", h: 0.3, pitch: -0.1, fov: 1.2 } } }, /inside H³ is out of range/],
      [{ ...home, view: { ...home.view, picture: { model: "h3", h: 0.3, pitch: 0.5, fov: 3 } } }, /inside H³ is out of range/],
      [{ ...home, view: { ...home.view, picture: { model: "hyperboloid", elevation: 0.5, distance: 41, fov: 1 } } }, /hyperboloid picture is out of range/],
      [{ ...home, view: { ...home.view, picture: { model: "hyperboloid", elevation: 2, distance: 5, fov: 1 } } }, /hyperboloid picture is out of range/],
      [{ ...home, view: { ...home.view, picture: { model: "hyperboloid", elevation: 0.5, distance: 5, fov: 0.2 } } }, /hyperboloid picture is out of range/],
      // the camera on the surface (at 30 degrees the wall is 2 R from the vertex)
      [{ ...home, view: { ...home.view, picture: { model: "hyperboloid", elevation: Math.PI / 6, distance: 2, fov: 1 } } }, /hyperboloid picture is out of range/],
      [{ ...home, view: { ...home.view, grids: { ...home.view.grids, polar: ["1.5", 0, 0] } } }, /grid camera is not readable/],
      [{ ...home, ui: { accent: "pink" } }, /unknown accent/],
    ];
    for (const [input, reason] of broken) {
      const r = load(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
    }
    const links: [string, RegExp][] = [
      ["", /not a Hyperscope link/],
      ["#foo=1", /not a Hyperscope link/],
      ["#v=7&g=7,3,2", /newer Hyperscope/],
      ["#g=4,4,2", /not a hyperbolic/],
      ["#g=7,3,2&m=xx", /unknown view/],
      ["#g=7,3,2&cam=AAAA", /holds 0 numbers|broken length/],
      ["#g=7,3,2&cam=!!", /not base64url/],
      ["#g=7,3,2&look=Paisley", /unknown look/],
      ["#g=7,3,2&gx=AA", /grid camera in the link/],
    ];
    for (const [link, reason] of links) {
      const r = fromLink(link);
      expect(r.ok, link).toBe(false);
      if (!r.ok) expect(r.reason, link).toMatch(reason);
    }
  });

  it("keeps a Wythoff construction and a free point's weights bit for bit, and refuses broken ones", () => {
    const snub = homeSnapshot({ ...PRESETS[0].content, construction: "snub" });
    expect(toLink(snub)).toMatch(/&wy=snub(&|$)/);
    const free = homeSnapshot({ ...PRESETS[0].content, construction: "free", weights: [0.1, Math.PI, 1 / 3] });
    expect(toLink(free)).toMatch(/&wy=free&wyw=0\.1%2C3\.14159/);
    for (const s of [snub, free]) {
      for (const r of [fromLink(toLink(s)), load(JSON.parse(JSON.stringify(save(s))))]) {
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.state.content.construction).toBe(s.content.construction);
          expect(r.state.content.weights).toEqual(s.content.weights);
        }
      }
    }
    // version 1's tiling is the construction left out, and weights go with a free point only
    expect(save(homeSnapshot({ ...PRESETS[0].content, construction: "lines" })).content.construction).toBeUndefined();
    expect(save(homeSnapshot({ ...PRESETS[0].content, construction: "110", weights: [1, 1, 1] })).content.weights).toBeUndefined();
    const home = save(homeSnapshot(PRESETS[0].content));
    const broken: [unknown, RegExp][] = [
      [{ ...home, content: { ...home.content, construction: "222" } }, /unknown construction/],
      [{ ...home, content: { ...home.content, construction: "free" } }, /three weights/],
      [{ ...home, content: { ...home.content, construction: "free", weights: [0, 0, 0] } }, /not all 0/],
      [{ ...home, content: { ...home.content, construction: "free", weights: [1, -1, 0] } }, /not all 0/],
      [{ ...home, content: { ...home.content, construction: "free", weights: [1, "x", 0] } }, /not a number/],
    ];
    for (const [input, reason] of broken) {
      const r = load(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
    }
    for (const [link, reason] of [["#g=7,3,2&wy=xyz", /unknown construction/], ["#g=7,3,2&wy=free", /three weights/], ["#g=7,3,2&wy=free&wyw=1,-1,0", /not all 0/]] as const) {
      const r = fromLink(link);
      expect(r.ok, link).toBe(false);
      if (!r.ok) expect(r.reason, link).toMatch(reason);
    }
  });

  it("keeps a motif, built-in by its id or loaded as its spec, and refuses broken ones", () => {
    const shoal = PRESETS.find((p) => p.content.motif === "shoal")!.content;
    const builtIn = homeSnapshot(shoal);
    expect(toLink(builtIn)).toMatch(/&mo=shoal(&|$)/);
    // a loaded motif keeps the format's fields only
    const spec = { ...cleanMotifSpec(motifSpecOf("moths")), author: "someone", features: motifSpecOf("moths").features!.map((f) => ({ ...f, note: "x" })) };
    const moths = PRESETS.find((p) => p.content.motif === "moths")!.content;
    const loaded = homeSnapshot({ ...moths, motif: spec as MotifSpec });
    expect(toLink(loaded)).toMatch(/&md=[A-Za-z0-9_-]+(&|$)/);
    expect(JSON.stringify(save(loaded))).not.toMatch(/author|note/);
    for (const s of [builtIn, loaded]) {
      for (const r of [fromLink(toLink(s)), load(JSON.parse(JSON.stringify(save(s))))]) {
        expect(r.ok, r.ok ? "" : r.reason).toBe(true);
        if (r.ok) expect(r.state.content.motif).toEqual(typeof s.content.motif === "string" ? s.content.motif : motifSpecOf("moths"));
      }
    }
    // the largest motif there is, in full float64, fits a link well within its limit
    const g = triangleGroup(7, 3, 2);
    const R = toDisk(g.corners.R);
    const Q = toDisk(g.corners.Q);
    const along = (a: Complex, b: Complex, n: number): Point[] => Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * (k + 1)) / (n + 1), a[1] + ((b[1] - a[1]) * (k + 1)) / (n + 1)]);
    const big: MotifSpec = {
      format: MOTIF_FORMAT,
      version: MOTIF_VERSION,
      name: "x".repeat(60),
      group: [7, 3, 2],
      colouring: "parity",
      pr: along([0, 0], R, 3 * (MAX_CURVE_POINTS - 1) - 1),
      rq: along(R, Q, 3 * (MAX_CURVE_POINTS - 1) - 1),
      features: [
        ...Array.from({ length: 8 }, (_, i) => ({ kind: "stroke" as const, colour: "line" as const, tone: -1 / 3, path: [[0.01 * i + 1 / 7, 1 / 9], ...along([0.01 * i + 1 / 7, 1 / 9], [0.01 * i + 1 / 7, 1 / 3], 44), [0.01 * i + 1 / 7, 1 / 3]] as Point[], width: [1 / 300, 1 / 700] as Point })),
        ...Array.from({ length: 16 }, (_, i) => ({ kind: "circle" as const, colour: "white" as const, tone: 1 / 3, centre: [0.01 * i + 1 / 7, 1 / 11] as Point, radius: 1 / 301 })),
      ],
    };
    const m = compileMotif(big);
    expect(m.features.reduce((k, f) => k + f.points.length, 0)).toBe(128);
    const huge = homeSnapshot({ ...PRESETS[0].content, motif: big });
    const md = /&md=([^&]*)/.exec(toLink(huge))![1];
    expect(md.length).toBeGreaterThan(MAX_MOTIF_LINK / 4);
    expect(md.length).toBeLessThan(MAX_MOTIF_LINK / 2);
    const back = fromLink(toLink(huge));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.content.motif).toEqual(big);

    const home = save(homeSnapshot(shoal));
    // compileMotif refuses it: its first curve leaves its two triangles
    const astray = { ...motifSpecOf("shoal"), pr: [[0.3, 0.01], [0.3, 0.2]] };
    const broken: [unknown, RegExp][] = [
      [{ ...home, content: { ...home.content, motif: "nope" } }, /unknown motif "nope"/],
      [{ ...home, content: { ...home.content, motif: 5 } }, /motif is not readable/],
      [{ ...home, content: { ...home.content, group: [7, 3, 2], colouring: "parity", motif: "shoal" } }, /Shoal is drawn for \(3, 3, 4\), not \(7, 3, 2\)/],
      [{ ...home, content: { ...home.content, construction: "snub" } }, /Lines construction only/],
      [{ ...home, content: { ...home.content, motif: astray } }, /motif refused: the curve from P to R leaves/],
      [{ ...home, content: { ...home.content, motif: { ...motifSpecOf("shoal"), colouring: "c99" } } }, /its colouring/],
    ];
    for (const [input, reason] of broken) {
      const r = load(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
    }
    const b64 = (text: string) => Buffer.from(text).toString("base64url");
    for (const [link, reason] of [
      ["#g=3,3,4&k=r2&mo=nope", /unknown motif "nope"/],
      ["#g=7,3,2&mo=shoal", /drawn for \(3, 3, 4\)/],
      ["#g=3,3,4&mo=shoal&wy=snub", /Lines construction only/],
      ["#g=3,3,4&md=a*b", /not base64url/],
      [`#g=3,3,4&md=${b64("not JSON")}`, /motif in the link is not readable/],
      [`#g=3,3,4&md=${"A".repeat(MAX_MOTIF_LINK + 4)}`, /too long/],
      [`#g=3,3,4&md=${b64(JSON.stringify(astray))}`, /motif refused: the curve from P to R leaves/],
    ] as const) {
      const r = fromLink(link);
      expect(r.ok, link).toBe(false);
      if (!r.ok) expect(r.reason, link).toMatch(reason);
    }
  });

  it("restarts a colour permutation that does not fit the colouring", () => {
    const s = save(homeSnapshot(PRESETS[0].content));
    const r = load({ ...s, view: { ...s.view, perm: [2, 0, 1] } });
    expect(r.ok && r.state.view.perm).toEqual([0, 1]);
  });

  it("keeps a chiral colouring and the camera's tile matrix, and restarts a matrix that does not fit", () => {
    const content: ContentState = { group: [7, 3, 2], colouring: "r2", sides: [false, true, true], lineWidth: 0.012 };
    const g = triangleGroup(7, 3, 2);
    const c = colouringFor(g, "r2");
    expect(c.kind).toBe("chiral");
    let v = homeView(c.k);
    for (let i = 0; i < 8; i++) v = settle(rotateBy(panBy(v, [0, 0], [0.3, 0.1]), 0.4), g, c);
    expect(v.tile).toBeDefined();
    expect(v.tile!.some((x, i) => x !== (i % 4 === 0 ? 1 : 0))).toBe(true);
    const snap: Snapshot = { view: v, content, ui: { accent: ACCENT_NAMES[0] } };
    const link = toLink(snap);
    expect(link).toMatch(/&tid=\d+(\.\d+){8}/);
    expect(link).toMatch(/&k=r2&/);
    for (const r of [fromLink(link), load(JSON.parse(JSON.stringify(save(snap))))]) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.state.view.tile).toEqual(v.tile);
        expect(r.state.content.colouring).toBe("r2");
      }
    }
    const s = save(snap);
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (const tile of [[1, 0, 0, 0, 1, 0, 0, 0, 2], [1, 0, 0, 0, 1, 0, 0, 0, 99999], [1, 2, 3], "x"]) {
      const r = load({ ...s, view: { ...s.view, tile } } as never);
      expect(r.ok && r.state.view.tile).toEqual(identity);
    }
    const r = fromLink(link.replace(/tid=[\d.]+/, "tid=1.0.0.0.1.0.0.0.2"));
    expect(r.ok && r.state.view.tile).toEqual(identity);
  });
});

describe("text chunk in a PNG", () => {
  const rgba = new Uint8Array(4 * 6 * 4).map((_, i) => (i * 37) % 256);
  const png = new Uint8Array(encodePNG(rgba, 6, 4));

  it("is written after the header, read back, and leaves the image intact", () => {
    const text = JSON.stringify(save(homeSnapshot(PRESETS[2].content))) + " Poincaré µ −";
    const out = withText(png, "hyperscope", text);
    expect(readText(out, "hyperscope")).toBe(text);
    expect(readText(png, "hyperscope")).toBeNull();
    expect(decodePNG(out)).toEqual(decodePNG(png));
    // every chunk's CRC, checked with Node's own CRC-32
    const dv = new DataView(out.buffer, out.byteOffset);
    const types: string[] = [];
    for (let at = 8; at < out.length; ) {
      const len = dv.getUint32(at);
      types.push(String.fromCharCode(...out.subarray(at + 4, at + 8)));
      const body = out.subarray(at + 4, at + 8 + len);
      expect(dv.getUint32(at + 8 + len)).toBe(zlibCrc32(body));
      expect(crc32(body)).toBe(zlibCrc32(body));
      at += 12 + len;
    }
    expect(types[0]).toBe("IHDR");
    expect(types[1]).toBe("iTXt");
    expect(types.at(-1)).toBe("IEND");
    // written again, the chunk is replaced, not added
    const twice = withText(out, "hyperscope", "second");
    expect(readText(twice, "hyperscope")).toBe("second");
    expect(twice.length).toBe(png.length + 12 + "hyperscope".length + 5 + "second".length);
  });

  it("reads nothing from something that is not a PNG", () => {
    expect(readText(new TextEncoder().encode("hello"), "hyperscope")).toBeNull();
    expect(() => withText(new Uint8Array(3), "k", "t")).toThrow(/not a PNG/);
  });
});
