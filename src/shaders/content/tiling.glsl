// Triangle-group tiling (reference.ts shadeTiling): fold into the fundamental triangle, carrying the
// start point (depth), the colouring's permutation, the tile matrix (Mosaic) and the frame map's
// tangents (relief) along; colour by the look's source; then relief, glow, lines and the far-tile
// fade. Compiled per variant: SOURCE 0 colouring (CHIRAL 1 for a chiral one), 1 distance, 2 depth,
// 3 inside, 4 mosaic; RELIEF 0 or 1; WYTHOFF 0 version 1's tiling, 1 a Wythoff tiling seen through
// the triangle, 2 through the kite T u s1 T (math/wythoff.ts): its face, the distance to its edges
// and the face across the nearest one replace the sides' (the colouring source colours face kinds);
// MOTIF 1 a motif (math/motifs.ts), seen through the kite: its tile, the distance to its curves, the
// tile across the nearest one, then its features and outline; TILEIMAGE 1 or 2 your own picture
// over version 1's tiling (content/tileimage.ts), in T mirrored or in the kite turned.

uniform sampler2D uPalette;

vec2 toDiskW(vec3 x) { return x.xy / (1.0 + x.z); }

#if TILEIMAGE
// Your own tile picture: its texture with all its levels (unit 2, mirrored repeat); w to its
// coordinates by two rows; s texels of level 0 per unit of w, the last level, the tint (0 or 1);
// the distance source's far-tile fill factor per channel (reference.ts Shading.fillFactor).
uniform sampler2D uImage;
uniform vec3 uImageU;
uniform vec3 uImageV;
uniform vec4 uImageInfo;
uniform vec4 uImageFill;

// reference.ts pictureAt: premultiplied linear RGBA at y for a pixel of plane length lpx, at the
// level of detail of the texels it covers (tileimage.ts pictureLod)
vec4 pictureAt(vec3 y, float lpx) {
  vec2 w = toDiskW(y);
  vec2 uv = vec2(dot(uImageU, vec3(w, 1.0)), dot(uImageV, vec3(w, 1.0)));
  float texels = uImageInfo.x * lpx * 0.5 * (1.0 - dot(w, w));
  return textureLod(uImage, uv, clamp(log2(max(texels, 1e-30)), 0.0, uImageInfo.y));
}
#endif

#if MOTIF
// A motif's numbers, packed by render/frame.ts packMotif when the content changes (binding 1; word
// offsets in brackets).
layout(std140) uniform Motif {
  vec4 uMoTurn;      // [0] rho_P's turn in the P frame (cos, sin of 2 pi / p), rho_Q's in the Q frame (of -2 pi / q)
  vec4 uMoAway;      // [4] unit directions away from PR (P frame) and from QR (Q frame), into T
  vec4 uMoBoost;     // [8] cosh, sinh of d(P, Q): the world moved along x by -d(P, Q) is the Q frame
  uvec4 uMoCount;    // [12] points of c1, points of c2, features
  vec4 uMoBound1;    // [16] the circle holding c1 (P frame): centre, radius
  vec4 uMoBound2;    // [20] the circle holding c2 (Q frame)
  uvec4 uMoCell;     // [24] Mosaic: the cell's vector (tileid.ts vt, or w for the polygon around P), its kind
  vec4 uMoC1[24];    // [28] c1 from P to R, two points per vec4
  vec4 uMoC2[24];    // [124] c2 from R to Q
  uvec4 uMoHead[24]; // [220] per feature: kind (circle, ellipse, stroke, shape), colour slot, first point, points
  vec4 uMoGeo[24];   // [316] circle: centre, radius; ellipse: centre, radii
  vec4 uMoGeo2[24];  // [412] an ellipse's cos and sin of its angle, the tone
  vec4 uMoBox[24];   // [508] the circle holding the feature
  vec4 uMoPts[128];  // [604] the strokes' and shapes' points: x, y, half width
};

// motifs.ts toQ: lorentz.ts boostX(-d(P, Q))
vec3 toQFrame(vec3 x) { return vec3(uMoBoost.x * x.x - uMoBoost.y * x.z, x.y, uMoBoost.x * x.z - uMoBoost.y * x.x); }

