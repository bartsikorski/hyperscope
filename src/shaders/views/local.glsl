// Local view (views.ts localFrame): the pixel at u lies at distance ell |u| in the direction of u,
// uView = (ell, unused). sinh(d) / d by its series near 0, where sinh itself loses digits.
float sinhOver(float d) {
  if (d < 0.5) {
    float d2 = d * d;
    return 1.0 + d2 / 6.0 * (1.0 + d2 / 20.0 * (1.0 + d2 / 42.0));
  }
  return sinh(d) / d;
}

bool frame(vec2 u, out vec3 x, out float scale) {
  float ell = uView.x;
  float d = ell * length(u);
  scale = ell * sinhOver(d);
  x = vec3(u * scale, cosh(d));
  return true;
}

// views.ts edgeDistance: the local view has no edge
float edge(vec2 u) {
  return -1e30;
}

// views.ts frameJacobian: x = (sinh(d) e, cosh d) with d = ell |u|; along e the map stretches by
// ell cosh d, across it by ell sinh(d) / d
void frameJacobian(vec2 u, vec3 x, out vec3 t1, out vec3 t2) {
  float ell = uView.x;
  float len = length(u);
  vec2 e = len > 0.0 ? u / len : vec2(1.0, 0.0);
  float d = ell * len;
  float ch = cosh(d);
  float so = sinhOver(d);
  t1 = ell * vec3(ch * e * e.x + so * (vec2(1.0, 0.0) - e * e.x), d * so * e.x);
  t2 = ell * vec3(ch * e * e.y + so * (vec2(0.0, 1.0) - e * e.y), d * so * e.y);
}
