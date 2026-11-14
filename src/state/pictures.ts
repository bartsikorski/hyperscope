// Your own tile pictures in the browser (design notes, step 17: Storing the picture): a picture file
// read into the data URL that is kept (the file as it is, or cut down and written again), a data URL
// decoded into its levels, and the pictures kept in IndexedDB for the session and your presets.
// Every storage call fails quietly (a private window, storage full): the picture then lasts for the
// visit only.

import type { TileImage } from "../content/tileimage.ts";
import { MAX_PICTURE_PX, tileImageFromRGBA } from "../content/tileimage.ts";
import { sha256 } from "./sha256.ts";

/** A file is kept as it is up to this size (and 2048 pixels, PNG, JPEG or WebP). */
const KEEP_BYTES = 4 * 1024 * 1024;
const KEEP_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** Quality of a picture written again (JPEG when opaque, WebP with alpha). */
const QUALITY = 0.92;

/** A blob's data URL. */
function dataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("the file could not be read"));
    r.readAsDataURL(blob);
  });
}

/** The size a picture is drawn at: its own, or cut down to 2048 pixels on the longer side. */
function fitted(width: number, height: number): [number, number] {
  const k = Math.min(1, MAX_PICTURE_PX / Math.max(width, height));
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

/** The picture decoded at its own size, or why not. */
async function decoded(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error("it is not a picture this browser can read");
  }
}

/** The picture decoded at its fitted size. */
async function bitmapOf(blob: Blob): Promise<ImageBitmap> {
  const bmp = await decoded(blob);
  const [w, h] = fitted(bmp.width, bmp.height);
  if (w === bmp.width && h === bmp.height) return bmp;
  bmp.close();
  return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
}

/** A 2D canvas holding the bitmap. */
function canvasOf(bmp: ImageBitmap): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error(`this browser cannot hold a ${bmp.width} × ${bmp.height} picture`);
  ctx.drawImage(bmp, 0, 0);
  return { canvas, ctx };
}

/** A picture file as the data URL that is kept, and its id: the file itself when it is PNG, JPEG or
 *  WebP of at most 2048 pixels and 4 MB, else the picture cut down to 2048 pixels and written again
 *  (JPEG when it is opaque, WebP with alpha, PNG where the browser cannot write WebP). */
export async function pictureFromFile(file: Blob): Promise<{ src: string; id: string }> {
  const full = await decoded(file);
  const [w, h] = fitted(full.width, full.height);
  const same = w === full.width && h === full.height;
  let src: string;
  if (same && KEEP_TYPES.includes(file.type) && file.size <= KEEP_BYTES) {
    full.close();
    src = await dataURL(file);
  } else {
    const bmp = same ? full : await createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    if (bmp !== full) full.close();
    const { canvas, ctx } = canvasOf(bmp);
    bmp.close();
    const px = ctx.getImageData(0, 0, w, h).data;
    let opaque = true;
    for (let i = 3; i < px.length; i += 4)
      if (px[i] !== 255) {
        opaque = false;
        break;
      }
    src = canvas.toDataURL(opaque ? "image/jpeg" : "image/webp", QUALITY);
    if (!opaque && !src.startsWith("data:image/webp")) src = canvas.toDataURL("image/png");
  }
  return { src, id: sha256(src) };
}

/** The bytes of a base64 data URL as a blob of its type. */
function blobOf(src: string): Blob {
  const comma = src.indexOf(",");
  const type = /^data:([^;,]+)/.exec(src)?.[1] ?? "image/png";
  const bin = atob(src.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** A picture's levels from its data URL (cut down to 2048 pixels when it is larger). */
export async function decodePicture(src: string, id: string): Promise<TileImage> {
  const bmp = await bitmapOf(blobOf(src));
  const { ctx } = canvasOf(bmp);
  const [w, h] = [bmp.width, bmp.height];
  bmp.close();
  return tileImageFromRGBA(ctx.getImageData(0, 0, w, h).data, w, h, id);
}

// ------------------------------------------------------------------------------- IndexedDB

const DB_NAME = "hyperscope";
const STORE = "pictures";
let opened: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

/** Run one request in a transaction; its result, or null when anything fails. */
async function request<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, mode);
      const req = make(tx.objectStore(STORE));
      let result: T | null = null;
      req.onsuccess = () => (result = req.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

interface Stored {
  id: string;
  src: string;
  /** When it was last stored or read (ms since 1970). */
  used: number;
}

/** Keep a picture in this browser; false when it could not be kept. */
export async function storePicture(id: string, src: string): Promise<boolean> {
  return (await request("readwrite", (s) => s.put({ id, src, used: Date.now() } satisfies Stored))) !== null;
}

/** A picture kept in this browser, or null. */
export async function fetchPicture(id: string): Promise<string | null> {
  const got = (await request("readonly", (s) => s.get(id))) as Stored | undefined | null;
  if (!got || typeof got.src !== "string") return null;
  void request("readwrite", (s) => s.put({ ...got, used: Date.now() }));
  return got.src;
}

/** Forget the pictures nothing uses: all but those in `keep` and the `spare` used last. */
export async function sweepPictures(keep: Set<string>, spare = 8): Promise<void> {
  const all = (await request("readonly", (s) => s.getAll())) as Stored[] | null;
  if (!all) return;
  const others = all.filter((p) => !keep.has(p.id)).sort((a, b) => b.used - a.used);
  for (const p of others.slice(spare)) await request("readwrite", (s) => s.delete(p.id));
}
