// The plane inside H3 (views.ts h3Frame): the pixel looks along w = (f u.x, cos p + f u.y sin p,
// -sin p + f u.y cos p) from the eye at height h, and its ray meets the plane at x = H / n with
// H = (w.xy sinh h, -w.z), n = sqrt(H.z^2 - |H.xy|^2); uView = (sinh h, cos p, sin p, f). Not
// conformal: scale is the largest plane length per unit of u, from the Jacobian's Gram matrix.
#define VIEW_FADE

vec3 h3W(vec2 u) {
  float f = uView.w;
  return vec3(f * u.x, uView.y + f * u.y * uView.z, -uView.z + f * u.y * uView.y);
}

// views.ts h3Jacobian: (dH + x <x, dH>) / n along u's x and y
void h3Jacobian(vec3 x, float n, out vec3 t1, out vec3 t2) {
  float f = uView.w;
  vec3 d1 = vec3(uView.x * f, 0.0, 0.0);
  vec3 d2 = vec3(0.0, uView.x * f * uView.z, -f * uView.y);
  t1 = (d1 + x * mink(x, d1)) / n;
  t2 = (d2 + x * mink(x, d2)) / n;
}

// views.ts largestStretch
float largestStretch(vec3 t1, vec3 t2) {
  float g11 = mink(t1, t1);
  float g22 = mink(t2, t2);
  float g12 = mink(t1, t2);
  return sqrt(0.5 * (g11 + g22 + length(vec2(g11 - g22, 2.0 * g12))));
}

bool frame(vec2 u, out vec3 x, out float scale) {
  vec3 w = h3W(u);
  vec3 H = vec3(w.xy * uView.x, -w.z);
  float n2 = H.z * H.z - dot(H.xy, H.xy);
  x = vec3(0.0, 0.0, 1.0);
  scale = 0.0;
  if (!(n2 > 0.0 && H.z > 0.0)) return false;
  float n = sqrt(n2);
  x = H / n;
  vec3 t1, t2;
  h3Jacobian(x, n, t1, t2);
  scale = largestStretch(t1, t2);
  return true;
}

// views.ts h3Edge: g / |grad g| with g = w.z + sinh h |w.xy|, in units of u, positive above the horizon
float edge(vec2 u) {
  vec3 w = h3W(u);
  float f = uView.w;
  float r = length(w.xy);
  if (r == 0.0) return w.z / f;
  float g = w.z + uView.x * r;
  vec2 grad = vec2(uView.x * w.x * f / r, f * uView.y + uView.x * w.y * f * uView.z / r);
  return g / length(grad);
}

// views.ts frameJacobian
void frameJacobian(vec2 u, vec3 x, out vec3 t1, out vec3 t2) {
  vec3 w = h3W(u);
  vec3 H = vec3(w.xy * uView.x, -w.z);
  h3Jacobian(x, sqrt(H.z * H.z - dot(H.xy, H.xy)), t1, t2);
}

// views.ts precisionFade: where float32's error in placing x grows past 0.03 to 0.1 of a pixel
float viewFade(vec3 x, float lpx) {
  return smoothstep(0.03, 0.1, 3.8743e-6 * x.z * x.z / lpx);
}
