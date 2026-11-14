// Pixel statistics for comparing a GPU picture with a reference (RGBA8, same size).

export interface Comparison {
  /** Share of pixels whose channels all differ by at most `tol`. */
  within: number;
  /** Largest channel difference, in 8-bit steps. */
  worst: number;
  /** Mean channel difference over all pixels, in 8-bit steps. */
  mean: number;
  /** Red where a pixel is off by more than `tol`, on a dimmed copy of the reference. */
  diff: Uint8Array;
}

export function compare(a: Uint8Array, b: Uint8Array, tol: number): Comparison {
  let within = 0;
  let worst = 0;
  let sum = 0;
  const diff = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 4) {
    const d = [0, 1, 2].map((k) => Math.abs(a[i + k] - b[i + k]));
    const m = Math.max(...d);
    sum += d[0] + d[1] + d[2];
    worst = Math.max(worst, m);
    if (m <= tol) {
      within++;
      diff.set([b[i] >> 2, b[i + 1] >> 2, b[i + 2] >> 2, 255], i);
    } else diff.set([255, 32, 32, 255], i);
  }
  const n = a.length / 4;
  return { within: within / n, worst, mean: sum / (3 * n), diff };
}
