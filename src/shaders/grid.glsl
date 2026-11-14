// The unit grid over the content (render/grid.ts gridRates, gridLines and shadeGrid). Per level, the
// phase of the even lines comes from the camera's E phase plus the pixel's dE, and the phase of the
// spreading lines from the slot's bits of S0 plus the pixel's offset term, so nothing here is larger
// than a few hundred lines at any zoom. Distances to lines are in pixels: a phase over its rate per
// pixel. Compiled per grid: GRID 1 Cartesian, 2 polar, 3 horocyclic; GRID 0 leaves this chunk empty.
#if GRID > 0

const float GRID_TURN = 6.283185307179586;
const float GRID_LN2 = 0.6931471805599453;

// atanh(z) / z, the series to z^12 (|z| <= 0.25, exact to float32)
float atanhRatio(float z) {
  float z2 = z * z;
  return 1.0 + z2 * (1.0 / 3.0 + z2 * (0.2 + z2 * (1.0 / 7.0 + z2 * (1.0 / 9.0 + z2 * (1.0 / 11.0 + z2 / 13.0)))));
}

// atan(z) / z, the same series with alternating signs
float atanRatio(float z) {
  float z2 = z * z;
  return 1.0 - z2 * (1.0 / 3.0 - z2 * (0.2 - z2 * (1.0 / 7.0 - z2 * (1.0 / 9.0 - z2 * (1.0 / 11.0 - z2 / 13.0)))));
}

// asinh for any float32 (GLSL's squares its argument and overflows above 1.8e19); asinhPos's
// series near 0, where log near 1 has only absolute precision
float asinhAny(float x) {
  float a = abs(x);
  float r = a < 0.1 ? asinhPos(a) : a > 1e4 ? log(a) + GRID_LN2 : log(a + sqrt(a * a + 1.0));
  return x < 0.0 ? -r : r;
}

// sinh without the cancellation of (e^x - e^-x) / 2 near 0
float sinhAny(float x) {
  if (abs(x) < 0.1) {
    float x2 = x * x;
    return x * (1.0 + x2 / 6.0 * (1.0 + x2 / 20.0));
  }
  return sinh(x);
}

// math/grid.ts offsetTerm: dE (relative to E0, without cancellation), E, and the offset term B with
// B uScale = 2^m0 dS / unit, from the frame point q turned into the grid frame
void gridOffset(vec3 q, out float de, out float e, out float b) {
  float e0 = uGrid1.x;
  float tm1 = dot(q.xy, q.xy) / (1.0 + q.z);
#if GRID == 1
  float c = uGrid0.w;
  float tau = uGrid0.z;
  float s = tau * c;
  e = asinhAny(s * q.z + c * q.y);
  de = 2.0 * asinhAny((s * tm1 + c * q.y) / (2.0 * cosh(0.5 * (e + e0))));
  float w = q.z + tau * q.y;
  float z = q.x / (c * w);
  float ratio = abs(z) <= 0.25 ? atanhRatio(z) : 0.5 * log((1.0 + z) / (1.0 - z)) / z;
  b = ratio * q.x / w;
#elif GRID == 2
  float c = uGrid0.w;
  float tau = uGrid0.z;
  float s = tau * c;
  float w = q.x + tau * q.z;
  float wx = c * w;
  float hi = max(abs(wx), abs(q.y));
  float lo = min(abs(wx), abs(q.y));
  float r = hi > 0.0 ? asinhAny(hi * sqrt(1.0 + (lo / hi) * (lo / hi))) : 0.0;
  // cosh r - cosh r0 = s x + c (t - 1) = 2 sinh((r + r0) / 2) sinh((r - r0) / 2)
  float half_ = sinhAny(0.5 * (r + e0));
  de = half_ > 1e-30 ? 2.0 * asinhAny((s * q.x + c * tm1) / (2.0 * half_)) : r - e0;
  e = e0 + de;
  // B = dphi cosh r0 with dphi = atan(y, c w): the series while the angle is small (y / c can
  // fall below float32's range far out)
  float z = q.y / wx;
  b = w > 0.0 && abs(z) <= 0.25 ? atanRatio(z) * q.y / w : c * atan(q.y, wx);
#else
  float d = q.y > 0.0 ? (1.0 + q.x * q.x) / (q.z + q.y) : q.z - q.y;
  // ln(t - y) = log1p(a), a = (t - 1) - y, as 2 atanh(a / (2 + a)) near the centre
  float a = tm1 - q.y;
  float u = a / (2.0 + a);
  de = -(abs(a) < 0.5 ? 2.0 * u * atanhRatio(u) : log(d));
  e = e0 + de;
  b = q.x / d;
#endif
#if GRID == 1
  e = e0 + de;
#endif
}

