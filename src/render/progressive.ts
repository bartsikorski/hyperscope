// Progressive refinement: what each animation frame renders. Any change starts the picture over.
// While the view moves, every frame draws one sample at a reduced render scale that keeps up with
// the display; once it has been still for HOLD_MS, samples are added at full scale until the
// picture holds maxSamples, and then rendering stops until the next change.

/** The view counts as moving until this long after its last change (pointer events can skip frames). */
export const HOLD_MS = 120;
/** Render scale range while moving. */
export const MIN_SCALE = 0.5;
/** Frame intervals (ms) that count as slow (a missed 60 Hz refresh) and as fast. */
const SLOW_MS = 22;
const FAST_MS = 18;
/** Fast moving frames in a row before the scale goes back up. */
const FAST_RUN = 30;

export interface Plan {
  /** Render scale of the target this sample goes into. */
  scale: number;
  /** Sample index: 0 starts the picture, n > 0 blends in with weight 1 / (n + 1). */
  index: number;
}

export class Progressive {
  /** Samples in the target so far. */
  n = 0;
  /** Render scale of the samples in the target. */
  scale = 1;
  /** Render scale used while moving, adapted to the frame time unless `adaptive` is off. */
  movingScale = 1;
  adaptive = true;
  readonly maxSamples: number;
  private lastChange = -Infinity;
  private fastFrames = 0;

  constructor(maxSamples: number) {
    this.maxSamples = maxSamples;
  }

  /** The picture changed at time `now` (ms): start over. */
  invalidate(now: number): void {
    this.lastChange = now;
    this.n = 0;
  }

  /** Start over without counting as movement (a new canvas size). */
  reset(): void {
    this.n = 0;
  }

  moving(now: number): boolean {
    return now - this.lastChange < HOLD_MS;
  }

  /** The next sample to draw, or null when the picture is complete. */
  next(now: number): Plan | null {
    // in steps of 1/8, so the target is not reallocated for every small change of the scale
    const scale = this.moving(now) ? Math.round(this.movingScale * 8) / 8 : 1;
    if (scale !== this.scale) {
      this.scale = scale;
      this.n = 0;
    }
    return this.n < this.maxSamples ? { scale, index: this.n } : null;
  }

  /** The planned sample was drawn. */
  done(): void {
    this.n++;
  }

  /** Adapt the moving scale to the interval between frames (ms) while moving: down quickly when
   *  frames are missed, back up slowly while they keep up. */
  frameTime(ms: number, moving: boolean): void {
    if (!moving || !this.adaptive) return;
    if (ms > SLOW_MS) {
      this.movingScale = Math.max(MIN_SCALE, this.movingScale * 0.85);
      this.fastFrames = 0;
    } else if (ms < FAST_MS && ++this.fastFrames >= FAST_RUN) {
      this.movingScale = Math.min(1, this.movingScale * 1.1);
      this.fastFrames = 0;
    }
  }
}
