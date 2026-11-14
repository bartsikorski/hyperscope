// Shared by the sample programs: the frame uniform block, Minkowski geometry, complex numbers and
// the box filter. The CPU twin of each function is named in its comment.

// One std140 block, packed by render/frame.ts (word offsets in brackets).
layout(std140) uniform Frame {
  mat3 uCamera;        // [0]  the camera, world = uCamera * frame point
  vec4 uView;          // [12] view parameters, views.ts viewUniform (one meaning per view chunk)
  vec4 uScreen;        // [16] target width, height, 2 / height (u per pixel), u's x shift (a band strip)
  vec4 uNormals[3];    // [20] mirror normals of the fundamental triangle
  vec4 uColours[8];    // [32] linear RGB per colour index
  vec4 uLine;          // [64] line colour, line width (plane units, or pixels when uFlags.w is 1)
  vec4 uBackground;    // [68] outside the disk
  vec4 uAverage;       // [72] colour where the picture meets its edge, inradius of the triangle
  vec4 uFade;          // [76] far-tile fade from uFade.x to uFade.y inradii per pixel
  uvec4 uPerm;         // [80] camera permutation, then sigma_1..3, 3 bits per colour
  uvec4 uFlags;        // [84] number of colours, sides to draw (bit j = side j + 1), edge sides, line unit
  vec4 uSample;        // [88] sample offset in pixels (y up), edge ring width in pixels, ring opacity
  vec4 uAccent;        // [92] edge ring colour
  vec4 uLook;          // [96] palette phase, density, largest distance to the edge sides, glow
  vec4 uShape;         // [100] glow decay length, bevel width, relief slope, drawn side length per area
  vec4 uLight;         // [104] light direction on the screen (x, y up), depth: walls through the start within this
  vec4 uAvgFill;       // [108] far-tile fill before lines; the distance source's own factor
  vec4 uAvgGlow;       // [112] far-tile glow
  vec4 uStart;         // [116] centre of the depth count's start tile, walls between it and the triangle
  // the unit grid (math/grid.ts gridFrame, render/grid.ts)
  vec4 uGrid0;         // [120] cos theta, sin theta, tanh E0, cosh E0 (horocyclic: e^E0)
  vec4 uGrid1;         // [124] E0, S0 (polar: signed turns), kBase, kTop
  vec4 uGrid2;         // [128] log10 of units per R, opacity per level, accent line opacity, its width in pixels
  vec4 uGrid3;         // [132] polar centre dot radius in pixels, luminance under which lines go white, its blend +-
  vec4 uGridA[8];      // [136] per level from kBase: frac(E0 / delta), 1 / delta, frac(2^m0 S0 / unit) as hi + lo
  vec4 uGridB[8];      // [168] per level: uScale, m0, delta, log2 delta
  uvec4 uGridBits[2];  // [200] per level: floor(2^m0 S0 / unit) mod 2^32
  vec4 uStrip;         // [208] a band strip's depth fog: u's x at its two sides, the fog at each (input/strips.ts)
  uvec4 uPairs[2];     // [212] a chiral colouring's tau_ij (colourings.ts pairPerms) in slot 2i + (j > i ? j - 1 : j)
  uvec4 uTileA[3];     // [220] Mosaic: the camera's tile matrix by rows (math/tileid.ts)
  uvec4 uTileD[3];     // [232] d_j = -2B_j mod l by rows; uTileD[0].w = l
  uvec4 uTileW[2];     // [244] w (the tile around P) and S_3 w (the tile across side 3)
  // a Wythoff tiling's tables (math/wythoff.ts), WYTHOFF 1 (the triangle) or 2 (the kite)
  vec4 uWyLines[16];   // [252] per edge line: its unit normal m_e, its two faces a + 32 b
  uvec4 uWyFaces[16];  // [316] per face: mask, want, kind + 16 colour index
  uvec4 uWyIds[16];    // [380] per face: its Mosaic vector, its kind
  uvec4 uWy;           // [444] lines, faces that meet the domain, all faces
};

// lorentz.ts mink
float mink(vec3 a, vec3 b) { return a.x * b.x + a.y * b.y - a.z * b.z; }

// complex.ts cmul, cdiv
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }

// models.ts fromPoincare
vec3 fromPoincare(vec2 z) {
  float r2 = dot(z, z);
  return vec3(2.0 * z, 1.0 + r2) / (1.0 - r2);
}

// groups.ts distanceToSide's asinh for z >= 0. GLSL's asinh is log(z + sqrt(z^2 + 1)), which near 0
// keeps only absolute precision (6e-8): several hundredths of a pixel at the zoom limit. The series
// is exact to float32 below 0.1.
float asinhPos(float z) {
  if (z < 0.1) {
    float z2 = z * z;
    return z * (1.0 - z2 / 6.0 * (1.0 - 0.45 * z2));
  }
  return asinh(z);
}

// reference.ts lineCoverage, a box filter: overlap of the pixel [d - lpx/2, d + lpx/2] with the
// line [-w/2, w/2], over lpx
float lineCoverage(float d, float w, float lpx) {
  float lo = max(d - 0.5 * lpx, -0.5 * w);
  float hi = min(d + 0.5 * lpx, 0.5 * w);
  return max(0.0, hi - lo) / lpx;
}
