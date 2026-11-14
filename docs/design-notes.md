# Design notes

Decisions taken while building, with the reasons and the measurements behind them. The design
document holds the plan; this file records what the code actually does where the two differ or
where the plan left a choice open.

## State after milestone 2

Milestone 2 (steps 11 to 18 of the second precise design) is done, on top of version 1 below.

- **What it draws.** Seven views: version 1's four, the band (step 11), the plane seen from an eye
  inside H³ (step 12, with the view tilting as the eye rises) and the hyperboloid as a surface in
  space (step 13). Colourings up to eight colours, chiral colourings and Mosaic from an exact tile
  identity (step 14); the Wythoff constructions with the snub and a free point (step 15); motifs
  with four built-in designs of our own (step 16); your own picture in the tile (step 17).
- **How it is checked.** 447 unit tests and 201 GPU tests, 182 golden images; every formula was
  checked numerically before coding (`design-checks/`). The new paths were benchmarked on an
  RTX 5060 Ti (step 18): none of the alternatives qualified, so the code stayed as it was.
- **Left for later** (milestone 3 and on, not designed yet): fractals and size-comparison objects,
  the desktop companion, and walking inside H³ worlds (milestone 4). Motifs are the costliest
  content (3 to 8 times a plain tiling), so an exact speed-up of their curves is the optimisation
  worth looking for next.
- **Release preparation** (after step 18): the help lists every key in three columns, the first
  visit says how to move and where the controls are, the construction list says "Lines (the
  mirrors)", and the repository gained continuous integration, a GitHub Pages build and a README
  for readers who have not seen the design.
- **Browser tests and real controllers.** On a PC with a DualSense attached, 27 browser tests failed
  that pass in the cloud: the views kept moving and the picture never settled. The likely cause: a
  connected controller is read every frame (so the render loop never rests) and a stick resting
  slightly off centre moves the view. The tests now import `test` from `tests/gpu/fixtures.ts`, which hides the machine's
  controllers from every page (no pads, no connect events); `gamepad.spec.ts` scripts its own.

## State of version 1

All ten build steps are done; each step below has its plan, what changed while coding, and its
measurements.

- **What it draws.** The hyperbolic plane in four views (Poincaré disk, Klein disk, upper
  half-plane, a local view): every pixel is mapped onto the hyperboloid, moved by the camera and
  folded by reflections into one triangle of a tiling. Triangle-group tilings with their colourings,
  24 palettes and four colour sources, lines with glow and relief, and a unit grid (Cartesian, polar
  or horocyclic) whose position is kept to 256 binary places, with exact labels down to 10⁻¹¹ R a
  pixel.
- **How it draws it.** One fragment-shader program per view, content and look; a still picture
  refines to 16 samples per pixel and stops, moving frames render at a scale that follows the frame
  rate, and the grid is drawn once over a still picture's samples. On an RTX 5060 Ti a sample pass
  takes under 1.3 ms at 4K.
- **How it is checked.** 239 unit tests (float64 math against 100-digit values, groups, colourings,
  views, input, palettes, shading, the grid and its labels, saved state, presets, screenshots) and
  114 GPU tests: the shader against a float64 CPU reference renderer pixel by pixel, 66 golden
  images, refinement, scripted input and the whole interface. Equivalent formulas were timed against
  each other (step 10) and the faster kept.
- **Left for later** (the design's later milestones): the hyperboloid view, an H³ view (the plane
  seen from inside H³ came in step 12), and the desktop build, whose route is chosen at milestone 3.

## Step 6: progressive refinement

### Samples

- A still picture is the mean of up to 16 samples per pixel (`MAX_SAMPLES`). Sample 0 sits at the
  pixel centre, so the first frame after a change is the same picture the CPU reference renders
  with one sample. The others follow the R2 low-discrepancy sequence (Roberts 2018), started at
  index 122: the first 16 points of the plain sequence have a mean 0.09 px away from the pixel
  centre, which shifts edges visibly; from index 122 the mean of 16 is under 0.012 px and the mean
  of 4 under 0.05 px. `tests/unit/progressive.test.ts` checks the spread (at most 2 samples per
  4×4 cell, at most 2 empty cells, minimum distance over 0.1 px).
- Each sample is one full-screen pass blended into the accumulation target with constant alpha
  1/(n+1), which keeps a running mean without a second "accumulate" pass or a ping-pong pair of
  targets. Blending is in linear light.
- The target is RGBA16F when `EXT_color_buffer_float` is present and an RGBA16F framebuffer is
  complete (the extension alone does not promise that on every driver). Otherwise it is
  SRGB8_ALPHA8: the hardware blends in linear light and stores sRGB, and the rounding error of each
  blend limits the useful count to 4 samples (`MAX_SAMPLES_8BIT`). The status line says so.
  `?accum=8` forces this path for testing.
- The display pass scales the target to the canvas (bilinear), encodes sRGB and adds a dither of
  ±0.5 of an 8-bit step from an integer hash of the pixel, which hides banding in the smooth fades.

### While moving

- Any change of the view or the content restarts the picture. For 120 ms after the last change
  (`HOLD_MS`, pointer events can skip frames) the view counts as moving: every frame draws one
  sample into a target at a reduced render scale, and the display pass scales it up.
- The moving scale lies in [0.5, 1] in steps of 1/8 (so the target is not reallocated for every
  small change). It drops by 15% after a frame interval over 22 ms (a missed 60 Hz refresh) and
  rises by 10% after 30 frames in a row under 18 ms. `?moving=0.5` fixes it, for testing.
- Once still, samples are added at full scale until there are 16, then nothing is drawn until the
  next change: an idle tab costs no GPU time.

### Anti-aliasing inside the shader

- Lines and colour boundaries are anti-aliased analytically from the distance to the nearest
  mirror in pixels (`lineCoverage`), so one sample already gives smooth edges; the samples then
  refine what the analytic coverage cannot see (corners, thin wedges, the fade).
- `asinh` in GLSL loses all precision near 0 on some drivers (it is computed as log(z + √(z²+1))).
  At the zoom-in limit the distance to a mirror is about 1e-5, and 5% of the pixels came out wrong.
  `sideDistance` uses the series z(1 − z²/6 (1 − 0.45 z²)) below 0.1, within float32 rounding there.
- Far tiles fade to the average colour of the colouring as the pixel footprint grows from 0.4 to
  1.2 times the tile's inradius, and are not folded at all past that: the boundary of the disk is
  smooth and cheap rather than an aliased mess.
- The edge of the picture (disk boundary, half-plane line) gets a soft 1-pixel transition to the
  background and a faint ring in the HUD accent colour (1.25 px, 40% opacity), computed from the
  exact edge distance in each view.

### Tests that gate this step

| Test | Pass rule | Result here |
| --- | --- | --- |
| Shader vs CPU reference, 26 cases, 4 views | ≥ 99.5% of pixels within 2/255 | 100% |
| Golden images, 28 scenes × 16 samples | ≥ 99.5% within 2, mean < 0.25, worst ≤ 48 | mean ≈ 0.01/255 |
| Refinement stops at 16 samples | no draws once complete | passes |
| Dither | at most 1 step from the undithered picture | passes |
| Moving frame at half scale | vs a half-size render scaled up, ≥ 99.5% within 3 | 100%, worst 1 |
| 8-bit accumulation (`?accum=8`) | 4 samples, ≥ 99.5% within 3 of the float path | 100% |

`npm run golden` rewrites the golden images; run it only after checking that a change of the
picture is intended, and look at the diff images in `test-results/golden/` first.

## Benchmark baseline

`npm run bench` opens `bench/index.html` in Chromium and times one sample pass per scene at 1920×1080
and 3840×2160: the median wall time of several passes, each synchronised by a 1-pixel read-back.
It also measures, on the CPU, the fraction of the screen inside the picture (pixels outside the
disk cost almost nothing) and the mean number of reflections and of sweeps over the three mirrors
per pixel inside it, which is what the shader's cost follows. Reports are saved as
`bench/results/<date>_<renderer>[_<tag>].json` (this baseline is the `_step6` file). A GPU timer
query (`EXT_disjoint_timer_query_webgl2`) would be more precise but is missing in most browsers;
the read-back sync is good enough for a baseline.

The numbers below are from SwiftShader, the software renderer of the test machine (no GPU), so only
the ratios between scenes mean anything, and repeated runs differ by up to 15%. The real baseline
comes from `npm run bench -- --headed` on a graphics card, which should be several hundred times
faster.

| Scene | 1080p ms/sample | 4K ms/sample | inside | reflections/px | sweeps/px |
| --- | ---: | ---: | ---: | ---: | ---: |
| Poincaré (7,3,2) | 282.6 | 964.5 | 40% | 11.7 | 6.1 |
| Klein (7,3,2) | 218.5 | 871.7 | 40% | 6.4 | 4.2 |
| half-plane (7,3,2) | 377.6 | 1752.1 | 100% | 7.7 | 4.8 |
| local (7,3,2) | 644.6 | 2277.8 | 100% | 14.4 | 7.2 |
| Poincaré (8,3,2) | 217.5 | 902.5 | 40% | 9.6 | 5.4 |
| Klein (8,3,2) | 202.0 | 876.9 | 40% | 5.6 | 3.9 |
| half-plane (8,3,2) | 386.0 | 1408.6 | 100% | 6.4 | 4.4 |
| local (8,3,2) | 505.5 | 1973.2 | 100% | 11.6 | 6.3 |
| Poincaré (2,3,7) | 264.9 | 1051.4 | 40% | 11.3 | 5.9 |
| Klein (2,3,7) | 194.0 | 835.3 | 40% | 5.9 | 3.9 |
| half-plane (2,3,7) | 371.9 | 1591.9 | 100% | 7.1 | 4.4 |
| local (2,3,7) | 522.9 | 2006.3 | 100% | 14.1 | 6.9 |
| Poincaré, 20 zooms toward the boundary (8,3,2) | 353.1 | 1313.3 | 97% | 3.8 | 3.1 |
| local, zoomed out to ℓ = 6 (7,3,2) | 245.1 | 1301.8 | 100% | 5.2 / 8.6 | 2.4 / 3.9 |

The counts are the same at both sizes except in the last row (1080p / 4K): at 4K the pixels are
smaller, so fewer far tiles fade out before they are folded.

What the baseline says:

- Cost follows the screen area inside the picture first and the fold work second. The disks at
  home fill 40% of a 16:9 screen; the half-plane and the local view fill all of it, which is why
  they cost more although the half-plane folds less per pixel than the Poincaré disk.
- There is a sizeable cost per inside pixel apart from the fold (the frame map, the colouring and
  the anti-aliasing): the near-boundary scene folds only 3.8 times per pixel but fills the screen,
  and costs about as much as the half-plane at home.
- The local view at home is the most expensive: it fills the screen and reaches far tiles while
  its pixels are still too fine for them to fade. The Klein disk is the cheapest, since its
  picture compresses the far tiles and they fade sooner.
- Deep zoom does not make a pixel more expensive: after re-centering the fold starts near the
  fundamental triangle.
- At 4K a sample costs about 4× the 1080p one, as the pixel count says: there is no fixed cost per
  pass worth optimising.

Open items for the benchmarks (design: "benchmark equivalent formulas later"): the real-GPU
baseline first, then the per-pixel cost apart from the fold (frame maps, Klein normalisation,
colouring) and a fold that tests the most likely mirror first.

## Step 7: colour

Planned before coding, as the working rule asks; the code follows it and the tests check it. What
changed while coding is folded in below and listed under "Changed while coding".

### Palettes

- `src/content/palettes.json` holds mandelscope's 24 cyclic gradients with their names and stops
  copied verbatim (MIT, credited in CREDITS.md), Psychedelic as mandelscope generates it
  (HSV with saturation 0.85 and value 1), and discrete sets for colourings: Gilded tiles (the five
  colours used until step 6, so the default look keeps every earlier picture), Escher (earth
  tones), Ink & paper and Neon tiles.
- Baking follows mandelscope's `make_palette` exactly: stops in sRGB, interpolated in OKLab with
  wrap-around, back to sRGB and clipped, at 256 entries. A unit test compares all 24 tables with
  values produced by mandelscope's own Python code (`tools/hp/palette_vectors.py`).
- The entries go to linear light and into a 256×1 RGBA16F texture with all 9 mip levels, each the
  mean of two entries of the level below, rounded to half floats on the CPU (uploaded as half
  floats, so the GPU does no rounding of its own). Sampling uses REPEAT and trilinear filtering at
  s = t + 0.5/256 with lod = log2(max(1, 256 w)), where w is how far the palette coordinate t moves
  across one pixel. Bands finer than a pixel therefore fade to their local mean instead of
  aliasing, and the CPU reference evaluates the same filter on the same half-float table.

### Colour sources

Each source gives a palette coordinate t (or class colours) and its change per pixel w. A look
sets the palette, the source, a phase φ (palette offset) and a density ρ.

| Source | Colour | w per pixel |
| --- | --- | --- |
| Colouring | class i of the k-colouring: set[(i + round(φ n)) mod n] for a discrete set, else palette(φ + i/k); anti-aliased across tile boundaries as now | — |
| Distance | t = φ + ρ d, d = asinh of the frame point's \|(x, y)\| (distance from the screen centre, exact near 0) | ρ ℓpx |
| Depth | walls between the pixel's triangle and the start triangle, smoothed (below) | ρ ℓpx / (d↓ + d↑) |
| Inside | t = φ + ρ dₑ / dₘₐₓ, dₑ the distance to the nearest edge side, dₘₐₓ its largest value in the triangle | ρ ℓpx / dₘₐₓ |

Depth counts walls from the centre of a start tile fixed in the plane. The view keeps an origin
matrix S that re-centering updates like the camera (S ← g S); the start point is s = S·P, the centre
of the tile that sat at the origin when the view went home. The CPU folds s once per frame and keeps
its wall count Nₛ. The shader folds s alongside the pixel's point: a reflection that also moves s
crosses a wall separating the start from the fundamental triangle. Walls through s (the p mirrors
through the tile centre) are left out, by a tolerance |⟨s, n⟩| ≤ 10⁻⁵ s_z + 10⁻⁶ (float32 rounding of
s, with a margin), because they cut the start tile into 2p triangles and would make the count
depend on which of them one starts from. So depth = crossed + Nₛ − 2·shared, counting only
reflections whose wall misses s: the number of walls between the pixel and the tile centre that do
not pass through it. It is an integer, unchanged by re-centering, and has the start tile's symmetry.
A unit test checks it against an independent count: the mean, over the 2p triangles around P, of
their wall distance to the pixel, minus p/2 (each wall through P separates the pixel from half of
those triangles).

Smoothing: in the folded triangle a side leads down when ⟨F s, nⱼ⟩ > tol, up when it is < −tol,
and sides through s are neutral. With d↓ and d↑ the distances to the nearest side leading down and
up, smooth = depth − ½ + d↓ / (d↓ + d↑), taken as depth + ½ when no side leads down (so the start
tile is a flat ½). Both sides of a wall between depth n and n + 1 give n + ½ on it, so
t = φ + ρ·smooth is continuous across every wall and needs no edge anti-aliasing. Past distance 10
from the camera the float32 sign tests on s get unreliable, so the start re-anchors to the tile at
the world's origin, which re-centering keeps near the camera (a single jump after a long trip; since
replaced by the move without a jump in "Depth on a long trip").