// render/grid.ts Coverage: a line of width w at distance d, both in pixels. Per sample a box of one
// pixel; drawn once over the finished samples (GRID_ONCE, the display pass) the box spread by the
// samples' jitter of half a pixel either side, a tent of half-width one pixel.
#if GRID_ONCE
float tentCdf(float t) {
  t = clamp(t, -1.0, 1.0);
  return t < 0.0 ? 0.5 * (1.0 + t) * (1.0 + t) : 1.0 - 0.5 * (1.0 - t) * (1.0 - t);
}

float gridCoverage(float d, float w) {
  return tentCdf(d + 0.5 * w) - tentCdf(d - 0.5 * w);
}
#else
float gridCoverage(float d, float w) {
  return lineCoverage(d, w, 1.0);
}
#endif

// math/grid.ts spreadLog2 at level spacing delta (log2 delta given)
float gridSpread(float e, float log2Delta) {
#if GRID == 1
  float a = abs(e);
  return a * 1.4426950408889634 - 1.0 + log2(1.0 + exp(-2.0 * a));
#elif GRID == 2
  return log2(GRID_TURN * sinhAny(e)) - log2Delta;
#else
  return -e * 1.4426950408889634;
#endif
}

// render/grid.ts bitsPhase: frac(2^(m0 + j) S0 / unit) from a slot's bits and fraction hi + lo
float bitsPhase(uint bits, float hi, float lo, int j) {
  if (j >= 0) {
    float k = exp2(float(j));
    return fract(fract(hi * k) + fract(lo * k));
  }
  if (j <= -32) return (float(bits) + hi + lo) / 4294967296.0;
  uint span = 1u << uint(-j);
  return (float(bits & (span - 1u)) + hi + lo) / float(span);
}

float nearestLine(float p) { return abs(p - round(p)); }

// render/grid.ts gridPoint: a frame point turned into the grid frame, then its offset terms
void gridPoint(vec3 xf, out float de, out float e, out float b) {
  gridOffset(vec3(uGrid0.x * xf.x - uGrid0.y * xf.y, uGrid0.y * xf.x + uGrid0.x * xf.y, xf.z), de, e, b);
}

// cosh a / cosh b and cosh a / sinh b (b > 0) as ratios of exponentials, finite for any a, b in the
// grid's range (cosh 55 squared is past float32)
float coshRatio(float a, float b) {
  return exp(abs(a) - abs(b)) * (1.0 + exp(-2.0 * abs(a))) / (1.0 + exp(-2.0 * abs(b)));
}
float coshOverSinh(float a, float b) {
  return b < 1.0 ? cosh(min(abs(a), 80.0)) / max(sinhAny(b), 1e-30) : exp(abs(a) - b) * (1.0 + exp(-2.0 * abs(a))) / (1.0 - exp(-2.0 * b));
}

// render/grid.ts gridRates: dE and B per pixel. In a conformal view the plane's own rates (exact
// there); elsewhere the frame map's Jacobian times the closed-form gradients of the coordinates
// (rates only set line widths, so a few digits are plenty).
vec2 gridRates(vec2 u, float lpx, float e, vec3 xf) {
#ifndef CONFORMAL
  vec3 t1, t2;
  frameJacobian(u, xf, t1, t2);
  mat3 turn = mat3(uGrid0.x, uGrid0.y, 0.0, -uGrid0.y, uGrid0.x, 0.0, 0.0, 0.0, 1.0);
  vec3 q = turn * xf;
  vec3 d1 = turn * t1 * uScreen.z;
  vec3 d2 = turn * t2 * uScreen.z;
  float tau = uGrid0.z;
  float e0 = uGrid1.x;
#if GRID == 1
  // sinh E = cosh E0 (y + tau t), B = cosh E0 atanh(x / (cosh E0 w)) with w = t + tau y
  float k = coshRatio(e0, e);
  float w = q.z + tau * q.y;
  vec2 dE = k * vec2(d1.y + tau * d1.z, d2.y + tau * d2.z);
  vec2 dB = k * k * (w * vec2(d1.x, d2.x) - q.x * vec2(d1.z + tau * d1.y, d2.z + tau * d2.y));
#elif GRID == 2
  // sinh r = |(cosh E0 v, y)| with v = x + tau t, B = cosh E0 phi
  float ks = coshOverSinh(e0, e);
  float kc = coshRatio(e0, e);
  float sh = sinhAny(e);
  float v = q.x + tau * q.z;
  vec2 dv = vec2(d1.x + tau * d1.z, d2.x + tau * d2.z);
  vec2 dy = vec2(d1.y, d2.y);
  vec2 dE = ks * kc * v * dv + (q.y / max(sh, 1e-30)) * dy / cosh(min(e, 80.0));
  vec2 dB = ks * ks * (v * dy - q.y * dv);
#else
  // E = E0 - ln D, D = t - y, B = x / D
  float D = q.y > 0.0 ? (1.0 + q.x * q.x) / (q.z + q.y) : q.z - q.y;
  vec2 dD = vec2(d1.z - d1.y, d2.z - d2.y) / D;
  vec2 dE = -dD;
  vec2 dB = vec2(d1.x, d2.x) / D - (q.x / D) * dD;
#endif
  return vec2(length(dE), length(dB));
#elif GRID == 1
  return lpx * vec2(1.0, uGrid0.w / cosh(e));
#elif GRID == 2
  return lpx * vec2(1.0, uGrid0.w / sinhAny(e));
#else
  return lpx * vec2(1.0, exp(e) / uGrid0.w);
#endif
}

