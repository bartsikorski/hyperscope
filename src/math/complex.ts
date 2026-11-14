// Minimal complex arithmetic for the view maps (float64). Complex numbers are [re, im].

export type Complex = [number, number];

export const cadd = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]];
export const csub = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]];
export const cmul = (a: Complex, b: Complex): Complex => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const cscale = (a: Complex, s: number): Complex => [a[0] * s, a[1] * s];
export const cconj = (a: Complex): Complex => [a[0], -a[1]];
export const cabs2 = (a: Complex): number => a[0] * a[0] + a[1] * a[1];
export const cabs = (a: Complex): number => Math.hypot(a[0], a[1]);

export function cdiv(a: Complex, b: Complex): Complex {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}

export function cexpi(theta: number): Complex {
  return [Math.cos(theta), Math.sin(theta)];
}

/** tanh of a complex number, used by the band model. */
export function ctanh(z: Complex): Complex {
  // tanh(x + iy) = (sinh 2x + i sin 2y) / (cosh 2x + cos 2y)
  const d = Math.cosh(2 * z[0]) + Math.cos(2 * z[1]);
  return [Math.sinh(2 * z[0]) / d, Math.sin(2 * z[1]) / d];
}
