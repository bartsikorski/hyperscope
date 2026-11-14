// The hyperboloid (views.ts hyperboloidFrame): the upper sheet of t^2 - x^2 - y^2 = 1 in Euclidean
// 3D, seen by an orbit camera at o = (0, -D cos e, 1 + D sin e) looking at the vertex; the pixel
// looks along d = F + f (u.x R + u.y U) and its frame point is where the ray first meets the sheet
// ahead. With Q(a, b) = a.t b.t - a.x b.x - a.y b.y = -mink, A = Q(d, d), B = Q(o, d),
// C = Q(o, o) - 1, the roots are q / A and C / q, q = -(B + sign(B) sqrt(B^2 - AC)).
// uView = (D, cos e, sin e, f). Not conformal; lit by a fixed light in the camera's axes.
#define VIEW_FADE
#define VIEW_SHADE

float hbQ(vec3 a, vec3 b) { return -mink(a, b); }

vec3 hbOrigin() { return vec3(0.0, -uView.x * uView.y, 1.0 + uView.x * uView.z); }

// F + f (u.x R + u.y U), F = (0, cos e, -sin e), R = (1, 0, 0), U = (0, sin e, cos e)
vec3 hbRay(vec2 u) {
  float f = uView.w;
  return vec3(f * u.x, uView.y + f * u.y * uView.z, -uView.z + f * u.y * uView.y);
}

// views.ts hbHit: the nearest root ahead (lambda > 0) on the upper sheet (t > 0)
bool hbHit(vec3 o, vec3 d, out float lambda) {
  float A = hbQ(d, d);
  float B = hbQ(o, d);
  float C = hbQ(o, o) - 1.0;
  float disc = B * B - A * C;
  lambda = 0.0;
  if (!(disc >= 0.0)) return false;
  float q = -(B + (B >= 0.0 ? 1.0 : -1.0) * sqrt(disc));
  if (q == 0.0) return false;
  float best = 3.0e38;
  float l1 = q / A;
  float l2 = C / q;
  if (l1 > 0.0 && o.z + l1 * d.z > 0.0) best = l1;
  if (l2 > 0.0 && l2 < best && o.z + l2 * d.z > 0.0) best = l2;
  if (!(best < 3.0e38)) return false;
  lambda = best;
  return true;
}

// views.ts hbJacobian: lambda (e - d Q(p, e) / Q(p, d)) for e = f R, f U
void hbJacobian(vec3 d, float lambda, vec3 p, out vec3 t1, out vec3 t2) {
  float f = uView.w;
  float pd = hbQ(p, d);
  vec3 e1 = vec3(f, 0.0, 0.0);
  vec3 e2 = vec3(0.0, f * uView.z, f * uView.y);
  t1 = lambda * (e1 - d * (hbQ(p, e1) / pd));
  t2 = lambda * (e2 - d * (hbQ(p, e2) / pd));
}

// views.ts largestStretch
float largestStretch(vec3 t1, vec3 t2) {
  float g11 = mink(t1, t1);
  float g22 = mink(t2, t2);
  float g12 = mink(t1, t2);
  return sqrt(0.5 * (g11 + g22 + length(vec2(g11 - g22, 2.0 * g12))));
}

bool frame(vec2 u, out vec3 x, out float scale) {
  vec3 o = hbOrigin();
  vec3 d = hbRay(u);
  float lambda;
  x = vec3(0.0, 0.0, 1.0);
  scale = 0.0;
  if (!hbHit(o, d, lambda)) return false;
  // float32 only: rays next to the asymptotic cone go out as 1 / A; past 1e6 R every pixel has long
  // faded into the tiles' average (viewFade), and the cap keeps the footprint's squares finite
  lambda = min(lambda, 1.0e6);
  vec3 p = o + lambda * d;
  // onto the sheet by t from x and y (views.ts hyperboloidFrame)
  x = vec3(p.xy, sqrt(1.0 + dot(p.xy, p.xy)));
  vec3 t1, t2;
  hbJacobian(d, lambda, x, t1, t2);
  scale = largestStretch(t1, t2);
  return true;
}

// views.ts hyperboloidEdge: the signed distance in u to the nearer of the silhouette (B^2 - AC = 0,
// from outside both bowls, where the grazing point is ahead on the upper sheet) and infinity
// (A = 0, for upward rays whose finite root is not the hit), negative where the ray hits
float edge(vec2 u) {
  vec3 o = hbOrigin();
  vec3 d = hbRay(u);
  float f = uView.w;
  float A = hbQ(d, d);
  float B = hbQ(o, d);
  float C = hbQ(o, o) - 1.0;
  float lambda;
  bool hit = hbHit(o, d, lambda);
  vec3 U = vec3(0.0, uView.z, uView.y);
  vec2 dA = vec2(-2.0 * f * d.x, 2.0 * f * hbQ(d, U));
  vec2 dB = vec2(0.0, f * hbQ(o, U));
  float disc = B * B - A * C;
  float dist = 1.0e6;
  if (C < 0.0 && B != 0.0) {
    float l = -C / B;
    if (l > 0.0 && o.z + l * d.z > 0.0) {
      float g = length(2.0 * B * dB - C * dA);
      if (g > 0.0) dist = min(dist, abs(disc) / g);
    }
  }
  if (d.z > 0.0) {
    float q = -(B + (B >= 0.0 ? 1.0 : -1.0) * sqrt(max(0.0, disc)));
    float l = C / q;
    bool finiteHit = disc >= 0.0 && q != 0.0 && l > 0.0 && o.z + l * d.z > 0.0;
    float g = length(dA);
    if (!finiteHit && g > 0.0) dist = min(dist, abs(A) / g);
  }
  return hit ? -dist : dist;
}

// views.ts frameJacobian
void frameJacobian(vec2 u, vec3 x, out vec3 t1, out vec3 t2) {
  vec3 o = hbOrigin();
  vec3 d = hbRay(u);
  float lambda;
  hbHit(o, d, lambda);
  hbJacobian(d, min(lambda, 1.0e6), x, t1, t2);
}

// views.ts precisionFade: where float32's error in placing x grows past 0.03 to 0.1 of a pixel
float viewFade(vec3 x, float lpx) {
  return smoothstep(0.03, 0.1, 3.8743e-6 * x.z * x.z / lpx);
}

// views.ts hyperboloidShade: HB_AMBIENT + (1 - HB_AMBIENT) max(0, n . L), n the Euclidean normal
// (-x, -y, t) turned toward the camera, L = HB_LIGHT (right, up, back) = a R + b U - c F
float viewShade(vec2 u, vec3 x) {
  vec3 d = hbRay(u);
  vec3 n = normalize(vec3(-x.xy / x.z, 1.0));
  if (dot(n, d) > 0.0) n = -n;
  const vec3 light = vec3(-0.6, 0.6, 0.5);
  vec3 L = vec3(light.x, light.y * uView.z - light.z * uView.y, light.y * uView.y + light.z * uView.z);
  return 0.4 + 0.6 * max(0.0, dot(n, L) / length(L));
}
