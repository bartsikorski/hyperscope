import { describe, expect, it } from "vitest";
import { homeView, switchModel, zoomAt } from "../../src/input/camera.ts";
import { HOME, MODELS, type Model } from "../../src/math/views.ts";
import { distanceText, exponentText, formatFixed, FrameRate, magnification, orbitText, parseFixed, positionDecimals, significant } from "../../src/ui/readouts.ts";

const H = 600;
/** The views with a camera of their own: their zoom moves it, within its own limits. */
const lens = (m: Model) => m === "h3" || m === "hyperboloid";
const thin = (t: string) => t.replace(/ /g, " ");

describe("magnification", () => {
  it("is 1 at the Poincaré home, and each view's home reads its own scale against it", () => {
    expect(magnification(homeView(2).picture)).toBe(0);
    expect(magnification(homeView(2, "klein").picture)).toBeCloseTo(Math.log10(2), 12);
    expect(magnification(homeView(2, "halfplane").picture)).toBeCloseTo(Math.log10(2.1), 12);
    expect(magnification(homeView(2, "local").picture)).toBeCloseTo(0, 12);
    // inside H3, the eye's home height over its height
    expect(magnification(homeView(2, "h3").picture)).toBe(0);
    expect(magnification({ ...HOME.h3, h: 0.03 })).toBeCloseTo(1, 12);
    // on the hyperboloid, the orbit's home distance over its distance
    expect(magnification(homeView(2, "hyperboloid").picture)).toBe(0);
    expect(magnification({ ...HOME.hyperboloid, distance: 2.5 })).toBeCloseTo(Math.log10(2), 12);
  });
  it("on the hyperboloid gives the orbit's distance and elevation in its place", () => {
    expect(thin(orbitText(HOME.hyperboloid).height)).toBe(thin("5.00 R"));
    expect(orbitText(HOME.hyperboloid).detail).toBe("elevation 55.0°");
    expect(orbitText({ ...HOME.hyperboloid, elevation: -Math.PI / 6, distance: 12.345 }).detail).toBe("elevation −30.0°");
    expect(thin(orbitText({ ...HOME.hyperboloid, distance: 12.345 }).height)).toBe(thin("12.3 R"));
  });
  for (const model of MODELS) {
    it(`doubles with a 2x zoom at the centre and stays when the view changes: ${model}`, () => {
      const v = homeView(2, model);
      const m0 = magnification(v.picture);
      let z = zoomAt(v, [0, 0], 2, H).view;
      expect(magnification(z.picture) - m0).toBeCloseTo(Math.log10(2), 12);
      z = zoomAt(z, [0, 0], 2 ** 6, H).view; // well inside the zoom-in limit
      // a switch keeps the centre's scale, except into H3 or onto the hyperboloid (their own eye or
      // orbit: magnification 0) and out of them (the centre's scale from that camera, not its own
      // limits: camera.test.ts)
      for (const other of MODELS) {
        if (lens(model) || lens(other)) continue;
        expect(magnification(switchModel(z, other, H).picture) - m0).toBeCloseTo(7 * Math.log10(2), 9);
      }
      for (const other of MODELS.filter((m) => lens(m) && m !== model)) expect(magnification(switchModel(z, other, H).picture)).toBe(0);
    });
  }
  it("writes the exponent with two decimals and a true minus", () => {
    expect(exponentText(0)).toBe("0.00");
    expect(exponentText(-0.001)).toBe("0.00");
    expect(exponentText(Math.log10(2))).toBe("0.30");
    expect(exponentText(-Math.log10(2))).toBe("−0.30");
    expect(exponentText(2.494)).toBe("2.49");
    expect(exponentText(11.005)).toBe("11.01");
  });
});

describe("distance", () => {
  it("reads in R and in metres as the labels do, to three significant digits", () => {
    expect(thin(distanceText(0, "earth"))).toBe("0 R · 0 m");
    expect(thin(distanceText(12.4, "earth"))).toBe("12.4 R · 79 000 km");
    expect(thin(distanceText(1, "km"))).toBe("1.00 R · 1.00 km");
    expect(thin(distanceText(0.5, "m"))).toBe("0.500 R · 500 mm");
    expect(thin(distanceText(2.5, "R"))).toBe("2.50 R");
    expect(thin(distanceText(1e-9, "earth"))).toBe("0.000 000 001 00 R · 6.37 mm");
    expect(thin(distanceText(1234.5, "R"))).toBe("1 230 R");
  });
  it("rounds up into the next unit and digit cleanly", () => {
    expect(thin(significant(999.7, "m"))).toBe("1.00 km");
    expect(thin(significant(9.996, "R"))).toBe("10.0 R");
    expect(thin(significant(0.0009996, "m"))).toBe("1.00 mm");
  });
  it("writes 0 for anything but a positive finite number", () => {
    for (const v of [0, -1, NaN, Infinity]) expect(significant(v, "R")).toBe("0 R");
  });
});

describe("frame rate", () => {
  it("counts the frames of the last second", () => {
    const r = new FrameRate();
    expect(r.rate()).toBeNull();
    r.frame(0);
    r.frame(16.7);
    expect(r.rate()).toBeNull();
    for (let i = 2; i <= 120; i++) r.frame(i * 16.7);
    expect(r.rate()).toBeCloseTo(1000 / 16.7, 6);
    r.stop();
    expect(r.rate()).toBeNull();
  });
});

describe("exact position fields", () => {
  const ONE = 1n << 256n;
  it("read decimals exactly into the grid's fixed point", () => {
    expect(parseFixed("0")).toBe(0n);
    expect(parseFixed("1")).toBe(ONE);
    expect(parseFixed("-2.5")).toBe(-(5n * ONE) / 2n);
    expect(parseFixed("+0.25")).toBe(ONE / 4n);
    expect(parseFixed("−3")).toBe(-3n * ONE);
    expect(parseFixed("12e3")).toBe(12000n * ONE);
    expect(parseFixed(".5")).toBe(ONE / 2n);
    expect(parseFixed("7.")).toBe(7n * ONE);
    // 0.1 is not a binary fraction: rounded to the nearest 2^-256
    expect(parseFixed("0.1")).toBe((ONE + 5n) / 10n);
    for (const bad of ["", "-", ".", "1.2.3", "abc", "1e", "e5", "1,5"]) expect(parseFixed(bad), bad).toBeNull();
  });
  it("write them back with the decimals asked for", () => {
    expect(formatFixed(parseFixed("12.3456789")!, 3)).toBe("12.346");
    expect(formatFixed(parseFixed("-0.0004")!, 3)).toBe("0.000");
    expect(formatFixed(parseFixed("-0.0005")!, 3)).toBe("-0.001");
    expect(formatFixed(parseFixed("123456789.000000000123")!, 12)).toBe("123456789.000000000123");
    expect(formatFixed(0n, 0)).toBe("0");
    expect(formatFixed(parseFixed("-7")!, 0)).toBe("-7");
  });
  it("show more decimals the deeper the zoom", () => {
    expect(positionDecimals(0.01)).toBe(3);
    expect(positionDecimals(1e-6)).toBe(7);
    expect(positionDecimals(3e-11)).toBe(12);
    expect(positionDecimals(1e-30)).toBe(18);
  });
});
