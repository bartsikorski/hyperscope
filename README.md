# Hyperscope

A GPU explorer of the hyperbolic plane: every pixel is mapped onto the hyperboloid, moved by the
camera and folded by reflections into one triangle of a tiling, so the picture is exact at any zoom.

This is version 1, all ten build steps of the design document done: four views of the plane
(Poincaré disk, Klein disk, upper half-plane and a local view that looks Euclidean near the centre)
with triangle-group tilings, colourings and lines, and the full set of camera moves. A still picture
refines itself to 16 samples per pixel and then stops drawing; while the view moves, frames render
at a reduced scale that follows the frame rate. Tiles are coloured by a look: one of 24 palettes
(mandelscope's gradients and four discrete sets), a colour source (the colouring, distance from the
centre, depth in walls from a start tile, or position inside the tile), and lines with optional
glow and relief.

Since version 1 the plane can also be seen as a band, from an eye inside H³ and on the hyperboloid
itself; the tilings gained chiral colourings, Mosaic (each tile its own colour, named exactly by
integers), the Wythoff constructions with the snub and a free point, and motifs: tiles with bent
edges that interlock, Escher's method, drawn sharp at any zoom. Four motifs of our own are built in
(Shoal, Moths, Rosette, Birds), and a motif can be loaded from a JSON file. Your own picture can
fill the tile too: mirrored at the triangle's sides like a kaleidoscope, or turned about the kite's
corners (chiral), with a template to draw on so its edges match, placed by dragging on a preview,
as it is or tinted by the look.

