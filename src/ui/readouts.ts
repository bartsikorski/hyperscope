// The HUD's readouts as text (design: Interface): the distance from the start point, the
// magnification (inside H3: the eye's height) and the frame rate. Pure, so the unit tests check
// them; hud.ts shows them.

import type { GridUnit } from "../math/grid.ts";
import { FRAC_BITS, UNITS } from "../math/grid.ts";
import type { Picture } from "../math/views.ts";
import { H3_HOME, HB_HOME, HOME, centreScale, horizonAngle, type HyperboloidPicture } from "../math/views.ts";
import { formatValue } from "./labels.ts";

/** log10 of the magnification: the plane length per unit of the screen at its centre in the
 *  Poincaré home view over the current one, so 0 at that home and log10 2 after zooming in 2x. A
 *  model switch keeps the centre's scale and so the magnification; the other models' own home
 *  views read their scale against the Poincaré one (the Klein home is 2x, design notes, step 9). */
export function magnification(picture: Picture): number {
  // inside H3 the eye's height sets the zoom: its home height over the current one; on the
  // hyperboloid the orbit's distance
  if (picture.model === "h3") return Math.log10(H3_HOME.h / picture.h);
  if (picture.model === "hyperboloid") return Math.log10(HB_HOME.distance / picture.distance);
  return Math.log10(centreScale(HOME.poincare) / centreScale(picture));
}

/** Inside H3 the HUD shows the eye's height in place of the magnification: in R, and in metres
 *  too when R has a physical size, with how far below level the horizon lies ("16.9° down"). */
export function eyeText(h: number, unit: GridUnit): { height: string; detail: string } {
  const horizon = `horizon ${(Math.round((horizonAngle(h) * 1800) / Math.PI) / 10).toFixed(1)}° down`;
  return { height: significant(h, "R"), detail: UNITS[unit].symbol === "R" ? horizon : `${significant(h * UNITS[unit].perR, "m")} · ${horizon}` };
}

/** On the hyperboloid the HUD shows the orbit's distance from the vertex in place of the
 *  magnification, in R (a length in the space around the surface, not on the plane), with the
 *  camera's elevation over the vertex's tangent plane under it ("elevation 55.0°"). */
export function orbitText(pic: HyperboloidPicture): { height: string; detail: string } {
  const e = Math.round((pic.elevation * 1800) / Math.PI) / 10;
  return { height: significant(pic.distance, "R"), detail: `elevation ${e < 0 ? "−" : ""}${Math.abs(e).toFixed(1)}°` };
}

/** The exponent of 10^m with two decimals and a true minus sign ("0.00" at home). */
export function exponentText(m: number): string {
  const t = Math.round(m * 100) / 100;
  return `${t < 0 ? "−" : ""}${Math.abs(t).toFixed(2)}`;
}

/** v to three significant digits in R or in metres (km, mm, µm by size), written as the grid's
 *  labels write their values; 0 for v = 0 (or anything not a positive finite number). */
export function significant(v: number, base: "m" | "R"): string {
  if (!(v > 0 && v < Infinity)) return formatValue(0n, 1n, 0, base);
  let decimals = 2 - Math.floor(Math.log10(v));
  let n = Math.round(v * 10 ** decimals);
  if (n >= 1000) n = Math.round(v * 10 ** --decimals);
  const [num, den] = decimals >= 0 ? [BigInt(n), 10n ** BigInt(decimals)] : [BigInt(n) * 10n ** BigInt(-decimals), 1n];
  return formatValue(num, den, decimals, base);
}

/** The distance r (in R) from the start point, and in metres too when R has a physical size:
 *  "12.4 R · 79 000 km". */
export function distanceText(r: number, unit: GridUnit): string {
  const inR = significant(r, "R");
  return UNITS[unit].symbol === "R" ? inR : `${inR} · ${significant(r * UNITS[unit].perR, "m")}`;
}

// ------------------------------------------------------------------- exact position fields

const ONE = 1n << FRAC_BITS;

/** A decimal number ("-12.5", "3e-4", "+0.25") as the grid cameras' fixed point S * 2^256, rounded
 *  to nearest, exactly; null when the text is not a number. */
export function parseFixed(text: string): bigint | null {
  const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,4}))?\s*$/.exec(text.replace(/\u2212/g, "-"));
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const digits = BigInt(`${m[2]}${m[3] ?? ""}` || "0");
  const exp = Number(m[4] ?? 0) - (m[3] ?? "").length;
  const [num, den] = exp >= 0 ? [digits * 10n ** BigInt(exp) * ONE, 1n] : [digits * ONE, 10n ** BigInt(-exp)];
  const q = (2n * num + den) / (2n * den);
  return m[1] === "-" ? -q : q;
}

/** The fixed point value with `decimals` decimals, rounded half away from zero, as an editable
 *  field shows it (an ASCII minus, no grouping). */
export function formatFixed(s: bigint, decimals: number): string {
  const neg = s < 0n;
  const a = neg ? -s : s;
  const scale = 10n ** BigInt(decimals);
  const r = (2n * a * scale + ONE) / (2n * ONE);
  const digits = r.toString().padStart(decimals + 1, "0");
  const int = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${neg && r !== 0n ? "-" : ""}${int}${decimals > 0 ? "." + frac : ""}`;
}

/** Decimals that show a position to a tenth of a pixel or so, for a plane length per CSS pixel
 *  of lpx (in R): from 3 to 18. */
export function positionDecimals(lpx: number): number {
  return Math.min(18, Math.max(3, Math.ceil(-Math.log10(lpx)) + 1));
}

/** Frames per second over the last second of drawn frames. */
export class FrameRate {
  private times: number[] = [];

  frame(t: number): void {
    this.times.push(t);
    while (this.times.length > 2 && t - this.times[0] > 1000) this.times.shift();
  }

  /** The rate, or null before three frames have been drawn since the loop last stopped. */
  rate(): number | null {
    const n = this.times.length;
    return n < 3 ? null : ((n - 1) * 1000) / (this.times[n - 1] - this.times[0]);
  }

  stop(): void {
    this.times = [];
  }
}
