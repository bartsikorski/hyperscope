# Credits

Hyperscope stands on the work of many people. The ideas below were studied and reimplemented from
their published descriptions; no code was copied from any of these projects. HyperRogue is GPL, so
its source was read for understanding only. Each module that uses one of these ideas names its
origin in a comment at the top.

## Used in this version

| Technique | Where it is used | Origin |
| --- | --- | --- |
| Hyperboloid (Minkowski) model as the working representation; re-centering the camera by a symmetry of the tiling so numbers stay small | `src/math/lorentz.ts`, `src/math/groups.ts` (`recenter`) | Zeno Rogue and contributors, [HyperRogue / RogueViz](https://roguetemple.com/z/hyper/) |
| Per-pixel folding into a Schwarz triangle by mirror reflections | `src/math/groups.ts` (`fold`), `src/shaders/content/tiling.glsl` | the Shadertoy community; Matt Zucker's Hyperbolic Wythoff explorer; Roice Nelson, [Adventures with the GPU](https://app.icerm.brown.edu/materials/Slides/sp-f19-w1/Adventures_with_the_GPU_]_Roice_Nelson,_GE_Aviation.pdf) |
| Raster rendering of tilings with anti-aliasing from the distance to the mirrors | `src/render/reference.ts`, `tiling.glsl` | Arnaud Chéritat, [raster methods](https://www.math.univ-toulouse.fr/~cheritat/Exposes/2017-Warwick/) |
| Colourings of hyperbolic tilings | `src/math/colourings.ts` | Vladimir Bulatov, [colouring hyperbolic tilings](https://www.bulatov.org/math/1003/index_color.html); Doug Dunham's analyses of Escher's patterns |
| The search for colourings (mirror and chiral) as transitive actions on k colours: the low-index subgroups method | `src/math/colourings.ts` (`lowIndex`) | C. C. Sims, *Computation with Finitely Presented Groups* (1994), ch. 5 |
| Chiral colourings (colourings kept by the rotations only, on kites) | `src/math/colourings.ts`, `tiling.glsl` | the rotation subgroup ⟨a, b \| aᵖ = b^q = (ab)ʳ = 1⟩ of the triangle group, after H. S. M. Coxeter and W. O. J. Moser, *Generators and Relations for Discrete Groups* (1957) |
| Exact tile identity: the triangle group's geometric (Tits) representation reduced modulo a prime, so tiles are named with integers | `src/math/tileid.ts`, `tiling.glsl` | the geometric representation of Coxeter groups (J. Tits; J. E. Humphreys, *Reflection Groups and Coxeter Groups* (1990), §5.3); reducing it modulo a prime to label a hyperbolic tiling's cells exactly is also how HyperRogue's field quotients are built (Zeno Rogue and contributors) |
| Wythoff's construction (the generator point in the triangle, its images as the vertices, the faces around the corners) and the snub (the generator whose three rotated images are equidistant, kept by the rotations only); the constructions' names and Wythoff symbols | `src/math/wythoff.ts`, `src/content/scene.ts`, `src/ui/card.ts` | W. A. Wythoff, "A relation between the polytopes of the C600-family" (1918); H. S. M. Coxeter, *Regular Polytopes* (1948) and Coxeter, Longuet-Higgins and Miller, "Uniform polyhedra" (1954), for the symbols and the snub |
| Wythoff tilings drawn per pixel: fold into the triangle, then find the face by the side of each edge line through the generator point | `src/shaders/content/tiling.glsl`, `src/render/reference.ts` | Matt Zucker's Hyperbolic Wythoff explorer (Shadertoy); Roice Nelson, [Adventures with the GPU](https://app.icerm.brown.edu/materials/Slides/sp-f19-w1/Adventures_with_the_GPU_]_Roice_Nelson,_GE_Aviation.pdf). The snub drawn in the rotations' kite from exact tables, and the faces named by step 14's tile identity, are Hyperscope's own |
| Motifs: a tile whose edges are bent into curves, each edge and its partner under the rotations bent alike so the tiles interlock; drawn per pixel by folding into the kite, a crossing-number test against the two curves and at most one step to the tile next door | `src/math/motifs.ts`, `src/render/reference.ts`, `tiling.glsl`, `src/content/motifs.ts` | M. C. Escher's method of bent edges, as in his Circle Limit prints (no artwork reproduced or traced: Shoal, Moths, Rosette and Birds are Hyperscope's own designs); Doug Dunham's computer generation of Escher-like hyperbolic patterns: D. Dunham, J. Lindgren and D. Witte, "Creating repeating hyperbolic patterns", SIGGRAPH '81, and D. Dunham, "Hyperbolic symmetry", *Computers & Mathematics with Applications* 12B (1986). The curves kept in their own frames (P's and Q's) so that the seams match to the last bit, and the far-tile colour as an affine function of the tile's colour, are Hyperscope's own |
| Your own tile picture: a picture repeated by the tiling's mirrors (kaleidoscope) or by its rotations only, on the kite (chiral), read per pixel where the fold lands; a template whose edges pair up as the rotations pair them, to draw a chiral picture on | `src/content/tileimage.ts`, `src/render/reference.ts`, `tiling.glsl`, `src/ui/template.ts`, `src/ui/card.ts` | kaleidoscopes that repeat part of an input image in the Poincaré disk: Peter Stampfli, ["Kaleidoscopes for Non-Euclidean Space"](https://archive.bridgesmathart.org/2018/bridges2018-67.html), *Proceedings of Bridges 2018*, pp. 67–74; drawing on a tile whose partner edges match is Escher's method again (Dunham, above). The picture's far-tile colour and the blend across the kite's edges are Hyperscope's own |
| Levels of detail of a tile picture (each level the area mean of the one below; the level chosen by the texels a pixel covers) | `src/content/tileimage.ts`, `src/render/gl.ts` | mip-mapping: Lance Williams, "Pyramidal parametrics", SIGGRAPH '83 |
| Pictures named by their SHA-256, so a link names a picture without carrying it | `src/state/sha256.ts`, `src/state/saved.ts` | NIST, FIPS 180-4, *Secure Hash Standard* (2015) |
| The integer hash of Mosaic and of the dither (xor-shift and multiply rounds, the shape of MurmurHash3's finaliser) | `src/math/tileid.ts` (`mosaicHash`), `tiling.glsl`, `src/shaders/colour.glsl` (`pixelNoise`) | the finaliser is `prospector32` from Chris Wellons' [hash prospector](https://github.com/skeeto/hash-prospector) (Unlicense); MurmurHash3 by Austin Appleby |
| Critically damped zoom spring, drag glide, the dark HUD style and layout (brand top left, magnification bottom left as 10^k) | `src/input/controls.ts`, `src/ui/hud.ts`, `src/ui/hud.css` | [mandelscope](https://github.com/bartsikorski/mandelscope) (MIT); the spring after T. Lowe, "Critically Damped Ease-In/Ease-Out Smoothing", *Game Programming Gems 4* (2004), as mandelscope credits it |
| Sample jitter by the R2 low-discrepancy sequence | `src/render/samples.ts` | Martin Roberts, [The unreasonable effectiveness of quasirandom sequences](https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/) (2018), as used in mandelscope |
| The 24 cyclic palettes (names and stops), their baking by interpolation in OKLab, random palettes | `src/content/palettes.json`, `src/content/palettes.ts` | [mandelscope](https://github.com/bartsikorski/mandelscope) (MIT); its stops are copied verbatim |
| The OKLab colour space | `src/math/colour.ts` | Björn Ottosson, [A perceptual color space for image processing](https://bottosson.github.io/posts/oklab/) (2020) |
| Fermi (Cartesian), polar and horocyclic coordinates for the unit grid | `src/math/grid.ts` | standard hyperbolic geometry; J. W. Cannon, W. J. Floyd, R. Kenyon and W. R. Parry, *Hyperbolic Geometry* (1997); J. G. Ratcliffe, *Foundations of Hyperbolic Manifolds* |
| The band model (w = tanh(z/2) from the strip to the Poincaré disk; Fermi coordinates along one geodesic, the Gudermannian form) | `src/math/views.ts` (`bandFrame`), `src/shaders/views/band.glsl` | standard hyperbolic geometry, as in Cannon, Floyd, Kenyon and Parry (above); the band view in HyperRogue gave the idea of offering it |
| The plane seen from an eye inside H³ (the plane as a totally geodesic plane of H³; the eye's height, pitch and field of view; walking and mouse look over it) | `src/math/views.ts` (`h3Frame`), `src/shaders/views/h3.glsl`, `src/input/camera.ts` (`walk`, `look`) | the views of the plane embedded in three dimensions in Zeno Rogue's [HyperRogue](https://roguetemple.com/z/hyper/) gave the idea of offering it; the projective form, which makes it a perspective image of the Beltrami–Klein model, is standard hyperbolic geometry (Ratcliffe, above) |
| The hyperboloid model drawn as a surface in space (the upper sheet of t² − x² − y² = 1 seen by an orbit camera, with its silhouette and its rim at infinity) | `src/math/views.ts` (`hyperboloidFrame`), `src/shaders/views/hyperboloid.glsl`, `src/input/camera.ts` (`orbit`) | standard hyperbolic geometry (the hyperboloid or Minkowski model, after Weierstrass, Killing and Poincaré; Ratcliffe and Cannon, Floyd, Kenyon and Parry, above); HyperRogue's hyperboloid view gave the idea of offering it; the stable quadratic roots after W. H. Press et al., *Numerical Recipes*, §5.6 |
| Grid labels at 1, 2 and 5 times powers of ten | `src/ui/labels.ts` | Paul S. Heckbert, "Nice numbers for graph labels", *Graphics Gems* (1990) |
| Fonts Inter and JetBrains Mono, icons Font Awesome 6 Free (bundled; licences in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) | `src/ui/fonts.ts`, `src/ui/icons.ts` | Rasmus Andersson and the Inter Project Authors; the JetBrains Mono Project Authors; Fontsource; Fonticons, Inc. |

## Inspiration

| Idea | Credit |
| --- | --- |
| Hyperbolic worlds for everyone, the first-person spirit | CodeParade, [Hyperbolica](https://store.steampowered.com/app/1256230/Hyperbolica/) and [HyperEngine](https://github.com/HackerPoet/HyperEngine) |
| Circle Limit (no artwork reproduced) | M. C. Escher; H. S. M. Coxeter's analysis; Doug Dunham's reconstructions of Escher's hyperbolic patterns |

## Planned (credited when the feature lands)

Ray marching in H³ (Coulon, Matsumoto, Segerman, Trettel, Ray-marching Thurston geometries);
Kleinian limit sets (Mumford, Series and Wright, Indra's Pearls; Jos Leys).

## Tools

TypeScript, Vite, vite-plugin-singlefile, Vitest and Playwright (all MIT or Apache-2.0); mpmath
(BSD) for the high-precision test vectors; mandelscope's own Python code (with NumPy, BSD) for the
palette test vectors.
