// The band's strips (input/strips.ts): each strip is the same picture, so a pixel shows the same
// world point, colour and depth start through any strip, and the strips cover the screen once.
import { describe, expect, it } from "vitest";
import { carry, colourOf, findChiralColourings, findColourings, parity } from "../../src/math/colourings.ts";
import type { Complex } from "../../src/math/complex.ts";
import { distanceToSide, fold, triangleGroup } from "../../src/math/groups.ts";
import { ORIGIN, apply, dist, inverse, mul } from "../../src/math/lorentz.ts";
import { bandMoveTo, frameOf } from "../../src/math/views.ts";
import { homeView, panBy, settle, zoomAt, type ViewState } from "../../src/input/camera.ts";
import { BAND_STRIP, MAX_STRIPS_EACH_SIDE, stripsOf } from "../../src/input/strips.ts";
import { stripColumns } from "../../src/render/reference.ts";
import { tileIdentity, tileOf } from "../../src/math/tileid.ts";
import { rng } from "./rng.ts";

const H = 900;

/** The world point under u through a strip: its camera times its frame point at u - du. */
const worldVia = (v: ViewState, du: number, u: Complex) => {
  const fp = frameOf(v.picture, [u[0] - du, u[1]]);
  return fp && apply(v.camera, fp.x);
};