// a turn back: w times the conjugate of t
vec2 unturn(vec2 w, vec2 t) { return vec2(w.x * t.x + w.y * t.y, w.y * t.x - w.x * t.y); }

// point i of c1 (curve 0) or c2 (curve 1)
vec2 moPoint(int curve, int i) {
  vec4 v = curve == 0 ? uMoC1[i >> 1] : uMoC2[i >> 1];
  return (i & 1) == 0 ? v.xy : v.zw;
}

bool inBound(vec2 w, vec4 b) { vec2 d = w - b.xy; return dot(d, d) <= b.z * b.z; }

// motifs.ts oddCrossings: the ray from w along d crosses the curve an odd number of times
bool oddCrossings(vec2 w, vec2 d, int curve) {
  int n = int(curve == 0 ? uMoCount.x : uMoCount.y);
  bool odd = false;
  vec2 a = moPoint(curve, 0);
  for (int i = 1; i < 48; i++) {
    if (i >= n) break;
    vec2 b = moPoint(curve, i);
    vec2 e = b - a;
    float den = d.y * e.x - d.x * e.y;
    if (den != 0.0) {
      vec2 r = a - w;
      float t = (r.y * e.x - r.x * e.y) / den;
      float s = (d.x * r.y - d.y * r.x) / den;
      if (t > 0.0 && s >= 0.0 && s < 1.0) odd = !odd;
    }
    a = b;
  }
  return odd;
}

// motifs.ts nearestOn: the curve's (Euclidean) nearest point to w
vec2 nearestOn(vec2 w, int curve) {
  int n = int(curve == 0 ? uMoCount.x : uMoCount.y);
  float best = 1e30;
  vec2 a = moPoint(curve, 0);
  vec2 at = a;
  for (int i = 1; i < 48; i++) {
    if (i >= n) break;
    vec2 b = moPoint(curve, i);
    vec2 e = b - a;
    float t = clamp(dot(w - a, e) / dot(e, e), 0.0, 1.0);
    vec2 z = a + t * e;
    vec2 v = w - z;
    float d2 = dot(v, v);
    if (d2 < best) {
      best = d2;
      at = z;
    }
    a = b;
  }
  return at;
}

// motifs.ts poincareDist: 2 atanh(|w - z| / |1 - conj(z) w|)
float poincareDist(vec2 w, vec2 z) {
  vec2 u = vec2(1.0 - (z.x * w.x + z.y * w.y), -(z.x * w.y - z.y * w.x));
  float r = sqrt(dot(w - z, w - z) / dot(u, u));
  return 2.0 * atanh(min(r, 0.99999994));
}

// motifs.ts featureDistance: signed, negative inside, in P frame units
float featureDistance(int f, vec2 w) {
  uvec4 h = uMoHead[f];
  vec4 g = uMoGeo[f];
  if (h.x == 0u) return length(w - g.xy) - g.z;
  if (h.x == 1u) {
    vec2 p = unturn(w - g.xy, uMoGeo2[f].xy);
    float k0 = length(p / g.zw);
    float k1 = length(p / (g.zw * g.zw));
    return k1 > 0.0 ? k0 * (k0 - 1.0) / k1 : -min(g.z, g.w);
  }
  int first = int(h.z);
  int n = int(h.w);
  if (h.x == 2u) {
    float d = 1e30;
    for (int i = 0; i < 127; i++) {
      if (i + 1 >= n) break;
      vec4 a = uMoPts[first + i];
      vec4 b = uMoPts[first + i + 1];
      vec2 e = b.xy - a.xy;
      float e2 = dot(e, e);
      float t = e2 > 0.0 ? clamp(dot(w - a.xy, e) / e2, 0.0, 1.0) : 0.0;
      d = min(d, length(w - a.xy - t * e) - (a.z + t * (b.z - a.z)));
    }
    return d;
  }
  // a closed polygon: the nearest edge, inside by the crossings of a ray along +x
  float d2 = 1e30;
  bool inside = false;
  vec2 a = uMoPts[first + n - 1].xy;
  for (int i = 0; i < 128; i++) {
    if (i >= n) break;
    vec2 b = uMoPts[first + i].xy;
    vec2 e = b - a;
    float e2 = dot(e, e);
    float t = e2 > 0.0 ? clamp(dot(w - a, e) / e2, 0.0, 1.0) : 0.0;
    vec2 v = w - a - t * e;
    d2 = min(d2, dot(v, v));
    if ((a.y > w.y) != (b.y > w.y) && w.x < a.x + (w.y - a.y) * e.x / e.y) inside = !inside;
    a = b;
  }
  return inside ? -sqrt(d2) : sqrt(d2);
}

