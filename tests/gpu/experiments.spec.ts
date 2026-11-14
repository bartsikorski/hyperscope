// Every benchmark experiment (bench/experiments.ts) still applies to the production chunks and
// compiles: each patch must match exactly once, so a change to the shaders that moves one fails here
// rather than when the benchmark is next run.

import { expect, test } from "./fixtures.ts";

test("every benchmark experiment compiles for every variant it draws", async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto("/");
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  const result = await page.evaluate(async () => {
    // loaded by the dev server; not part of the app
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { EXPERIMENTS } = await load("/bench/experiments.ts");
    const { Renderer } = await load("/src/render/gl.ts");
    const { SOURCES } = await load("/src/content/looks.ts");
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const renderer = new Renderer(gl);
    const errors: string[] = [];
    let compiled = 0;
    for (const exp of EXPERIMENTS) {
      renderer.experiment = exp;
      // a motif (step 16) and a tile picture (step 17, 1 kaleidoscope, 2 chiral) draw over
      // version 1's fold, so with WYTHOFF 0, and not together
      for (let wythoff = 0; wythoff <= 2; wythoff++)
        for (const motif of wythoff === 0 ? [false, true] : [false])
          for (const image of wythoff === 0 && !motif ? [0, 1, 2] : [0])
            for (let source = 0; source < SOURCES.length; source++)
              for (const relief of [false, true])
                for (const chiral of source === 0 && wythoff === 0 ? [false, true] : [false]) {
                  // the dihedral fold draws version 1's inside source without relief only, the
                  // permutation arrays version 1's mirror colourings only
                  if (exp.name === "fold-dihedral" && (SOURCES[source] !== "inside" || relief || wythoff > 0 || motif)) continue;
                  if (exp.name === "perm-arrays" && (chiral || motif)) continue;
                  try {
                    renderer.program("poincare", "tiling", { source, chiral, relief, grid: 0, wythoff, motif, image });
                    compiled++;
                  } catch (e) {
                    const what = `${SOURCES[source]}${chiral ? " chiral" : ""}${relief ? " relief" : ""} wythoff ${wythoff}${motif ? " motif" : ""}${image ? ` image ${image}` : ""}`;
                    errors.push(`${exp.name} ${what}: ${String((e as Error).message).slice(0, 400)}`);
                  }
                }
    }
    return { errors, compiled, names: EXPERIMENTS.map((e: { name: string }) => e.name) };
  });
  console.log(`${result.compiled} programs for ${result.names.join(", ")}`);
  expect(result.errors).toEqual([]);
  expect(result.names.length).toBeGreaterThanOrEqual(6);
});

// The benchmark page's scenes (bench/scenes.ts) draw without a GL error and are not blank, and each
// pair the step 18 plan compares draws a different picture (so a scene that lost its picture or its
// look, and would time the same work twice, fails here rather than in a misleading report).
test("every benchmark scene draws, and each compared pair differs", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/");
  await page.waitForFunction(() => window.hyperscope?.ready || window.hyperscope?.error);
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { scenes, specOf } = await load("/bench/scenes.ts");
    const { Renderer } = await load("/src/render/gl.ts");
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const renderer = new Renderer(gl);
    const [w, h] = [192, 108];
    const drawn = new Map<string, Uint8Array>();
    const problems: string[] = [];
    for (const s of scenes()) {
      const px: Uint8Array = renderer.renderPixels(specOf(s, h), w, h, 1);
      const err = gl.getError();
      if (err !== gl.NO_ERROR) problems.push(`${s.name}: GL error ${err}`);
      const colours = new Set<number>();
      for (let i = 0; i < px.length; i += 4) colours.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      if (colours.size < 8) problems.push(`${s.name}: ${colours.size} colours`);
      drawn.set(s.name, px);
    }
    // the share of pixels that differ by more than 8 in some channel
    const differ = (a: string, b: string) => {
      const pa = drawn.get(a);
      const pb = drawn.get(b);
      if (!pa || !pb) return -1;
      let n = 0;
      for (let i = 0; i < pa.length; i += 4)
        if (Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2])) > 8) n++;
      return n / (pa.length / 4);
    };
    const pairs: [string, string][] = [
      ["poincare {7,3} Mosaic", "poincare {7,3} Mosaic look, colouring source"],
      ["halfplane {7,3} Mosaic", "halfplane {7,3} Mosaic look, colouring source"],
      ["poincare Snub {5,4} Mosaic", "poincare Snub {5,4}"],
      ["poincare {7,3} free point", "poincare (7,3,2)"],
      ["poincare {7,3} kaleidoscope picture", "poincare {7,3} chiral picture"],
      ["halfplane {7,3} kaleidoscope picture", "halfplane {7,3} lines only"],
      ["halfplane {7,3} chiral picture", "halfplane {7,3} lines only"],
      ["halfplane {7,3} kaleidoscope picture, tinted", "halfplane {7,3} kaleidoscope picture"],
      ["poincare {7,3} picture at 1024x zoom, finest level", "poincare {7,3} lines only at 1024x zoom"],
      ["poincare Birds (4,4,3)", "halfplane Birds (4,4,3)"],
    ];
    const shares = pairs.map(([a, b]) => ({ a, b, share: differ(a, b) }));
    return { problems, shares, count: drawn.size };
  });
  console.log(`${result.count} scenes; pairs differ in ${result.shares.map((s) => `${Math.round(100 * s.share)}%`).join(", ")}`);
  expect(result.problems).toEqual([]);
  expect(result.count).toBeGreaterThanOrEqual(60);
  for (const s of result.shares) expect(s.share, `${s.a} against ${s.b}`).toBeGreaterThan(0.05);
});
