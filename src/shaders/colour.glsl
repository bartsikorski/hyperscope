// Colour encoding for the display pass.

// reference.ts linearToSrgb
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Uniform noise in [0, 1) from the pixel position (an integer hash, the same every frame; its
// finaliser is prospector32 from Chris Wellons' hash prospector).
float pixelNoise(uvec2 p) {
  uint h = p.x * 0x8da6b343u ^ p.y * 0xd8163841u;
  h ^= h >> 15;
  h *= 0x2c1b3c6du;
  h ^= h >> 12;
  h *= 0x297a2d39u;
  h ^= h >> 15;
  return float(h >> 8) / 16777216.0;
}
