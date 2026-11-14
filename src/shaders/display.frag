// Display pass: the accumulated linear picture, scaled to the canvas, encoded as sRGB with a dither
// of uDisplay.z 8-bit steps against banding in dark gradients. With GRID > 0 the target holds the
// samples without the unit grid, and the grid is drawn here once, at the pixel's centre, over their
// mean (reference.ts renderView): inside the picture's edge and under the accent ring, as main.frag
// draws it per sample.
uniform sampler2D uAccum;
uniform vec3 uDisplay; // canvas width, height, dither amplitude
out vec4 fragColor;

void main() {
  vec3 c = texture(uAccum, gl_FragCoord.xy / uDisplay.xy).rgb;
#if GRID > 0
  vec2 u = (gl_FragCoord.xy + uSample.xy - 0.5 * uScreen.xy) * uScreen.z - vec2(uScreen.w, 0.0);
  vec3 x;
  float scale;
  if (frame(u, x, scale)) {
    float dpx = edge(u) / uScreen.z;
    float under = clamp(0.5 - dpx, 0.0, 1.0) * (1.0 - uSample.w * lineCoverage(dpx, uSample.z, 1.0));
#ifdef VIEW_FADE
    under *= 1.0 - viewFade(x, scale * uScreen.z);
#endif
#ifdef VIEW_SHADE
    // the grid goes on the mean with the view's light taken off, and the light back on after
    float light = viewShade(u, x);
    c = mix(c, grid(c / light, x, scale * uScreen.z, u) * light, under);
#else
    c = mix(c, grid(c, x, scale * uScreen.z, u), under);
#endif
  }
#endif
  c = linearToSrgb(c);
  c += (pixelNoise(uvec2(gl_FragCoord.xy)) - 0.5) * uDisplay.z / 255.0;
  fragColor = vec4(c, 1.0);
}
