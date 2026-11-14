// What the app exposes on window for the GPU tests and the benchmark page.

interface HyperscopeShot {
  width: number;
  height: number;
  /** Row-major Lorentz matrix. */
  camera: number[];
  /** A views.ts Picture: the model and its state. */
  picture:
    | { model: "poincare" | "klein"; c: [number, number]; sigma: number; s: number }
    | { model: "halfplane"; mu: number }
    | { model: "local"; ell: number }
    | { model: "h3"; h: number; pitch: number; fov: number }
    | { model: "hyperboloid"; elevation: number; distance: number; fov: number }
    | { model: "band"; y0: number; s: number };
  /** The tiling and its look (scene.ts ContentState), rebuilt in the page. */
  content: import("./content/scene.ts").ContentState;
  cameraPerm: number[];
  /** The camera's tile matrix (math/tileid.ts, Mosaic), row-major; the identity when left out. */
  cameraTile?: number[];
  /** The view's depth origin (row-major). */
  origin: number[];
  /** Walls added to the depth (camera.ts ViewState); 0 when left out. */
  shift?: number;
  /** The camera of the grid the content turns on (math/grid.ts GridCamera, S0 as a decimal string). */
  gridCamera?: { s: string; e: number; theta: number };
  /** The unit grid in every sample, as while moving, instead of once over them. */
  gridPerSample?: boolean;
}

interface HyperscopeHook {
  ready: boolean;
  error?: string;
  renderer?: string;
  /** Frames drawn so far. */
  frames?: number;
  /** Render a shot off screen with `samples` progressive samples (1 = pixel centres) and return
   *  its RGBA8 pixels without dither, top row first, base64-encoded; with `tile`, only that part. */
  renderShot?(shot: HyperscopeShot, samples?: number, tile?: { x: number; y: number; width: number; height: number }): string;
  /** Show the current picture now and read the canvas back (RGBA8, top row first, base64). */
  snapshot?(): { width: number; height: number; data: string };
  /** Progressive refinement: samples in the picture, the most it takes, its render scale, and
   *  whether it accumulates in float. */
  progress?(): { samples: number; max: number; scale: number; float: boolean };
  /** The current state (view and content), as plain data. */
  state?(): unknown;
  /** The current state in its saved form (state/saved.ts), as JSON. */
  saved?(): string;
  /** World point under a canvas position in CSS pixels, or null outside the picture. */
  worldAt?(x: number, y: number): [number, number, number] | null;
  /** What a canvas position shows, independent of re-centering: the world point folded into the
   *  fundamental triangle, and its colour index. Null outside the picture. */
  probe?(x: number, y: number): { folded: [number, number, number]; colour: number } | null;
  /** Plane length of one CSS pixel at a canvas position. */
  unitAt?(x: number, y: number): number;
  /** True while a zoom spring, glide or held key is still moving the view. */
  busy?(): boolean;
  /** True while frames are still being drawn (the view moves or the picture is being refined). */
  refining?(): boolean;
  /** Tests: register a tile picture by id from its RGBA bytes (sRGB, straight alpha, top row first,
   *  base64), as content/tileimage.ts makes its levels. */
  addPicture?(id: string, rgba: string, width: number, height: number): void;
  /** The content's tile picture: its id, whether it is loading, ready, missing or broken, and
   *  whether it is drawn; null when there is none. */
  picture?(): { id: string; status: string; drawn: boolean } | null;
}

interface Window {
  hyperscope: HyperscopeHook;
}
