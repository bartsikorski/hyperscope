// Your own presets: a presets file read back as written, presets that do not load refused with
// their reason, pictures that are not small data URLs dropped, and imports without duplicates.

import { describe, expect, it } from "vitest";
import { PRESETS } from "../../src/content/scene.ts";
import { mergePresets, presetFile, readPresets, type UserPreset } from "../../src/state/presets.ts";
import { homeSnapshot, save } from "../../src/state/saved.ts";

const THUMB = "data:image/png;base64,iVBORw0KGgo=";
const preset = (name: string, i = 0): UserPreset => ({ name, state: save(homeSnapshot(PRESETS[i].content)), thumb: THUMB });

describe("user presets", () => {
  it("reads back a presets file as written", () => {
    const list = [preset("Heptagons"), preset("Grid", PRESETS.length - 1)];
    const file = JSON.parse(JSON.stringify(presetFile(list)));
    expect(readPresets(file)).toEqual({ presets: list, refused: [], images: {} });
    // a bare list too
    expect(readPresets(JSON.parse(JSON.stringify(list))).presets).toEqual(list);
  });

  it("keeps the presets that load and says why the others did not", () => {
    const good = preset("  Good one  ");
    const broken = { name: "Spherical", state: { ...good.state, content: { ...good.state.content, group: [2, 3, 4] } }, thumb: THUMB };
    const r = readPresets(presetFile([good, broken as UserPreset, { name: "", state: good.state, thumb: "" } as UserPreset]));
    expect(r.presets.map((p) => p.name)).toEqual(["Good one"]);
    expect(r.refused).toHaveLength(2);
    expect(r.refused[0]).toMatch(/^Spherical: /);
    expect(r.refused[1]).toBe("preset 3: no name");
  });

  it("refuses what is not a presets file, and a newer version", () => {
    expect(readPresets({ v: 1, view: {} }).refused).toEqual(["not a Hyperscope presets file"]);
    expect(readPresets("hello").refused).toEqual(["not a Hyperscope presets file"]);
    expect(readPresets({ hyperscope: "presets", v: 2, presets: [] }).refused).toEqual(["made by a newer Hyperscope (presets version 2)"]);
  });

  it("drops a picture that is not a small image data URL, and cuts long names", () => {
    for (const thumb of ["javascript:alert(1)", "data:text/html;base64,PGI+", `data:image/png;base64,${"A".repeat(500_000)}`, 42]) {
      const r = readPresets([{ ...preset("x"), thumb }]);
      expect(r.presets[0].thumb).toBe("");
    }
    expect(readPresets([{ ...preset("n".repeat(200)) }]).presets[0].name).toHaveLength(80);
  });

  it("imports without doubling a preset already there", () => {
    const a = preset("A");
    const b = preset("B", 1);
    const { presets, added } = mergePresets([a], [a, b, { ...a, name: "A again" }, b]);
    expect(presets.map((p) => p.name)).toEqual(["A", "B", "A again"]);
    expect(added).toBe(2);
  });
});
