// The tile picture's parts (design notes, step 17): SHA-256, the levels, GL's sampling rule, the
// placement and the template's geometry.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Complex } from "../../src/math/complex.ts";
import { triangleGroup } from "../../src/math/groups.ts";
import { reflectPoint } from "../../src/math/lorentz.ts";
import { fromDisk, toDisk } from "../../src/math/motifs.ts";
import {
  DEFAULT_PLACEMENT, mapUV, mirrorIndex, pictureMap, sampleImage, shapeBox, shapeCorners, SRGB_TO_LINEAR, templateGeometry, TEMPLATE_PX, TEMPLATE_TICKS, tileImageFromRGBA, TILE_MODES,
  type Level, type TileImage,
} from "../../src/content/tileimage.ts";
import { sha256 } from "../../src/state/sha256.ts";
import { testPicture } from "./picture-world.ts";

const GROUPS: [number, number, number][] = [[7, 3, 2], [5, 4, 2], [3, 3, 4], [4, 4, 3], [8, 3, 2], [2, 3, 7], [6, 4, 2]];

/** A level's texel as premultiplied linear RGBA. */
const texel = (lv: Level, i: number, j: number) => {
  const o = (j * lv.width + i) * 4;
  return [SRGB_TO_LINEAR[lv.data[o]], SRGB_TO_LINEAR[lv.data[o + 1]], SRGB_TO_LINEAR[lv.data[o + 2]], lv.data[o + 3] / 255];
};
const levelMean = (lv: Level) => {
  const m = [0, 0, 0, 0];
  for (let j = 0; j < lv.height; j++) for (let i = 0; i < lv.width; i++) texel(lv, i, j).forEach((v, c) => (m[c] += v / (lv.width * lv.height)));
  return m;
};

describe("SHA-256", () => {
  it("equals Node's for lengths around the block boundaries", () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 127, 128, 1000, 70000]) {
      const s = Array.from({ length: n }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 95))).join("");
      expect(sha256(s), `${n}`).toBe(createHash("sha256").update(s).digest("hex"));
    }
    expect(sha256("Poincaré")).toBe(createHash("sha256").update("Poincaré", "utf8").digest("hex"));
  });
});

describe("the picture's levels", () => {
  it("halve each side down to 1 x 1, odd sides rounded down", () => {
    const img = tileImageFromRGBA(testPicture(75, 20), 75, 20, "x");
    expect(img.levels.map((l) => [l.width, l.height])).toEqual([[75, 20], [37, 10], [18, 5], [9, 2], [4, 1], [2, 1], [1, 1]]);
    expect(img.opaque).toBe(true);
  });

  it("keep an opaque picture's bytes as level 0, and premultiply a transparent one in linear light", () => {
    const rgba = testPicture(40, 30);
    expect(Array.from(tileImageFromRGBA(rgba, 40, 30, "x").levels[0].data)).toEqual(Array.from(rgba));
    const t = new Uint8Array([255, 128, 0, 128, 10, 20, 30, 0]);
    const img = tileImageFromRGBA(t, 2, 1, "t");
    expect(img.opaque).toBe(false);
    const d = img.levels[0].data;
    expect(SRGB_TO_LINEAR[d[0]]).toBeCloseTo(128 / 255, 2);
    expect(SRGB_TO_LINEAR[d[1]]).toBeCloseTo(SRGB_TO_LINEAR[128] * (128 / 255), 2);
    expect([d[3], d[4], d[5], d[6], d[7]]).toEqual([128, 0, 0, 0, 0]);
  });

  it("keep the mean of level 0 at every level (an exact area average, then rounding)", () => {
    for (const [w, h, alpha] of [[96, 64, false], [75, 50, true], [33, 7, true]] as const) {
      const img = tileImageFromRGBA(testPicture(w, h, alpha), w, h, "x");
      const m0 = levelMean(img.levels[0]);
      for (const lv of img.levels) levelMean(lv).forEach((v, c) => expect(Math.abs(v - m0[c]), `${w}x${h} level ${lv.width}x${lv.height} channel ${c}`).toBeLessThan(4e-3));
    }
  });
});

