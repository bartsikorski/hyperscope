// Upper half-plane (views.ts halfPlaneFrame): w = i u / (u + i mu), uView = (mu, unused).
// The boundary line is Im u = -mu / 2; 1 - |w|^2 and the scale are formed without cancellation.
// Conformal (views.ts CONFORMAL), so the grid takes its line widths from the plane (grid.glsl).
#define CONFORMAL
bool frame(vec2 u, out vec3 x, out float scale) {
  float mu = uView.x;
  float m = mu + 2.0 * u.y;
  x = vec3(0.0, 0.0, 1.0);
  scale = 0.0;
  if (!(m > 0.0)) return false;
  vec2 d = vec2(u.x, u.y + mu);
  vec2 w = cdiv(vec2(-u.y, u.x), d);
  float q = mu * m / dot(d, d); // 1 - |w|^2
  x = vec3(2.0 * w, 2.0 - q) / q;
  scale = 2.0 / m;
  return true;
}

// views.ts edgeDistance: signed distance to the boundary line, positive below it
float edge(vec2 u) {
  return -(uView.x + 2.0 * u.y) * 0.5;
}
