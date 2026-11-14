// The history of views (design notes, step 9: History): a view is recorded when it has rested after
// a change and before every jump, at most 200 of them; back and forward step through them. It
// holds views, not settings, so going back never undoes a change of tiling or look. Pure, with
// the comparison of two views left to the caller.

export class ViewHistory<T> {
  private entries: T[] = [];
  private index = -1;
  private same: (a: T, b: T) => boolean;
  private max: number;

  constructor(same: (a: T, b: T) => boolean, max = 200) {
    this.same = same;
    this.max = max;
  }

  /** Record the view on the screen, unless it is the entry we are at; the entries after that one
   *  are dropped, and the oldest when there are more than `max`. */
  record(view: T): void {
    if (this.index >= 0 && this.same(this.entries[this.index], view)) return;
    this.entries.length = this.index + 1;
    this.entries.push(view);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    this.index = this.entries.length - 1;
  }

  /** The view before the one on the screen (recorded first if it moved since), or null at the start. */
  back(current: T): T | null {
    this.record(current);
    if (this.index <= 0) return null;
    return this.entries[--this.index];
  }

  /** The view after the one on the screen, or null at the end or after a move away from it. */
  forward(current: T): T | null {
    if (this.index < 0 || !this.same(this.entries[this.index], current) || this.index >= this.entries.length - 1) return null;
    return this.entries[++this.index];
  }

  canBack(current: T): boolean {
    return this.index > 0 || (this.index === 0 && !this.same(this.entries[0], current));
  }

  canForward(current: T): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1 && this.same(this.entries[this.index], current);
  }

  get length(): number {
    return this.entries.length;
  }
}