Tile (a hash of each tile's centre, for a mosaic look) moves to milestone 2 with motifs, which need
the same thing: a tile identity that survives re-centering. A hash of float coordinates measured
from the start speckles (one in about 10⁴ tiles hashes inconsistently from pixel to pixel), so it
needs an exact construction.

### Lines and shading

- Edge sides E: the sides with lines, or side 3 when none are drawn. dₑ = min over E of the
  distance to the side.
- Line width in plane units (thinning toward the boundary) or in pixels (w = width × ℓpx).
- Inner glow: γ = glow · exp(−dₑ / (0.15 dₘₐₓ)), mixing toward the line colour.
- Relief: a bevel of width b = 0.25 dₘₐₓ along the edge sides with slope h′ = k (1 − smoothstep(0,
  b, dₑ)), lit from azimuth α at 45° elevation:
  R = (sin 45° − h′ cos 45° (ĝ·L̂)) / (sin 45° √(1 + h′²)), where ĝ is the screen direction in
  which dₑ grows. ĝ comes from two tangent vectors (central differences of the frame map at ±1
  pixel) that are folded along with the point, so mirrored triangles light correctly.
- Order: fill × R, then glow, then lines, then the far-tile fade.

### Far-tile fade

The fade target is the area mean of the same pipeline over the triangle: before lines it is linear
in the fill f, mean = E[f R (1 − γ)] + glowColour·E[γ], computed on the CPU by quadrature over the
triangle in Klein coordinates (about 58 000 points, weighted by the area element). Averaged over
light directions the slope term of R cancels, leaving E[f (1 − γ) / √(1 + h′²)]. For Colouring and
Depth f is replaced by its mean; Inside integrates its palette directly; Distance multiplies its
own filtered fill by E[(1 − γ) / √(1 + h′²)] in the shader. Lines then cover the fraction
(w/2)·(length of the drawn sides)/area, or all of it when the width is in pixels (they stay a pixel
or more wide however small the tiles get).

### State and keys

Content gains the line unit; a new look state holds palette, source, φ, ρ, line colour, glow,
relief and light azimuth; the view gains the origin matrix. Until the HUD (step 9): L / Shift+L
next / previous look, K colouring, P palette.

### Order and tests

1. Palettes and baking: unit tests against mandelscope's values, mip means, half rounding, sampling.
2. Style → look refactor: the default look must reproduce all 28 golden images unchanged.
3. Palette texture and gradient colourings: GPU vs reference.
4. Distance and Inside, then Depth (unit: depth unchanged by re-centering on random walks, smooth t
   equal on both sides of walls), each with GPU vs reference cases.
5. Pixel-unit lines, glow, relief; then the averages.
6. Looks, keys, golden images for every look, interaction tests.

### Looks

| Look | Palette | Source | Lines and shading |
| --- | --- | --- | --- |
| Gilded (default) | Gilded tiles | colouring | gold lines; every picture of steps 1 to 6 unchanged |
| Escher | Escher | colouring | dark lines, relief 0.8, glow 0.15 |
| Ink | Ink & paper | colouring | dark lines |
| Porcelain | Porcelain | inside | navy lines, relief 0.6 |
| Midnight | Midnight | distance, 0.5 cycles per unit | glow 0.6 |
| Nebula | Nebula | depth, a cycle per 10 walls | glow 0.2 |
| Aurora | Aurora | depth, a cycle per 14 walls | |
| Ember | Ember | distance, 0.6 cycles per unit | |
| Glacier | Glacier | inside | white lines, relief 0.8 |
| Blueprint | Blueprint | colouring, phase 0.55 | glow 0.25 |
| Neon wire | Neon tiles | colouring, phase 5/6 (dark tiles in a 2-colouring) | cyan lines, glow 0.5 |
| Opal | Opal | inside, 0.75 cycles | relief 0.4 |
| Relief | Sand | inside, half a cycle | brown lines, relief 1 |
| Graphite | Graphite | depth, a cycle per 8 walls | relief 0.6 |

The tiling (group, colouring, drawn sides, line width) belongs to the preset; a look only changes
how it is coloured, so C keeps the look and L keeps the tiling.

### Changed while coding

- **Depth start.** The plan counted walls from the incentre of a start triangle. The rings came out
  lopsided, because a triangle has less symmetry than its tile, and the start tile itself spanned
  depths 0 to p (the walls through its centre cut it into 2p triangles). Counting from the tile centre P and leaving out the walls through P gives
  rings with the tile's full symmetry and a whole start tile at depth 0; the unit test checks it
  against the independent count described above.
- **Relief tangents** use central differences at ±1 pixel (the shader's pixel step in u), not ±½.
- **Drag release (input, found by the GPU suite).** A quick drag sometimes did not glide when the
  machine was busy. Browsers deliver one move per frame, and the release velocity was taken from
  the moves in the 50 ms before release: at about 35 fps the window often held a single move, so
  there was no velocity. It is now measured over the 50 ms before the last move, starting from the
  last move before that window, and a pointer that rested more than 80 ms before release still
  does not glide. A unit test drags at 144, 60, 35, 30, 20 and 15 fps with jittered timing and
  checks the glide speed within 10% of the pointer's; the old code fails it.
- **Benchmark.** Three look scenes were added (Escher, Nebula and Midnight in the half-plane, which
  fills the screen), and `--tag` keeps each step's results apart.


### Results

- **Palettes:** all 24 tables match mandelscope's own `make_palette` within 10⁻⁶ (its float32
  rounding); mip levels, half-float rounding and the CPU twin of the texture filter are unit-tested.
- **Depth:** equal to the independent count on 1000 random points; unchanged on 200 points along
  five random walks of 60 re-centred steps; continuous across 3000 random walls (smooth values
  within 10⁻⁴ on both sides).
- **Shader vs CPU reference:** the 8 new cases (gradient colouring, distance, depth after a walk,
  depth in the Klein disk, inside with glow in the half-plane, relief, relief with glow in the local
  view, pixel-unit lines) are 100% within 2/255.
- **Golden images:** 56 scenes (the 28 of step 6, pixel-identical to before, and each look in two
  views): at least 99.96% of pixels within 2/255, mean at most 0.036/255. The few pixels off by 4 to
  8/255 are all in relief looks on the 6,4 tiling, whose three drawn sides meet in bevel creases;
  most likely float32 and float64 pick a different nearest side right on a crease.
- **Tests:** 85 unit tests and 47 GPU tests pass; the GPU suite passed twice in a row after the
  drag-release fix.

Benchmark. The full run is in `bench/results/…_step7.json`, but this machine ran about 1.5× slower
than when the step 6 baseline was taken, so the comparison was redone as an A/B: the step 6 and
step 7 sources alternately, twice, on the same scenes at 1080p (ms per sample, run 1 / run 2).

| Scene | Step 6 | Step 7 |
| --- | --- | --- |
| Poincaré disk (7,3,2), default look | 430 / 436 | 433 / 431 |
| half-plane (7,3,2), default look | 610 / 695 | 599 / 651 |
| local view (7,3,2), default look | 829 / 908 | 946 / 945 |
| half-plane, Escher (relief and glow) | | 777 / 888 |
| half-plane, Nebula (depth and glow) | | 676 / 703 |
| half-plane, Midnight (distance) | | 524 / 431 |

The default look costs the same as at step 6 within the run-to-run noise (about ±10%; the local
view may be a few per cent slower). Relief costs about 1.3× (four more evaluations of the view map
and two tangents folded along), depth with glow about 1.1×, and the distance source is cheaper
than a colouring because it composes no colour permutations during the fold.

## Step 8 plan: unit grid

Written before coding. It refines the design document's Unit grid section where working out the
numbers showed a gap (the subdivided family far from the axis); the design document is updated to
match.

### Three grids, one shape

Each grid has an even coordinate E (lines at E = jΔ, a distance Δ apart) and a spreading
coordinate S whose lines are geodesics that spread apart by a factor f(E). Where they spread, the
S-lines are subdivided by powers of two so their spacing stays between Δ and 2Δ.

| Grid | E | S | Point of the hyperboloid at (S, E) | S-line spacing at E |
| --- | --- | --- | --- | --- |
| Cartesian (Fermi), default | Y, signed distance from the axis (the x axis at home) | X, arc length along the axis | (sinh X cosh Y, sinh Y, cosh X cosh Y) | ΔX cosh Y |
| Polar | r, distance from the centre (the home origin) | φ in turns (1 = full circle) | (sinh r cos 2πφ, sinh r sin 2πφ, cosh r) | 2π Δφ sinh r |
| Horocyclic | h = ln Im z, height toward the ideal point straight up at home | p = Re z, upper half-plane position | from z = p + i e^h | Δp e^(−h) |

Subdivision level at a pixel: L = log₂ of the spreading, m = ⌊L⌋. S-lines sit at S = i·Δ/2^m at
full strength and the in-between ones at Δ/2^(m+1) with opacity L − m, so lines fade in as they
appear (continuous in L). Cartesian: L = log₂ cosh Y (m ≥ 0). Horocyclic: L = −h / ln 2 (negative
above h = 0: lines merge going up, the same rule in reverse). Polar: rays at i/2^m turns with
L = log₂(2π sinh r / Δ), at least 4 rays (m ≥ 2) near the centre.

Distances to the lines, for anti-aliasing: |E − jΔ| for E-lines (equidistant curves, circles,
horocycles); for S-lines sinh d = cosh Y sinh |ΔX|, sinh r sin |2πΔφ| and e^(−h) |Δp|.

### Units and levels

A length unit u: one metre, so that the presets R = Earth's radius (6 371 000 m), R = 1 km and
R = 1 m read in m and km; or u = R for bare units. Levels are Δ_k = 10^k u, up to a top level
Δ_top = the largest power of ten not above 2R (10 000 km for Earth). Per pixel, with ℓ the plane
length per pixel, level k has weight a_k = clamp(log₁₀(Δ_k / 8ℓ), 0, 1): full at 80 px, gone at
8 px. Only the three finest levels with a_k > 0 are evaluated; coarser lines coincide with lines of
the third, so they are already drawn. Overlapping lines of several levels add up in opacity, which
makes coarse lines stronger without a separate style.

Style: 1 px lines, opacity 0.45 per level, toward white over dark colours and toward near-black over
light ones (by the luminance of the colour underneath), so the grid reads over every look. The
lines E = 0 and S = 0 (the axis and the line through home; the centre circle's rays at φ = 0; the
horocycle h = 0 and p = 0) use the HUD accent at full opacity.

### The grid camera and precision

The grid is fixed in the plane, so it cannot be re-centred with the tiling's symmetries. Each grid
keeps its own camera: the grid coordinates (S₀, E₀) of the screen-centre point and the angle θ from
the S direction to the screen's x axis. Every camera move is a right factor N (camera ← camera·N),
and the same N moves the grid cameras: the new centre is q = R(θ)·N·o in the old local frame, and
closed forms give ΔS, the new E and the new θ without large intermediate numbers. Cartesian, with
q′ = (x′, y′, t′), τ = tanh Y₀ and v the screen's x direction carried by N:
sinh Y₁ = sinh Y₀ t′ + cosh Y₀ y′, ΔX = atanh(x′ / (cosh Y₀ (t′ + τ y′))) and
θ₁ = atan2(v_y + τ v_t, v_x (t′ + τ y′) − τ v_y x′ − v_t x′). The tiling's re-centering does not
touch the grid cameras; H resets them. At the polar centre the angle is undefined, so there the
polar camera keeps φ₀ and folds the turn into θ.

The gap: far from the axis the S-lines are finely subdivided. At Y = 30 the level is m = 42, so
placing X-lines to a tenth of a pixel needs X₀ to about 2⁻⁴²⁻²⁰ of the top spacing, beyond float64.
So S₀ is kept exactly, as a BigInt fixed-point number of units with 256 fractional bits. That also
makes the design's "re-centering by the coarsest spacing" unnecessary, and labels keep absolute
values (polar turns wrap exactly at 1). E₀ stays float64 (at 1e−9 R per pixel and E = 30 it is
good to 10⁻¹⁵ R).

What the GPU gets, per frame, all of order 1:
- the rotation θ, τ = tanh E₀ and the scale factors of the local formulas;
- for each of up to 8 levels k: the E phase frac(E₀/Δ_k) and, for the S-lines, the bits of
  2^(m₀) S₀ / Δ_k at the camera's level m₀: its integer part mod 2³² (uint) and its fraction as a
  hi + lo float pair. A pixel at level m = m₀ + j gets its S phase from these bits: shifted right
  for j < 0 (down to j = −32), left for j > 0 (up to j = +30, still 18 bits for the line);
- the pixel adds its own offset from the camera, computed from the frame point relative to the
  screen centre (accurate to float32 relative precision at any zoom: t′ − 1 = |x′|²/(1 + t′)):
  ΔE by a cancellation-free formula (Cartesian: ΔY = 2 asinh(D / (2 cosh((Y₁ + Y₀)/2))),
  D = sinh Y₀ (t′ − 1) + cosh Y₀ y′; polar the same with cosh r; horocyclic Δh = −ln(t′ − y′)
  exactly) and 2^m ΔS / Δ_k, which is of the order of pixels per line.

Beyond |E₀| = 60 (cosh near the float32 range) the grid is not drawn and the status line says so.

### Content without a tiling, and deep zoom on the grid

A new content kind, Plain, draws a flat dark fill under the grid and no tiling (still re-centred
with a tiling's group on the CPU, which keeps the camera matrix small). The tiling's float32 fold
limits zoom to 10⁻⁵ R per pixel; the grid has no such limit, so with Plain content the zoom limit
is 10⁻¹¹ R per pixel (0.06 mm for Earth). This is the "Unit grid" preset, and what the 10⁻⁹ test
needs. Switching back to a tiling clamps the zoom to its limit.

### Labels

HTML labels where lines cross the left edge (E-lines) and the bottom edge (S-lines), 12 px inside.
The CPU samples the edge every 2 px in float64, finds where the grid coordinate passes a line of a
level with a_k = 1, and keeps a label only if it is at least 60 px from the previous one. Values
come from the exact S₀ and E₀: "250 m", "12.5 km", "1 250 km"; bare units "0.25 R"; polar rays in
degrees.

### State and keys

The view state gains the three grid cameras; the content state gains the grid type (none,
Cartesian, polar, horocyclic) and the unit (Earth, 1 km, 1 m, R). Until the HUD: G grid on or off,
T next grid type, U next size of R. The "Unit grid" preset (C) is Plain content with the Cartesian
grid in km.

### Order and tests

1. `math/grid.ts`: coordinates and closed forms, grid cameras and their moves, levels, phase data.
   Unit tests against 50-digit mpmath vectors (`tools/hp/grid_vectors.py`): coordinates, ΔE and ΔS
   at E₀ up to 60, moves along random walks against exact composition, opacity continuous across
   subdivision levels and across zoom levels.
2. Cartesian on the CPU reference and the GPU (`content/grid.glsl`), Plain content; GPU vs reference
   cases in every view, then the precision case: 10⁻⁹ R per pixel at Y = 30, lines within 0.1 px of
   the float64 reference.
3. Polar, then horocyclic, each with unit tests and GPU vs reference cases.
4. Labels: positions checked against the reference crossing, text formatting.
5. Keys, the preset, golden images with the grid, interaction tests (keys, labels follow a drag),
   benchmark scenes with the grid.

### Changed while coding

- **Level weights.** The plan gave each of the three evaluated levels its own weight
  clamp(log₁₀(Δ/8ℓ), 0, 1), so the finest two and the third at 1. When zooming moved the three
  levels on by one, the coarsest left the evaluated set while its lines were still drawn at full
  strength by it and by the level below, so every coarse line lost a layer of opacity at once. The
  weights are now a, 1 and 1 − a for the finest's a in (0, 1]: a level fades in at the fine end
  while the coarsest fades out, and the summed opacity of every line is continuous in ℓ (a unit test
  zooms through the levels in small steps; the old weights fail it).
- **Polar camera near the centre.** The plan kept φ₀ at the centre and folded the turn into θ.
  That was ill-conditioned close to the centre and wrong when the walk passed beside it. For r < 1
  the move now carries the frame across (θ + 2πφ is well-conditioned there), and the general
  formula takes over beyond. A walk straight through the centre is one of the test walks.
- **Polar ΔE.** The cancellation-free formula is used down to sinh((r + r₀)/2) = 10⁻¹⁵⁰ (planned
  10⁻³): below 10⁻³ the plain difference lost 2·10⁻¹⁴ of the distance at E₀ = 10⁻⁹.
- **Line distances in pixels.** The plan measured distances to lines in the plane and divided by ℓ.
  The Klein disk and the local view are not conformal, so lines grew to thick blobs toward their
  edges. In those two views each pixel now takes the rates of dE and of the offset term per pixel
  from the frame points one pixel to either side (central differences, on the GPU and in the CPU
  twin). The Poincaré disk and the half-plane are conformal, so there the plane's own rates are
  exact: |∇E| = 1 and |∇B| = cosh E₀ / cosh E (polar cosh r₀ / sinh r, horocyclic e^(h − h₀)),
  times ℓ. The first benchmark used central differences everywhere and showed the grid doubling
  the time per sample; the plane rates save four frame points and four offset terms per pixel.
  They changed four golden images only at the picture's rim (the last 3 px of the disk, the
  half-plane's bottom 2 rows), where the scale changes several-fold across a pixel, and in a ring of
  2 to 3 px around the polar centre, where the differences had misjudged the angle's rate. Lines
  are 1 px wide in every view. The lines E = 0 and S = 0 are 1.5 px at full opacity, and the polar
  centre is a 2.5 px dot.
- **Shader.** `shaders/grid.glsl` is compiled per grid (GRID 1, 2, 3); with the grid off it is
  empty, so the tiling programs are the step 7 ones plus a larger uniform block.
- **Test vectors** are computed at 100 digits, not 50.
- **Labels** needed more than the plan's "lines of a full-strength level, 60 px apart":
  - The full-strength level's lines are 80 to 800 px apart, so at some zooms only the zero lines
    were labelled. Labels now go on the finest lines drawn at strength 0.3 or more (a level's
    weight, times `half` for the in-between spreading lines), thinned to come 60 px or more apart:
    every 1st, 2nd, 5th or 10th even line, after Heckbert's nice numbers, and the spreading lines
    at a coarser subdivision. Labels come 60 to 200 px apart in a flat view at every zoom.
  - The label lines are the screen's edges 12 px in, moved in (keeping the aspect) until all four
    lie inside the picture where its scale is at most 6 times the centre's, and then each side
    pushed back out on its own. A zoomed-out disk gets a rectangle inside it, and the
    half-plane keeps its left labels at the screen's edge above its crowded boundary.
  - Which family goes to which edge is decided by how squarely each family's lines cross each edge,
    averaged along it, not at the screen centre: in the half-plane the Cartesian E-lines run along
    the left edge and touched it twice. Crossings at less than 30° are not labelled.
  - A polar centre on the screen, or up to half a screen beyond it, labels its circles along a
    radial axis where its horizontal crosses the label lines, toward the side with more room. Its
    rays go to the left and bottom edges, or to the right (top) edge when that is twice as far from
    the centre or more. The step's screenshots found this: a centre near the Klein disk's rim, just
    left of the label lines, had its rays grazing the near edges and no angle labelled at all. On
    the right edge the text ends left of the line.
  - Where the line spacing changes along an edge, labels are placed roundest value first (0, then
    multiples of the coarsest steps): greedy placement from the top lost the 0 line in the
    half-plane. Text boxes are measured with the HUD font, kept apart and on the screen.
  - The decimals are shared by an edge's labels in each display unit (what the rounded values need,
    trailing zeros dropped), so a series reads alike: 170.675 300 m next to 170.675 299 m, −135°
    next to −90°.
  - The status line moved to the top right until the HUD of step 9, out of the bottom labels' way.

### Results

- **Grid coordinates** against 100-digit values, E₀ up to 55 and distances 10⁻¹¹ to 0.5: worst
  relative error 2.2·10⁻¹⁶ for E, 4.2·10⁻¹⁵ for dE and 4.3·10⁻¹⁶ for the offset term.
- **Grid camera moves** along random walks against exact composition (deep zoom at E = 30, out to
  E = ±55, through the polar centre): position within 2.5·10⁻¹³, angle within 2.6·10⁻¹⁵.
- **Slot phases** frac(2^(m₀+j) S₀ / unit) for j from −32 to 30 against direct BigInt arithmetic:
  within 1.1·10⁻¹⁶ of a line spacing.
- **Lines at the precision case:** points placed exactly on lines (S₀ with 256 bits) at 10⁻⁹ and
  10⁻¹¹ R per pixel and E₀ up to 55 come out within 5.7·10⁻¹³ px of their line in float64 (the gate
  asked for 0.1 px). On the GPU, the 16 grid cases (every view, every grid, and Y = 30 at 10⁻⁹ R per
  pixel, the local view at Y = −55 and 1.2·10⁻¹¹, polar r = 30, horocyclic h = −30 and 55) match the
  CPU twin on 100% of pixels within 2/255, worst 1/255, so lines sit within about 0.01 px.
- **Golden images:** 62 scenes; the 56 of step 7 are pixel-identical, and the 6 new ones are the
  polar and horocyclic grids over tilings and the Unit grid in four views. All 62 match the shader
  within the golden test's limits.
- **Labels:** 56 unit tests check every label in 20 views: it sits on a drawn line of its level
  within 0.05 px, crosses it at 30° or more, reads the line's exact value (compared with BigInt
  arithmetic against E₀ and S₀, at Y = 30 and 10⁻⁹ R per pixel too), keeps 60 px from its
  neighbours, and no text overlaps or leaves the screen; in a flat view through a decade of zoom
  they come every first, second, fifth or tenth line; a polar centre at the lower left of every
  view has its rays on the right and top edges. Fifteen deliberate mistakes in `labels.ts` (a value
  off by one line, a decimal short, no thinning, no roundest-first order, families fixed to edges,
  rays kept on the near edges, the right edge's text not flipped, and others) are each caught; a
  sixteenth, no corner gap below the top edge, is not, since the overlap pass keeps text apart
  anyway.
- **Label cost:** 1 to 4 ms per view change at 1920 × 1080 (timed in Node, the same JavaScript
  engine as Chrome), within a frame, so labels follow every frame of a drag.
- **Interaction:** G, T and U switch the grid, its type and the size of R in the status line and
  the state, labels follow a drag to within a pixel, and the plain Unit grid zooms to 10⁻¹¹ R per
  pixel and back to 10⁻⁵ when a tiling returns.
- **Tests:** 151 unit tests and 66 GPU tests pass (step 7: 85 and 47).

Benchmark. The full run with the five new grid scenes is in `bench/results/…_step8.json`. This
machine ran about twice as fast as at step 7, so the comparison was again an A/B: the step 7 and
step 8 sources alternately, twice, at 1080p (ms per sample, run 1 / run 2).

| Scene | Step 7 | Step 8 |
| --- | --- | --- |
| Poincaré disk (7,3,2), default look | 273 / 276 | 301 / 235 |
| half-plane (7,3,2), default look | 429 / 449 | 429 / 437 |
| local view (7,3,2), default look | 769 / 642 | 529 / 564 |
| half-plane, Escher | 626 / 571 | 674 / 575 |
| half-plane, Nebula | 420 / 499 | 569 / 516 |
| half-plane, Midnight | 244 / 312 | 280 / 282 |
| half-plane (7,3,2) + Cartesian grid | | 675 / 661 |
| Poincaré disk (7,3,2) + polar grid | | 465 / 518 |
| Klein disk (7,3,2) + Cartesian grid | | 567 / 548 |
| Unit grid alone, half-plane, 10⁻⁹ R per pixel | | 191 / 166 |
| Unit grid alone, local view, 10⁻⁹ R per pixel | | 378 / 369 |

With the grid off the cost is unchanged within this machine's noise, which was larger this time
(±15% between runs of the same source). The grid adds about half the cost of a tiling in the
conformal views, 180 ms here at 1080p; in the Klein disk and the local view, which take the four
neighbouring points for the line widths, about twice that. Before the plane rates the half-plane
grid cost as much as the tiling (695 against 347 ms in the full run).

A larger saving is left for step 10: the grid is drawn in every one of the 16 samples, although its
lines are anti-aliased analytically. Drawn once, over the accumulated picture in the display pass,
a still picture's grid would cost a sixteenth (it needs the colour underneath, which the display
pass has). The Klein and local line widths could also come from the frame map's Jacobian instead of
four offset terms.

## Step 9 plan: interface, state, links, presets, screenshots

Written before coding. It turns the design document's Interface and State sections into the parts
built here, in the order they are built, each with its tests before the next starts.

### One saved state

Everything on the screen comes from the store's state: the view (picture, camera, colour
permutation, start tile, the three grid cameras), the content (tiling, colouring, sides, lines,
look, plain, grid) and the interface settings (accent). `src/state/saved.ts` turns it into one
versioned object and back:

```
{ v: 1,
  view:    { picture: { model: "poincare", c: [re, im], sigma, s } | { model: "halfplane", mu } | …,
             camera: [9 numbers], perm: [..], origin: [9 numbers],
             grids: { cartesian: ["<S0 · 2^256 as a decimal string>", E0, θ], polar: [..], horocyclic: [..] } },
  content: { group: [7, 3, 2], colouring: "parity", sides: [0, 0, 1], lineWidth, lineUnit,
             look: { palette, source, phase, density, lineColour, glow, relief, light }, plain, grid },
  ui:      { accent: "ice" } }
```

JSON keeps every float64 exactly (JavaScript prints the shortest digits that read back to the same
number), so this form is bit exact. It is used for the saved session, presets and the text chunk
inside a screenshot. Reading checks every field (types, ranges, a hyperbolic group, a colouring that
fits, a Lorentz camera) and returns the state or the reason it was refused; it never throws.

The link is shorter: readable keys for the settings and base64url of the float64 values for the
camera, e.g. `#v=1&m=pd&g=7,3,2&k=parity&sd=001&lw=0.03&look=Gilded&cam=…`. A look that differs
from its named one adds only the fields that differ (`pal`, `src`, `ph`, `dn`, `lc`, `gw`, `rl`,
`li`). The start tile, permutation and grid cameras are written only when they differ from home; a
grid camera is its S0 as signed big-endian bytes followed by E0 and θ. A newer version number than
the app knows is refused with "made by a newer Hyperscope"; each older version gets a migration
function, and a test keeps a literal version 1 link that must keep loading.

### History, saved session, the address bar, the clipboard

- History holds views, not settings: an entry is pushed when the view has rested 400 ms after a
  change, and before every jump (home, model switch, preset, loading a link); 200 entries.
  Backspace goes back, Shift+Backspace forward, and the chip has both buttons. A view whose
  colour permutation does not fit the current colouring restarts it, as re-centering already does.
- The session (the saved state) goes to localStorage a second after the last change and when the
  page is hidden. Start-up takes the link if there is one, else the saved session, else home. All
  storage access sits in try/catch, so a private window simply starts at home.