describe("sampling as textureLod does", () => {
  const img = tileImageFromRGBA(testPicture(48, 32, true), 48, 32, "s");
  const close = (a: number[], b: number[], tol = 1e-12) => a.forEach((v, c) => expect(Math.abs(v - b[c])).toBeLessThan(tol));

  it("mirrors texel indices as MIRRORED_REPEAT", () => {
    expect([-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => mirrorIndex(i, 3))).toEqual([2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1, 2]);
  });

  it("returns a texel at its centre, and the mean of four between them", () => {
    const lv = img.levels[0];
    close(sampleImage(img, (5 + 0.5) / 48, (7 + 0.5) / 32, 0), texel(lv, 5, 7));
    const mid = [0, 0, 0, 0];
    for (const [i, j] of [[5, 7], [6, 7], [5, 8], [6, 8]]) texel(lv, i, j).forEach((v, c) => (mid[c] += v / 4));
    close(sampleImage(img, 6 / 48, 8 / 32, 0), mid);
  });

  it("mirrors past the picture's edge", () => {
    close(sampleImage(img, -0.3 / 48, 2.5 / 32, 0), sampleImage(img, 0.3 / 48, 2.5 / 32, 0));
    close(sampleImage(img, 1 + 1.5 / 48, 1 + 3.5 / 32, 0), sampleImage(img, 1 - 1.5 / 48, 1 - 3.5 / 32, 0));
    close(sampleImage(img, 2.25, -1.75, 0), sampleImage(img, 0.25, 0.25, 0));
  });

  it("blends two levels by the fraction of the level of detail, and stops at the last level", () => {
    const [u, v] = [0.37, 0.61];
    const a = sampleImage(img, u, v, 2);
    const b = sampleImage(img, u, v, 3);
    close(sampleImage(img, u, v, 2.25), a.map((x, c) => 0.75 * x + 0.25 * b[c]));
    const last = img.levels.length - 1;
    close(sampleImage(img, u, v, 40), sampleImage(img, u, v, last));
    close(sampleImage(img, u, v, -3), sampleImage(img, u, v, 0));
    close(sampleImage(img, 0.1, 0.9, last), texel(img.levels[last], 0, 0));
  });
});

describe("the placement", () => {
  it("by default centres the shape's box and fits its larger side to 84 % of the shorter side", () => {
    for (const g of GROUPS)
      for (const mode of TILE_MODES)
        for (const [W, H] of [[1000, 600], [500, 800]]) {
          const group = triangleGroup(...g);
          const m = pictureMap(group, mode, DEFAULT_PLACEMENT, W, H, 12);
          const px = shapeCorners(group, mode).map((w) => mapUV(m, w)).map(([u, v]) => [u * W, v * H]);
          const xs = px.map((p) => p[0]);
          const ys = px.map((p) => p[1]);
          expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(W / 2, 9);
          expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(H / 2, 9);
          expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))).toBeCloseTo(0.84 * Math.min(W, H), 9);
          // T stands upright: R above side 1 (smaller y in the picture), Q right of P
          expect(px[2][1]).toBeLessThan(px[0][1]);
          expect(px[1][0]).toBeGreaterThan(px[0][0]);
        }
  });

  it("moves the box's centre to x, y, scales it by size, and turns it counterclockwise as seen", () => {
    const group = triangleGroup(7, 3, 2);
    const { c, E } = shapeBox(group, "chiral");
    const W = 800;
    const H = 400;
    const m = pictureMap(group, "chiral", { x: 0.3, y: 0.6, size: 0.5, turn: 90 }, W, H, 12);
    const at = (w: Complex) => {
      const [u, v] = mapUV(m, w);
      return [u * W, v * H];
    };
    const centre = at(c);
    expect(centre[0]).toBeCloseTo(240, 9);
    expect(centre[1]).toBeCloseTo(240, 9);
    expect(m.s).toBeCloseTo((0.5 * 400) / E, 9);
    // +x in w (right, as seen unturned) points up in the picture after a quarter turn
    const right = at([c[0] + 0.01, c[1]]);
    expect(right[0] - centre[0]).toBeCloseTo(0, 9);
    expect(right[1] - centre[1]).toBeCloseTo(-0.01 * m.s, 9);
  });

  it("stops the level of detail where the whole shape is one texel", () => {
    const group = triangleGroup(7, 3, 2);
    const small = pictureMap(group, "kaleidoscope", { ...DEFAULT_PLACEMENT, size: 0.05 }, 2048, 2048, 12);
    expect(small.maxLod).toBeCloseTo(Math.log2(0.05 * 2048), 9);
    expect(pictureMap(group, "kaleidoscope", DEFAULT_PLACEMENT, 2048, 2048, 12).maxLod).toBeCloseTo(Math.log2(0.84 * 2048), 9);
    expect(pictureMap(group, "kaleidoscope", { ...DEFAULT_PLACEMENT, size: 4 }, 64, 64, 7).maxLod).toBe(6);
  });
});

