// Test pictures for the tile picture (design notes, step 17), made the same way in Node and in the
// page: smooth colour, stripes and a disc, so filtering, seams and levels all show; optionally a
// transparent part.

/** RGBA bytes (sRGB, straight alpha, top row first) of a width x height test picture. */
export function testPicture(width: number, height: number, alpha = false): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const o = (y * width + x) * 4;
      const disc = Math.hypot(u - 0.62, v - 0.4) < 0.18;
      const stripe = Math.floor(u * 12 + v * 5) % 2 === 0;
      out[o] = disc ? 240 : Math.round(30 + 200 * u);
      out[o + 1] = disc ? 200 : stripe ? 60 : 170;
      out[o + 2] = Math.round(40 + 180 * v);
      out[o + 3] = alpha ? (u < 0.3 ? 0 : u < 0.45 ? Math.round(((u - 0.3) / 0.15) * 255) : 255) : 255;
    }
  return out;
}