// render/grid.ts shadeGrid: the three finest levels with weights a, 1, 1 - a, then E = 0 and S = 0
vec3 grid(vec3 col, vec3 xf, float lpx, vec2 u) {
  float de, e, b;
  gridPoint(xf, de, e, b);
  if (!(abs(e) < 80.0)) return col;
  vec2 rates = max(gridRates(u, lpx, e, xf), vec2(1e-30));
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 target = mix(vec3(1.0), vec3(0.012, 0.013, 0.016), smoothstep(uGrid3.y - uGrid3.z, uGrid3.y + uGrid3.z, lum));
  float x = log2(8.0 * lpx) * 0.3010299956639812 + uGrid2.x;
  float kf = floor(x) + 1.0;
  float a = kf - x;
  int i0 = int(kf - uGrid1.z);
  vec3 outCol = col;
  for (int n = 0; n < 3; n++) {
    int i = i0 + n;
    float weight = n == 0 ? a : n == 1 ? 1.0 : 1.0 - a;
    if (i < 0 || i >= 8 || weight <= 0.0) continue;
    if (kf + float(n) > uGrid1.w) break;
    vec4 A = uGridA[i];
    vec4 B = uGridB[i];
    float delta = B.z;
    float cov = gridCoverage(nearestLine(A.x + de * A.y) * delta / rates.x, 1.0);
    float L = gridSpread(e, B.w);
#if GRID == 2
    float m = max(2.0, floor(L));
#else
    float m = floor(L);
#endif
    int j = int(m - B.y);
    if (j >= -32 && j <= 30) {
      // the phase at level m is bitsPhase + B uScale 2^j, so it moves by rates.y uScale 2^j per pixel
      uint bits = uGridBits[i >> 2][i & 3];
      float offset = b * B.x;
      float rate = rates.y * B.x * exp2(float(j));
      cov = max(cov, gridCoverage(nearestLine(bitsPhase(bits, A.z, A.w, j) + offset * exp2(float(j))) / rate, 1.0));
      float half_ = clamp(L - m, 0.0, 1.0);
      if (j < 30 && half_ > 0.0)
        cov = max(cov, half_ * gridCoverage(nearestLine(bitsPhase(bits, A.z, A.w, j + 1) + offset * exp2(float(j + 1))) / (2.0 * rate), 1.0));
    }
    if (cov > 0.0) outCol = mix(outCol, target, uGrid2.y * weight * cov);
  }
  // the lines E = 0 and S = 0 in the accent colour, in pixels (polar: the centre as a dot, the ray
  // phi = 0)
  float axis = abs(e) / rates.x;
  float zero = 1e30;
#if GRID == 1
  zero = abs(uGrid0.w * uGrid1.y + b) / rates.y;
#elif GRID == 2
  axis = max(0.0, axis - (uGrid3.x - 0.5 * uGrid2.w));
  float phi = uGrid1.y + b / (uGrid0.w * GRID_TURN);
  if (abs(phi) < 0.25) zero = abs(phi) * GRID_TURN * uGrid0.w / rates.y;
#else
  zero = abs(uGrid1.y / uGrid0.w + b) / rates.y;
#endif
  float acc = max(gridCoverage(axis, uGrid2.w), gridCoverage(zero, uGrid2.w));
  return acc > 0.0 ? mix(outCol, uAccent.rgb, uGrid2.z * acc) : outCol;
}

#endif
