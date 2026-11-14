// Screenshot sizes and tiles (design notes, step 9: Screenshot): the picture is drawn off screen at
// the chosen size, in tiles no larger than the GPU allows, each tile's offset riding on the samples'
// offsets so the shader is the same as on the screen.

export type ShotSize = "screen" | "2x" | "4x" | "1080p" | "4k" | "8k";
export const SHOT_SIZES: ShotSize[] = ["screen", "2x", "4x", "1080p", "4k", "8k"];
export const SHOT_LABELS: Record<ShotSize, string> = {
  screen: "The screen",
  "2x": "2× the screen",
  "4x": "4× the screen",
  "1080p": "1920 × 1080",
  "4k": "3840 × 2160",
  "8k": "7680 × 4320",
};
/** Longest side of a screenshot, pixels. */
export const MAX_SIDE = 8192;
/** Tiles are at most this many pixels on a side (smaller when the GPU allows less), so that no
 *  single draw runs long enough for a driver to give up on it. */
export const TILE = 2048;

/** The screenshot's size for a screen of screenW x screenH device pixels: within MAX_SIDE, keeping
 *  the shape. */
export function shotSize(size: ShotSize, screenW: number, screenH: number): [number, number] {
  const fixed: Partial<Record<ShotSize, [number, number]>> = { "1080p": [1920, 1080], "4k": [3840, 2160], "8k": [7680, 4320] };
  const scale = size === "2x" ? 2 : size === "4x" ? 4 : 1;
  const [w, h] = fixed[size] ?? [screenW * scale, screenH * scale];
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

export interface Tile {
  /** Top left corner, pixels from the picture's top left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tiles of at most `max` pixels a side covering width x height, row by row from the top. */
export function tiles(width: number, height: number, max: number): Tile[] {
  const out: Tile[] = [];
  for (let y = 0; y < height; y += max) for (let x = 0; x < width; x += max) out.push({ x, y, width: Math.min(max, width - x), height: Math.min(max, height - y) });
  return out;
}
