// A tile picture in saved states, links and preset files (design notes, step 17: Storing the
// picture): by id in the session and links, with its data URL in files that stand alone.
import { describe, expect, it } from "vitest";
import { PRESETS } from "../../src/content/scene.ts";
import type { TileImageState } from "../../src/content/tileimage.ts";
import { DEFAULT_PLACEMENT } from "../../src/content/tileimage.ts";
import { presetFile, readPresets } from "../../src/state/presets.ts";
import { fromLink, homeSnapshot, load, MAX_PICTURE_URL, save, toLink, withPictures } from "../../src/state/saved.ts";
import { sha256 } from "../../src/state/sha256.ts";

const SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ID = sha256(SRC);
const picture = (extra: Partial<TileImageState> = {}): TileImageState => ({ mode: "chiral", tint: true, place: { x: 0.25, y: 0.75, size: 1.5, turn: -30 }, id: ID, ...extra });
const withPicture = (t: TileImageState = picture()) => homeSnapshot({ ...PRESETS[0].content, tileImage: t });

describe("a tile picture in the saved state", () => {
  it("is saved by its settings and id, and read back the same", () => {
    const s = withPicture();
    const saved = save(s);
    expect(saved.content.tileImage).toEqual(picture());
    expect(JSON.stringify(saved)).not.toContain("base64");
    const r = load(JSON.parse(JSON.stringify(saved)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.content.tileImage).toEqual(picture());
      expect(r.images).toBeUndefined();
    }
    // the tint is left out when off
    expect(save(withPicture(picture({ tint: false }))).content.tileImage).toEqual({ mode: "chiral", place: picture().place, id: ID });
  });

  it("carries its data URL in a file that stands alone, which names it on reading", () => {
    const saved = withPictures(save(withPicture()), (id) => (id === ID ? SRC : undefined));
    expect(saved.content.tileImage?.src).toBe(SRC);
    expect(withPictures(save(withPicture()), () => undefined).content.tileImage?.src).toBeUndefined();
    const r = load(JSON.parse(JSON.stringify(saved)));
    expect(r.ok && r.images).toEqual({ [ID]: SRC });
    if (r.ok) expect(r.state.content.tileImage).toEqual(picture());
    // the data URL wins over an id that does not match it
    const wrong = JSON.parse(JSON.stringify(saved));
    wrong.content.tileImage.id = "f".repeat(64);
    const w = load(wrong);
    expect(w.ok && w.state.content.tileImage?.id).toBe(ID);
  });

  it("refuses broken pictures with the reason", () => {
    const base = JSON.parse(JSON.stringify(save(withPicture())));
    const broken = (patch: Record<string, unknown>) => ({ ...base, content: { ...base.content, tileImage: { ...base.content.tileImage, ...patch } } });
    const cases: [unknown, RegExp][] = [
      [broken({ mode: "mosaic" }), /unknown tile picture mode "mosaic"/],
      [broken({ tint: "yes" }), /tint is not on or off/],
      [broken({ place: undefined }), /placement is missing/],
      [broken({ place: { x: 0.5, y: 0.5, size: 0.84 } }), /the picture's turn is not a number/],
      [broken({ place: { x: 3, y: 0.5, size: 0.84, turn: 0 } }), /placement is out of range/],
      [broken({ place: { x: 0.5, y: 0.5, size: 0.01, turn: 0 } }), /placement is out of range/],
      [broken({ place: { x: 0.5, y: 0.5, size: 1, turn: 400 } }), /placement is out of range/],
      [broken({ id: "nope" }), /id is not readable/],
      [broken({ src: "data:image/gif;base64,R0lGOD" }), /not a PNG, JPEG or WebP data URL/],
      [broken({ src: "https://example.com/a.png" }), /not a PNG, JPEG or WebP data URL/],
      [broken({ src: `data:image/png;base64,${"A".repeat(MAX_PICTURE_URL)}` }), /at most 16 MB/],
      [{ ...base, content: { ...base.content, tileImage: 5 } }, /tile picture is not readable/],
    ];
    for (const [json, why] of cases) {
      const r = load(json);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(why);
    }
  });
});

describe("a tile picture in a link", () => {
  it("goes by its settings and id, never its bytes", () => {
    for (const t of [picture(), picture({ mode: "kaleidoscope", tint: undefined, place: DEFAULT_PLACEMENT })]) {
      const link = toLink(withPicture(t));
      expect(link).toContain(`ti=${t.mode === "chiral" ? "c" : "k"}.${ID}`);
      expect(link.includes("tip=")).toBe(t.place !== DEFAULT_PLACEMENT);
      expect(link.includes("tit=1")).toBe(!!t.tint);
      const r = fromLink(link);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.state.content.tileImage).toEqual({ ...t, ...(t.tint ? {} : { tint: undefined }) });
    }
  });

  it("refuses a broken one", () => {
    for (const [link, why] of [
      ["#g=7,3,2&ti=x.abc", /tile picture in the link is not readable/],
      [`#g=7,3,2&ti=k.${ID}&tip=1,2`, /placement is not four numbers/],
      [`#g=7,3,2&ti=k.${ID}&tip=0.5,0.5,99,0`, /placement is out of range/],
    ] as [string, RegExp][]) {
      const r = fromLink(link);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(why);
    }
  });
});

describe("a tile picture in preset files", () => {
  it("reads the pictures a file carries, and keeps the presets by id", () => {
    const state = withPictures(save(withPicture()), () => SRC);
    const r = readPresets(JSON.parse(JSON.stringify(presetFile([{ name: "Mine", state, thumb: "" }]))));
    expect(r.refused).toEqual([]);
    expect(r.images).toEqual({ [ID]: SRC });
    expect(r.presets[0].state.content.tileImage).toEqual(picture());
  });
});