- The address bar follows the state with `history.replaceState` at most every 300 ms, so the
  browser's own history is not flooded. Editing the address (hashchange) loads that state.
- Ctrl+C copies the link (unless text is selected or a field has focus), Ctrl+V loads a link
  pasted from anywhere. A short glass note at the bottom says what happened.

### HUD

Plain DOM and CSS, no framework: `src/ui/hud.ts` builds it and updates only what changed. The
status line of steps 4 to 8 goes; its information moves into the corners.

| Corner | Content |
| --- | --- |
| Top left | HYPERSCOPE, then the preset and the view ({7,3} HEPTAGONS · POINCARÉ DISK, the grid when on), then REFINING 4/16 with a 1 px progress line (and 8-BIT when float targets are missing) |
| Top right | icon row: home, back, forward · four view segments with small drawn pictograms · presets · grid · screenshot · settings · help |
| Under it | the settings card, 320 px, tabs TILING, LOOK, VIEW, closed at start |
| Bottom left | DISTANCE 12.4 R · 79 000 km, then MAGNIFICATION and 10^2.49 in 40 px light mono with an 18 px exponent |
| Bottom right | 60 FPS · 1920×1080 · 16/16 |

Readouts. Magnification is the plane length per unit of the screen at its centre in the Poincaré
home view over the current one (the design: one plane unit's screen size against home), so it reads
10^0.00 at home and does not change when the view model changes; the other views' own home views
read their scale against it (the Klein home shows 10^0.30, the half-plane home 10^0.32). The
distance is the polar grid camera's r, the exact distance from the start point, which re-centering
never touches. The design's FOLDS counter is dropped: the centre point is always folded into the
first triangle by re-centering, so its count is always zero, and a per-pixel mean needs a GPU
read-back the HUD should not pay for.

Fonts and icons are bundled for offline use: Inter 400 and 600 and JetBrains Mono 300 and 400 (OFL,
from Fontsource, the Latin subset as WOFF2 only) and eight Font Awesome 6 Free solid icons as inline
SVG paths (CC BY 4.0); the view pictograms are drawn here. Licences go into
`THIRD_PARTY_NOTICES.md`. The build grows by about 120 kB.

Behaviour as in the design: after 2.5 s without pointer movement or a key, the icon row and the
card fade out over 400 ms and the corner readouts dim to 50%, except while the pointer is over a
HUD element or a field has focus. Tab hides the HUD and the labels, F toggles full screen, F1 (or
the help icon) shows the controls, Esc closes help and the card. Below 700 px width the card is a
bottom sheet. Every control is a real button or input with an accent focus ring and a tooltip with
its key. Accent colours: ice #8FD3FF, gold #F2C14E, coral #FF8A7A, lime #B8F06A, lilac #C9A8FF; the
picture's edge ring and the grid's zero lines take the accent too.

### Settings card

- TILING: p, q and r steppers (2 to 20) with a live check, applied only when 1/p + 1/q + 1/r < 1,
  otherwise greyed with the reason (spherical or Euclidean); the tiling presets {7,3}, {3,7}, {5,4},
  {4,5}, {8,3}, {6,4}, (2,3,7), (3,3,4); which lines to draw (tile edges, centre to vertices, centre
  to edge midpoints: mirrors 3, 1 and 2); line width (log slider) in plane units or pixels; the
  colouring list of the group.
- LOOK: the 14 looks as small live previews of the current view (96 × 64, 2 samples each, rendered
  when the tab opens and when the view rests while it is open); palettes as colour strips; colour
  source; line colour; glow; relief and light angle; phase; density; HUD accent.
- VIEW: the four views; distance; position X and Y (Fermi coordinates, in R) and rotation in
  degrees, editable, which set the Cartesian grid camera exactly and move the camera there;
  magnification, editable; grid on, type and size of R; Home and Copy link; screenshot size.

### Presets

`src/content/presets.json`: named partial states (content, look name, view model) with a 96 × 96
PNG thumbnail made by `tools/thumbnails.ts` from the CPU reference renderer: Heptagons {7,3},
Pentagons {5,4}, Three colours {6,4} (angels and devils like), Octagons {8,3} (fish like), Squares
{4,5}, Triangles {3,7}, (2,3,7) triangles, (3,3,4) triangles, Unit grid in km. The presets icon
opens a gallery of them and of your own presets: "Save current" stores the full state with a
thumbnail rendered on the GPU in localStorage; export writes them all to a JSON file, and a JSON
file opened or dropped on the window imports them. C and Shift+C step through the built-in ones.

### Screenshot

F12 (where the browser lets the page have it) or Ctrl+S or the camera icon: the view rendered off
screen at the chosen size (the screen, 2× or 4× it, 1920 × 1080, 3840 × 2160 or 7680 × 4320, at
most 8192 on a side) with the full sample count, in tiles no larger than the GPU allows (the tile's
offset rides on the sample offset, so the shader is unchanged). The grid's labels are drawn on top
at the same scale as on the screen. The PNG gets an iTXt chunk `hyperscope` (UTF-8, so names
like Poincaré survive) with the saved state;
dropping such a PNG on the window restores its view, as mandelscope does with locations.

### Tests that gate this step

Unit: saved state and link round trips bit exact over 1000 random views (all models, grid cameras
with S0 beyond 2^64, random permutations) and malformed input refused without throwing; the
literal version 1 link; the PNG chunk written and read back, with the image still decoding in
Node's zlib; magnification 1 at home in every view and 2 after a 2× zoom; position fields setting
the Cartesian grid camera within 10⁻¹²; every preset builds and its thumbnail is a 96 × 96 PNG; the
tiling check.

Interaction (Playwright): the corners show the preset and view; view segments and keys switch the
view; the HUD fades after 2.5 s, comes back on movement, Tab hides and shows it; the card's
steppers, looks and fields change the state; a link opened in a new page restores the camera bit
for bit; a reload restores the session; back and forward; Ctrl+C and Ctrl+V; a screenshot downloads
a PNG of the right size whose chunk holds the state, and dropping it on a fresh page restores the
view; the bottom sheet at 600 px; help opens and Esc closes it. The golden images must not change,
and the render loop must stay idle when nothing moves.

Then the gate the design names: your review of the look and feel.

### As built: the HUD shell

- `src/ui/hud.ts` and `hud.css` replace the status line. Top left: HYPERSCOPE, the title (preset,
  view, and the grid with its size of R when it is on), which wraps only between its parts, then
  the refine line (REFINING 4/16 and a 1 px line in the accent; 8-BIT ACCUMULATION, 4 SAMPLES stays
  when float targets are missing). Bottom left: DISTANCE in R and in metres, MAGNIFICATION 10^k.
  Bottom right: frame rate, canvas size in device pixels, samples. The frame rate reads IDLE as
  soon as the render loop stops, which shows at a glance that a still picture costs nothing.
- The readouts are text with a dark halo, not glass panels, so the picture shows through; the halo
  keeps them readable over light looks (Ink, Porcelain). Glass is for the chrome, help and notes.
- The grid's labels keep out of the readouts: `gridLabels` takes boxes to avoid, and the HUD
  reports its readouts' boxes (6 px larger), refreshed when a readout changes size. The fields of
  the bottom right readout have fixed widths, so the count of samples does not move the labels.
- Keys L, P, K, T and U (and the design's . and , for the looks) show what they chose in a note at
  the bottom (Look: Escher), since the status line that named it is gone.
- Fade: a single timer, no animation loop. It waits while the help is open, the pointer is over
  the chrome or a control has keyboard focus. Tab hides everything but the notes, unless you are
  moving between controls with the keyboard; a note says how to bring it back.
- Fonts arrive through the FontFace API from `?url` imports, which the single-file build inlines:
  the page grows from 81 kB to 216 kB. Labels are measured again once they have loaded.
- Tests: 8 browser tests in `tests/gpu/hud.spec.ts` (corners, refining, fade, idle loop, Tab, help,
  labels clear of the readouts, accent) and unit tests for the readouts and the keep-out boxes; the
  label-drag test now matches labels on their own edge (the same value can sit on both).

### As built: the icon row and the settings card

- The icon row (`src/ui/toolbar.ts`): home, back and forward, the four views with their drawn
  pictograms, the unit grid, settings and help. Back and forward stay disabled until the history
  of views exists (next sub-step); the presets and screenshot icons come with their sub-steps.
  Each tooltip names the key (Half-plane · 3).
- The card (`src/ui/card.ts`, controls in `src/ui/widgets.ts`) reads the state when it refreshes
  and writes every change back through its host in `main.ts`. A slider sends many changes per
  frame, so content changes are applied once per animation frame, and the card reads the pending
  state, so two quick edits never lose one.
- TILING. A group that is not hyperbolic is kept as a draft: the three steppers turn red, the note
  gives the reason (1/3 + 1/4 + 1/2 > 1: a spherical tiling, not hyperbolic) and the picture stays,
  so you can step through spherical or Euclidean groups on the way to another hyperbolic one. The
  next change starts from the draft. A new group keeps its colouring when it fits (faces when it is
  valid there), else parity. With the tiling off the title reads "No tiling" (the Unit grid preset
  keeps its name). Switching the width's unit resets the width (0.03 in the plane, 1.5 px), since a
  number in one unit means nothing in the other. The colourings of a group are searched once.
- LOOK. The previews are 96 × 64 CSS pixels (at up to 2× the device pixel ratio), 2 samples, drawn
  two per task with a generation counter so that a newer request drops an older one. They are drawn
  when the tab opens and when the view has rested 400 ms with something new to show (the key is
  the saved view, the content without its look, and the accent). They render into their own target;
  a test checks the main picture is bit for bit the same after all 14 are drawn. The look marked is
  the one you chose last, while it is unchanged. The looks and palettes fill the card's width: three
  previews to a row on the 320 px card, six in the bottom sheet.
- VIEW. X is read exactly into the grid camera's 256-bit fixed point, however many digits you type;
  Y (a float64 in the grid camera) and the rotation as numbers. A field takes its text on Enter or
  when you leave it; refused text stays, marked, with the reason in its tooltip (Not a number,
  At most 1 000 R from the start, The zoom stops at 10^k here), and Esc puts the value back. The
  decimals follow the zoom (a tenth of a pixel, 3 to 18; Y no more than a float64 holds). The
  magnification zooms about the centre and says where a limit stopped it. Screenshot size comes with
  the screenshots.
- Keys: Esc does one thing at a time (leave the field, else close the help, else the card); Tab moves
  through the open card instead of hiding the HUD; keys typed into a field never reach the view. The
  accent is applied as soon as it changes, not on the next frame.
- Narrow screens: below 700 px the card is a sheet along the bottom, at most 58% of the height;
  below 560 px the title moves under the icon row.
- Tests: 11 browser tests in `tests/gpu/card.spec.ts`: open and close, the fade with the pointer
  over the card or not, the steppers and their reasons, chips and switches and the width and the
  colouring, the previews (and the picture left alone), the accent (only the rim's pixels change),
  the exact position fields with refused input and the magnification, keys in fields and Tab, the
  grid controls and Copy link read back with `fromLink`, the icon row, and the bottom sheet. A
  mutation check: without the final exact write of the grid camera, the X test fails (the walk
  alone lands within float64 rounding, not exactly).

### As built: history, session, the address bar and the clipboard

- `src/state/history.ts` is pure: a view is recorded when it has rested 400 ms and before every jump
  (home, another view model, a preset, a typed place or magnification, a link), at most 200. Back
  first records a view that has not rested yet, so it always returns to the last place you stopped;
  a move after going back drops the views ahead, as a browser does. Backspace and Shift+Backspace,
  and the icon row's arrows, which are enabled only when there is somewhere to go.
- Views are compared by their saved form, so "the same view" means bit for bit. Two changes keep
  views bit for bit where they used to be re-orthonormalised for nothing: a change of look, lines or
  grid leaves the camera alone (only a new tiling or a zoom limit re-centres it), and going back to
  a view restores it as it was unless the tiling changed since.
- The saved form writes its fields in one order (the picture's model first, the look's fields in
  their declared order), so equal states save to equal text; the tests compare states as text.
- Session: localStorage `hyperscope.session`, a second after the last change and when the page is
  hidden; every access sits in try/catch. Start-up: the link in the address, else the session, else
  home. A link that cannot be read gives a note with the reason (Link not loaded: made by a newer
  Hyperscope (version 99)) and the session instead.
- The address bar holds the link to the view, replaced in place at most every 300 ms (no browser
  history entries); a hash typed or pasted into it loads that view, as a jump.
- Ctrl+C copies the link unless text is selected or a field has the focus. A browser sends no copy
  event without a selection, so this listens for the key itself and copies through the clipboard
  API (with the selected text area fallback). Ctrl+V uses the paste event, which needs no
  permission: a link or a saved state as JSON loads, anything else gives a note. In a field both
  keys are the field's. Found while testing: the view keys took Ctrl+C as C and stepped the preset;
  the view keys now ignore any key held with Ctrl or Cmd.
- Names: a tiling is named by its tiles ({7,4} heptagons, {13,3} 13-gons, (2,3,7) triangles);
  content that is exactly a preset gets the preset's name back, which a loaded link needs since the
  saved state has no name; with the tiling off it is Unit grid or No tiling.
- Tests: 5 unit tests for the history, 4 for the names, and 6 browser tests in
  `tests/gpu/state.spec.ts`: back and forward with buttons and keys (bit for bit, the views ahead
  dropped, settings kept), a link in a new page and a fresh browser (bit for bit), reload and the
  refused link, no storage at all, the address bar (no history entries; editing it loads), and
  Ctrl+C / Ctrl+V including JSON, junk and fields.

### As built: presets

- The built-in presets stay in `src/content/scene.ts`, each with the look the gallery shows it in
  and, where it matters, a view; (3,3,4) triangles is added (Aurora), so all nine of the design are
  there, and its four golden images were written alone (`npm run golden -- 3_3_4`) with every other
  golden file checked byte for byte unchanged.
- Changed from the plan: the pictures are drawn on the GPU when the gallery opens (96 px, 2
  samples, two per task, as the look previews), not made by `tools/thumbnails.ts` into
  `presets.json`. Nine PNGs would have added about 150 kB to a 250 kB page, and drawn pictures
  always match the renderer, the accent and the grid. So there is no `presets.json` and no
  thumbnails tool.
- The presets icon sits between the views and the grid; the gallery takes the card's place under
  the icon row (one panel at a time, Esc closes it, a bottom sheet below 700 px). A built-in preset
  opens whole: its tiling, colouring and look, at home in the view on the screen, as a jump (Back
  returns). C and Shift+C still step through the presets' tilings and keep your look and place,
  as the earlier steps' tests require.
- Yours: Save keeps the full saved state with a 192 px picture of the screen's centre square (WebP
  where the browser writes it, else PNG), under the typed name or the title. They live in
  localStorage `hyperscope.presets`; × asks "Delete?" and deletes on a second click within 3 s.
  Export writes `hyperscope-presets.json` ({ hyperscope: "presets", v: 1, presets }); Import, a
  drop on the window or Ctrl+V reads it back, adding only presets not already there and saying how
  many were refused and why. A saved state as JSON dropped or pasted opens instead. Pictures read
  from a file must be small image data URLs or they are dropped.
- Tests: 5 unit tests (`presets.test.ts`) and 3 browser tests (`presets.spec.ts`): the pictures
  drawn and a preset opened whole and undone with Back, the card and gallery taking turns; your
  presets saved, opened, kept across a reload and deleted; export, import with a refused preset,
  a repeated import adding nothing, a dropped saved state and a dropped junk file.

### As built: screenshots

- Ctrl+S, F12 (where the browser lets the page have it) or the camera icon. The size is chosen in
  the VIEW tab (the screen, 2× or 4× it, 1920 × 1080, 3840 × 2160, 7680 × 4320, at most 8192 on a
  side) and kept on this device (`hyperscope.shot`), apart from the saved state, so a link or a
  preset never changes it.
- `Renderer.renderPixels` takes a tile: its sample offsets move by the tile's place in the picture
  (right by x, and down by its distance from the bottom, since GL counts rows from there), and the
  frame keeps the whole picture's size, so the shader is unchanged. Tiles are at most 2048 px (or
  what the GPU allows) so no single draw runs long; the page gets a breath between them and a note
  counts the parts. The state is taken when the shot starts, so moving meanwhile changes nothing.
- The grid's labels are laid out as on a screen of this one's CSS height and the shot's shape, then
  scaled up with the picture and drawn with the same halo; they do not avoid the readouts, which
  are not in the picture.
- The browser writes the PNG (`toBlob`); `src/state/pngtext.ts` then puts an uncompressed iTXt chunk
  `hyperscope` with the saved state right after the header. A PNG dropped on the window is read
  from that chunk: "The view of hyperscope-7-3-heptagons-640x480.png loaded", or a note that it
  holds none. File names are `hyperscope-<title>-<W>x<H>.png`.
- The icon row now has 12 buttons (380 px): the title sits beside it down to 600 px wide, under it
  below that, and below 440 px the row takes two lines with the title under both.
- Tests: 4 unit tests (sizes, tiles covering each pixel once, the text chunk read back in UTF-8 with
  the image still decoding, tEXt and junk), 4 browser tests (Ctrl+S at the screen's size, equal to
  the screen within the dither and carrying the state, which a drop restores bit for bit; four
  uneven tiles equal to one whole picture in three views; a shot in 200 px parts equal to one made
  whole; the size chosen in the card and the camera icon, with the labels' near-white pixels where
  the screen shows its labels). Mutation check: the tile test fails if the tile's offset is not
  counted from the bottom.

## Step 10 plan: benchmark A/B runs, design notes, credits, the final build

Written before coding. The design lists six pairs of equivalent formulas to compare, and step 8
left two more; each is built as an experiment, checked to draw the same picture, timed against the
current code, and kept only if it wins. Then the notes, credits and README are brought up to date
and the single-file build is made.

### How an experiment is built

The production chunks stay as they are. An experiment (`bench/experiments.ts`) rewrites the
assembled chunks of a program with text patches, each of which must match exactly once (so an
experiment fails loudly when the code under it changes instead of silently measuring something
else), or replaces a chunk. `assemble` takes the rewrite as an optional argument and the renderer
an optional experiment, which is part of its program cache key; the app never sets one. The
design's pairs and the two from step 8:

| Experiment | A (now) | B | Scenes |
| --- | --- | --- | --- |
| fold | sweeps over the three mirrors | the dihedral step: turn the point into the wedge at P by its angle (one `atan`), then one test of mirror 3, repeated | inside source, so only the folded point is needed; colourings would follow if B wins |
| reflection | `if (d > 0)` | branch free: `x -= 2 max(d, 0) n`, the permutation composed always and selected | default looks |
| geometry | hyperboloid vectors | the Poincaré disk point w and circle inversions in the mirrors' circles (centre n.xy / n.z, radius 1 / n.z; lines when n.z = 0), back to the hyperboloid once for the distances | default looks, near the boundary |
| footprint | the frame map's analytic scale | `dFdx` / `dFdy` of the frame point, its Minkowski length | all views |
| programs | one program per view, content, colour source, relief and grid | one program for every colour source and relief, chosen by a uniform | default and Escher looks; compile time too |
| colourings | permutations packed 3 bits a colour in a uint | arrays of 8 ints, composed by indexing | default looks |
| grid rates (Klein, local) | central differences: four more frame points and offset terms | the frame map's Jacobian (closed form per view) times the grid coordinates' gradients (closed form per grid) | Klein + Cartesian, local + polar, Klein + horocyclic |
| grid pass | the grid in each of the 16 samples | samples without the grid, the grid once in the display pass over the accumulated picture | a still picture to 16 samples, and a moving frame at half scale |

### Equivalence and timing

- Each B is first compared with A on the same scenes at 640 × 360 with 4 samples: at least 99.5% of
  pixels within 2 levels and the worst within 48, the golden images' rule. Where it fails, both are
  compared with the CPU reference (float64), and B still counts as equivalent if it is at least as
  close to it as A. A B that is not equivalent is timed anyway, for the record, but not adopted.
- Timing alternates A and B (ABBA, 4 rounds) on one page at 1920 × 1080, so drift of the machine
  falls on both. A round times a batch of sample passes closed by one 1-pixel read-back, batched to
  at least 50 ms, so on a fast GPU the read-back's own cost does not count. The report gives each
  arm's median ms per sample pass and B / A with the spread of the four rounds.
- Rule: B is adopted only if it is at least 10% faster on a graphics card in every scene it applies
  to (or faster where it matters and no slower elsewhere) and passes the equivalence check;
  otherwise the simpler of the two stays. Software-renderer numbers are recorded but decide nothing
  on their own.
- `npm run ab` runs it headless here; `npm run ab -- --headed --channel msedge` (or `chrome`) runs it
  on a graphics card in the browser already installed, so no Chromium download is needed. The same
  `--channel` goes to `npm run bench`. Reports go to `bench/results/<date>_<renderer>_ab.json` and a
  readable `.txt` beside it.

### The real-GPU run

On your PC through a Remote Control session (you approve one prompt): `npm install` if needed, then
`npm run bench -- --headed --channel msedge --tag step10` (the baseline the step 6 notes asked for)
and `npm run ab -- --headed --channel msedge`. The reports come back here and go into these notes.

### Then

- Adopt the winners in the production chunks, with the CPU reference changed alike where the
  picture depends on it (only the grid pass could), golden images re-checked (they must stay
  within their rule; re-made only for an intended change, after looking at the diffs), and every
  suite run.
- Design notes: a Step 10 section with the A/B table and decisions, the GPU baseline next to the
  software one, and a short "state of version 1" summary at the top of this file.
- Credits: check every row of the design's credits table against `CREDITS.md` and the comments in
  the code; add the formulas adopted here if they have an origin.
- README: step 10 of 10, `npm run ab`, the `--channel` option.
- `dist/hyperscope.html` built, opened from disk by the smoke test, and copied to your folder.

Gate: all suites green, the benchmark report, your sign-off.

### Results

Both runs are in `bench/results/`: on this machine's software renderer (SwiftShader) and on your
PC's NVIDIA GeForce RTX 5060 Ti (driver 32.0.16.1742, Edge, Direct3D 11 through ANGLE), each
`…_ab.json` with a readable `.txt` beside it. B / A is the median of four rounds (below 1: B is
faster); the spread of the rounds is in the files.

| Experiment | Scenes | Equivalent | B / A, RTX 5060 Ti | B / A, SwiftShader | Decision |
| --- | --- | --- | --- | --- | --- |
| fold: dihedral step | 4, inside source | on the GPU yes (99.84–100%); in software 3 of 4 just miss (99.1%) | 0.93–1.00 | 0.65–0.78 | kept the sweeps: under 10% on a graphics card, and only for one colour source |
| reflection without a branch | 5 | yes, identical | 1.11–1.61 | 0.87–1.17 | kept the branch |
| geometry in the Poincaré disk | 4 | yes | 1.19–1.27 | 0.89–1.14 | kept the hyperboloid |
| footprint from derivatives | 4 views | no: 84.6–98.5% within 2 of A, and further from the CPU reference | 1.01–2.06 | 0.88–1.22 | kept the analytic scale |
| one program for all looks | 3, and compiling | yes, identical | 1.04–1.09 per sample; compiling 6 variants 30 ms instead of 334 ms | 2.4–3.4 | kept a program per look: the compile is paid once, the sample on every frame |
| colourings as int arrays | 3 | yes, identical | 1.89–2.41 | 1.43–1.75 | kept the packed permutations |
| grid rates from the Jacobian (Klein, local) | 3 | yes after the change below | 0.76–0.88 | 0.84–0.97 | **adopted** |
| grid drawn once over the samples | 4, still and moving | looks the same; 95.7–98.2% within 2 (the lines' soft edge, see below) | still picture 0.20–0.78; moving frame 1.77–3.48 | still 0.14–0.78; moving 1.64–3.22 | **adopted for still pictures**, per sample while moving |

The current formulas were the faster ones almost everywhere: the GPU's branches on a pixel's own
data cost less than doing both sides, the hyperboloid's dot products are cheaper than circle
inversions, and a uint of packed bits beats an array that has to live in registers or memory.
Software rendering often ranked them the other way, which is why it decides nothing.

**Grid rates from the Jacobian.** The Klein and local views are not conformal, so a line's width in
pixels needs the frame point's change across the pixel. Step 8 took it from central differences:
four more frame points and offset terms. Now it is the frame map's Jacobian in closed form per view
(`frameJacobian`, Klein (d + x⟨x, d⟩) / n) times the grid coordinates' gradients in closed form per
grid, 12–24% faster on the GPU. In the A/B the Klein scenes missed the golden rule by 0.1% of
pixels, all at the disk's rim, where the central differences straddle the rim and the closed form is
right; the CPU reference used the same central differences, so "closer to the reference" only
measured agreement with the old approximation. The CPU reference now uses the closed form too,
the shader matches it on 100% of pixels, and the one golden image affected (`unit_grid_klein`)
changed at the rim only. Written directly, cosh and sinh of the grid's E overflowed float32 at
E₀ = −55 in the local view; they are taken as ratios (`coshRatio`, `coshOverSinh`), which stay
finite at any E₀.

**Grid drawn once.** The grid's lines are anti-aliased analytically, so drawing them in all 16
samples repeats work. A target as large as the canvas now holds the samples without the grid, and
the display pass draws it once over their mean, at the pixel's centre, inside the picture's edge
and under the accent ring (`display.frag`, one display program per view and grid). The samples'
jitter spreads each line over half a pixel either side, so drawn once a line takes its coverage
under a tent of half-width one pixel instead of a box (`gridCoverage`, `tentCoverage`); it keeps
the line's ink (unit tested) and looks as soft as before, which is why 2–4% of pixels differ by a
few levels along the lines. A finished still picture with the grid is 1.3–5× faster on the RTX
5060 Ti (5× for the plain Unit grid). A moving frame has a single sample at reduced scale, and the
display pass runs at full size, so there drawing once is 1.8–3.5× slower: frames smaller than the
canvas keep the grid in every sample. Screenshots and thumbnails always draw it once. The CPU
reference does the same (`renderView`, or with `gridPerSample` as main.frag), and every grid case of
the shader-against-reference test runs both ways.

Changed while coding:

- The grid's line colour switched from white to near-black at a luminance of 0.25. Drawn once over
  a single mean, a pixel whose colour sat at 0.24 flipped between them on the rounding of float16
  against float64. The switch is now a blend over 0.25 ± 0.03 (`DARK_BAND`), in both renderers.
- `npm run ab -- --only …` writes `…_ab_<names>.json`, so a partial run no longer overwrites a full
  one of the same day.

GPU baseline, `npm run bench` on the RTX 5060 Ti (`…_step10.json`): one sample pass takes 0.3–0.6 ms
at 1920 × 1080 and 0.6–1.3 ms at 3840 × 2160 in every scene, so a still picture's 16 samples finish
within 21 ms even at 4K. Software rendering here takes 170–770 ms a sample at 1080p (step 8 above),
about a thousand times longer. These baseline numbers are coarse (the timer reads in steps of
0.1 ms, and each pass ends in a read-back); the A/B timings, batched to 50 ms, are the precise ones.

Tests: 239 unit tests and 114 GPU tests pass (step 9: 236 and 98; the 16 new GPU tests are the grid
cases drawn per sample). The six golden images with a grid were re-made after the grid pass, after
looking at the differences (along the lines only, mean under one level); the other 60 are unchanged.

## After version 1: game controller

Written before coding. A controller drives the same exact camera moves as the mouse and keys,
through the browser's Gamepad API, so it works in the single file and in the dev server alike.

### Which controllers

Pads the browser reports with the "standard" layout (Xbox, PlayStation, Switch Pro and most
others through Chrome and Edge, which map them to one layout). A pad without it is announced and
not used, rather than guessed at. Browsers show a pad to the page only after its first button
press, so "Controller connected" appears then.

### Mapping

| Control | Action | Keys it matches |
| --- | --- | --- |
| left stick | pan, at up to 1.2 screen heights a second | W A S D |
| right stick left / right | rotate, up to 1.5 radians a second | Q / E |
| right stick up / down, RT / LT | zoom in / out at the centre, up to 4× a second | + / − |
| LB / RB | rotate one symmetry step of the tiling | [ / ] |
| A | next view: Poincaré, Klein, half-plane, local | 1 to 4 |
| B | close the help or a panel; otherwise back through the views | Esc, Backspace |
| X | unit grid on or off | G |
| Y | next grid type | T |
| D-pad up / down | next / previous preset | C, Shift+C |
| D-pad left / right | previous / next look | Shift+L / L |
| L3 / R3 (stick presses) | next palette / next colouring | P / K |
| Start (Menu) | home | H |
| View (Back, Select) | hide or show the interface | Tab |

- Sticks have a round dead zone of 0.15 (a resting stick never drifts the view) and a squared
  response past it, so small deflections give fine control and full deflection the top speed;
  triggers have a dead zone of 0.05 and are linear. Diagonals are not faster than straight.
- Motion is a rate times the frame's time step, so it does not depend on the frame rate, and is
  applied directly (no spring: the stick is already smooth). A zoom stops at the content's limit
  as the keys' does.
- Buttons act on the press, not while held.
- Any controller input counts as activity: the interface comes back and fades again after rest.

### Cost when idle

The page must poll the Gamepad API every frame while a pad is connected (it has no events for
sticks or buttons). The poll is a few microseconds; drawing still stops when the picture is
finished, so the GPU stays idle. Without a pad it is read only on frames that run anyway.

### Code and tests

- `src/input/gamepad.ts`: the pure part (dead zones, response curve, the standard layout to rates
  and button presses) and a reader over `navigator.getGamepads()`; `Controls.tick` applies it.
- Unit tests: the dead zone and response (0 at the dead edge, 1 at full, never more than 1 on a
  diagonal), press detection (once per press), a non-standard pad ignored, and in `Controls` a
  stick held for one second moving the view as far at 30 and 144 frames a second.
- Browser test with a scripted pad in the real page: the left stick pans, the right stick and the
  triggers zoom and rotate, A switches the view, B goes back, and after release the view rests and
  the picture refines to 16 samples.
- The help panel and the README list the mapping.

### As built

- As planned, with three changes found while testing. Reading the pads only after the browser's
  "connected" event missed a pad already connected when the page loaded, so `Controls.tick` reads
  them every tick (the call costs nothing when no pad is there).
- The frame loop capped each time step at 50 ms, so on a slow renderer (frames of 100 ms and more)
  the sticks moved the view at half speed or less. The cap is now 250 ms: held keys already count
  real time, and the springs and glides are exact for any step.
- The test hook `refining` meant "a frame is requested", which stays true while a pad is connected;
  it now means samples are still missing or something moves.
- Tests: 11 unit tests (dead zones, response, presses once, a pad without the standard layout
  ignored, motion the same at 30 and 144 frames a second, every button's command) and two browser
  tests with a scripted pad (sticks and triggers pan, zoom and rotate; A and B switch the view and
  go back; with the sticks at rest the picture refines to 16 samples and drawing stops).

## Zooming at the edge

Reported as the Klein disk lagging and failing to show small scales near its edge. The cause was
not the Klein map, which matches the CPU reference on 100% of pixels near the rim, nor the zoom
itself, which keeps the point under the cursor to 0.000 px anywhere inside either disk. It was a
zoom aimed at a point **outside** the disk: nothing under the cursor holds the zoom there, so each
step moved the screen centre toward the boundary, which is infinitely far away. Ten wheel notches
just beside the rim took the camera 30 R out, the screen centre to 10⁻²⁵ of the rim and the
magnification to 10⁻²², where every tile is smaller than a pixel and shows as the flat average; more
zooming only slid along the edge. Both disks did this, but the Klein disk is drawn at 0.8 of the
screen's half-height at home (the Poincaré disk fills it), so a cursor aimed near its edge was often
just outside.

Now a zoom-in aimed outside the picture, or within 8 px of its edge, zooms about the point that far
inside on the way from the screen centre to the cursor (`zoomAnchor`). Each step grows the edge
toward the cursor, which is inside again after a few notches, and from there the zoom is exact at
the cursor. Aimed past the rim, both disks now come to rest at the zoom limit; aimed far below the
half-plane's boundary line (which has no far side to grow past the cursor) the view slides toward
it a little per notch at a steady scale. Zooms out and zooms inside the picture are unchanged.

**Growing out to the cursor.** Later reported as the Klein disk not zooming where the cursor is
until it is moved close to the edge. Aimed beside a disk, the stand-in 8 px inside the rim held the
zoom at the rim, and the rim crept toward the cursor by a few pixels a notch (with the rim opening,
8 px a notch in the Klein disk; 3 px in the Poincaré disk): from 60 px away the Klein disk took 10
notches to reach the cursor, from 150 px 21, and from 300 px it reached the zoom limit first. The
Klein disk at home leaves wide dark margins beside it, so this was the usual case. Now, aimed outside
a disk, the stand-in lies as far inside the rim as the cursor is outside it (at least the 8 px;
`edgeDistance` measures both), or at the screen centre when even that is not so far inside. The disk
grows out to meet the cursor: the Klein disk within 5 notches and the Poincaré disk within 11, from
any distance on screen, after which the zoom holds the cursor's point as before. The stand-in moves
smoothly with the gap, so the motion has no jump; zooms inside the picture, zoom-outs, the half-plane
and the band are unchanged.

Tests: 5 unit tests (the stand-in point lies on the way to the cursor, as far inside as the cursor is
outside and at least 8 px; with the cursor just past the rim, well past it and in the far corner,
both disks reach the zoom limit, which the runaway never did; from 20 to 300 px beside either disk,
at home and after a model switch, the disk reaches the cursor within 5 notches (Klein) or 11
(Poincaré), which fails on the old stand-in; the half-plane does not fall toward its line; a zoom at
the margin is exact).
On the RTX 5060 Ti the Klein disk draws as fast as the Poincaré disk (0.4 ms a sample at 1080p), so
the lag was most likely this runaway rather than drawing.

## Depth on a long trip

Reported as the colours switching every few seconds while moving over a coloured background. The
cause was the depth colouring's start (step 7, "Depth"): past MAX_START_DISTANCE = 10 from the
camera the shader's float32 sign tests against the start point stop being reliable, so the start
jumped to the tile at the camera and every ring on the screen changed at once. Holding an arrow key
(1.7 R a second at home) did this every 6 s, a controller's stick every 4 s. Only the depth looks
(Nebula, Aurora, Graphite and any look set to Depth) showed it; colouring, distance and inside do
not depend on the start.

Now the start moves earlier and without a visible change. Past START_SOFT = 8 a new start s' is
looked for: the centre of the tile around the point 6.5 R from the camera on the way to the old
start s (then 6, 5.5, 7 and 5 R, each also 0.25 and 0.5 R to either side). Depth counts the walls
between a pixel and the start, leaving out the walls through the start. A wall between a visible
point x and s also lies between x and s' or between s' and s, and no wall is counted twice, as long
as s' lies inside the narrow bundle of geodesics from the visible disk to s; the only walls crossing
the tile around s' are the ones through s'. So depth from s = depth from s' + a whole number,
the same for every visible point, unless a wall through s' or through s crosses the visible disk. Each
candidate is therefore checked in float64 at 673 points within START_VISIBLE = 5.5 R of the screen
centre (rings 0 to 5.5 R; past about 4.5 R at 1080p and 5.2 R at 4K the zoomed-out disk's tiles are
faded to their average colour), and the first with the same whole-number difference everywhere is
taken. The view keeps the difference as `shift`; the depth colour is phase + density · (smooth
depth + shift), and palettes repeat with period 1, so the shift goes into the phase, reduced in
float64 (`sceneOf`). The shader is unchanged. A search takes 1.5 to 3 ms and runs once a second or
so while moving; one that finds nothing is not repeated until the camera is 0.2 R farther. At 10 R
the start must move, and the candidate that changes the fewest test points is taken; in the tests a
fit was always found first (24 directions in 10 groups, each searched from 8 R on).

The shift is saved with the view (JSON `shift`, link `dsh`, left out when 0) and must be a whole
number. Tests: in every preset's group, 20 s of stick panning in three directions moves the start
more than three times and never changes the depth at screen points within 5 R; the CPU reference
picture of a Depth look is the same to 10⁻⁶ before and after the start moves; on the GPU the two
pictures agree to 0/255; a new reference case draws a Depth look 48 R from home; links and JSON keep
the shift. In the page, holding an arrow key on {3,7} Nebula moves the start every 1 to 2 s, with the
shift counting up (15, 18, 33, …).

## Step 11: the band view

The plane as an endless strip |Im z| < π/2 along one geodesic (key 7), conformal: the map to the
Poincaré disk is w = tanh(z/2). The picture keeps y₀, the band height of the screen centre, and s,
band units per unit of u; moves along the geodesic are camera moves. A pixel's frame point is the
band point P(s uₓ, y₀ + s u_y) seen from the screen-centre point, where
P(x, y) = (sinh x / cos y, tan y, cosh x / cos y), in the relative form of the design (nothing of
size 1 / cos y₀ is subtracted), so the view zooms into either edge down to a gap π/2 − |y₀| of
10⁻¹², the float32 limit. The zoom's camera part is built from the frame point and the band
direction there, never from boosts of size cosh b₀.

Tests: the frame against tanh(z/2) (1000 random points), against 120-digit values next to the edge
(`tools/hp/band_vectors.py`: frame to 10⁻¹², the zoom's N to 10⁻¹², float32 emulation of the shader
to 3 × 10⁻⁷), the cursor staying put on a flight into the edge down to the gap limit, and every
view-wide test (switches, saved state, readouts) now with five views.

Changed while coding:

- **GPU sin.** The first shader used `sin` and `cos` of d/2; next to the edges cos(y₀ + d) is formed
  from them, and GPU `sin` is accurate only to an absolute error, which showed as 3 to 4/255 noise
  along the edges. The chunk now uses the Taylor series of sin to t¹³ (|d/2| < π/2 always inside
  the band, error below 7 × 10⁻¹⁰) and cos(d/2) = √(1 − sin²); sinh also by its series below 0.5.
- **Pans grab at most PAN_REACH = 4 R out.** A transvection between points far from the centre is
  formed from entries near the square of their t, so its rounding grows like cosh⁴ of their
  distance (10⁻⁹ at 3 R, 10³ at 8 R). The band shows such points along both edges; a grab beyond
  4 R pulls both screen points toward the centre by the same factor (the pan keeps its direction
  and moves less). This holds in every view, but only the band's edges and the disks' last few
  pixels reach it.
- **Strips.** The band shows tiles far from the centre at full size, and float32 places a world
  point of size t only to about 65 · 2⁻²⁴ · t² R (measured), half a pixel 3.5 R out at 1600 × 900.
  So the band is drawn in vertical strips cos y₀ band units wide (`src/input/strips.ts`): strip k
  is the view moved k·Δ along the band, re-centred on its own (colour permutation and grid cameras
  carried along, the depth start kept), drawn into its pixel columns with u shifted by kΔ/s
  (`uScreen.w`). Every pixel is then within 0.5 R along the band of its strip's camera. The CPU
  reference draws the same strips, by the same columns. Past 12 strips a side the picture fades
  into the tiles' average where the estimated error passes 0.03 px.
- **Ease and zoom-out limit.** Zooming out keeps the edge gap at least s/3 by moving y₀ toward 0
  with the camera fixed, so the rows of large tiles stay within about 1.4 R of the centre; the
  zoom-out limit is s = π/0.8, the band 0.4 of the screen high.
- **Depth far from the start.** All strips count depth from the view's start, so the depth looks
  stay one picture. A strip farther than 8.5 R from the start fades its depth colouring into the
  average by 10 R (MAX_START_DISTANCE), linearly across each strip so there is no step. A start of
  its own per strip, exact on its columns as `nearerStart` is on the screen, would keep the colours
  instead; it costs about 9 ms a search per strip, so it is left for later.
- **Saved state version 2.** The band picture is saved as `{model: "band", y0, s}`, link `m=bd` and
  `pc` with two numbers. Version 1 states and links load unchanged; this version writes `v=2`.

GPU against the reference: 11 band cases, among them 1200 × 600 at home, zoomed out with an
8-colour colouring, a depth look 7 R from its start, and a grid drawn once and in every sample; all
within 2/255 with no unexplained pixel. 15 new golden images: every preset in the band, the looks
Escher, Porcelain, Midnight, Nebula and Graphite, and the Cartesian grid.


## Opening the Klein rim

Reported as zooming near the Klein disk's rim failing to show what is squeezed there. The Klein map
was right; the zoom could not help. At a point with Klein radius ρ the disk squashes the plane across
the rim by r = √(1 − ρ²) relative to along it (1/r ≈ cosh of the depth), and a zoom magnifies both
directions alike, so the tiles there stay needles at any magnification. The zoom-in limit also stops
on the finer direction first, so a dive at the rim ended about 5.4 R deep with tiles still squashed
110 : 1 (the Poincaré disk dives to about 21 R). No Klein picture escapes this: with the rim D screen
units from the centre at scale s, r² ≈ 2 D s, so showing the rim at magnification m squashes by at
least √(m / 2).

Now each zoom-in also re-projects the picture around the point under the cursor (`openKleinAt`,
camera.ts): the picture is measured from the cursor (`kleinShift`, views.ts, the centre move of
`zoomKlein` without its scaling), opened there (`openKlein`: c shrinks toward the disk's centre with σ
grown by the same amount, which keeps that point and the camera), and measured from the screen centre
again. The point under the cursor stays there exactly, every frame is still a true Klein picture and
geodesics stay straight; the region zoomed into opens in place and the rim moves off the screen.

The cursor point's r = √(1 − |z|²) grows toward the bound 1 − ∛(s / KLEIN_OPEN_FROM) below
s = KLEIN_OPEN_FROM (the home scale, 1.05): squash at most 2.9 at 3.6 times, 2 at 8 times, 1.27 at 100
times. Per zoom step by k it grows by at most k^KLEIN_OPEN_RATE (0.5), so the picture changes no
faster than the zoom moves it; and never past the zoom-in limit (s / r at the screen centre ≥ the
minimum footprint). Zoom-outs, pans and the other views are unchanged; a zoom-out shows the rim again
and the next zoom-in opens it gradually. To travel along the rim at depth in the Klein disk one drags;
diving at the rim is for the Poincaré disk, the half-plane and the band.

**Smooth opening.** The first version opened around the screen-centre point at once, to the bound,
and then panned the cursor's point back under the cursor. Reported as the camera jumping: the pan is
a hyperbolic translation of a point a few R from the centre, and it threw the far side of the screen
95 to 325 px in a single 60 fps frame of the wheel's spring while r changed by 1%. Opening around the
cursor point needs no pan, and the rate limit spreads the opening over the zoom; replaying the
spring frame by frame, the opening now moves any visible point by at most about the zoom's own motion
of that point.

**Rounding, and the stalls.** Then reported as zooming at the rim feeling very slow, with jumps
still there. A disk picture keeps c and σ = 1 − |c|² apart (σ alone is precise near the rim), and
nothing kept them consistent. Each zoom-in frame measures the picture from the cursor, opens it and
measures it back, and that round trip amplified the mismatch (about 1.5 times a frame, with alternating
sign): 1e-16 grew to 1e-4 within 30 frames, so r at the cursor alternated and the picture jittered
frame to frame. Some frames later the way back put the screen centre off the disk, the step failed
with an error, and the error stopped the animation loop until the next wheel notch, which then caught
up with up to 0.25 s of motion in one frame: a stall and a jump. Replaying 14-notch wheel zooms at
seven points around the rim, from 60 px past it to 10 px inside, at 60 and 144 frames a second on
canvases 700, 1000 and 1400 px tall (252 runs), the old code had failed steps in 71 runs (in 30 of
the 42 runs at 144 Hz on the 1400 px canvas), with |c|² + σ off by up to 72.

Now every computed disk picture goes through `diskPicture` (views.ts), which restores |c|² + σ = 1
from whichever of the two is smaller: near the rim σ sets |c| (c keeps its direction), near the
centre c sets σ. `openKlein` sets σ = r₁² itself rather than carrying the old sum along. Over the same
252 runs the mismatch stays below 5e-16, no step fails, and r at the zoom's anchor grows each frame by
exactly the planned factor. Two guards stay in for anything unforeseen: an opening whose way back
cannot be computed is cut back to the most that can be, or skipped, and the frame loop reports an
error from a step and carries on instead of stopping.

Tests: the inverse Klein map round-trips 2000 shallow and deep pictures to 1e-9; kleinShift
re-measures 200 pictures from another screen point to 1e-9; the point under the cursor stays within
1e-6 of a screen unit through 20 random zoom sequences at the rim; over 6 eight-notch wheel zooms
replayed at 60 fps, no frame moves a visible point by more than 1.5 times the zoom's own motion of it;
the cursor's r only grows, at most by the rate, catches up with the bound within 8 notches and holds it
to the zoom limit, where the squash at the centre is below 1.2; openKlein keeps s, the screen-centre
point and |c|² + σ = 1; diskPicture restores |c|² + σ = 1 from the smaller of the two; over 36 wheel
zooms at the rim and past it (60 and 144 Hz, 1000 and 1400 px), every frame keeps |c|² + σ = 1 to
1e-14 with a finite camera, and r at the anchor only grows, by at most the rate and never past the
bound (this test fails on the old code).


## Step 12: the plane inside H³

The plane seen from an eye inside H³ (key 5): the plane is the totally geodesic plane z = 0 of H³,
the eye stands h above its foot point, looks along the frame's +y tilted down by the pitch φ, with a
vertical field of view `fov`. Not conformal. Limits: h from 0.01 to 6 R, φ from level to straight
down, the field from 40° to 100°; home is 0.3 R up, 30° down, 70°. The idea of offering this view
comes from HyperRogue (CREDITS.md).

**Projective form.** With f = tan(fov / 2), a pixel u looks along
w = (f uₓ, cos φ + f u_y sin φ, −sin φ + f u_y cos φ). Its ray from E = (0, 0, sinh h, cosh h) meets
the plane where tanh t = tanh h / (−ŵ_z), and that point is, up to a positive factor,
H = (w_x sinh h, w_y sinh h, −w_z): the frame point is x = H / √(H_t² − |H_s|²), and the ray meets
the plane exactly where H is future timelike. H is affine in u, so the picture is a perspective
image of the Klein model: geodesics are straight lines, and the ground on the screen is convex.
The Jacobian is (dH + x⟨x, dH⟩) / n with dH₁ = (f sinh h, 0, 0), dH₂ = (0, f sinh h sin φ, −f cos φ),
the footprint is its largest stretch (√ of the Gram matrix's larger eigenvalue), and the horizon is
g = w_z + sinh h |w_xy| = 0, asin(tanh h) below level, its distance g / |∇g| in units of u. No
atanh, no boost of size cosh h: the shader chunk is a few lines. It needs every frame point to
float32's 65 · 2⁻²⁴ · t² R (step 11), so near the horizon the picture fades into the tiles' average
where that passes 0.03 px, as in the band.

**Camera.** The frame's origin is the foot point. Home stands the eye back so that the start point
is at the screen centre. A switch into H³ keeps the screen centre's world point the same way (the
eye steps back from it along the view), and a switch out steps forward to it; the eye's height,
pitch and field when the view was left are found again on the way back in, and Home keeps the
field of view (a setting). The wheel and + − lower and raise the eye by the zoom factor; left-drag
grabs the ground; right-drag is a mouse look, half the field per screen unit (a drag over the
screen's height turns the view by the whole field); W A S D walk 2 sinh h of the plane per screen
unit, so the ground under the eye crosses the screen at about the same rate from any height; Q E
turn about the foot point; on a controller the left stick walks, the right stick turns and tilts,
the triggers set the height.

**Readouts and settings.** The distance readout and the card's X, Y and rotation are where the eye
stands (its foot point, the frame's origin), so at home they read 0.59 R back from the start. The HUD
shows the eye's height in R (and km for a physical R) with the horizon's angle below level, in place
of the magnification; the magnification behind it is
log₁₀(0.3 / h). The View tab trades its magnification field for an eye-height field and adds a
field-of-view slider. Saved states write `{model: "h3", h, pitch, fov}` (link `m=h3`, `pc` with
three numbers), checked against the limits; the version stays 2, since every state without this
view is written as before (an older build refuses an H³ state as an unknown view).

Changed while coding:

- **The zoom holds the ground under the cursor.** The design zoomed over the foot point. Every
  other view keeps the point under the cursor, so this one does too: after the height changes the
  eye moves by the transvection from where the cursor's ray now meets the plane to where it met it
  before. Where the cursor shows sky, or ground beyond PAN_REACH (whose transvection would round
  badly), the eye stays over its foot point.
- **The grid's levels.** The grid chooses its eight levels from the plane length per pixel at the
  screen centre, which inside H³ may be sky. It now uses `referenceScale`: the least of the centre
  column's at the bottom edge and straight down (a wide view's pixels shrink toward its edges, so
  the bottom edge can be finer than the ground under the eye), within 5% of the least on a 16:9
  screen; the nearest ground gets its fine lines, and the far ground fades as levels run out.
- **Labels.** The label lines shrink around the screen centre in the other views; inside H³ the
  ground fills the screen's lower part, so the left, right and bottom edges stay and the top comes
  down below the horizon to where a pixel covers at most 6 times the centre's plane length (the
  nearest ground's when the centre is sky). A pixel's level follows its stretch in depth, so along
  the view the lines labelled come further apart than across it.

Tests: the projective form against the ray from the eye on 20 000 random pixels and pictures, and
against 112 values at 120 digits (`tools/hp/h3_vectors.py`); the Jacobian against finite
differences and its largest stretch as the footprint; the horizon's angle and distance; home, walking
(2 sinh h per unit, straight ahead, and back exactly), turning (right for a positive yaw, about the
foot point), the pitch limits, the mouse look, ground drags and zooms holding the point under the
cursor to 10⁻⁹ of a pixel's footprint, the height limits, switches keeping the centre's point, the
reference scale against the least on the screen, labels below the horizon (none when all is sky),
saved states and refusals, the controller, the HUD, the card and scripted input in the page (which
found key 5 not yet wired); every
view-wide test now with six views. GPU against the reference: 9 cases (home; 0.03 R up nearly level;
1.5 R up looking down; walked, turned and zoomed at the cursor; a 100° depth look; the Cartesian and
polar grids drawn once and in every sample), all with every pixel within 2/255. 14 new golden images:
every preset inside H³, the looks Escher, Midnight, Nebula and Relief, and the polar grid.

## Step 13: the hyperboloid

The plane as the upper sheet of t² − x² − y² = 1, drawn in Euclidean 3D with the tiling moving on it
(key 6). The frame coordinates are the embedding's coordinates (x, y, t), so a pixel's frame point
is simply where its ray meets the surface. Not conformal.

**Picture.** `{model: "hyperboloid", elevation, distance, fov}`: an orbit camera looking at the
vertex V = (0, 0, 1) from distance D (1.5 to 40) at elevation ε (−90° to 90°, positive above the
tangent plane at V), with a vertical field of view (40° to 100°, f = tan(fov / 2)). Turning around
the axis is a camera rotation, as the design has it. The camera sits at o = V + D (0, −cos ε, sin ε)
and looks along F = (0, cos ε, −sin ε), with right R = (1, 0, 0) and up U = (0, sin ε, cos ε); a
pixel looks along d = F + f (uₓ R + u_y U). With Q(a, b) = aₜbₜ − aₓbₓ − a_yb_y (−`mink`),
A = Q(d, d), B = Q(o, d), C = Q(o, o) − 1, the ray o + λd meets the quadric where
Aλ² + 2Bλ + C = 0; the roots are q / A and C / q, q = −(B + sign(B) √(B² − AC)) (sign(0) = 1),
and the frame point is the nearest one with λ > 0 on the upper sheet (t > 0), divided by √Q(p, p)
as the other views normalise theirs. The camera is inside the bowl when C > 0 and oₜ > 0 (always
for ε > 45°), inside the lower sheet's bowl when C > 0 and oₜ < 0, and outside both when C < 0.

**Footprint.** On the surface Q(p, dp) = 0, so ∂p/∂uᵢ = λ (eᵢ − d Q(p, eᵢ) / Q(p, d)) with
e₁ = f R, e₂ = f U: tangent vectors whose larger stretch (`largestStretch`, as inside H³) is the
plane length per unit of u. It grows without bound at the silhouette (Q(p, d) → 0) and toward
infinity, where the tiles fade into their average.

**Edge.** The ray-hit region on the screen ends in two kinds of curve, and `edge(u)` is the signed
distance (in u, positive outside) to the nearer one that applies:
- a silhouette, B² − AC = 0, where the ray grazes the upper sheet: only with the camera outside both
  bowls (from inside one every line crosses the surface), and only where the grazing point o − (B/A) d
  is ahead (−B/A > 0) and on the upper sheet; distance |B² − AC| / |∇(B² − AC)|;
- infinity, A = 0, where the visible root runs off along the asymptotic cone (looking up inside the
  bowl, or past the bowl's side from outside): only for upward rays (dₜ > 0) whose finite root
  (C / q) is not itself the hit; distance |A| / |∇A|.
The sign is the hit's: −distance where the ray meets the surface, +distance where it does not (and a
large value when neither curve applies). The accent ring then outlines the bowl, as it does the disk
rims, and a sample's edge is anti-aliased before the samples add up.

**Shading.** The tiling's colour (and the grid's) times 0.55 + 0.45 max(0, n · L), with n the
Euclidean normal (−x, −y, t) turned toward the camera and L a fixed light from the upper left
behind the camera (in the camera's own axes, so the light turns with the orbit); constants to be
settled on test renders. A new `VIEW_SHADE` hook in main.frag (and in display.frag, where the grid
is drawn once over the mean: the mean is unshaded, the grid drawn, and the result shaded again) and
in reference.ts. Far points fade into the tiles' average by the same float32 rule as inside H³
(`precisionFade`, `viewFade`).

**Camera.** The frame's origin is the vertex, so the distance readout and the card's X, Y and
rotation say which point of the plane sits at V. Home looks at the start point at V from inside the
bowl (elevation and distance chosen on test renders). A switch in puts the previous view's screen
centre at V; a switch out puts V at the new view's screen centre; the orbit (ε, D, field) when the
view was left is found again on the way back, as inside H³. The camera keeps at least 0.05 R from
the surface: an orbit or zoom step that would bring it closer passes through the wall in one step
(a closer camera would see pixels finer than float32 resolves).

**Controls.** Left-drag grabs the surface (`panBy`, generic through `frameOf`); right-drag up and
down orbits (ε, dragging down looks from higher up, π/2 per unit of u) and sideways turns the tiling
about the vertex; the wheel and + − change D by the zoom factor and hold the point under the cursor
as the other views do (by a transvection, within PAN_REACH, else the vertex stays); W A S D pan the
tiling at the vertex's own scale; Q E turn; a controller's left stick pans, its right stick orbits
and turns, the triggers change D.

**Readouts and settings.** The HUD shows the orbit distance in R (in place of the magnification)
with the elevation below it; the magnification behind it is log₁₀(D_home / D). The View tab trades
its magnification field for an orbit-distance field and shows the field-of-view slider. Saved
states write `{model: "hyperboloid", elevation, distance, fov}` (link `m=hb`, `pc` with three
numbers), checked against the limits; the version stays 2.

**Tests.** Unit: the hit against a float64 march along the ray with bisection, from inside the bowl,
inside the lower bowl and outside both (20 000 random pixels and orbits); against mpmath at 50
digits for grazing and near-cone rays (`tools/hp/hyperboloid_vectors.py`); the footprint against
finite differences; the edge's sign against the hit everywhere, and its size against the bisected
distance to the boundary near silhouettes and infinity; shading in range and facing the camera;
home, switches in and out keeping the vertex and the screen centre, orbit and turn, the wall guard,
zoom holding the cursor's point, limits, saved states and refusals, controller, HUD and card. GPU:
reference cases (home; from outside with the silhouette; from below; looking up inside at the far
walls; walked, turned and zoomed; the Cartesian and polar grids once and in every sample), every pixel
within 2/255, and golden images for every preset and four looks.

Changed while coding:

- **Onto the sheet by t.** The plan divided the hit by √Q(p, p) as the other views normalise. Far
  up the sheet (t² ε near 1) Q(p, p) can come out at or below 0, and the frame point NaN. The point
  keeps the hit's x and y and takes t = √(1 + x² + y²) (`Math.hypot` on the CPU): never NaN, and
  along the surface it loses only about ε t, as the other way does.
- **Which sheet a silhouette grazes.** The plan took the grazing point's λ as −B/A. Test renders from
  just outside the bowl showed short stretches of the accent ring in empty sky below it: next to
  rays along the lower half of the asymptotic cone A is near 0, −B/A says "ahead, on the upper sheet"
  while the nearby curve B² = AC grazes the lower sheet. On the curve −B/A = −C/B, and C does not
  change with u, so the edge now uses −C/B. A new unit test checks that wherever the edge distance is
  under 0.01 the hit changes within three times it (it failed with −B/A, 2 points in 1 600).
- **λ capped in the shader.** Rays next to the cone go out as 1/A; in float32 the footprint's
  squares overflowed past λ ≈ 10¹². The chunk caps λ at 10⁶ R, where every pixel has long faded
  into the tiles' average; the CPU keeps the exact hit.
- **Light and home.** On test renders an ambient of 0.55 left the bowl flat; the light is now
  (−0.6, 0.6, 0.5) in the camera's axes with an ambient of 0.4, enough to light one side of the bowl
  without darkening the tiles much. Home stays at 55°, 5 R and a 50° field: from inside the bowl the
  whole screen is surface, the vertex small at the centre and the walls growing toward the edges.
- **Behind the wall.** With the camera outside the bowl between the vertex's tangent plane and the
  cone (0 < ε < 45°), the line of sight to the vertex enters the bowl through the near wall: the
  screen centre shows the wall's outside, not the vertex. A switch out still puts the vertex at the
  new view's centre, so the place kept is the orbit's, not the wall's.
- **The wall guard** is `clearWall`: a move of the distance or the elevation that would end within
  0.05 R of the surface walks on toward the limit in 200 steps to the first clear place and bisects
  its edge, or, with no room before the limit, stops at the last clear place before the wall. Zoom,
  orbit, the typed distance and saved states (refused when not clear) all go through it. The wheel's
  spring stops when a step applies less zoom than asked (a limit), not when it applies more (the
  wall passed in one step), so a wheel zoom through the surface carries on to where it was going.
- **Zoom.** The hold of the point under the cursor is shared with H³ (`holdAt`). The grid's levels
  come from `referenceScale`, the least footprint over a 5 × 5 grid of the screen.
- **Labels** use the generic layout. From inside the bowl it is the other views'; from outside, the
  picture is a V above the centre, and the label rectangle that fits in it is narrow, so few lines
  are labelled.

Tests: the hit against a float64 march with bisection from inside the bowl, inside the lower bowl
and outside both (3 000 random pixels and orbits, compared along the surface: coordinates far up the
sheet lose their digits mostly along the point itself, which only moves it off the surface), and
against 146 values at 120 digits (`tools/hp/hyperboloid_vectors.py`), 38 of them 10⁻⁴ and 10⁻⁸ from
the silhouette or from infinity; the Jacobian against finite differences and its largest stretch as
the footprint; the edge's sign against the hit (60 000 pixels, with every change of the hit within a
step of the edge), no edge where nothing changes, and its size against bisection at both kinds of
curve; the shading in range and lit from the left; home, switches in and out (through every view),
the orbit's turn and elevation, the right-drag (no momentum), zooms holding the point under the
cursor to 10⁻⁹ of a screen unit, the distance limits, the wall passed in one step or stopped short
of, a wheel zoom carried on through it, a 2 000-step random walk always clear of it, saved states
and refusals, the controller, every view's number key (now read from the views' key table), the HUD
and the card; every view-wide test now with seven views (the polar grid's turn compared modulo a
whole turn). GPU against the reference: 11 cases (home; outside with the silhouette; from below;
inside the lower bowl; 40 R out; moved, orbited and zoomed; depth with relief; the Cartesian and
polar grids once and in every sample), every pixel within 2/255 but at edges. 14 new golden images:
every preset on the hyperboloid, the looks Escher, Midnight, Nebula and Relief, and the Cartesian
grid.

## Step 14: colourings and tile identity

Three additions: colourings with up to 8 colours in every group, chiral colourings (respected by the
rotations only), and Mosaic, a colour source that gives every tile its own stable random colour from
an exact identity of the tile. Every picture that can be made today stays as it is, but for one case
of repeated colours (below).

**Colourings up to 8 (mirror colourings).** A colouring is still three permutations σⱼ of k colours,
one per mirror, with σⱼ² = (σ₁σ₂)ᵖ = (σ₁σ₃)^q = (σ₂σ₃)ʳ = 1 and every colour used. Version 1 tried
every triple of involutions, which takes 40 to 95 ms per group up to 5 colours and is out of reach
beyond 6. The new search is Sims' low-index method (as `design-checks/check_lowindex.py`): colour 0
is the start triangle's, the images are defined one at a time in breadth-first order (each either a
colour already met or the next new one), and every relator is traced from every colour as far as it
is defined, so a branch dies as soon as a cycle closes too early or not at all. Each colouring is
found once per start colour; the breadth-first labelling from the start that gives the smallest
table is its canonical form, and one colouring is kept per form. Saved links name colourings by
number (`c<n>`), so the first ones keep version 1's numbers and permutations exactly: for up to 5
colours each class is written as version 1 met it first (the relabelling whose triple comes first in
version 1's order of involutions) and the classes are sorted by that; 6, 7 and 8 colours follow, in
canonical form, sorted by it. The design's counts for 6, 7 and 8 colours: {7,3} 0, 0, 1; {8,3} 7, 0,
5; {5,4} 1, 0, 0; {6,4} 18, 0, 18; (3,3,4) 5, 2, 5.

**Colours for more classes than the set has.** A discrete set gives class i the colour
set[(i + round(φ n)) mod n]; with k > n that repeated colours (version 1 could do this only with Ink &
paper's 4 colours and a 5-colouring). With k > n the k classes now take evenly spaced points of the
set's gradient, palette(φ + i / k), as gradient palettes do.

**Chiral colourings.** The rotations form the group ⟨a, b | aᵖ = b^q = (ab)ʳ = 1⟩ with a = s₁s₂ (about
P), b = s₃s₁ (about Q), so ab = s₁(s₂s₃)s₁ turns about the image of R. A chiral colouring is a pair of
permutations α, β of k colours with αᵖ = β^q = (αβ)ʳ = 1, every colour used; it colours kites, the
triangle T and its mirror image across side 1 (the domain of the rotations, and the motif tile of
step 16): the kite of an even element h gets π(h)(0). The same low-index search finds them (four
generators a, a⁻¹, b, b⁻¹). Checked in `design-checks/check_chiral.py`: counts for 2 to 8 colours
{7,3} 0, 0, 0, 0, 0, 2, 1; {8,3} 1, 1, 1, 0, 3, 0, 5; {5,4} and {4,5} 1, 0, 0, 2, 3, 0, 0; {6,4} 3, 1,
4, 1, 10, 4, 14; (3,3,4) 0, 1, 1, 0, 3, 4, 3 (under 0.1 s per group in Python); on 3 000 points per
colouring, one colour per kite (the kite found from the geometry), colours unchanged by re-centering,
and the colour across sides 2 and 3 as below; and version 1's colourings restricted to rotations
satisfy the rotation relations.
- Per pixel the fold word is read in pairs. Each pair rᵢrⱼ is a rotation with permutation τᵢⱼ:
  τ₁₂ = α, τ₂₁ = α⁻¹, τ₃₁ = β, τ₁₃ = β⁻¹, τ₂₃ = α⁻¹β⁻¹, τ₃₂ = βα (mirrors numbered from 1 here;
  τᵢᵢ = 1). P ← P ∘ τ for each pair; a word of odd length leaves its last mirror e unpaired, and the
  triangle then belongs to the kite of h s₁, whose colour is (P ∘ τₑ₁)(0).
- Across side 1 the colour never changes (the same kite). Across side j = 2, 3 the neighbour is
  (P ∘ τⱼ₁)(0) for an even word and (P ∘ τₑⱼ)(0) for an odd one: the anti-aliasing of colour edges is
  version 1's with these colours.
- Re-centering words are even (`recenter`), so the camera's permutation carries along their pairs.
- The shader gets the six τ in a new `uvec4 uPairs[2]` and a CHIRAL compile switch; version 1's
  mirror colourings keep their code path.
- In the state a chiral colouring is `r<n>`, numbered as above (by colour count, then canonical form).

**Exact tile identity.** The triangle group acts on F_ℓ³ by the reflections Sⱼ v = v − (2Bⱼ · v) eⱼ,
with 2Bᵢⱼ = −2cos(π/mᵢⱼ) (2 on the diagonal) reduced modulo a prime ℓ, the first prime above 4096 with
ℓ ≡ ±1 mod 2m for each m = p, q, r above 2, so that 2cos(π/m) exists in F_ℓ: z + 1/z for z of order 2m
in F_ℓ (ℓ ≡ 1) or in F_ℓ² (ℓ ≡ −1, found as the t whose matrix [[t, −1], [1, 0]] has order 2m; the
smallest such t, and the smallest primitive root for z, so the choice is fixed). The relations hold
for any such roots. w, the vector fixed by S₁ and S₂ (the cross product of rows 1 and 2 of 2B), stands
for the tile around P, and a tile hT has the identity A · S_h · w, where A is the camera's matrix:
- The camera carries A (`ViewState.tile`, 9 integers below ℓ, the identity at home); re-centering
  by the word j₁ … j_K multiplies it on the right by S_j₁ … S_j_K, as the colour permutation is
  carried. Any invertible A gives a valid labelling, so a matrix that does not fit the group (an entry
  of ℓ or more, or a determinant other than ±1 mod ℓ) restarts at the identity, as a permutation does.
- Per pixel the fold multiplies A on the right by each Sⱼ: S_j differs from the identity only in row j,
  so A[r][c] += A[r][j] · dⱼ[c] mod ℓ with dⱼ = −2Bⱼ mod ℓ, 9 integer multiply-adds (all below 2²⁸).
- The tile across side 3 has the identity A · w₃ with w₃ = S₃ w (sides 1 and 2 lie inside the tile).
- Checked before (`design-checks/check_tileid.py`): the relations in 10 groups, one identity per tile
  and no collisions among the 114 to 416 tiles within 3.5 R of 4 groups, unchanged by 1 000
  re-centerings. Two tiles share an identity only when they are the same tile of a finite quotient
  with about ℓ³ / p tiles, so repeats are tens of R apart.
- Saved states keep A (`view.tile`, link `tid` with 9 numbers) when it is not the identity, so a link
  opens with the same colours; reading checks it as above. The version stays 2.

**Mosaic.** A fifth colour source. The identity's three numbers go through a 32-bit integer hash
(multiply-xorshift, the same in TypeScript with Math.imul and in GLSL), t = (h >> 8) / 2²⁴ ∈ [0, 1).
A discrete set gives the tile set[(⌊t n⌋ + round(φ n)) mod n]; a gradient gives palette(φ + t) at
level 0. Across side 3 the colour blends with the neighbour's as the colouring does. The far-tile
colour is the set's mean, or the palette's. Shader: SOURCE 4, with the set's colours in uColours and
their count in uFlags.x (0 for a gradient), A, the dⱼ, w, w₃ and ℓ in new uniforms. The look card's
source switch gets a fifth button.

**Interface.** The colouring list groups its entries by colour count (an optgroup each), mirror
colourings first and chiral ones after them labelled "Chiral n". One new preset and one new look,
chosen on test renders, show the new colourings and Mosaic.

**Tests.** Unit: the new search returns version 1's colourings, permutations and order exactly up to
5 colours in every group with p, q, r up to 8 and r up to 3 (version 1's search kept in the test as
the oracle), the design's counts for 6 to 8 colours, every colouring valid and transitive and one per
class; chiral colourings valid, the counts above, one colour per kite and re-centering on random
points, the colours across sides against the reflected point; the tile identity's relations and
orders in many groups, w fixed and nonzero, one identity per tile and no collisions within 3 R,
unchanged by re-centering, the shader's row update against the matrix product, the hash in range and
the same as the GLSL's integers; Mosaic's colours and mean; saved states with chiral names and tile
matrices, and refusals. GPU against the reference: an 8-colouring, chiral colourings with odd and even
words, Mosaic with a set and with a gradient, Mosaic after a long walk (many re-centerings), a band
with strips, and relief; golden images for the new preset and look.

Changed while coding:

- **Where the data goes.** The frame grew from 212 to 252 words. A chiral colouring puts the camera's
  permutation where a mirror colouring does (`uPerm[0]`) and its six τ in `uPairs`; Mosaic puts the
  rows of A at words 220 to 228, the dⱼ at 232 to 240 (ℓ in the first one's fourth word), w and w₃ at
  244 and 248. The colour count word holds the discrete set's size for Mosaic (0 for a gradient).
- **The mirror colouring's line in the fold loop is kept as it was**, character for character, and
  the chiral and Mosaic paths sit beside it under their own switches: the benchmark experiments find
  that line by its text.
- **Search time.** Both searches together take 2 to 40 ms per group (the slowest, {8,8}, finds 135
  mirror and 80 chiral colourings), where version 1 took 40 to 95 ms for up to 5 colours. The list
  of a large group is long; the headings by colour count keep it usable.
- **Strip tests.** Points on the band's axis lie on a mirror, between two triangles, and an
  8-colouring can tell them apart where version 1's could not: the strip tests skip points within
  10⁻⁹ of a mirror, and the tile identity is tested across strips as the colours are.
- **The new preset and look**, chosen on test renders: "{7,3} chiral, seven colours" in Gilded, with
  only the lines of sides 2 and 3 (the kites' outlines, so the turning of the colours shows), and
  "Mosaic", Copper & Teal with relief 0.7, a little glow and dark lines. The source switch now has five
  buttons and wraps to two rows in the card; all five stay inside it at every width.

Tests: unit, 374 in all: the new search equal to version 1's (kept in the test as the oracle) up to 5
colours in 36 groups, the counts for 6 to 8 colours, every colouring valid and transitive and one per
class; chiral counts, validity, one colour per kite, re-centering and the colours across each side;
the tile identity's relations and orders in 179 groups (every hyperbolic (p, q, r) with p, q up to 12
and r up to 4, and (5,5,5), (7,7,7), (8,8,8), (20,20,20)), 2cos(π/m) of the right order, the row
update against the matrix product, one identity (and one hash) per tile within 3 R in 10 groups, the
tile across side 3, unchanged by re-centering, the matrix carried by `settle` and restarted for
another group, and the hash against a BigInt spelling of it; Mosaic's colours and mean, the gradient
for more classes than colours; saved states with chiral names and tile matrices, and refusals. GPU
against the reference, every pixel within 2/255: an 8-colouring moved, chiral colourings in the
Poincaré, Klein (with relief) and H³ views, Mosaic with a set (moved) and with a gradient, Mosaic after
a long trip, and a band of strips. The card: the colouring list's headings and labels, a chiral
colouring chosen, and the five sources inside the card. 9 new golden images (the preset in every view,
the look twice); the 109 others are byte for byte as before.

## Step 15: Wythoff tilings

A Wythoff tiling has its vertices at the images of a generator point G of the triangle T and its
edges from G to its mirror images s_a G across the active mirrors a (those G is not on). Its faces
surround the corners: around P, Q and R (each the orbit of G under the two mirrors there), and in
the snub, triangles. Eight constructions plus a free point, for every group; version 1's tilings (the
mirror lines and the colourings) stay what they were, as the construction "Lines", the default.

**Constructions.** Named by their active mirrors (sides 1, 2, 3), as the ringed nodes of the Coxeter
diagram, with the Wythoff symbol beside them. The generator is G = −(w₁m₁ + w₂m₂ + w₃m₃) normalised,
m the dual basis of the mirror normals (⟨mᵢ, nⱼ⟩ = δᵢⱼ), wⱼ = 1 for an active mirror and 0 otherwise;
the free point takes any three weights wⱼ ≥ 0, not all 0 (wⱼ is proportional to sinh of G's distance
to mirror j).

| id | G | symbol | for (p, q, 2) |
| --- | --- | --- | --- |
| 010 | at Q | q \| p r | the regular {p, q} |
| 001 | at P | p \| q r | its dual {q, p} |
| 100 | at R | r \| p q | rectified |
| 110 | on side 3 | q r \| p | truncated {p, q} |
| 101 | on side 2 | p r \| q | truncated {q, p} |
| 011 | on side 1 | p q \| r | cantellated (rhombi-) |
| 111 | inside | p q r \| | omnitruncated |
| snub | inside, the three edges equal | \| p q r | snub |
| free | anywhere in T | | non-uniform |

For other groups the list shows the symbol and where G is ("at Q", "on side 3"). The snub's G solves
dist(G, ρ_P G) = dist(G, ρ_Q G) = dist(G, ρ_R G) with ρ_P = s₁s₂, ρ_Q = s₁s₃, ρ_R = s₂s₃ (Newton on
the weights (u, v, 1) in float64, as `design-checks/check_wythoff.py`).

**One rule per pixel, two domains.** Checked in `design-checks/check_wythoff_faces.py` before this was
written. A tiling that every mirror keeps (all but the snub) is seen through the triangle: the pixel is
folded into T as now. The snub is kept by the rotations only, so the pixel is folded into the kite
K = T ∪ s₁T, the rotations' domain: an odd fold word reflects once more across side 1 (the colour
permutation, the tile matrix and the relief tangents follow). In the domain the CPU lists a few edge
lines (unit normals m_e) and the faces that meet it; each face f has a mask of lines and the side of
each it lies on. Per pixel, y the folded point:
- bit e is ⟨y, m_e⟩ > 0; y lies in the first face with (bits XOR want_f) AND mask_f = 0; if none fits
  (rounding where several lines meet), the face with fewest mismatched lines;
- de = min over the face's mask of asinh|⟨y, m_e⟩|, the distance to the nearest edge: a face is
  convex, so the distance from a point inside to its boundary is the least distance to its edges'
  lines, and the mask holds every edge that can be nearest to a point of the domain;
- the face across that nearest line is the line's other face (each line is one edge, between two
  faces), for the anti-aliasing of the face colours.

The triangle's tables: the lines L_a through G perpendicular to each active mirror a (normal
∝ G × n_a, the Minkowski cross product), at most 3; the faces around P, Q and R that exist (a corner
whose two mirrors are both inactive is G itself, and a corner with angle π/2 and one mirror inactive
has a face of two vertices, an edge), at most 3. The face around a corner X lies on X's side of the
lines L_a of X's active mirrors: the three rays from G to the feet of the perpendiculars cut T into
one region per corner, each a convex sector at G (its angle is below π − π/m), so it is the
intersection of two half-planes. Across L_a lies the face around the other corner on mirror a, or,
when that face is an edge (L_a is then the mirror b through it), the face around s_b X in the next
triangle. Nothing else is needed: the sector argument (a point is nearer to a mirror image of a
boundary point on its own side of the mirror) puts the nearest edge of the face inside T.

