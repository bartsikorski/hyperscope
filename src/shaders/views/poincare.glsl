// Poincare disk (views.ts poincareFrame): w = u / (lambda - conj(c) u), uView = (lambda, conj(c), s).
// Returns false outside the disk; scale is the plane length per unit of u at the pixel. Conformal
// (views.ts CONFORMAL), so the grid takes its line widths from the plane (grid.glsl gridRates).
#define CONFORMAL
bool frame(vec2 u, out vec3 x, out float scale) {
  vec2 den = vec2(uView.x, 0.0) - cmul(uView.yz, u);
  vec2 w = cdiv(u, den);
  float r2 = dot(w, w);
  x = vec3(0.0, 0.0, 1.0);
  scale = 0.0;
  if (r2 >= 1.0) return false;
  scale = uView.x / dot(den, den) * 2.0 / (1.0 - r2);
  x = fromPoincare(w);
  return true;
}

// views.ts edgeDistance: signed distance to the rim in units of u, positive outside (uView.w = s)
float edge(vec2 u) {
  return (2.0 * (uView.y * u.x - uView.z * u.y) - uView.x + uView.w * dot(u, u)) * 0.5;
}
