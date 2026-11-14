// Sample positions for progressive refinement, shared by the GPU and the CPU reference so their
// pictures can be compared sample for sample. Offsets are in pixels, x right and y down.

/** Additive recurrence with the plastic number (Roberts' R2 sequence, as in mandelscope): evenly
 *  spread for any count. Sample 0 is the pixel centre, so a single sample is the 1-sample picture;
 *  the others continue the sequence from index START, chosen so the first 4 and the first 16
 *  samples average within 0.05 and 0.012 px of the centre (from index 1 the 16 would sit 0.1 px off,
 *  shifting the finished picture). */
const G = 1.324717957244746;
const A1 = 1 / G;
const A2 = 1 / (G * G);
const START = 122;

export function sampleOffset(i: number): [number, number] {
  if (i === 0) return [0, 0];
  const frac = (v: number) => v - Math.floor(v);
  return [frac(0.5 + (i + START) * A1) - 0.5, frac(0.5 + (i + START) * A2) - 0.5];
}

/** Samples accumulated once the view is still. */
export const MAX_SAMPLES = 16;
/** Without float render targets the 8-bit accumulation stops earlier (rounding builds up). */
export const MAX_SAMPLES_8BIT = 4;
