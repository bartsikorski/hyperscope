// The Frame block (shaders/common.glsl) against render/frame.ts: each member's offset in its comment
// is where std140 puts it, and the block ends at FRAME_WORDS.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRAME_WORDS } from "../../src/render/frame.ts";

describe("the Frame block", () => {
  it("has each member at the word its comment names, and FRAME_WORDS words", () => {
    const src = readFileSync(new URL("../../src/shaders/common.glsl", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("uniform Frame {"), src.indexOf("};"));
    const members = [...block.matchAll(/^\s+(mat3|vec4|uvec4)\s+(\w+)(?:\[(\d+)\])?;\s*\/\/ \[(\d+)\]/gm)];
    expect(members.length).toBeGreaterThan(30);
    // std140: a mat3 is three vec4 columns; a vec4 or uvec4 (alone or in an array) takes 4 words
    let at = 0;
    for (const [, type, name, count, offset] of members) {
      expect(Number(offset), name).toBe(at);
      at += type === "mat3" ? 12 : 4 * Number(count ?? 1);
    }
    expect(at).toBe(FRAME_WORDS);
  });
});