// reference.ts featureColour: the slot's colour (the tile's, the line's, black or white), toned
vec3 featureColour(int f, vec3 tile) {
  uint slot = uMoHead[f].y;
  vec3 c = slot == 0u ? tile : slot == 1u ? uLine.rgb : slot == 2u ? vec3(0.0) : vec3(1.0);
  float tone = uMoGeo2[f].z;
  return tone > 0.0 ? mix(c, vec3(1.0), tone) : tone < 0.0 ? c * (1.0 + tone) : c;
}
#endif

uint permAt(uint p, uint i) { return (p >> (3u * i)) & 7u; }

// colourings.ts compose: (a o b)(i) = a(b(i)), for the first uFlags.x colours
uint composePerm(uint a, uint b) {
  uint r = 0u;
  for (uint i = 0u; i < 8u; i++) {
    if (i >= uFlags.x) break;
    r |= permAt(a, permAt(b, i)) << (3u * i);
  }
  return r;
}

// colourings.ts pairPerms: tau_ij of the rotation r_i r_j (i != j), in slot 2i + (j > i ? j - 1 : j)
uint pairPerm(int i, int j) {
  int slot = 2 * i + (j > i ? j - 1 : j);
  return uPairs[slot >> 2][slot & 3];
}

// tau_ij(c), tau_ii the identity
uint pairAt(int i, int j, uint c) { return i == j ? c : permAt(pairPerm(i, j), c); }

// tileid.ts stepTile: one row of A S_j
uvec3 tileStep(uvec3 row, int j) { return (row + row[j] * uTileD[j].xyz) % uTileD[0].w; }

// tileid.ts applyTile: the tile matrix (rows a0, a1, a2) times v, mod l
uvec3 tileApply(uvec3 a0, uvec3 a1, uvec3 a2, uvec3 v) {
  return uvec3(a0.x * v.x + a0.y * v.y + a0.z * v.z, a1.x * v.x + a1.y * v.y + a1.z * v.z, a2.x * v.x + a2.y * v.y + a2.z * v.z) % uTileD[0].w;
}

// tileid.ts mosaicHash
uint mosaicHash(uvec3 v) {
  uint h = v.x * 0x8da6b343u ^ v.y * 0xd8163841u ^ v.z * 0xcb1ab31fu;
  h ^= h >> 15;
  h *= 0x2c1b3c6du;
  h ^= h >> 12;
  h *= 0x297a2d39u;
  h ^= h >> 15;
  return h;
}

// the number of bits set (bitCount is GLSL ES 3.10, not 3.00)
int bitsSet(uint v) {
  v = v - ((v >> 1) & 0x55555555u);
  v = (v & 0x33333333u) + ((v >> 2) & 0x33333333u);
  return int((((v + (v >> 4)) & 0x0f0f0f0fu) * 0x01010101u) >> 24);
}

// tileid.ts faceHash: a Wythoff face's vector salted by its kind
uint faceHash(uvec3 v, uint kind) { return mosaicHash(uvec3(v.xy, v.z + kind * uTileD[0].w)); }

// groups.ts distanceToSide
float sideDistance(vec3 x, vec3 n) { return asinhPos(max(0.0, -mink(x, n))); }

// palettes.ts samplePalette: trilinear over the mip levels, cyclic
vec3 palette(float t, float w) {
  float lod = min(8.0, log2(max(1.0, 256.0 * w)));
  return textureLod(uPalette, vec2(fract(t) + 0.5 / 256.0, 0.5), lod).rgb;
}

// reference.ts mosaicColour: a discrete set's colour by the hash's top 24 bits, or the gradient
vec3 mosaicColour(uint h) {
  uint n = uFlags.x;
  return n > 0u ? uColours[((h >> 8) * n) >> 24].rgb : palette(uLook.x + float(h >> 8) / 16777216.0, 0.0);
}

