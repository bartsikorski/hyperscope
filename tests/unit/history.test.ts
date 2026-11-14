// The history of views: recording at rest and before jumps, back and forward, a move after going
// back dropping the views ahead, the 200-entry limit.

import { describe, expect, it } from "vitest";
import { ViewHistory } from "../../src/state/history.ts";

const make = (max?: number) => new ViewHistory<string>((a, b) => a === b, max);

describe("history of views", () => {
  it("starts empty: nothing to go back or forward to", () => {
    const h = make();
    expect(h.canBack("a")).toBe(false);
    expect(h.canForward("a")).toBe(false);
    expect(h.back("a")).toBeNull();
    expect(h.forward("a")).toBeNull();
  });

  it("records each new view once, and steps back and forward through them", () => {
    const h = make();
    for (const v of ["a", "a", "b", "c", "c"]) h.record(v);
    expect(h.length).toBe(3);
    expect(h.canBack("c")).toBe(true);
    expect(h.canForward("c")).toBe(false);
    expect(h.back("c")).toBe("b");
    // the view comes to rest at b: no new entry, and c is still ahead
    h.record("b");
    expect(h.length).toBe(3);
    expect(h.canForward("b")).toBe(true);
    expect(h.back("b")).toBe("a");
    expect(h.back("a")).toBeNull();
    expect(h.canBack("a")).toBe(false);
    expect(h.forward("a")).toBe("b");
    expect(h.forward("b")).toBe("c");
    expect(h.forward("c")).toBeNull();
  });

  it("goes back to the last rested view from a move that has not rested yet", () => {
    const h = make();
    h.record("a");
    expect(h.canBack("a")).toBe(false);
    expect(h.canBack("moving")).toBe(true);
    expect(h.back("moving")).toBe("a");
    // the move was recorded on the way, so forward returns to it
    expect(h.forward("a")).toBe("moving");
  });

  it("drops the views ahead once you move away after going back", () => {
    const h = make();
    for (const v of ["a", "b", "c"]) h.record(v);
    expect(h.back("c")).toBe("b");
    // moving off b: forward is gone at once, and for good once the move is recorded
    expect(h.canForward("b2")).toBe(false);
    expect(h.forward("b2")).toBeNull();
    h.record("b2");
    expect(h.length).toBe(3);
    expect(h.canForward("b2")).toBe(false);
    expect(h.back("b2")).toBe("b");
    expect(h.back("b")).toBe("a");
  });

  it("keeps the newest 200", () => {
    const h = make();
    for (let i = 0; i < 250; i++) h.record(String(i));
    expect(h.length).toBe(200);
    let v = "249";
    let steps = 0;
    for (let b = h.back(v); b !== null; b = h.back(v)) [v, steps] = [b, steps + 1];
    expect([v, steps]).toEqual(["50", 199]);
  });
});