describe("the template", () => {
  /** Template pixels back to w, through the default placement's map at the template's size. */
  const toW = (group: ReturnType<typeof triangleGroup>, mode: (typeof TILE_MODES)[number], p: Complex): Complex => {
    const m = pictureMap(group, mode, DEFAULT_PLACEMENT, TEMPLATE_PX, TEMPLATE_PX, 1);
    const [u, v] = [p[0] / TEMPLATE_PX - m.u[2], p[1] / TEMPLATE_PX - m.v[2]];
    const det = m.u[0] * m.v[1] - m.u[1] * m.v[0];
    return [(u * m.v[1] - v * m.u[1]) / det, (m.u[0] * v - m.v[0] * u) / det];
  };

  it("pairs its ticks: rho_P takes those on PR' onto those on PR, rho_Q those on QR' onto QR", () => {
    for (const g of GROUPS) {
      const group = triangleGroup(...g);
      const t = templateGeometry(group, "chiral");
      const n = group.normals;
      const byEdge = (name: string) => {
        const k = t.edges.findIndex((e) => e.name === name);
        return t.ticks.filter((x) => x.edge === k).sort((a, b) => a.index - b.index);
      };
      expect(byEdge("PR").length).toBe(TEMPLATE_TICKS - 1);
      // rho_P = s2 s1 (s1 first), rho_Q = s3 s1
      const rhoP = (w: Complex) => toDisk(reflectPoint(reflectPoint(fromDisk(w), n[0]), n[1]));
      const rhoQ = (w: Complex) => toDisk(reflectPoint(reflectPoint(fromDisk(w), n[0]), n[2]));
      for (const [from, to, rho] of [["PR′", "PR", rhoP], ["QR′", "QR", rhoQ]] as const) {
        const a = byEdge(from);
        const b = byEdge(to);
        a.forEach((tick, i) => {
          const w = rho(toW(group, "chiral", tick.at));
          const target = toW(group, "chiral", b[i].at);
          expect(Math.hypot(w[0] - target[0], w[1] - target[1]), `${g} ${from} tick ${i + 1}`).toBeLessThan(1e-9);
        });
      }
    }
  });

  it("lies inside the sheet and closes its outline through the corners", () => {
    for (const g of GROUPS)
      for (const mode of TILE_MODES) {
        const group = triangleGroup(...g);
        const t = templateGeometry(group, mode);
        for (const [x, y] of t.outline) {
          expect(x).toBeGreaterThan(0.07 * TEMPLATE_PX);
          expect(x).toBeLessThan(0.93 * TEMPLATE_PX);
          expect(y).toBeGreaterThan(0.07 * TEMPLATE_PX);
          expect(y).toBeLessThan(0.93 * TEMPLATE_PX);
        }
        expect(t.corners.map((c) => c.name)).toEqual(mode === "chiral" ? ["P", "Q", "R", "R′"] : ["P", "Q", "R"]);
        for (const c of t.corners) expect(Math.min(...t.outline.map((p) => Math.hypot(p[0] - c.at[0], p[1] - c.at[1])))).toBeLessThan(1e-9);
        expect(t.edges.every((e) => e.pair === (mode === "chiral" ? (e.name.startsWith("P") ? 0 : 1) : 2))).toBe(true);
      }
  });
});

export type { TileImage };
