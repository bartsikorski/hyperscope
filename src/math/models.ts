// Conversions between the hyperboloid and the classical models.
//
//   Poincare disk   z = (x + iy) / (1 + t)        inverse (2z, 1 + |z|^2) / (1 - |z|^2)
//   Klein disk      k = (x + iy) / t              inverse (k, 1) / sqrt(1 - |k|^2)
//   Half-plane      h = i (1 + z) / (1 - z)       (Cayley map from the Poincare disk; Im h > 0)

import type { Complex } from "./complex.ts";
import { cdiv } from "./complex.ts";
import type { Vec3 } from "./lorentz.ts";

export function toPoincare(x: Vec3): Complex {
  const k = 1 / (1 + x[2]);
  return [x[0] * k, x[1] * k];
}

export function fromPoincare(z: Complex): Vec3 {
  const r2 = z[0] * z[0] + z[1] * z[1];
  const k = 1 / (1 - r2);
  return [2 * z[0] * k, 2 * z[1] * k, (1 + r2) * k];
}

export function toKlein(x: Vec3): Complex {
  return [x[0] / x[2], x[1] / x[2]];
}

export function fromKlein(k: Complex): Vec3 {
  const s = 1 / Math.sqrt(1 - k[0] * k[0] - k[1] * k[1]);
  return [k[0] * s, k[1] * s, s];
}

export function poincareToHalfPlane(z: Complex): Complex {
  return cdiv([-z[1], 1 + z[0]], [1 - z[0], -z[1]]); // i (1 + z) / (1 - z)
}

export function halfPlaneToPoincare(h: Complex): Complex {
  return cdiv([h[0], h[1] - 1], [h[0], h[1] + 1]); // (h - i) / (h + i)
}

export function toHalfPlane(x: Vec3): Complex {
  return poincareToHalfPlane(toPoincare(x));
}

export function fromHalfPlane(h: Complex): Vec3 {
  return fromPoincare(halfPlaneToPoincare(h));
}
