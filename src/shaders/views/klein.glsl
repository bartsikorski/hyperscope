// Klein disk (views.ts kleinFrame): h = (r u + c (c . u) / (1 + r), lambda - c . u), x = h / |h|,
// uView = (lambda, c, r). Klein is not conformal: scale is the largest plane length per unit of u.
bool frame(vec2 u, out vec3 x, out float scale) {
  float lambda = uView.x;
  vec2 c = uView.yz;
  float r = uView.w;
  float cu = dot(c, u);
  vec3 h = vec3(r * u + c * (cu / (1.0 + r)), lambda - cu);
  float n2 = h.z * h.z - dot(h.xy, h.xy);
  x = vec3(0.0, 0.0, 1.0);
  scale = 0.0;
  if (!(n2 > 0.0 && h.z > 0.0)) return false;
  float n = sqrt(n2);
  x = h / n;
  vec2 g = r * r * u + lambda * c;
  scale = sqrt(r * r + dot(g, g) / n2) / n;
  return true;
}

// views.ts edgeDistance: signed distance to the rim in units of u, positive outside (s = r^2 / lambda)
float edge(vec2 u) {
  return (2.0 * dot(uView.yz, u) - uView.x + uView.w * uView.w / uView.x * dot(u, u)) * 0.5;
}

// views.ts frameJacobian: d(h / n) = (dh + x <x, dh>) / n, the frame point's change along u's x and y
void frameJacobian(vec2 u, vec3 x, out vec3 t1, out vec3 t2) {
  float lambda = uView.x;
  vec2 c = uView.yz;
  float r = uView.w;
  float cu = dot(c, u);
  vec3 h = vec3(r * u + c * (cu / (1.0 + r)), lambda - cu);
  float n = sqrt(h.z * h.z - dot(h.xy, h.xy));
  vec3 d1 = vec3(vec2(r, 0.0) + c * (c.x / (1.0 + r)), -c.x);
  vec3 d2 = vec3(vec2(0.0, r) + c * (c.y / (1.0 + r)), -c.y);
  t1 = (d1 + x * mink(x, d1)) / n;
  t2 = (d2 + x * mink(x, d2)) / n;
}
