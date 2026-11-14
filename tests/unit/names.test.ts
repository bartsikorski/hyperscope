// The names the title and the card give: the tiling check's reasons, tilings by their shape,
// content by its preset when it is one, and the named look nearest a changed look.

import { describe, expect, it } from "vitest";
import { LOOKS, nearestLook } from "../../src/content/looks.ts";
import { PRESETS } from "../../src/content/scene.ts";
import { contentLabel, groupProblem, tilingName } from "../../src/ui/card.ts";

describe("tiling check", () => {
  it("passes hyperbolic groups and names the others", () => {
    expect(groupProblem([7, 3, 2])).toBeNull();
    expect(groupProblem([2, 3, 7])).toBeNull();
    expect(groupProblem([3, 3, 4])).toBeNull();
    expect(groupProblem([3, 4, 2])).toBe("1/3 + 1/4 + 1/2 > 1: a spherical tiling, not hyperbolic");
    expect(groupProblem([3, 6, 2])).toBe("1/3 + 1/6 + 1/2 = 1: a Euclidean tiling, not hyperbolic");
    expect(groupProblem([4, 4, 2])).toBe("1/4 + 1/4 + 1/2 = 1: a Euclidean tiling, not hyperbolic");
    expect(groupProblem([3, 3, 3])).toBe("1/3 + 1/3 + 1/3 = 1: a Euclidean tiling, not hyperbolic");
  });
});

describe("names", () => {
  it("names a tiling by its tiles", () => {
    expect(tilingName([7, 3, 2])).toBe("{7,3} heptagons");
    expect(tilingName([4, 5, 2])).toBe("{4,5} squares");
    expect(tilingName([7, 4, 2])).toBe("{7,4} heptagons");
    expect(tilingName([13, 3, 2])).toBe("{13,3} 13-gons");
    expect(tilingName([2, 3, 7])).toBe("(2,3,7) triangles");
  });

  it("gives every preset its own name back, and other content the name of its shape", () => {
    for (const p of PRESETS) expect(contentLabel(p.content)).toBe(p.label);
    const six = PRESETS.find((p) => p.label === "{6,4} in three colours")!.content;
    expect(contentLabel({ ...six, colouring: "parity" })).toBe("{6,4} hexagons");
    const plain = PRESETS.find((p) => p.label === "Unit grid")!.content;
    expect(contentLabel({ ...plain, grid: { ...plain.grid!, on: false } })).toBe("No tiling");
    expect(contentLabel({ ...PRESETS[0].content, plain: true })).toBe("No tiling");
    // a Wythoff tiling by its construction, with the group when the name does not carry it
    const wy = { group: [7, 3, 2] as [number, number, number], colouring: "c1" as const, sides: [false, false, false] as [boolean, boolean, boolean], lineWidth: 0.02 };
    expect(contentLabel({ ...wy, construction: "110" })).toBe("Truncated {7,3}");
    expect(contentLabel({ ...wy, construction: "101" })).toBe("Truncated {3,7}");
    expect(contentLabel({ ...wy, construction: "free", weights: [1, 2, 3] })).toBe("{7,3} free point");
    expect(contentLabel({ ...wy, group: [5, 4, 3], construction: "free", weights: [1, 2, 3] })).toBe("(5,4,3) free point");
    expect(contentLabel({ ...wy, group: [5, 4, 3], construction: "snub" })).toBe("(5,4,3) snub");
    expect(contentLabel({ ...wy, group: [5, 4, 3], construction: "001" })).toBe("(5,4,3) G at P");
    expect(contentLabel({ ...wy, group: [5, 4, 3], construction: "111" })).toBe("(5,4,3) G inside");
  });

  it("finds the named look nearest a look", () => {
    LOOKS.forEach((l, i) => expect(nearestLook(l.look)).toBe(i));
    expect(nearestLook({ ...LOOKS[3].look, glow: 0.123 })).toBe(3);
  });
});