vec3 shade(vec3 xf, vec2 u, float lpx) {
  float lineW = uFlags.w == 1u ? uLine.w * lpx : uLine.w;
  // the far-tile colour: the area mean of everything below, lines included
#if SOURCE == 1
  vec3 distanceFill = palette(uLook.x + uLook.y * asinhPos(length(xf.xy)), uLook.y * lpx);
#if TILEIMAGE
  vec3 fill = distanceFill * uImageFill.rgb + uAvgGlow.rgb;
#else
  vec3 fill = distanceFill * uAvgFill.w + uAvgGlow.rgb;
#endif
#else
  vec3 fill = uAvgFill.rgb + uAvgGlow.rgb;
#endif
  vec3 target = mix(fill, uLine.rgb, min(1.0, 0.5 * lineW * uShape.w));
  float fade = smoothstep(uFade.x, uFade.y, lpx / uAverage.w);
#if SOURCE == 2
  // a band strip far from the depth start (reference.ts stripFog)
  fade = max(fade, mix(uStrip.z, uStrip.w, clamp((u.x - uStrip.x) / (uStrip.y - uStrip.x), 0.0, 1.0)));
#endif
  if (fade >= 1.0) return target;

#if RELIEF
  // central differences of the frame map one pixel either side
  vec3 xa, xb, xc, xd;
  float sa, sb, sc, sd;
  float h = uScreen.z;
  bool tangents = frame(u + vec2(h, 0.0), xa, sa) && frame(u - vec2(h, 0.0), xb, sb)
               && frame(u + vec2(0.0, h), xc, sc) && frame(u - vec2(0.0, h), xd, sd);
  vec3 t1 = uCamera * (xa - xb);
  vec3 t2 = uCamera * (xc - xd);
#endif
#if SOURCE == 0 && WYTHOFF == 0
  uint perm = uPerm.x;
#if CHIRAL
  int pend = -1; // an odd word's last mirror, not yet paired
#endif
#elif SOURCE == 4
  uvec3 a0 = uTileA[0].xyz;
  uvec3 a1 = uTileA[1].xyz;
  uvec3 a2 = uTileA[2].xyz;
#elif SOURCE == 2
  vec3 s = uStart.xyz;
  float crossed = 0.0;
  float shared = 0.0;
#endif
#if WYTHOFF == 2 || MOTIF || TILEIMAGE == 2
  bool odd = false; // the fold word's parity: an odd word's point goes once more across side 1
#endif
  // groups.ts fold: sweeps over sides 1, 2, 3 until nothing moves, at most MAX_SWEEPS
  vec3 x = uCamera * xf;
  bool moved = true;
  for (int sweep = 0; sweep < MAX_SWEEPS && moved; sweep++) {
    moved = false;
    for (int j = 0; j < 3; j++) {
      vec3 n = uNormals[j].xyz;
      float d = mink(x, n);
      if (d > 0.0) {
        x -= 2.0 * d * n;
#if WYTHOFF == 2 || MOTIF || TILEIMAGE == 2
        odd = !odd;
#endif
#if SOURCE == 0 && WYTHOFF == 0 && CHIRAL
        // colourings.ts carry: the word read in pairs, each a rotation
        if (pend < 0) pend = j;
        else {
          if (pend != j) perm = composePerm(perm, pairPerm(pend, j));
          pend = -1;
        }
#elif SOURCE == 0 && WYTHOFF == 0
        perm = composePerm(perm, uPerm[j + 1]);
#elif SOURCE == 4
        a0 = tileStep(a0, j);
        a1 = tileStep(a1, j);
        a2 = tileStep(a2, j);
#elif SOURCE == 2
        // reference.ts depthAt: walls through the start's centre do not count
        float ds = mink(s, n);
        if (abs(ds) > uLight.z) {
          crossed += 1.0;
          if (ds > 0.0) shared += 1.0;
        }
        s -= 2.0 * ds * n;
#endif
#if RELIEF
        t1 -= 2.0 * mink(t1, n) * n;
        t2 -= 2.0 * mink(t2, n) * n;
#endif
        moved = true;
      }
    }
  }
  if (moved) return target; // hit the sweep cap: treated as far away

  vec3 dist3 = vec3(sideDistance(x, uNormals[0].xyz), sideDistance(x, uNormals[1].xyz), sideDistance(x, uNormals[2].xyz));
  float de = 1e30;
  int nearest = 2;
  for (int j = 0; j < 3; j++)
    if ((uFlags.z & (1u << uint(j))) != 0u && dist3[j] < de) {
      de = dist3[j];
      nearest = j;
    }
  // relief: the unit normal whose products with the tangents give the screen direction in which de grows
  vec3 rn = uNormals[nearest].xyz;
  float rs = -1.0;

#if WYTHOFF
  // wythoff.ts wythoffAt, in the domain: the kite's odd words once more across side 1
  vec3 y = x;
#if WYTHOFF == 2
  if (odd) {
    vec3 n0 = uNormals[0].xyz;
    y -= 2.0 * mink(y, n0) * n0;
#if RELIEF
    t1 -= 2.0 * mink(t1, n0) * n0;
    t2 -= 2.0 * mink(t2, n0) * n0;
#endif
#if SOURCE == 4
    a0 = tileStep(a0, 0);
    a1 = tileStep(a1, 0);
    a2 = tileStep(a2, 0);
#endif
  }
#endif
  // the sides of the listed edge lines pick the face: the first that matches all its lines, or the
  // one with fewest mismatched (rounding where several lines meet)
  uint bits = 0u;
  for (uint e = 0u; e < 16u; e++) {
    if (e >= uWy.x) break;
    if (mink(y, uWyLines[e].xyz) > 0.0) bits |= 1u << e;
  }
  int face = 0;
  int best = 99;
  for (uint f = 0u; f < 16u; f++) {
    if (f >= uWy.y) break;
    int miss = bitsSet((bits ^ uWyFaces[f].y) & uWyFaces[f].x);
    if (miss < best) {
      best = miss;
      face = int(f);
      if (miss == 0) break;
    }
  }
  // the nearest of its own lines, and the face across it
  de = 1e30;
  int line = -1;
  uint fmask = uWyFaces[face].x;
  for (uint e = 0u; e < 16u; e++) {
    if (e >= uWy.x) break;
    if ((fmask & (1u << e)) == 0u) continue;
    float d = asinhPos(abs(mink(y, uWyLines[e].xyz)));
    if (d < de) {
      de = d;
      line = int(e);
    }
  }
  int across = face;
  if (line >= 0) {
    uint two = uint(uWyLines[line].w + 0.5);
    across = int(two & 31u) == face ? int(two >> 5) : int(two & 31u);
    rn = uWyLines[line].xyz;
    rs = ((uWyFaces[face].y >> uint(line)) & 1u) != 0u ? 1.0 : -1.0;
  }
#endif

#if MOTIF
  // motifs.ts motifAt: in the kite (an odd word once more across side 1), a ray away from PR (or QR)
  // that crosses c1 (c2) an odd number of times puts the point in the neighbour's tile, two mirrors on
  vec3 y = x;
  int lt[3];
  int nl = 0;
  if (odd) {
    vec3 n0 = uNormals[0].xyz;
    y -= 2.0 * mink(y, n0) * n0;
    lt[nl++] = 0;
  }
  vec2 wP = toDiskW(y);
  vec2 wQ = toDiskW(toQFrame(y));
  int l1 = -1;
  int l2 = -1;
  if (!odd) {
    if (inBound(wP, uMoBound1) && oddCrossings(wP, uMoAway.xy, 0)) {
      l1 = 1;
      l2 = 0;
    } else if (inBound(wQ, uMoBound2) && oddCrossings(wQ, uMoAway.zw, 1)) {
      l1 = 2;
      l2 = 0;
    }
  } else {
    vec2 mP = cmul(wP, uMoTurn.xy);
    vec2 mQ = cmul(wQ, uMoTurn.zw);
    if (inBound(mP, uMoBound1) && oddCrossings(mP, -uMoAway.xy, 0)) {
      l1 = 0;
      l2 = 1;
    } else if (inBound(mQ, uMoBound2) && oddCrossings(mQ, -uMoAway.zw, 1)) {
      l1 = 0;
      l2 = 2;
    }
  }
  if (l1 >= 0) {
    vec3 na = uNormals[l1].xyz;
    vec3 nb = uNormals[l2].xyz;
    y -= 2.0 * mink(y, na) * na;
    y -= 2.0 * mink(y, nb) * nb;
    wP = toDiskW(y);
    wQ = toDiskW(toQFrame(y));
    lt[nl++] = l1;
    lt[nl++] = l2;
  }
  // the letters carry the colour state, the tile matrix, the depth start and the tangents on, as the
  // fold's reflections do
  for (int k = 0; k < 3; k++) {
    if (k >= nl) break;
    int j = lt[k];
    vec3 n = uNormals[j].xyz;
#if SOURCE == 0 && CHIRAL
    if (pend < 0) pend = j;
    else {
      if (pend != j) perm = composePerm(perm, pairPerm(pend, j));
      pend = -1;
    }
#elif SOURCE == 0
    perm = composePerm(perm, uPerm[j + 1]);
#elif SOURCE == 4
    a0 = tileStep(a0, j);
    a1 = tileStep(a1, j);
    a2 = tileStep(a2, j);
#elif SOURCE == 2
    float ds = mink(s, n);
    if (abs(ds) > uLight.z) {
      crossed += 1.0;
      if (ds > 0.0) shared += 1.0;
    }
    s -= 2.0 * ds * n;
#endif
#if RELIEF
    t1 -= 2.0 * mink(t1, n) * n;
    t2 -= 2.0 * mink(t2, n) * n;
#endif
  }
  // de: the nearest of c1 and c1' (c1 from rho_P y) in the P frame, c2 and c2' in the Q frame
  vec2 at[4] = vec2[4](wP, cmul(wP, uMoTurn.xy), wQ, cmul(wQ, uMoTurn.zw));
  de = 1e30;
  int curve = 0;
  vec2 grad = vec2(0.0);
  for (int c = 0; c < 4; c++) {
    vec2 z = nearestOn(at[c], c < 2 ? 0 : 1);
    float d = poincareDist(at[c], z);
    if (d < de) {
      de = d;
      curve = c;
      vec2 g = at[c] - z;
      float len = length(g);
      grad = len > 0.0 ? g / len : vec2(0.0);
    }
  }
  if (curve == 1) grad = unturn(grad, uMoTurn.xy);
  else if (curve == 3) grad = unturn(grad, uMoTurn.zw);
  // the mirrors to the tile across the nearest curve
  ivec2 acr = curve == 0 ? ivec2(1, 0) : curve == 1 ? ivec2(0, 1) : curve == 2 ? ivec2(2, 0) : ivec2(0, 2);
  float tb = max(0.0, 0.5 - de / lpx);
#endif

#if MOTIF && SOURCE == 0
  // the tile's colour (its word is even), blended toward the tile across the nearest curve
  uint own = permAt(perm, 0u);
#if CHIRAL
  uint other = permAt(perm, pairAt(acr.x, acr.y, 0u));
#else
  uint other = permAt(perm, permAt(uPerm[acr.x + 1], permAt(uPerm[acr.y + 1], 0u)));
#endif
  vec3 col = uColours[own].rgb;
  if (other != own && tb > 0.0) col = mix(col, uColours[other].rgb, tb);
#elif MOTIF && SOURCE == 4
  // the kite's identity (or the polygon's around P), and the tile's across the nearest curve
  uint mown = faceHash(tileApply(a0, a1, a2, uMoCell.xyz), uMoCell.w);
  vec3 col = mosaicColour(mown);
  if (tb > 0.0) {
    uvec3 b0 = tileStep(tileStep(a0, acr.x), acr.y);
    uvec3 b1 = tileStep(tileStep(a1, acr.x), acr.y);
    uvec3 b2 = tileStep(tileStep(a2, acr.x), acr.y);
    uint mother = faceHash(tileApply(b0, b1, b2, uMoCell.xyz), uMoCell.w);
    if (mother != mown) col = mix(col, mosaicColour(mother), tb);
  }
#elif MOTIF && SOURCE == 2
  // constant over the tile: the depth of its even triangle, and of the tile's across the nearest curve
  float depth = crossed + uStart.w - 2.0 * shared;
  vec3 col = palette(uLook.x + uLook.y * depth, 0.0);
  if (tb > 0.0) {
    float c2 = crossed;
    float s2 = shared;
    vec3 sa = s;
    for (int k = 0; k < 2; k++) {
      vec3 n = uNormals[k == 0 ? acr.x : acr.y].xyz;
      float ds = mink(sa, n);
      if (abs(ds) > uLight.z) {
        c2 += 1.0;
        if (ds > 0.0) s2 += 1.0;
      }
      sa -= 2.0 * ds * n;
    }
    float depth2 = c2 + uStart.w - 2.0 * s2;
    if (depth2 != depth) col = mix(col, palette(uLook.x + uLook.y * depth2, 0.0), tb);
  }
#elif WYTHOFF && SOURCE == 0
  // the face's kind, blended toward the kind across the nearest edge
  uint own = uWyFaces[face].z >> 4;
  vec3 col = uColours[own].rgb;
  uint other = uWyFaces[across].z >> 4;
  float t = max(0.0, 0.5 - de / lpx);
  if (other != own && t > 0.0) col = mix(col, uColours[other].rgb, t);
#elif WYTHOFF && SOURCE == 4
  // the face's identity: the camera's matrix along the word, applied to the face's own vector
  vec3 col = mosaicColour(faceHash(tileApply(a0, a1, a2, uWyIds[face].xyz), uWyIds[face].w));
  float t = max(0.0, 0.5 - de / lpx);
  if (t > 0.0 && across != face) col = mix(col, mosaicColour(faceHash(tileApply(a0, a1, a2, uWyIds[across].xyz), uWyIds[across].w)), t);
#elif SOURCE == 0 && CHIRAL
  // colourings.ts colourOf, colourAcross: an odd word's triangle lies in the kite of h s1; across side
  // 1 the kite goes on, across sides 2 and 3 lies the kite of (P o tau_j1) or (P o tau_ej)
  uint own = permAt(perm, pend < 0 ? 0u : pairAt(pend, 0, 0u));
  vec3 col = uColours[own].rgb;
  for (int j = 1; j < 3; j++) {
    uint other = permAt(perm, pend < 0 ? pairAt(j, 0, 0u) : pairAt(pend, j, 0u));
    if (other == own) continue;
    float t = max(0.0, 0.5 - dist3[j] / lpx);
    if (t > 0.0) col = mix(col, uColours[other].rgb, t);
  }
#elif SOURCE == 0
  uint own = permAt(perm, 0u);
  vec3 col = uColours[own].rgb;
  // across side j the neighbouring tile has colour (perm o sigma_j)(0)
  for (int j = 0; j < 3; j++) {
    uint other = permAt(perm, permAt(uPerm[j + 1], 0u));
    if (other == own) continue;
    float t = max(0.0, 0.5 - dist3[j] / lpx);
    if (t > 0.0) col = mix(col, uColours[other].rgb, t);
  }
#elif SOURCE == 4
  // tileid.ts tileOf: the tile around P's image, and the one across side 3 (sides 1 and 2 lie inside)
  vec3 col = mosaicColour(mosaicHash(tileApply(a0, a1, a2, uTileW[0].xyz)));
  float t3 = max(0.0, 0.5 - dist3[2] / lpx);
  if (t3 > 0.0) col = mix(col, mosaicColour(mosaicHash(tileApply(a0, a1, a2, uTileW[1].xyz))), t3);
#elif SOURCE == 1
  vec3 col = distanceFill;
#elif SOURCE == 2
  // walls between this triangle and the start tile's centre, smoothed between the nearest side
  // toward it (down) and the nearest away from it (up)
  float depth = crossed + uStart.w - 2.0 * shared;
  float down = 1e30;
  float up = 1e30;
  for (int j = 0; j < 3; j++) {
    float ds = mink(s, uNormals[j].xyz);
    if (ds > uLight.z) down = min(down, dist3[j]);
    else if (ds < -uLight.z) up = min(up, dist3[j]);
  }
  float span = down + up;
  bool atStart = down >= 1e30;
  float ratio = atStart ? 1.0 : span > 0.0 ? down / span : 0.5;
  float w = atStart ? 0.0 : uLook.y * lpx / max(span, 1e-30);
  vec3 col = palette(uLook.x + uLook.y * (depth - 0.5 + ratio), w);
#else
  vec3 col = palette(uLook.x + uLook.y * de / uLook.z, uLook.y * lpx / uLook.z);
#endif

#if TILEIMAGE
  // reference.ts pictureOver: the picture at x, or the chiral mode's in the kite (an odd word's point
  // once more across side 1), blended within half a pixel of the kite's edges toward the neighbour's
  // at its own point; then over the source's colour, or tinted by it
#if TILEIMAGE == 2
  vec3 n0 = uNormals[0].xyz;
  vec4 pic = pictureAt(odd ? x - 2.0 * mink(x, n0) * n0 : x, lpx);
  for (int j = 1; j < 3; j++) {
    float t = max(0.0, 0.5 - dist3[j] / lpx);
    if (t <= 0.0) continue;
    vec3 nj = uNormals[j].xyz;
    vec3 yn = x - 2.0 * mink(x, nj) * nj;
    if (!odd) yn -= 2.0 * mink(yn, n0) * n0;
    pic = mix(pic, pictureAt(yn, lpx), t);
  }
#else
  vec4 pic = pictureAt(x, lpx);
#endif
  col = mix(pic.rgb + col * (1.0 - pic.a), col * (pic.rgb + 1.0 - pic.a), uImageInfo.z);
#endif

#if MOTIF
  vec3 tileCol = col; // a feature in the tile's slot takes the source's colour
#endif
#if RELIEF
  if (tangents) {
#if MOTIF
    // de's direction in its curve's frame, through the frame's derivative along the tangents
    vec3 yf = curve >= 2 ? toQFrame(y) : y;
    vec3 u1 = curve >= 2 ? toQFrame(t1) : t1;
    vec3 u2 = curve >= 2 ? toQFrame(t2) : t2;
    float kf = 1.0 / (1.0 + yf.z);
    vec2 g = vec2(dot(grad, (u1.xy - yf.xy * u1.z * kf) * kf), dot(grad, (u2.xy - yf.xy * u2.z * kf) * kf));
#else
    vec2 g = rs * vec2(mink(t1, rn), mink(t2, rn));
#endif
    float len = length(g);
    if (len > 0.0) {
      float hp = uShape.z * (1.0 - smoothstep(0.0, uShape.y, de));
      col *= max(0.0, (1.0 - hp * dot(g / len, uLight.xy)) / sqrt(1.0 + hp * hp));
    }
  }
#endif
  if (uLook.w > 0.0) col = mix(col, uLine.rgb, uLook.w * exp(-de / uShape.x));
#if MOTIF
  // the features over the tile, in the P frame, then the outline
  vec2 fw = toDiskW(y);
  float lam = 2.0 / (1.0 - dot(fw, fw));
  float reach = 0.5 * lpx / lam;
  for (int f = 0; f < 24; f++) {
    if (f >= int(uMoCount.z)) break;
    vec4 box = uMoBox[f];
    if (length(fw - box.xy) - box.z >= reach) continue;
    float cov = clamp(0.5 - featureDistance(f, fw) * lam / lpx, 0.0, 1.0);
    if (cov > 0.0) col = mix(col, featureColour(f, tileCol), cov);
  }
  float mcov = lineCoverage(de, lineW, lpx);
  if (mcov > 0.0) col = mix(col, uLine.rgb, min(1.0, mcov));
#endif
#if WYTHOFF
  // the tiling's edges, then version 1's sides over them
  float wcov = lineCoverage(de, lineW, lpx);
  if (wcov > 0.0) col = mix(col, uLine.rgb, min(1.0, wcov));
#endif
  for (int j = 0; j < 3; j++) {
    if ((uFlags.y & (1u << uint(j))) == 0u) continue;
    float cov = lineCoverage(dist3[j], lineW, lpx);
    if (cov > 0.0) col = mix(col, uLine.rgb, min(1.0, cov));
  }
  return fade > 0.0 ? mix(col, target, fade) : col;
}
