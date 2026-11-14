// Colour arithmetic shared by the CPU reference renderer, the palettes and the frame packing:
// sRGB transfer, OKLab, HSV and half floats. Colours are linear RGB unless a name says sRGB.
// Origin: OKLab by Björn Ottosson (2020), matrices as in mandelscope's palettes.py; HSV as in
// Python's colorsys.

export type RGB = [number, number, number];

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c: number): number {
  c = Math.min(1, Math.max(0, c));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** "#rrggbb" as sRGB components in [0, 1]. */
export function hexSrgb(h: string): RGB {
  const v = parseInt(h.replace("#", ""), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** "#rrggbb" as linear RGB. */
export function hex(h: string): RGB {
  return hexSrgb(h).map(srgbToLinear) as RGB;
}

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------------------------- OKLab

/** sRGB components (not linear) to OKLab, as mandelscope's _rgb_to_oklab. */
export function srgbToOklab(c: RGB): RGB {
  const [r, g, b] = c.map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to sRGB components, clipped to [0, 1] in linear light, as mandelscope's _oklab_to_rgb. */
export function oklabToSrgb([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Python's colorsys.hsv_to_rgb. */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  if (s === 0) return [v, v, v];
  let i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  i %= 6;
  return ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]] as RGB[])[i];
}

// --------------------------------------------------------------------------------- half floats

/** Bits of the IEEE half float nearest to x (0 <= x < 65504). */
export function halfBits(x: number): number {
  if (!(x >= 0 && x < 65504)) throw new Error(`half float out of range: ${x}`);
  if (x < 2 ** -14) return Math.round(x * 2 ** 24); // subnormal; 1024 is the smallest normal
  let e = Math.floor(Math.log2(x));
  if (x / 2 ** e < 1) e--;
  else if (x / 2 ** e >= 2) e++;
  let m = Math.round((x / 2 ** e - 1) * 1024);
  if (m === 1024) {
    m = 0;
    e++;
  }
  return ((e + 15) << 10) | m;
}

export function halfValue(bits: number): number {
  const e = bits >> 10;
  const m = bits & 1023;
  return e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15);
}

export const toHalf = (x: number): number => halfValue(halfBits(x));
