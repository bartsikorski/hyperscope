import { describe, expect, it } from "vitest";
import { HOLD_MS, MIN_SCALE, Progressive } from "../../src/render/progressive.ts";
import { MAX_SAMPLES, sampleOffset } from "../../src/render/samples.ts";

describe("sample positions", () => {
  it("start at the pixel centre and stay inside the pixel", () => {
    expect(sampleOffset(0)).toEqual([0, 0]);
    for (let i = 1; i < 1000; i++) for (const v of sampleOffset(i)) expect(Math.abs(v)).toBeLessThanOrEqual(0.5);
  });
  it("cover the pixel evenly: the first 16 put at most two in any cell of a 4 x 4 grid, no two close", () => {
    const cells = new Array(16).fill(0);
    const pts = Array.from({ length: MAX_SAMPLES }, (_, i) => sampleOffset(i));
    for (const [x, y] of pts) cells[Math.min(3, Math.floor((x + 0.5) * 4)) + 4 * Math.min(3, Math.floor((y + 0.5) * 4))]++;
    expect(Math.max(...cells)).toBeLessThanOrEqual(2);
    expect(cells.filter((c) => c === 0).length).toBeLessThanOrEqual(2);
    for (let a = 0; a < pts.length; a++)
      for (let b = a + 1; b < pts.length; b++) expect(Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])).toBeGreaterThan(0.1);
  });
  it("average to the pixel centre, so the picture does not shift as it refines", () => {
    const mean = (n: number) => [0, 1].map((k) => Array.from({ length: n }, (_, i) => sampleOffset(i)[k]).reduce((a, b) => a + b) / n);
    expect(Math.hypot(...mean(16))).toBeLessThan(0.012);
    expect(Math.hypot(...mean(4))).toBeLessThan(0.05);
  });
});

describe("progressive refinement", () => {
  it("adds samples at full scale until the picture is complete, then stops", () => {
    const p = new Progressive(16);
    const plans = [];
    for (let t = 1000; ; t += 16) {
      const plan = p.next(t);
      if (!plan) break;
      plans.push(plan);
      p.done();
    }
    expect(plans.map((q) => q.index)).toEqual([...Array(16).keys()]);
    expect(plans.every((q) => q.scale === 1)).toBe(true);
  });
  it("starts over on every change, and goes to full scale HOLD_MS after the last one", () => {
    const p = new Progressive(16);
    p.movingScale = 0.6;
    let t = 0;
    for (; t < 300; t += 16) {
      p.invalidate(t);
      const plan = p.next(t)!;
      expect(plan).toEqual({ scale: 0.625, index: 0 }); // the moving scale in steps of 1/8
      p.done();
    }
    // still now: samples keep accumulating at the moving scale until the hold runs out
    const last = t - 16;
    expect(p.next(last + HOLD_MS - 1)).toEqual({ scale: 0.625, index: 1 });
    p.done();
    expect(p.next(last + HOLD_MS)).toEqual({ scale: 1, index: 0 });
  });
  it("lowers the moving scale when frames are missed and raises it again slowly", () => {
    const p = new Progressive(16);
    for (let i = 0; i < 10; i++) p.frameTime(40, true);
    expect(p.movingScale).toBe(MIN_SCALE);
    for (let i = 0; i < 29; i++) p.frameTime(16.7, true);
    expect(p.movingScale).toBe(MIN_SCALE);
    p.frameTime(16.7, true);
    expect(p.movingScale).toBeCloseTo(MIN_SCALE * 1.1, 12);
    for (let i = 0; i < 1000; i++) p.frameTime(16.7, true);
    expect(p.movingScale).toBe(1);
    p.frameTime(100, false); // frame times of a still view do not count
    expect(p.movingScale).toBe(1);
  });
});
