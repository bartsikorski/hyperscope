// Your own presets (design notes, step 9: Presets): a name, the whole saved state and a small picture
// of it, kept in this browser and written to or read from a JSON file. Reading checks every preset
// with the saved state's own reader and keeps the ones that load; it never throws. A preset keeps
// its tile picture by id (the picture itself is stored apart); an exported file carries the
// pictures' data URLs, which reading returns by id.

import type { SavedState } from "./saved.ts";
import { load, save } from "./saved.ts";

export interface UserPreset {
  name: string;
  state: SavedState;
  /** A data URL of the picture (PNG or WebP), or "" when there is none. */
  thumb: string;
}

export const PRESETS_KEY = "hyperscope.presets";
export const MAX_NAME = 80;
/** Pictures larger than this are dropped on reading (a 192 px WebP is about 15 kB). */
const MAX_THUMB = 400_000;

/** The file that export writes and import reads. */
export interface PresetFile {
  hyperscope: "presets";
  v: 1;
  presets: UserPreset[];
}

export function presetFile(presets: UserPreset[]): PresetFile {
  return { hyperscope: "presets", v: 1, presets };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The presets in a presets file, or a bare list of them; `refused` says why each other one was not
 *  taken, numbered from 1. A file that is not a presets file at all gives one reason. */
export function readPresets(json: unknown): { presets: UserPreset[]; refused: string[]; images: Record<string, string> } {
  let list = json;
  const images: Record<string, string> = {};
  if (isObject(json) && json.hyperscope === "presets") {
    if (typeof json.v === "number" && json.v > 1) return { presets: [], refused: [`made by a newer Hyperscope (presets version ${json.v})`], images };
    list = json.presets;
  }
  if (!Array.isArray(list)) return { presets: [], refused: ["not a Hyperscope presets file"], images };
  const presets: UserPreset[] = [];
  const refused: string[] = [];
  list.forEach((p, i) => {
    if (!isObject(p) || typeof p.name !== "string" || !p.name.trim()) return void refused.push(`preset ${i + 1}: no name`);
    const r = load(p.state);
    if (!r.ok) return void refused.push(`${p.name.trim().slice(0, MAX_NAME)}: ${r.reason}`);
    Object.assign(images, r.images);
    const thumb = typeof p.thumb === "string" && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(p.thumb) && p.thumb.length <= MAX_THUMB ? p.thumb : "";
    presets.push({ name: p.name.trim().slice(0, MAX_NAME), state: save(r.state), thumb });
  });
  return { presets, refused, images };
}

/** `incoming` added after `list`, leaving out any with the name and state of one already there. */
export function mergePresets(list: UserPreset[], incoming: UserPreset[]): { presets: UserPreset[]; added: number } {
  const key = (p: UserPreset) => `${p.name}\u0000${JSON.stringify(p.state)}`;
  const seen = new Set(list.map(key));
  const out = [...list];
  for (const p of incoming) {
    if (seen.has(key(p))) continue;
    seen.add(key(p));
    out.push(p);
  }
  return { presets: out, added: out.length - list.length };
}