describe("band strips", () => {
  const g = triangleGroup(6, 4, 2);
  // version 1's last colouring of {6,4} (5 colours), and a chiral one
  const c8 = findColourings(g, 5).filter((c) => c.k > 2).pop() ?? parity;
  const chiral = findChiralColourings(g).filter((c) => c.k > 2)[0];
  const views: [string, ViewState][] = [];
  let v = settle(homeView(c8.k, "band"), g, c8);
  views.push(["home", v]);
  v = settle(zoomAt(v, [0.2, 0.1], 0.5, H).view, g, c8);
  v = settle(zoomAt(v, [0.2, 0.1], 0.5, H).view, g, c8);
  views.push(["zoomed out", v]);
  const r = rng(91);
  let w = settle(homeView(c8.k, "band"), g, c8);
  for (let i = 0; i < 12; i++) w = settle(zoomAt(panBy(w, [0.2, 0.1], [r() - 0.5, r() - 0.5]), [r() - 0.5, r() * 0.8 - 0.4], 0.6 + r(), H).view, g, c8);
  for (let i = 0; i < 3; i++) w = settle(zoomAt(w, [r() - 0.5, r() * 0.8 - 0.4], 0.5, H).view, g, c8);
  views.push(["moved", w]);

  for (const [name, view] of views)
    it(`show the same world point and colour through every strip (${name})`, () => {
      const strips = stripsOf(view, g, c8, 21 / 9);
      expect(strips.length).toBeGreaterThan(1);
      expect(strips.length).toBeLessThanOrEqual(2 * MAX_STRIPS_EACH_SIDE + 1);
      const pic = view.picture as { y0: number; s: number };
      const step = (BAND_STRIP * Math.cos(pic.y0)) / pic.s;
      for (const st of strips) {
        if (st.from > -Infinity && st.to < Infinity) expect(st.to - st.from).toBeCloseTo(step, 12);
        // the strip's world is the view's moved by its re-centering g: st.camera = g camera N
        const gk = mul(mul(st.view.camera, inverse(bandMoveTo(pic, [st.du, 0]))), inverse(view.camera));
        // the same depth start, moved with the strip's re-centering
        const start = apply(gk, apply(view.origin, ORIGIN));
        // (re-centering re-orthonormalizes the start's matrix, good to about 1e-16 of its entries)
        expect(dist(apply(st.view.origin, ORIGIN), start)).toBeLessThan(1e-8 * start[2]);
        expect(st.view.shift).toBe(view.shift);
        // points across the strip and a little beyond it on both sides
        for (const t of [-0.7, -0.3, 0, 0.3, 0.7]) {
          for (const uy of [-0.6, 0, 0.5]) {
            const u: Complex = [st.du + t * step, uy];
            const a = worldVia(view, 0, u);
            const b = worldVia(st.view, st.du, u);
            if (!a || !b) continue;
            // b lies in the strip's world: back to the view's world through the cameras
            const back = apply(inverse(gk), b);
            expect(dist(a, back)).toBeLessThan(1e-9 * a[2]);
            // the colour: the permutation carried by each camera, along the fold of each point (a
            // point on a mirror, as the band's axis is at home, may fold to either side)
            const fa = fold(a, g.normals);
            if (g.normals.some((n) => distanceToSide(fa.x, n) < 1e-9)) continue;
            const colour = (cam: ViewState, x: NonNullable<typeof a>) => colourOf(c8, carry(c8, cam.perm, fold(x, g.normals).word));
            expect(colour(st.view, b)).toBe(colour(view, a));
          }
        }
      }
    });

  it("show the same chiral colour and the same tile identity through every strip", () => {
    const ids = tileIdentity(g);
    const rr = rng(92);
    let cv = settle(homeView(chiral.k, "band"), g, chiral);
    for (let i = 0; i < 12; i++) cv = settle(zoomAt(panBy(cv, [0.2, 0.1], [rr() - 0.5, rr() - 0.5]), [rr() - 0.5, rr() * 0.8 - 0.4], 0.6 + rr(), H).view, g, chiral);
    for (let i = 0; i < 3; i++) cv = settle(zoomAt(cv, [rr() - 0.5, rr() * 0.8 - 0.4], 0.5, H).view, g, chiral);
    const strips = stripsOf(cv, g, chiral, 21 / 9);
    expect(strips.length).toBeGreaterThan(2);
    const pic = cv.picture as { y0: number; s: number };
    const step = (BAND_STRIP * Math.cos(pic.y0)) / pic.s;
    let n = 0;
    for (const st of strips)
      for (const t of [-0.7, -0.3, 0, 0.3, 0.7])
        for (const uy of [-0.6, -0.2, 0.3, 0.5]) {
          const u: Complex = [st.du + t * step, uy];
          const a = worldVia(cv, 0, u);
          const b = worldVia(st.view, st.du, u);
          if (!a || !b) continue;
          const fa = fold(a, g.normals);
          const fb = fold(b, g.normals);
          if (g.normals.some((m) => distanceToSide(fa.x, m) < 1e-9)) continue;
          expect(colourOf(chiral, carry(chiral, st.view.perm, fb.word))).toBe(colourOf(chiral, carry(chiral, cv.perm, fa.word)));
          expect(tileOf(st.view.tile!, fb.word, ids).id).toEqual(tileOf(cv.tile!, fa.word, ids).id);
          n++;
        }
    expect(n).toBeGreaterThan(50);
  });

  it("cover every pixel column once, each by the strip that holds its centre", () => {
    const strips = stripsOf(views[1][1], g, c8, 2);
    const cols = stripColumns(strips, 1200, 600);
    expect(cols[0][0]).toBe(0);
    expect(cols[cols.length - 1][1]).toBe(1200);
    for (let i = 1; i < cols.length; i++) expect(cols[i][0]).toBe(cols[i - 1][1]);
    cols.forEach(([x0, x1], i) => {
      for (const px of [x0, x1 - 1]) {
        if (px < x0 || px >= x1) continue;
        const ux = (px + 0.5 - 600) / 300;
        expect(ux >= strips[i].from && ux < strips[i].to).toBe(true);
      }
    });
  });

  it("are one strip for every other view, and for a band zoomed in", () => {
    for (const model of ["poincare", "klein", "halfplane", "local"] as const) expect(stripsOf(homeView(2, model), g, parity, 2)).toHaveLength(1);
    let z = homeView(2, "band");
    for (let i = 0; i < 4; i++) z = zoomAt(z, [0.1, 0.2], 2, H).view;
    expect(stripsOf(z, g, parity, 2)).toHaveLength(1);
  });
});
