// One sample of a pixel: screen position u, the view's frame point, the camera, the content's
// shade and the unit grid over it, the view's light where it has one, then the picture's edge
// (reference.ts shadeSample). Output is linear light; the sample is
// blended into the accumulation target and the display pass encodes it.
out vec4 fragColor;

void main() {
  // views.ts screenToU, with gl_FragCoord counted from the bottom, less a band strip's shift
  vec2 u = (gl_FragCoord.xy + uSample.xy - 0.5 * uScreen.xy) * uScreen.z - vec2(uScreen.w, 0.0);
  vec3 x;
  float scale;
  bool inside = frame(u, x, scale);
  float lpx = scale * uScreen.z;
  vec3 base = inside ? shade(x, u, lpx) : uAverage.rgb;
#if GRID > 0
  if (inside) base = grid(base, x, lpx, u);
#endif
#ifdef VIEW_FADE
  if (inside) base = mix(base, uAverage.rgb, viewFade(x, lpx));
#endif
#ifdef VIEW_SHADE
  if (inside) base *= viewShade(u, x);
#endif
  float dpx = edge(u) / uScreen.z;
  vec3 col = mix(uBackground.rgb, base, clamp(0.5 - dpx, 0.0, 1.0));
  float ring = lineCoverage(dpx, uSample.z, 1.0);
  if (ring > 0.0) col = mix(col, uAccent.rgb, uSample.w * ring);
  fragColor = vec4(col, 1.0);
}
