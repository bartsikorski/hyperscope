// Band (views.ts bandFrame): the band |Im z| < pi/2 around one geodesic, uView = (cos y0, sin y0, s,
// pi/2 - |y0|), the last from float64 so the nearer edge keeps its full relative precision.
// The relative form, where nothing of size 1 / cos y0 is subtracted, built from sin and cos of d / 2
// and sinh of a / 2 only. Sin and small sinh go through series, because GPU sin and sinh are
// accurate only to an absolute error and deep zooms make their arguments tiny; |d / 2| < pi / 2
// inside the band, so cos(d / 2) = sqrt(1 - sin^2(d / 2)). Checked in emulated float32 down to an edge gap of 1e-12
// (tests/unit/views-band.test.ts, design-checks/check_m2.py A3).
// Conformal (views.ts CONFORMAL), so the grid takes its line widths from the plane (grid.glsl).
#define CONFORMAL

// sin t for |t| < pi / 2 (always so here: inside the band |d / 2| < pi / 2), its Taylor series to
// t^13, within 7e-10 of sin t: GPU sin is accurate only to an absolute error, too coarse next to the
// edges, where cos(y0 + d) is formed from it
float bandSin(float t) {
  float t2 = t * t;
  return t * (1.0 - t2 / 6.0 * (1.0 - t2 / 20.0 * (1.0 - t2 / 42.0 * (1.0 - t2 / 72.0 * (1.0 - t2 / 110.0 * (1.0 - t2 / 156.0))))));
}

// sinh t, the same series with plus signs
float bandSinh(float t) {
  if (abs(t) < 0.5) {
    float t2 = t * t;
    return t * (1.0 + t2 / 6.0 * (1.0 + t2 / 20.0 * (1.0 + t2 / 42.0)));
  }
  return sinh(t);
}

// views.ts edgeDistance: the nearer of the two edges, in units of u, positive outside
float edge(vec2 u) {
  float near = uView.w;
  float far = 3.14159265 - near;
  float up = uView.y >= 0.0 ? near : far;
  float down = uView.y >= 0.0 ? far : near;
  return max(u.y - up / uView.z, -down / uView.z - u.y);
}

bool frame(vec2 u, out vec3 x, out float scale) {
  float c0 = uView.x;
  float s0 = uView.y;
  float s = uView.z;
  x = vec3(0.0, 0.0, 1.0);
  scale = 0.0;
  if (!(edge(u) < 0.0)) return false;
  float sh = bandSin(0.5 * s * u.y);
  float ch = sqrt(max(0.0, 1.0 - sh * sh));
  float C = c0 - 2.0 * sh * (c0 * sh + s0 * ch); // cos(y0 + d)
  if (!(C > 0.0)) return false;
  float h = bandSinh(0.5 * s * u.x);
  float m = 2.0 * h * h; // cosh a - 1
  float cmid = c0 * ch - s0 * sh; // cos(y0 + d / 2)
  float k = C * c0;
  x = vec3(2.0 * h * sqrt(1.0 + h * h) / C, (2.0 * cmid * sh - s0 * m) / k, 1.0 + (m + 2.0 * sh * sh) / k);
  scale = s / C;
  return true;
}

// views.ts precisionFade: where float32 no longer places the tiles to a small part of a pixel (past
// the last strip), the picture fades into their average (FLOAT32_SPREAD, FADE_ERROR_PX)
#define VIEW_FADE
float viewFade(vec3 x, float lpx) {
  return smoothstep(0.03, 0.1, 3.8743e-6 * x.z * x.z / lpx);
}