Over any of it goes a unit grid: Cartesian (Fermi coordinates along a geodesic), polar or
horocyclic, with the curvature radius R set to the Earth's radius, 1 km, 1 m, or left as R. Lines
come in decades (1, 10, 100 ... units) that fade in and out with the zoom, the lines that spread
apart are halved as they do, and labels at the screen edges read each line's exact value. The grid
keeps its own position to 256 binary places, so at the zoom limit of the plain "Unit grid"
(10⁻¹¹ R a pixel, 64 µm with R the Earth's radius) the lines and labels are still exact 30 R out.

Around the picture sits a quiet HUD that fades when you rest: the title, the distance from the
start point and the magnification in the corners; an icon row with home, back and forward through
the views you visited, the four views, the presets gallery, the grid, a screenshot, settings and
help; and a settings card with three tabs (Tiling, Look, View) where every setting can be changed,
including an exact position typed to any number of digits. The address bar always holds a link to
the view (bit for bit), the session comes back after a reload, your own presets are kept in the
browser and can be exported, and a screenshot (up to 7680 × 4320) carries its view inside the PNG:
drop it on the window to return there.

## Running it

- **Just look:** open `dist/hyperscope.html` (one self-contained file, works offline, no install).
- **Develop:** install Node.js 22 LTS once, then double-click `run.bat` (or `npm install` and
  `npm run dev`). The app opens at http://localhost:5173 and reloads when files change.

| Command | What it does |
| --- | --- |
| `npm run dev` | development server with hot reload |
| `npm test` | unit tests (math, groups, colourings, views, camera, controls, game controllers, palettes, shading, motifs, tile pictures, grid, labels, saved state, history, presets, screenshots) |
| `npm run test:gpu` | headless Chromium: shader vs CPU reference, golden images, refinement, scripted input and controller, the HUD, card, gallery, links and screenshots |
| `npm run build` | `dist/hyperscope.html` |
| `npm run reference` | reference pictures from the CPU renderer into `out/` |
| `npm run golden` | rewrite the golden images in `tests/golden/` (only after checking a change is intended) |
| `npm run bench` | time one sample pass per scene at 1080p and 4K (`-- --headed` uses your graphics card, `-- --channel msedge` or `chrome` the browser you have installed, `-- --tag name` names the result) |
| `npm run ab` | the A/B runs of equivalent formulas: each checked to draw the same picture, then timed against the current code (same options; `-- --only name,name` runs only those) |

## Controls

| Input | Action |
| --- | --- |
| left drag | pan (an exact hyperbolic translation), glides when released |
| wheel | zoom at the cursor (Ctrl: fine, Shift: rotate) |
| right drag | rotate about the screen centre |
| double-click / middle click | zoom 4x into that point / bring it to the centre |
| + / − (PgUp / PgDn), Z / X | zoom at the centre, at the cursor (tap 2x, hold to keep going) |
| W A S D or arrows, Q / E | pan, rotate |
| [ / ] | rotate by one symmetry step of the tiling |
| 1 – 7 | Poincaré disk, Klein disk, half-plane, local view, inside H³, hyperboloid, band (the place you look at stays put) |
| inside H³ (5) | W A S D or drag walk, Q / E or right drag turn (right drag up and down looks up and down), wheel or + / − lower and raise the eye from 0.01 to 6 R, keeping the ground under the cursor and tilting the view with the height (further down as the eye rises) |
| C (Shift+C) | next (previous) tiling of the presets, keeping your look and place |
| L (Shift+L), . / , | next (previous) look |
| P (Shift+P) | next (previous) palette |
| K (Shift+K) | next (previous) colouring of the tiling |
| O (Shift+O) | next (previous) construction: Lines, the Wythoff tilings, the snub |
| M (Shift+M) | next (previous) motif: none, Shoal, Moths, Rosette, Birds |
| G | unit grid on / off |
| T (Shift+T) | next (previous) grid: Cartesian, polar, horocyclic |
| U (Shift+U) | size of R: the Earth's radius, 1 km, 1 m, units of R |
| H | home (in the current view) |
| Backspace / Shift+Backspace | back / forward through the views you visited |
| Ctrl+C / Ctrl+V | copy a link to this view / open a pasted link or saved state |
| Ctrl+S, F12 | save a screenshot (its view is inside the PNG) |
| Tab | hide or show the interface |
| F | full screen |
| F1 or ? | the controls |
| Esc | leave a field, close the help, the settings card or the gallery |

A game controller (Xbox, PlayStation, Switch Pro and others the browser maps to its standard
layout) works too: the left stick moves, the right stick rotates and zooms, RT and LT zoom, LB and RB
rotate by a symmetry step, A switches the view, B closes or goes back, X and Y switch the grid and
its type, the D-pad steps through presets and looks, L3 and R3 the palette and colouring, Start goes
home and View hides the interface. Press any button once so the browser shows the pad to the page.

Files dropped on the window: a Hyperscope screenshot returns to its view, a saved state opens, a
presets file adds its presets to yours, a motif file is drawn with its group, and any other picture
(PNG, JPEG, WebP and what else the browser reads) becomes the tile picture; a pasted picture does
too. The picture is kept in the browser (IndexedDB) and inside screenshots and exported presets; a
link names it by its SHA-256, so a link opened elsewhere asks for the picture and keeps its
settings.

## Layout

Design decisions and measurements are recorded in [docs/design-notes.md](docs/design-notes.md),
including the benchmarks of equivalent formulas (step 10, and step 18 for the later work) on a
software renderer and an RTX 5060 Ti.

`src/math` float64 geometry (hyperboloid, triangle groups, colourings, view maps) and colour
arithmetic, `src/render` the WebGL2 renderer and the CPU reference renderer, `src/shaders` GLSL
chunks, `src/input` camera moves, controls and game controllers, `src/content` tilings, palettes and looks,
`src/state` the store, the saved state, links, history, presets and the PNG text chunk, `src/ui`
the HUD, icon row, settings card, gallery and the grid's labels, `tests` unit and GPU tests and
golden images, `bench` the benchmark and A/B pages, the A/B experiments and the saved results,
`tools` the reference, golden and benchmark scripts and the test-vector generators (mpmath for
geometry, mandelscope's own code for palettes).

## Credits

See [CREDITS.md](CREDITS.md) and, for the bundled fonts and icons, [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
MIT licence, see [LICENSE](LICENSE).

## How it was made

Developed with Claude (Anthropic) as an AI programming assistant.
