# Design checks

Numerical checks of the formulas in the design, run before each was coded. Each script compares
the closed forms the code uses with direct computations in high precision (mpmath), double and
float32, and prints what it checked and the worst error it found. The design notes
([../docs/design-notes.md](../docs/design-notes.md)) cite them where a step relies on them.

```sh
pip install mpmath numpy scipy
python design-checks/check_math.py
```

| Script | Checks | Time |
| --- | --- | --- |
| `check_math.py` | version 1: folding into the triangle, the deep-zoom maps of the disk and half-plane in float32, the plane hit inside H³ | seconds |
| `check_views.py` | the closed forms of the Klein and half-plane frames and zooms against 300-digit values | seconds |
| `check_m2.py` | milestone 2: the band, the plane inside H³ (ray hit, footprint, horizon), the hyperboloid's stable root | seconds |
| `check_tileid.py` | exact tile identity: the triangle group modulo a prime, one identity per tile, unchanged by re-centering | seconds |
| `check_lowindex.py` | colourings up to 8 colours by Sims' low-index subgroup search | seconds |
| `check_chiral.py` | chiral colourings: transitive actions of the rotation group | seconds |
| `check_wythoff.py` | Wythoff and snub tilings drawn from the kite: the segments that cross it, distances | about a minute |
| `check_wythoff_faces.py` | which face a point is in, its distance to the edges, the neighbour across, face identities | several minutes |
| `check_motifs.py` | motifs: bent edges paired by the rotations, seams, the step into the next tile | about two minutes |
