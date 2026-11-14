// The built-in motifs (design notes, step 16), our own designs: Shoal, Moths, Rosette and Birds.
// A loaded motif is kept in the content state as its spec; both compile once and are cached.

import type { Motif, MotifSpec } from "../math/motifs.ts";
import { compileMotif } from "../math/motifs.ts";
import birds from "./motifs/birds.json" with { type: "json" };
import moths from "./motifs/moths.json" with { type: "json" };
import rosette from "./motifs/rosette.json" with { type: "json" };
import shoal from "./motifs/shoal.json" with { type: "json" };

export interface BuiltinMotif {
  /** Its name in links (mo=) and saved states. */
  id: string;
  spec: MotifSpec;
}

// the JSON files are checked by compileMotif (tests/unit/motifs.test.ts compiles each)
export const MOTIFS: BuiltinMotif[] = [
  { id: "shoal", spec: shoal as unknown as MotifSpec },
  { id: "moths", spec: moths as unknown as MotifSpec },
  { id: "rosette", spec: rosette as unknown as MotifSpec },
  { id: "birds", spec: birds as unknown as MotifSpec },
];

/** A content state's motif: a built-in's id, or a loaded motif's spec. */
export type MotifRef = string | MotifSpec;

export function motifSpecOf(ref: MotifRef): MotifSpec {
  if (typeof ref !== "string") return ref;
  const b = MOTIFS.find((m) => m.id === ref);
  if (!b) throw new Error(`unknown motif "${ref}"`);
  return b.spec;
}

const SPEC_KEYS = ["format", "version", "name", "group", "colouring", "cell", "pr", "rq", "features"] as const;
const FEATURE_KEYS = ["kind", "colour", "tone", "centre", "radius", "radii", "angle", "path", "width"] as const;

/** A copy of a motif's JSON with only the fields of the format, in its order (anything else a file
 *  holds is left behind, so saved states and links carry the motif alone). It never throws: what
 *  it keeps is checked by compileMotif. */
export function cleanMotifSpec(input: object): MotifSpec {
  const pick = (o: Record<string, unknown>, keys: readonly string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (o[k] !== undefined) out[k] = JSON.parse(JSON.stringify(o[k]));
    return out;
  };
  const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  const out = pick(input as Record<string, unknown>, SPEC_KEYS);
  if (Array.isArray(out.features)) out.features = out.features.map((f: unknown) => (isObject(f) ? pick(f, FEATURE_KEYS) : f));
  return out as unknown as MotifSpec;
}

const compiled = new Map<string, Motif>();

/** The motif compiled, kept for the last few (a loaded one by its JSON). Throws MotifError when it
 *  is refused. */
export function motifOf(ref: MotifRef): Motif {
  const key = typeof ref === "string" ? `id:${ref}` : JSON.stringify(ref);
  let m = compiled.get(key);
  if (m) compiled.delete(key);
  else m = compileMotif(motifSpecOf(ref));
  compiled.set(key, m);
  if (compiled.size > 8) compiled.delete(compiled.keys().next().value!);
  return m;
}
