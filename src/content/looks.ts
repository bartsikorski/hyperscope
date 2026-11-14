// Looks: a palette, a colour source and the line and shading settings, saved under a name as in
// mandelscope (design: Colour and shading). The tiling (group, colouring, sides, line width) is the
// preset's; a look only changes how it is coloured.

export type ColourSource = "colouring" | "distance" | "depth" | "inside" | "mosaic";
/** In the shader's SOURCE order (tiling.glsl). */
export const SOURCES: ColourSource[] = ["colouring", "distance", "depth", "inside", "mosaic"];

export interface LookState {
  palette: string;
  source: ColourSource;
  /** Palette offset in cycles (for a discrete set: in steps of one colour). */
  phase: number;
  /** Palette cycles per plane unit (distance), per wall crossed (depth) or across a tile (inside). */
  density: number;
  lineColour: string;
  /** Inner glow toward the line colour along the edge sides, 0 to 1. */
  glow: number;
  /** Relief slope along the edge sides, 0 = flat. */
  relief: number;
  /** Light azimuth in degrees, counterclockwise from the screen's right. */
  light: number;
}

const base: LookState = { palette: "Gilded tiles", source: "colouring", phase: 0, density: 1, lineColour: "#f2c14e", glow: 0, relief: 0, light: 135 };

const look = (name: string, l: Partial<LookState>) => ({ name, look: { ...base, ...l } });

export const LOOKS: { name: string; look: LookState }[] = [
  look("Gilded", {}),
  look("Escher", { palette: "Escher", lineColour: "#1c1b19", relief: 0.8, glow: 0.15 }),
  look("Ink", { palette: "Ink & paper", lineColour: "#1c1b19" }),
  look("Porcelain", { palette: "Porcelain", source: "inside", density: 1, relief: 0.6, lineColour: "#0d2347" }),
  look("Midnight", { palette: "Midnight", source: "distance", density: 0.5, glow: 0.6, lineColour: "#ffcc6b" }),
  look("Nebula", { palette: "Nebula", source: "depth", density: 1 / 10, glow: 0.2, lineColour: "#fff4e6" }),
  look("Aurora", { palette: "Aurora", source: "depth", density: 1 / 14, lineColour: "#f4ffd9" }),
  look("Ember", { palette: "Ember", source: "distance", density: 0.6, lineColour: "#fff3c4" }),
  look("Glacier", { palette: "Glacier", source: "inside", density: 1, relief: 0.8, lineColour: "#ffffff" }),
  look("Blueprint", { palette: "Blueprint", phase: 0.55, glow: 0.25, lineColour: "#dbe9ff" }),
  look("Neon wire", { palette: "Neon tiles", phase: 5 / 6, glow: 0.5, lineColour: "#00d5ff" }),
  look("Opal", { palette: "Opal", source: "inside", density: 0.75, relief: 0.4, lineColour: "#ffffff" }),
  look("Relief", { palette: "Sand", source: "inside", density: 0.5, relief: 1, lineColour: "#5b3a22" }),
  look("Graphite", { palette: "Graphite", source: "depth", density: 1 / 8, relief: 0.6, lineColour: "#f4f3ef" }),
  look("Mosaic", { palette: "Copper & Teal", source: "mosaic", relief: 0.7, glow: 0.12, lineColour: "#1a1410" }),
];

export const DEFAULT_LOOK = LOOKS[0].look;

/** The index of the named look that differs from `look` in the fewest fields (the first of equals). */
export function nearestLook(look: LookState): number {
  const fields = Object.keys(look) as (keyof LookState)[];
  const diff = (l: LookState) => fields.filter((f) => l[f] !== look[f]).length;
  let best = 0;
  LOOKS.forEach((l, i) => {
    if (diff(l.look) < diff(LOOKS[best].look)) best = i;
  });
  return best;
}