The kite's tables (the snub): the faces that meet the kite and their edges are found by a walk over
the snub's vertices ρG (ρ a rotation) from G, each vertex with its faces (ρ·the faces around P, Q, R
with at least 3 sides, and the triangles ρΔⱼ, Δⱼ the triangle around the odd vertex sⱼG with vertices
sⱼsᵢG), going on from a vertex while one of its faces meets the kite (convex polygons in Klein
coordinates, separating axes; touching is not meeting). A face's mask holds the edges whose own
sector (the triangle with the face's centre, where a regular face has that edge nearest) meets the
kite, and those whose line cuts the kite (needed by the face test); every snub face is regular. The
faces across the masked edges follow, without masks. Sizes found: at most 10 lines and 7 faces that
meet the kite plus 4 across (tables are sized 16 and 16).

**Colour, by source.** Colouring: the face's kind (around P, Q, R, or a snub triangle), the kinds that
exist numbered in that order and coloured as a colouring with that many classes (`classColours`); the
colouring choice does not apply and is kept for the lines. Mosaic: the face's identity A·S_h·v_f, A
the camera's tile matrix, h the fold word (and side 1 when the kite needs it), v_f the face's own
vector in the domain: S_k w_X for the face around k·X (w_X fixed by the two reflections at X: rows of
2B crossed, w_P as in step 14), and for a snub triangle S_k v_T with 2B v_T = (1, 1, 1) mod ℓ, which no
reflection fixes. The hash takes (v₁, v₂, v₃ + kind·ℓ), so kinds never share; the faces around P get
exactly step 14's colours. Distance and depth stay fields over the plane, as they are. Inside: de over
the largest de. Relief and glow: de and the nearest line's normal, turned to face into the face. The
lines: lineCoverage(de); version 1's mirror lines (the sides switches) can be drawn over them, so a
Wythoff tiling can show its triangle mesh.

**The far-tile colour.** The quadrature of the triangle (reference.ts) keeps its points per group;
for a Wythoff tiling each point gets its de and face kind, and for the snub its mirror image across
side 1 too (the kite). The largest de, the means of glow and relief, Inside's mean and the colouring's
mean colour come from them, the last weighted by area (the kinds' areas differ). The edge length per
area, as the line share uses it: a half-edge from G to the foot on mirror a counts 2h (both sides of
the line lie in T), or h when it lies along T's side; for the snub, deg · L / (2 area(T)) with L the
edge length and deg the vertex degree (2 per corner, 1 for a corner of angle π/2). Checked against the
tiling's edges clipped to the domain: equal to 2 × 10⁻⁷ in 10 groups.

**State and interface.** Content gets `construction` (an id above; "lines" or left out is version 1)
and, for free, `weights`; links `wy` and `wyw`. The Tiling tab gets a Construction list above the
lines; free shows a small triangle to drag G in (P, Q and R at its corners, the point at the weights'
barycentre; the content follows while dragging). Choosing a construction turns the mirror lines off,
choosing Lines with none on turns the tile edges back on; the colouring list is disabled while a
construction is shown. Key O (Shift+O) steps through the constructions. New presets, chosen on test
renders.

**Shader.** A compile switch WYTHOFF (0 lines, 1 triangle, 2 kite) and new Frame words: 16 lines (m_e,
and the line's two faces), 16 faces (mask, want, kind and colour; Mosaic vector), the counts. Version
1's code paths keep every line the benchmark patches match.

**Tests.** Unit: tables for every construction in all groups up to 8 and some large ones (sizes, snub
edges equal, each existing kind present); against brute force over the tiling's own edges and faces
(group elements walked from the origin, as the Python check): every point of the domain in exactly one
face and the right one, de equal to the distance to the whole tiling, the face across the nearest edge
on random edges' two sides, identities equal to their own words' and distinct within 3 R; the edge
length per area against clipping; the construction 010 with Mosaic draws step 14's Mosaic exactly (r =
2); means by area; saved states and refusals; the key. GPU against the reference: every construction,
each colour source, relief, the kite with odd words, the band, a free point; the card's list and a drag
of the free point; golden images of the new presets; and every benchmark patch still compiles.

### Changed while coding

- **The snub's walk names vertices and faces exactly.** The first walk keyed vertices by rounded
  coordinates and carried word matrices in floating point. In far groups the matrices overflowed
  ((64, 64, 64) gave NaN) and rounding split one vertex into two, so an edge ended up with one face.
  Now a vertex ρG is keyed by its tile matrix S_ρ mod ℓ (step 14's integers), and a face by its kind
  and its identity under that matrix. Positions come from reflecting points along the word, never
  from a word's matrix. The walk checks that every edge has exactly two faces and stops with an error
  past 20,000 vertices.
- **The meet test is done in Minkowski form.** Two convex polygons are apart when one of their edge
  lines (the Minkowski cross product of its ends) has the other polygon wholly outside, with a
  tolerance relative to the vectors' sizes. Each polygon's own side is taken from the mean of its
  vertices. In (p, 2, r) the kite's corner Q has angle π, so Q lies on the edge between its
  neighbours, and taking the side from that vertex gave the wrong answer: the face around P was lost.
- **Snub edges are compared by reflecting points.** The rotations' matrices left the three edge
  lengths equal only to 2 × 10⁻¹⁰. Reflecting G twice gives 10⁻¹², as the test now asks.
- **The tile prime skips primes where 2B is singular.** A snub triangle's vector solves 2B v_T =
  (1, 1, 1) mod ℓ. For 36 groups the chosen prime divided det(2B), for example (6, 16, 48) at 4127, so
  there was no solution. `tilePrime` now also requires det(2B) ≢ 0 mod ℓ, and the Python check
  agrees: (7, 3, 2) keeps 4129, and (6, 16, 48) moves to 4129. Only Mosaic's colours in those 36
  groups change.
- **`isHyperbolic` is an integer test.** It tests qr + pr + pq < pqr. In floats, 1/2 + 1/3 + 1/6
  came out just below 1, so (2, 3, 6) passed as hyperbolic. The Euclidean triples are now tested in
  every order.
- **No bitCount in the shader.** bitCount is GLSL ES 3.10, and WebGL2 is 3.00, so the fallback face
  uses a SWAR popcount (`bitsSet`).
- **The benchmark's patches were repaired, and now have a test.** Three experiments no longer applied
  or compiled:
  - reflect-branchless: rewritten for the fold block, which now toggles the kite's parity.
  - geometry-complex: its `w` clashed with depth's, so it is renamed `pw`.
  - uber-shader: now keeps the chiral and Wythoff variants.

  Also, perm-arrays refuses chiral programs, which never use the permutation. The new
  `tests/gpu/experiments.spec.ts` compiles every experiment for every variant it draws (159
  programs), so a shader change that moves a patch fails at once rather than at the next benchmark.
- **The Frame block has a layout test.** It holds 448 words, with the tables at words 252, 316, 380
  and 444. `tests/unit/frame.test.ts` reads each member's offset from its comment in `common.glsl`
  and checks it against std140.
- **The table sizes are smaller than planned.** The triangle needs at most 3 lines and 3 faces. The
  kite needs at most 9 lines and 9 faces, 7 of them meeting the kite. That holds over all 54,232
  tables of the 6,779 hyperbolic groups with p, q, r ≤ 20, and over the large groups in the test up
  to (64, 64, 64). The planned 10 lines and 7 + 4 faces came from the rounded walk.
- **The title names the group for a free point and for other groups.** For example "{7,3} free point",
  "(5,4,3) snub" and "(5,4,3) G at P". A disabled list is drawn dimmed.
- **Two older browser tests were tightened.** The tiling check's note is now found by its label
  (the Construction section adds a second note). The controller test no longer asks the centre to stay
  equal to the last bit while the right stick rotates. Every frame renormalises the camera, so the
  centre can move by one unit in the last place, depending on how many frames ran. It now asks for
  10⁻¹².
- **Presets were chosen on test renders.** The four are Snub {7,3} (Escher), Omnitruncated {7,3}
  (Blueprint), Truncated {3,7} (Ink) and Snub {5,4} (Mosaic). They come before Unit grid.

### Results

- Unit tests: 389 pass, among them the 7 groups (one with q = 2) against brute force for every
  construction and a free point. Each point lands in exactly one face and the right one, de is within
  10⁻⁹ of the distance to the whole tiling, the face across is right on both sides of random edges,
  identities are distinct within 3 R, and the edge length per area matches clipping to 10⁻⁶. 010
  with Mosaic and 001 with Inside draw version 1's sides 3 and 2 to 10⁻⁷, and the means by area
  match the analytic sectors and polygons to 2 × 10⁻³.
- GPU against the reference in 11 Wythoff cases: every construction, each colour source, relief,
  odd words through the kite, the Klein disk and the band, and a free point. All pixels are within
  2/255, except 99.998 % in the free point's depth case, with no pixel unexplained. The H³ and
  hyperboloid views draw the same content and appear in the golden images.
- Golden images: 150. The 118 from before are unchanged byte for byte, and 32 are new (the four
  presets in seven views, and four looks).
- Benchmark experiments: 159 programs compile. Frame time on a real GPU has not been measured yet
  (benchmarking equivalent formulas is left for later, as planned).

## Step 16: motifs

A motif is a picture that tiles the plane under the rotations alone, drawn sharp at any zoom. It uses
Escher's method of bent edges: start from the kite and bend its edges into curves. Each edge and its
partner bend the same way, so the shapes interlock. The motif's group is part of the motif, because
the curves are drawn for one kite shape. Version 1's tilings, the colourings and the Wythoff tilings
stay as they are.

**The tile.** The kite K = T ∪ s₁T has corners P, R, Q, R′ (R′ = s₁R). Its edges pair up under the
rotations:
- ρ_P = s₂s₁ turns about P by 2π/p and carries PR′ onto PR;
- ρ_Q = s₃s₁ turns about Q by 2π/q and carries QR′ onto QR.

A motif gives two curves: c₁ from P to R and c₂ from R to Q. Their copies c₁′ = ρ_P⁻¹c₁ and
c₂′ = ρ_Q⁻¹c₂ replace PR′ and QR′. The tile M is bounded by c₁, c₂, c₂′ and c₁′.

Each curve lives in its own frame, a copy of the plane in Poincaré coordinates:
- c₁ in the P frame, the world's own (P at 0, side 1 along +x, T above it). ρ_P is the turn
  w ↦ e^{2πi/p}w there.
- c₂ in the Q frame, the world moved along x by −d(P, Q) so that Q is at 0. ρ_Q is the turn
  w ↦ e^{−2πi/q}w there (QR leaves Q at angle π − π/q).

Each curve is a polyline in its frame, of at most 48 points. Its copy is then the same polyline
turned, exactly, and the seams match to the last bit. A curve drawn in one frame and turned about
the other centre would not: a Möbius map bends straight segments into arcs.

**When a motif is valid** (checked when one is loaded):
- c₁ runs inside the two triangles on either side of PR (T ∪ s₂T), and c₂ inside those on either
  side of QR (T ∪ s₃T). Each touches that region's boundary only at its own ends.
- The four curves meet only at P, R, Q and R′, and none crosses itself.

These two conditions make M a tile: every triangle hT of the tiling holds exactly two curves, the
images of c₁ and c₂ (or of c₁′ and c₂′), and they do not cross. They divide hT between the kites
on either side of its two edges. Every bulge lies in the triangles next to its own edge, so the
tile that holds a point of a kite is that kite's own, or the tile of a kite across one of its four
edges. One step of correction per pixel is always enough.

Checked in `design-checks/check_motifs.py` before this was written:
- the turns and edge pairings, to 3 × 10⁻¹⁵;
- 56 random valid motifs in 7 groups (68 refused);
- 11,200 random points: the tile is the one tile, of every kite near the point, whose whole boundary
  winds around it;
- 672 seam points either side of the curves get the two tiles that share them;
- points within 10⁻¹⁵ of PR and QR are never sent across by mistake.

**Per pixel.**
1. Fold into T as now. An odd word reflects once more across side 1 and appends 0, as the snub
   does, so the point y lies in K and the word w is even.
2. Find the tile:
   - If y lies in T (y ≥ 0 in the P frame), it can only lie in the bulges of PR or QR into T.
     - It is in PR's bulge when a ray from y, moving away from PR into T, crosses c₁ an odd
       number of times. The ray never meets PR itself, so a point within rounding of PR cannot be
       misjudged.
     - If so, the tile is the one across PR: reflect y by s₂ then s₁ (append the letters 1, 0).
     - Otherwise QR's bulge is tested the same way in the Q frame, with c₂ (letters 2, 0).
   - If y lies in s₁T, the candidates are the tiles across PR′ and QR′.
     - The point m = ρ_P y lies across PR, in s₂T. It belongs to M when a ray from m, moving away
       from PR, crosses c₁ an odd number of times. If so, y becomes m (letters 0, 1).
     - Otherwise ρ_Q y is tested against c₂ in the Q frame (letters 0, 2).
   - The letters extend the word, and the colour state follows them as it follows the fold.
3. de is the distance to the nearest of the four curves:
   - to c₁ from y and from ρ_P y (that is the distance to c₁′), in the P frame;
   - to c₂ from y and from ρ_Q y, in the Q frame.

   Each is the hyperbolic distance to the polyline's nearest point in the frame (the Euclidean
   nearest point z), 2 atanh(|w − z| / |1 − z̄w|). Against the true distance to the polyline this
   is within 10⁻⁸ relative below 10⁻³, and 1.5 × 10⁻⁴ at 0.1. The conformal factor times the
   Euclidean distance would be within 0.5 % at 0.05. The distance is continuous across every seam,
   because both sides measure in the same frame.
4. The tile across the nearest curve is reached by appending 1, 0 (across c₁), 0, 1 (c₁′), 2, 0 (c₂)
   or 0, 2 (c₂′). Near a curve, its colour is blended in as the colourings' neighbours are.

**Features**, drawn in order over the tile's body, in the P frame:
- circle (centre, radius);
- ellipse (centre, two radii, angle), with the usual cheap signed distance;
- stroke: an open path with a width that may taper from one end to the other, at most 16 points;
- shape: a closed path filled, at most 32 points.

Paths are given as cubic Bézier chains and sampled once into polylines. A feature's coverage is
clamp(0.5 − d·λ / ℓpx, 0, 1), with λ = 2/(1 − |w|²) and d the signed distance in the frame. A
bounding circle per feature skips it where it cannot reach. A motif holds at most 24 features and
128 feature points.

Each feature names a colour slot:
- the tile's colour, with a tone in [−1, 1] (negative toward black, positive toward white);
- the line colour, with a tone;
- black or white.

**Colours by source.**
- Colouring: the kite of an even element h gets π(h)(0), as chiral colourings already do. A mirror
  colouring therefore colours kites by the rotations' action on colour 0.
- Mosaic: the kite's identity A·S_w·v. Here v is v_T, so every kite is its own, or w_P when the
  motif colours by the polygon around P (Rosette: the p kites around P share a colour).
- Distance: the field, as now.
- Depth: the depth of the tile's even triangle, constant over the tile.
- Inside: de over its largest value.

A feature in the tile slot takes the source's colour at that pixel, toned. Relief and glow use de
and the direction away from the nearest curve, mapped to the screen through the frame's tangents.
The motif's outline is drawn with the look's line width; version 1's mirror lines can still be
drawn over it.

**The far-tile colour.** Every step above is affine in the tile's colour: relief scales it, glow,
tones and features mix toward fixed colours. So each quadrature point of the kite (T's points and
their images across side 1) gives a pair (α, β), and the colour there is α·tile + β. The means of α
and β, and the mean tile colour, give the fill:
- for the colouring source, the mean over the colours in colour 0's orbit under the rotations;
- for the others, as now.

The outline's length per area is (len c₁ + len c₂) / area(T).

**Format.** A motif is JSON:
- `name`, `group` [p, q, r], the default `colouring` (a ContentState name) and `cell` ("kite" or
  "P");
- `pr`: c₁'s Bézier control points between P and R, as 3n − 1 points with P and R implied;
- `rq`: c₂'s, between R and Q, in the P frame (sampled there, then moved to the Q frame);
- `features`.

The built-ins live in `src/content/motifs/*.json`. The same format can be loaded from a file.
Version 1 of the format.

**Storage.** A second uniform block, Motif (binding 1), is packed when the content changes:
- the frame numbers: cos and sin of both turns, and cosh and sinh of d(P, Q);
- the two inward directions away from PR and QR;
- the counts, and the curves' bounding circles;
- Mosaic's vector;
- c₁ and c₂, two points per vec4;
- per feature, its kind, points and slot, its geometry and its bounding circle;
- the feature points (x, y, half width).

This is about 4.5 KB, under WebGL2's 16 KB minimum. The compile switch MOTIF 0 or 1 adds the code.
CHIRAL, SOURCE and RELIEF work with it, and WYTHOFF is 0.

**State and interface.**
- Content gets `motif`: a built-in's id, or the loaded motif itself.
- Links carry `mo=<id>`, or the loaded motif as base64url JSON (`md`, at most 16 KB).
- The Tiling tab gets a Motif list (None, the built-ins, the loaded one) and "Load motif…".
- Choosing a motif sets its group and default colouring, sets Construction to Lines and turns the
  mirror lines off. Choosing another group drops the motif.
- M (Shift+M) steps through None and the built-ins.
- The title names the motif. Four presets, chosen on renders.

**Built-ins** (our own designs; none traced from Escher):
- **Shoal** (3,3,4): fish, a 4-colour chiral colouring.
- **Moths** {6,4}: two colours, each moth's neighbours across both edges in the other colour. The
  rotations only pair the edges, so a moth cannot be exactly mirror-symmetric (its edge across
  PR′ is a turned copy, not a mirror image). It is drawn symmetric in its markings.
- **Rosette** {8,3}: coloured by octagon (a colouring that keeps colour 0 around P), eight curved
  petals around each P, Mosaic by the polygon around P.
- **Birds** (4,4,3): a 3-colour chiral colouring, wing tips at the threefold points.

**Tests.**
- Unit:
  - every built-in is valid, and broken motifs are refused with the reason;
  - the per-pixel tile equals brute force (every kite near the point tested by a winding number of
    its whole boundary) at random points in several groups;
  - seams: points just either side of every curve get the two tiles;
  - re-centering leaves the colours alone;
  - the means equal dense sampling;
  - kite identities are distinct within 3 R;
  - saved states and links round trip.
- GPU: the reference per motif and source, with relief, odd words, the band and a loaded motif; the
  card's list and the file; golden images of the four presets in every view; and the benchmark
  patches still compile.

### Changed while coding

- **Feature paths are sampled to a tolerance.** Sampling each Bézier segment evenly spent the
  128-point budget on straight strokes. Now a segment gets as many pieces as it needs to stay within
  2 × 10⁻⁵ of its curve (about a thousandth of a tile): a straight one costs one piece, a curved one
  more, up to the limits. The curves c₁ and c₂ are still sampled evenly, 48 points each.
- **A curve has at most 47 segments.** Each segment needs a sample of its own. A curve of 48 or more
  segments sampled to nothing, so it is now refused with the reason. This turned up while writing
  the test of the largest motif a link can carry.
- **The far-tile means have a quadrature of their own.** The tile is not T, so the means are taken
  over the kite: T's 160-step quadrature points and their images across side 1 (as odd points),
  each run through the per-pixel tile, de and feature. It takes 200 to 300 ms, once per motif.
- **The outline is drawn over the features.** A feature cut by the tile's edge then ends cleanly at
  the outline.
- **The benchmark's experiments follow the motif code.**
  - The fold's parity flag is now declared for `WYTHOFF == 2 || MOTIF`, and the reflect-branchless
    patch was changed to match.
  - perm-arrays stopped applying at all: the motif's colour code repeats one of the lines it
    patches, so the patch found two matches. It now anchors on version 1's lines, and it refuses
    motifs as it refuses chiral colourings.
  - uber-shader declares the Motif block once, above its copies of the chunk.
  - The experiments test now compiles every experiment with a motif too: 207 programs.
- **Two rules for drawing a motif, learned when the first built-ins were refused.**
  - At R, c₁'s bulge outward widens the tile's angle at R and narrows the angle at R′ by the same
    amount, and so does c₂'s. The two deviations together must stay below π/r, or c₁′ and c₂′
    cross at R′.
  - Near P the wedge of T ∪ s₂T is only 2π/p wide (22.5° each side of PR for Rosette's octagons),
    so a curve leaving P stays close to PR.

  Also, a bulge on c₁ is a dent on c₁′, so a tile can be symmetric in its markings but never in its
  outline.
- **A link carries a loaded motif of up to 128 KB, not 16 KB.** The largest motif compileMotif
  accepts, written in full float64, takes between 32 and 64 KB of base64url, so 16 KB would have
  refused valid motifs. The limit only stops a broken link.
- **A loaded motif keeps only the format's fields** (`cleanMotifSpec`), in saved states, links and
  the card's list. Anything else a file holds is left behind.
- **A loaded motif's colouring is checked against its group.** compileMotif knows nothing of
  colourings, so a motif whose default colouring its group does not have is refused on loading
  ("its colouring: …"), and in saved states and links.
- **Choosing a motif also shows the tiling** if it was off. Another construction than Lines drops the
  motif, as another group does.
- **Motif files can also be dropped or pasted on the window**, beside the card's "Load motif…". The
  card keeps the last loaded motif in its list for the visit. M steps through None and the
  built-ins; a loaded motif counts as None there.
- **Presets were chosen on sheets of eight looks.** Shoal in Gilded, Moths in Ink, Rosette in Mosaic
  (each octagon its own colour) and Birds in Escher. They come before Unit grid. The golden images
  add four looks of their own: Moths in Ink, Rosette in Mosaic in the Klein disk, Birds in Escher in
  the half-plane and Shoal in Relief in the band.
- **The planned dense-sampling test became a brute-force integral over the bent tile.** It uses a
  grid in the disk, the winding number of the tile's whole boundary, and the distance to that
  boundary. It shares nothing with the quadrature, neither the domain (the tile, not the kite) nor
  the method.
- **Mosaic's identities are tested farther out than planned**, to distance 5, not 3: every kite has
  its own, the same by any word that reaches it, and the polygons around P pair one to one with
  their identities.
- **A fix in the brute force itself.** Its kite keys printed −0 and 0 differently, so the identity
  kite was found twice. The keys are now whole numbers.

### Results

- Unit tests: 410 pass. Among them:
  - the motif engine against brute force in 7 groups (the tile whose whole boundary winds around
    each point, the seams, de within the measured error);
  - the four built-ins and their presets, choosing and leaving a motif, and reading a motif file;
  - Mosaic's identities to distance 5 in the four groups;
  - saved states and links: 1000 random states, now with motifs (half of them loaded), bit for bit,
    and the largest motif there is through a link;
  - the far-tile means against the integral over the bent tile. The tile's area is within 10⁻³ of
    the kite's, the fill factor within 2.5 × 10⁻⁴, and glow with features within 5.6 × 10⁻⁴.
- GPU against the reference in 11 motif cases: every colour source, relief, glow, odd words,
  Mosaic by kite and by polygon, a deep zoom, mirror lines drawn over a motif, a loaded motif with
  pixel lines, the Klein disk, the band and inside H³. All have 0 unexplained pixels. Nine are
  100 % within 2/255; Shoal with relief is 99.998 % and Shoal's inside source with glow 99.995 %.
- Golden images: 182. The 150 from before are unchanged pixel for pixel, and 32 are new (the four
  presets in seven views, and four looks). The worst new pixel is 20/255 in Birds' local view, at
  99.992 % within 2/255: a pixel where three tiles meet, put in another tile by float32.
- Browser tests: 187 pass, among them the card's Motif list, "Load motif…" with its refusals, a motif
  file dropped on the window, and M.
- Not done yet: frame time with a motif on a real GPU (benchmarking is left for later, as planned).
  Features toned −0.4 are hard to see on the darkest tiles of some looks. The presets use looks
  where they read well.

## Step 17: your own tile

Your own picture fills the tile, in one of two ways:
- **Kaleidoscope** (the default): the picture fills the fundamental triangle T and is mirrored at its
  three sides, as in a kaleidoscope. It is seamless whatever the picture holds.
- **Chiral**: the picture fills the kite K = T ∪ s₁T and is only turned, about P by ρ_P and about Q
  by ρ_Q (step 16). Edges pair up, PR′ with PR and QR′ with QR, so the picture is seamless only when
  it is drawn to match along partner edges. A template shows where.

The picture is drawn over version 1's tiling: with Lines and without a motif. Wythoff tilings,
motifs, colourings and every view stay as they are.

**Where the picture sits.** The fold already puts every point x in T, in the world's own frame
(P at 0, side 1 along +x, T above it). For the chiral mode, an odd word reflects once more across
side 1, as motifs do, so y lies in K. The picture is read at w = toDisk(y), the Poincaré coordinate
in that frame. Poincaré coordinates are conformal, so the picture keeps its shapes locally; side QR
is an arc there, PQ and PR are straight.

A placement {x, y, size, turn} puts the shape on the picture:
- x, y: the centre of the shape's bounding box (T, or K, in w), as fractions of the picture's width
  and height (y down);
- size: the box's larger side as a fraction of the picture's shorter side;
- turn: the shape turned on the picture, in degrees, counterclockwise as seen.

The default is x = y = 0.5, size = 0.84 (an 8 % margin on each side of the central square), turn 0.
Since the placement is relative, the picture keeps its framing when the group changes.

With W × H pixels, s = size · min(W, H) / E pixels per unit of w (E the box's larger side), c the
box's centre and θ the turn, the picture's pixel for w is

    px = x·W + s·( dx cos θ − dy sin θ ),   py = y·H + s·( −dx sin θ − dy cos θ ),   (dx, dy) = w − c,

so with turn 0 the picture stands upright in T as T stands on the screen at home. The texture
coordinate is (px / W, py / H), an affine map of w (two rows of three numbers). Outside the picture
it repeats mirrored (MIRRORED_REPEAT), so a shape moved past the picture's edge never smears.

**Sampling.** The picture is a texture with all its mip levels, read with an explicit level of
detail from the pixel's footprint (L. Williams' mip-mapping). A pixel of plane length ℓpx covers
s · ℓpx · (1 − |w|²) / 2 texels of level 0 (the Poincaré metric is 2|dw| / (1 − |w|²)), so

    lod = clamp(log2(s · ℓpx · (1 − |w|²) / 2), 0, maxLod),

with maxLod the last level, or the level where the whole shape is one texel when that comes first.
The views that are not conformal use ℓpx as every other filter here does.
- The texture is SRGB8_ALPHA8, so the hardware decodes to linear light before it filters. Colours
  are stored premultiplied by alpha (in linear light, then encoded), so transparent edges filter
  without fringes.
- The levels are made on the CPU, not by generateMipmap: an exact area average (a box of two, or of
  between two and three texels for an odd size) in linear premultiplied light, then encoded. The
  reference renderer reads the same bytes with the same trilinear rule (GL's level and texel
  selection, mirrored repeat), so the shader and the reference see identical levels.
- Pictures are cut down to 2048 pixels on the longer side when they are loaded.

**Chiral seams.** Across a kite edge the neighbour's picture is a different part of the picture. As
the colourings do, a pixel within half a pixel of the edge is blended toward the neighbour, by
max(0, 1/2 − d / ℓpx), d being the distance to the edge. The neighbour's colour at y is the picture
at its own point:
- y in T (an even word): across PR at s₁s₂x (ρ_P⁻¹y), across QR at s₁s₃x (ρ_Q⁻¹y);
- y in s₁T (odd): across PR′ at s₂x (ρ_P y), across QR′ at s₃x (ρ_Q y).

Each sample has its own level of detail (ρ_Q is not a turn about the origin of w). The two edges'
distances are those of the folded point x to sides 2 and 3, already known. The kaleidoscope needs no
blend: the mirrored picture is continuous across every side.

**Colour.** The picture p (premultiplied, alpha a) replaces the source's colour c of version 1:
- as it is (the default): col = p.rgb + c · (1 − a), so the look shows through where the picture is
  transparent;
- tinted: col = c ⊙ (p.rgb + 1 − a), the picture multiplied by the look's colours (the colouring's
  tiles, the depth rings and so on).

Relief, glow, lines and the far-tile fade then go on as before.

**The far-tile colour.** At a quadrature point of T (and, for the chiral mode, its mirror image
across side 1, with the same weight and de), let k = f(1 − γ) be the relief factor times one minus
the glow, and p, a the picture there. The picture is sampled at the level of the point's own share
of the area, so the sum is a box-filtered integral.
- As it is: mean = mean(k p) + mean(c) · mean(k (1 − a)) + mean(γ) L. The fill factor is
  mean(k (1 − a)), and mean(k p) joins the glow's constant.
- Tinted: mean = mean(c) ⊙ mean(k (p + 1 − a)) + mean(γ) L. The fill factor is now a colour.
- The inside source's c varies with de, so its terms are summed point by point; the distance
  source's c is the field at the pixel, multiplied by the fill factor there.

Shading gets the fill factor as a colour (fillFactor; avgFactor stays its scalar for the shader's
Frame block when there is no picture). The samples at the points are kept per picture, group, mode
and placement, so a look change only re-sums them.

**Shader.** The compile switch TILEIMAGE 0 (none), 1 (kaleidoscope) or 2 (chiral) adds the code; it
needs WYTHOFF 0 and MOTIF 0, and works with every SOURCE, CHIRAL and RELIEF. The picture's numbers
are plain uniforms, not part of the Frame block: the map's two rows, s, maxLod, the tint, and the
distance source's fill factor. The picture is on texture unit 2 (the palette stays on 1). The
renderer keeps the textures of the last two pictures.

**Storing the picture.** The picture's bytes are large (up to a few MB), so the content state does
not hold them:
- ContentState gets `tileImage`: { mode, tint?, place, id }, where id is the SHA-256 of the
  picture's data URL. It stays small, so comparing states and the session's saves stay cheap.
- The bytes live in a registry by id, and in IndexedDB for the session and your presets (localStorage
  holds about 5 MB in all, too little for pictures). Pictures in use are kept; of the others, the 8
  used last.
- Screenshots and exported preset files are whole: their saved state carries the data URL (`src`)
  beside the id. Reading one registers the picture and checks that the id is the data URL's hash
  (a file's src wins over its id).
- A loaded file is kept as it is when it is PNG, JPEG or WebP, at most 2048 pixels and at most
  4 MB. Otherwise it is cut down and written again: JPEG at 0.92 when it is opaque, WebP at 0.92
  with alpha (PNG where the browser cannot write WebP). The texture is always made by decoding the
  stored data URL, so a session restored or a screenshot opened elsewhere draws the same pixels.
- Links carry the settings and the id (`ti=k.<id>` or `ti=c.<id>`, `tit=1` for the tint, `tip=x,y,
  size,turn` when not the default), never the bytes. A link opened where the picture is known
  draws it. Elsewhere the tiling opens without it, and a note says the picture is only in the
  screenshot or file that holds it. The settings are kept, so loading the picture then uses them.

A picture is decoded after it is loaded, so the content is drawn without it for a moment, then
rebuilt.

**When it is drawn.** Only with Lines, without a motif, and with the tiling shown. Otherwise it is
kept in the state but hidden, and the card says why. Loading a picture sets Lines, drops the motif
and shows the tiling. It stays when the group, colouring or look changes. The title names it:
"{7,3} kaleidoscope", "(3,3,4) chiral picture".

**Card**, Tiling tab, a Tile picture section after Motif:
- Load picture…, Remove, Export template;
- Kaleidoscope or Chiral, and Tint with the look's colours;
- a preview of the picture with the shape drawn over it (partner edges in one colour). Dragging in it
  moves the shape;
- Size and Turn sliders, and Reset;
- a note: what the mode does, or that the picture is hidden, loading, or not held here.

A picture dropped on the window (an image without a Hyperscope view in it) or pasted also loads.

**Template** (1024 × 1024 PNG, for the default placement, so a drawing on it loads back in place):
the shape on a light sheet, the outside shaded. For the chiral mode, PR and PR′ share one colour and
QR and QR′ another, with ticks at equal hyperbolic distances from P (on PR, PR′) and from Q (on QR,
QR′): matching ticks meet in the tiling. Corners are labelled P, Q, R, R′, with the group and a line
of text on how the edges match. For the kaleidoscope it shows T with its three mirror sides.

**Tests.**
- Unit:
  - SHA-256 against Node's;
  - the levels: sizes for odd and even sides, each level's mean equal to level 0's, premultiplying,
    an opaque level 0 stored as loaded;
  - sampling: texel centres, mirrored repeat, trilinear between levels;
  - the placement: the default fit, size and turn, every group;
  - kaleidoscope seams: the colour continuous across all three sides, and the same at every image of
    a point under the group;
  - chiral: the same at ρ_P x and ρ_Q x, and continuous across the kite's edges with the blend;
  - the template: its ticks on PR′ and QR′ turned by ρ_P and ρ_Q land on those on PR and QR;
  - the means against a dense sum over the picture's texels inside the shape, both modes, tinted or
    not, with relief and glow, and the inside and distance sources;
  - saved states and links with a picture, files with src, refusals, and the hidden cases.
- GPU: the reference with a test picture in both modes, tinted, with alpha, a deep zoom, far away,
  the band and inside H³; the card (load, mode, tint, sliders, drag, reset, remove, template);
  the session after a reload; a screenshot opened in a fresh browser; a link without the picture
  and its note; an image dropped on the window; and the benchmark patches compiled with a picture.

### Changed while coding

- **The levels' sRGB encoding is a table.** Encoding linear light back to sRGB bytes with `pow` took
  most of the 2.6 s that a 2048 × 1536 picture's levels first cost. A table of 65 536 buckets over
  linear light, each checked against the byte boundaries it straddles, gives the same byte as `pow`
  for every one of 2 million test values, and an even side takes a 2 × 2 fast path. The levels of a
  2048 × 1536 picture now take 0.2 to 0.35 s opaque and 0.4 to 0.6 s with alpha (Node).
- **SHA-256 is the app's own, written with 32-bit integer locals** (about 30 ms per MB; the first
  version took 250 ms for a 3 MB picture). The browser's `crypto.subtle` is asynchronous, but
  reading a saved state is not (a file's src gives the picture's id there), and `crypto.subtle` is
  missing on a page served over plain HTTP from another machine.
- **The button is called "Template"**, not "Export template", to fit the row beside "Load picture…"
  and "Remove". The mode buttons choose the template's mode even before there is a picture, and the
  next picture loads in that mode.
- **The wheel over the preview resizes the shape**, beside the Size slider.
- **A PNG without a Hyperscope view loads as the tile picture**, as other pictures do, instead of
  the note that it holds no view. A file that is not a picture says "it is not a picture this
  browser can read".
- **A picture loaded after a link takes the link's settings** only while the link's picture is
  missing here; any other picture is placed afresh in the middle.
- **The card's picture buttons have their own row class** (`hs-picture-actions`): sharing the motif
  row's class gave the motif test two file inputs to choose from.
- **The benchmark's experiments follow the picture code.**
  - The fold's parity is now declared for `WYTHOFF == 2 || MOTIF || TILEIMAGE == 2`, and the
    reflect-branchless patch was changed to match.
  - fold-dihedral keeps the parity too (the mirror in its wedge step and the side-3 step are odd,
    its turns even), so it draws the chiral picture.
  - uber-shader declares the picture's uniforms once, above its copies of the chunk, and compiles
    the picture variant.
  - The experiments test compiles every experiment with both picture modes too.
- **The far-tile test integrates over the disk, not over the texels.** A grid in w over the shape's
  box, each cell weighted by the hyperbolic area 4/(1 − |w|²)² · Δx · Δy and the picture sampled at
  level 0, checks the quadrature's means, which share nothing with it but the picture.
- **The golden test has its own time limit** of 10 minutes: its 182 pictures take about two
  minutes on the software renderer, at the edge of the default limit.

### Results

- Unit tests: 444 pass, 34 of them new. Among them:
  - SHA-256 against Node's, the levels (sizes, means, premultiplying), sampling and the placement;
  - kaleidoscope seams and invariance under the group, chiral invariance under ρ_P and ρ_Q and
    continuity across the kite's edges with the blend, and the template's ticks paired by ρ;
  - the far-tile means against the integral over the disk: area within 1.3 × 10⁻⁴, the fill factor
    within 4 × 10⁻⁵, glow and picture within 7 × 10⁻⁵;
  - saved states and links with a picture (1000 random states, 30 % of them with one, bit for bit),
    files carrying src, and the refusals.
- GPU against the reference in 8 picture cases: both modes, relief, tint with alpha, depth, a deep
  zoom, Mosaic, the inside source with glow in the Klein disk, the distance source tinted in the
  band, and inside H³. All are 100 % within 2/255 with 0 unexplained pixels; the worst pixel is
  2/255.
- Golden images: the 182 from before are unchanged pixel for pixel.
- Browser tests: 200 pass, 5 of them new for the picture: the card section (template in both
  modes, load, mode, tint, size, turn, drag and wheel on the preview, reset, remove), a construction
  and a motif hiding the picture and giving it back, the session after a reload, a link in a fresh
  browser and its note, the picture loaded again under the link's settings, a screenshot carrying
  the picture to a fresh browser, a pasted image, a broken file, a large picture cut down to
  2048 × 410 JPEG, and presets exported with their pictures and read back elsewhere. Writing them
  found one bug: loading the picture a link names lost the link's placement, because the new
  picture was registered (as loading) before the link's was asked whether it was missing.
- The benchmark's experiments: 325 programs compile, the picture's included.
- Loading a 2048 × 1536 picture in Chromium here: reading the file and its hash 0.05 to 0.18 s, the
  levels 0.34 to 0.47 s (once 0.94 s). The built file opened from disk keeps the picture in IndexedDB
  across a reload.
- Not done yet: frame time with a picture on a real GPU (benchmarking is left for later, as
  planned), and golden images of pictures (the reference cases cover the drawing).

## Inside H³: the view tilts with the zoom

Asked for after step 12: inside H³ the view should look further down as the eye rises and come up
toward the horizon as it descends. Until now a zoom changed only the height, so from high up at the
home pitch the whole screen was sky: at 6 R the horizon is 89.7° below level, and a view 30° down
with a 70° field never reaches it.

**The rule.** With α(h) = asin(tanh h) the horizon's angle below level, r = π/2 − α the angle from
the horizon down to straight down, and d = φ − α the view's angle below the horizon, a zoom keeps the
tilt

    c = d r / (r − d)   when d ≥ 0   (0 at the horizon, ∞ straight down),
    c = d / α           when d < 0   (−1 level, 0 at the horizon),

and sets the pitch at the new height from it: d = c r / (c + r), or α (1 + c) above the horizon.
So 1/d = 1/c + 1/r: while r is large the view stays about c below the horizon, which keeps the
horizon near its place on the screen; as r shrinks (the eye rises and the plane becomes a disk
below) d closes on r and the view turns to straight down, bringing the disk to the screen centre.
- At any height c maps the pitches [0, π/2] one to one, so the pitch never leaves its limits and
  no clamp is needed; straight down stays straight down, level stays level.
- A zoom out and back in returns the same pitch (to rounding), however many steps the zoom spring
  takes, since c does not change along the way.
- Nothing new is saved: c is computed from (h, φ) when a zoom needs it.

From home (0.3 R, 30° down, the horizon 13.1° above the centre, c = 15.9°):

| eye | 0.01 R | 0.1 R | 0.3 R | 1 R | 2 R | 3 R | 6 R |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pitch | 14.1° | 19.1° | 30° | 61.0° | 82.4° | 88.5° | 90.0° |
| horizon above the centre | 13.5° | 13.4° | 13.1° | 11.4° | 7.8° | 4.2° | 0.28° |

A first rule, keeping the share σ = d / r, was tried and dropped: from 1.7 R it left the view only
3.7° below the horizon, so the disk of the plane was cut off by the screen's bottom edge.

**Where it applies.** Every zoom: the wheel, + and −, Z and X, a pinch, the controller's triggers,
and the eye-height field in the View tab (the stand-in for the magnification field, a zoom typed
in). The ground under the cursor is held as before: holdAt moves the eye by the transvection from
where the cursor's ray meets the plane after the change to where it met it before, whatever the
change is. The mouse look, the right stick, the walk and Q E leave the height alone and set the
pitch as before; the next zoom keeps the share they left. Home goes back to 0.3 R and 30° down.

The reading taken of "look down or sideways when I zoom": the tilt down. The view does not also
turn sideways toward the cursor: holding the ground under the cursor already brings that ground
toward the eye as it descends.

**Tests.**
- Unit: the tilt and back for pitches and heights across the limits; the table above; limits kept;
  straight down and level kept; a zoom out to 6 R and back in 40 steps returning the pitch to
  10⁻¹²; every zoom path tilting (zoomAt, the controller's triggers); the ground under the cursor
  still held to 10⁻⁹ of a pixel through zooms that tilt.
- GPU: the wheel inside H³ tilts and still holds the ground; the eye-height field tilts; from
  6 R the ground is on the screen.

**Results.** Unit tests: 447 pass (3 new; the zoom tests of the controller and of zoomPicture now
expect the tilt). Browser tests: 200 pass, with the wheel inside H³ checked to tilt and still hold
the ground under the cursor to half a pixel, the eye-height field tilting to 1.5 R and from 6 R
still showing the ground at the screen centre, and back at 0.3 R the home pitch again to 10⁻¹².
Review pictures from home zoomed out to 0.85, 1.7 and 4.8 R are in the project's review folder.

## Step 18 plan: benchmarks of the new work

Written before coding. The design's benchmark list for the steps after version 1: the new views
against the Poincaré disk at 1080p and 4K; Wythoff tables in uniforms against a texture; Mosaic's
integer path; motif curves of 24 against 48 points. Steps 16 and 17 added frame time with a motif
and with a picture. The harness is step 10's: `npm run bench` for the baseline (one sample pass per
scene at 1920 × 1080 and 3840 × 2160) and `npm run ab` for equivalent formulas (checked to draw the
same picture, then timed ABBA over four rounds of batches of at least 50 ms).

**Baseline scenes** (`bench/scenes.ts`, after version 1's):
- every view with {7,3}, {8,3} and (2,3,7) is already there, so the band, inside H³ and the
  hyperboloid sit beside the Poincaré disk at both sizes;
- colourings: the chiral seven-colour preset, and Mosaic against the same scene with the colouring
  source (Mosaic's integer path costs the difference: three uvec3 steps per reflection and a hash);
- Wythoff: the truncated {3,7}, the omnitruncated (7,3,2) and the snub {5,4} with Mosaic, and a free
  point, in the Poincaré disk and the half-plane;
- motifs: the four built-ins in the Poincaré disk and the half-plane, and Birds inside H³;
- tile pictures: a 2048 × 2048 picture in both modes at home, tinted, and at a deep zoom (where every
  pixel reads the finest level), against the same scene without the picture.

**A/B runs** (`bench/experiments.ts`), besides version 1's eight, which run again on today's code:
- **wythoff-texture**: the tables (lines, faces, Mosaic ids; Frame words 252 to 447) read with
  texelFetch from two small textures (RGBA32F for the lines, RGBA32UI for faces and ids) instead of
  the uniform block. Scenes: the Wythoff ones above.
- **motif-24**: c₁ and c₂ sampled with 24 points instead of 48, the motif compiled again for B (the
  shader's loops already stop at the count). Equivalence by the golden rule against A, and the
  curve's own error at 24 points reported in plane units. Scenes: the four motifs.
- Mosaic has no equivalent formula to try (a float form of the steps mod ℓ = 4129 would not be exact
  in float32: products reach 1.7 × 10⁷ > 2²⁴), so its cost is measured by the baseline pair above.
- Pictures have none either: the explicit level of detail is what keeps fold seams free of the
  hardware's derivative-based level; their cost is the baseline pair.

**Rule** as in step 10: B is adopted only if it passes the equivalence check and is at least 10 %
faster on a graphics card in every scene it applies to; software-renderer numbers are recorded but
decide nothing.

**The real-GPU run** on your PC through a Remote Control session (you approve one prompt):
`npm install` if needed, `npm run bench -- --headed --channel msedge --tag step18` and
`npm run ab -- --headed --channel msedge`. The reports come back to `bench/results/` and into these
notes, with the decisions.

**Tests.** `tests/gpu/experiments.spec.ts` compiles the new experiments for every variant they
draw; the A/B page's equivalence check runs here on the new scenes; the bench page draws every new
scene once without an error.

### Changed while coding

- **motif-32.** 24 points per curve missed the equivalence check in four of the six motif scenes
  (below), so the same experiment runs again with 32 points, the next count that halves the curve
  error. Both are timed on the graphics card for the record; the rule decides as before.
- The motif's curve count is a parameter of `compileMotif` (default 48, `MAX_CURVE_POINTS`), so the
  experiment compiles B's motif with the production code instead of a copy of it.
- `tests/gpu/experiments.spec.ts` has a second test: all 61 benchmark scenes draw at 192 × 108
  without a GL error and with more than eight colours, and each pair the plan compares (Mosaic
  against its colouring source, a picture against lines only, kaleidoscope against chiral, tinted
  against plain, the deep picture against the deep lines, a free point against the vertex) differs in
  at least 5% of pixels (they differ in 16–100%), so a scene that silently lost its picture or look
  cannot time the same work twice.
- The benchmark table's scene column is 52 characters wide, for the new scene names.

### Results on the software renderer

`npm run ab -- --only wythoff-texture,motif-24` and `--only motif-32` here (SwiftShader;
`bench/results/2026-11-10_…_ab_wythoff-texture+motif-24` and `…_ab_motif-32`, each `.json` with a
`.txt`). The times decide nothing; equivalence does not depend on the machine, since B draws other
geometry, not other arithmetic.

| Experiment | Scenes | Equivalent (within 2 / worst) | B / A, SwiftShader |
| --- | --- | --- | --- |
| Wythoff tables from textures | 8 | yes, identical in all 8 (100% / 0) | 0.90–1.13 |
| motif curves, 24 points (23 drawn) | 6 | no in 4 of 6: poincaré Shoal 99.60% / 14 and Rosette 99.53% / 17 pass; Moths 99.13%, Birds 99.14%, half-plane Birds 97.38% / 45, H³ Birds 98.79% / 102 fail; curves within 4.4–9.6 × 10⁻⁴ R of A's | 0.72–0.84 |
| motif curves, 32 points (31 drawn) | 6 | no in 2 of 6: the four poincaré scenes pass (99.77–99.95%, worst 6–26); half-plane Birds 98.52% / 35 and H³ Birds 99.18% / 57 fail; curves within 2.2–4.8 × 10⁻⁴ R | 0.77–0.84 |

The curves are sampled at even steps of each Bézier segment's parameter (these curves have two
segments, so 48 asks for 47 points, 32 for 31 and 24 for 23), and the polyline's distance from the
curve falls about as the square of the count: Birds' from 9.6 to 4.8 × 10⁻⁴ R between 23 and 31 points.
Birds has the largest error and fails first, in the half-plane and inside H³ most. Neither count can
be adopted by the rule, whatever the graphics card says. Points placed by the curve's bend rather
than evenly (`sampleChain` already counts pieces by flatness, but per segment and only for features)
might reach 48 points' accuracy with fewer; that would be a new formula, worth trying only if motifs
turn out costly on the graphics card.

### Results on your graphics card

Both runs on your PC's NVIDIA GeForce RTX 5060 Ti (Edge 157, Direct3D 11 through ANGLE), in
`bench/results/`: `2026-11-10_…_step18.json` (the baseline, 61 scenes at both sizes) and
`2026-11-10_…_ab.json` with its `.txt` (every experiment, version 1's included, on today's code).

| Experiment | Scenes | Equivalent | B / A, RTX 5060 Ti | B / A, SwiftShader | Decision |
| --- | --- | --- | --- | --- | --- |
| Wythoff tables from textures | 8 | yes, identical | 0.95–1.04 | 0.90–1.13 | kept the uniform block: no gain |
| motif curves, 24 points | 6 | no in 4 of 6 (as in software, to the pixel count) | 0.56–0.64 | 0.72–0.84 | kept 48: not equivalent |
| motif curves, 32 points | 6 | no in 2 of 6 (half-plane and H³ Birds) | 0.71–0.76 | 0.77–0.84 | kept 48: not equivalent |

Version 1's eight, run again, land within a few percent of step 10 and keep their decisions:
fold-dihedral 0.93–1.00, reflect-branchless 1.06–1.57, geometry-complex 1.15–1.27,
footprint-derivatives 1.02–2.03 and still not equivalent, uber-shader 1.07–1.11 a sample (its
compile, now 7 variants, 50 ms against 547 ms), perm-arrays 1.87–2.40, and the grid drawn once
0.27–0.78 for a still picture and 1.88–3.41 for a moving frame (adopted in step 10 for still
pictures only, as before).

**Baseline** (`npm run bench`; one sample pass, read in steps of 0.1 ms):
- Without a motif, every scene takes 0.3–1.0 ms at 1920 × 1080 and 0.6–2.0 ms at 3840 × 2160 (the
  Midnight look is the slowest, as in step 10).
- The newer views: the band, inside H³ and the hyperboloid take 0.4–0.5 ms and 0.7–1.1 ms, against
  the Poincaré disk's 0.4 and 0.7. They fill more of the screen (62–100% against the disk's 40%).
- Wythoff tilings take 0.3–0.4 and 0.6–0.8 ms, no more than the plain tiling; the free point the same.
- Mosaic takes 1.4–1.75 times its twin with the colouring source at 1080p and 1.56–2.17 times at 4K
  (0.6–0.7 ms against 0.4–0.5; 1.3–1.9 against 0.6–1.1): the integer steps and the hash.
- A tile picture adds at most 0.1 ms at 1080p and 0.3 ms at 4K (the chiral picture in the
  half-plane, 1.1 against 0.8 ms), tinted or not. At 1024× zoom, where every pixel reads the finest
  level, it costs nothing measurable (0.5 against 0.4 ms, 0.7 against 0.7).
- Motifs are now the costliest content: 1.2–2.5 ms at 1080p and 3.4–7.6 ms at 4K, 3 to 8.4 times
  the plain tiling in the same view, most in the half-plane.
  A finished 4K picture of Birds in the half-plane takes 16 × 7.6 ≈ 120 ms; a moving frame is one
  sample at a reduced size, so it stays fluid. 24 points save 36–44% on the graphics card, which
  says most of a motif's cost is its two curves (crossings and nearest point, 47 pieces each).
  An exact speed-up there (one that draws the same picture) is the one optimisation worth looking
  for next.

Tests: 447 unit tests and 201 GPU tests (the new one draws every benchmark scene), and both
experiments compile for every variant they draw (529 programs).
