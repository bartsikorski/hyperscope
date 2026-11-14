"""High-precision reference values for the hyperboloid view (120 digits, mpmath).
Writes tests/unit/data/hyperboloid.json. Run: python tools/hp/hyperboloid_vectors.py

The inputs are float64 states as the app holds them (elevation, distance, fov) and screen points u;
the reference is the definition: the camera at o = (0, -D cos e, 1 + D sin e) looks along
d = F + f (u_x R + u_y U), F = (0, cos e, -sin e), R = (1, 0, 0), U = (0, sin e, cos e),
f = tan(fov / 2), and the frame point is where o + l d first meets t^2 - x^2 - y^2 = 1 with l > 0
and t > 0 (both roots of the quadratic at 120 digits, no stable form needed). The scale is the
largest plane length per unit of u, from central differences of the frame point at step 1e-40.

Besides random points, each picture gets points next to its edge: along random lines across the
screen the change of hit is bisected at 120 digits, and points 1e-4 and 1e-8 from it on the hit side
are kept (rounded to float64, the reference recomputed for the rounded point). These are rays that
nearly graze the sheet (the silhouette) or nearly run along the asymptotic cone (infinity)."""
import json
import random
import mpmath as mp

mp.mp.dps = 120


def n20(x): return mp.nstr(x, 20)


def ray(e, D, fov, ux, uy):
    ce, se, f = mp.cos(e), mp.sin(e), mp.tan(fov / 2)
    o = [mp.mpf(0), -D * ce, 1 + D * se]
    d = [f * ux, ce + f * uy * se, -se + f * uy * ce]
    return o, d


def lq(a, b): return a[2] * b[2] - a[0] * b[0] - a[1] * b[1]


def frame(e, D, fov, ux, uy):
    o, d = ray(e, D, fov, ux, uy)
    A, B, C = lq(d, d), lq(o, d), lq(o, o) - 1
    best = None
    if A == 0:
        roots = [-C / (2 * B)] if B != 0 else []
    else:
        disc = B * B - A * C
        if disc < 0:
            return None
        s = mp.sqrt(disc)
        roots = [(-B - s) / A, (-B + s) / A]
    for l in roots:
        if l > 0 and o[2] + l * d[2] > 0 and (best is None or l < best):
            best = l
    if best is None:
        return None
    return [o[j] + best * d[j] for j in range(3)]


def mink(p, q): return p[0] * q[0] + p[1] * q[1] - p[2] * q[2]


def scale(e, D, fov, ux, uy):
    h = mp.mpf(10) ** -40

    def diff(dx, dy):
        a = frame(e, D, fov, ux + dx, uy + dy)
        b = frame(e, D, fov, ux - dx, uy - dy)
        return [(a[j] - b[j]) / (2 * h) for j in range(3)]
    t1, t2 = diff(h, 0), diff(0, h)
    g11, g12, g22 = mink(t1, t1), mink(t1, t2), mink(t2, t2)
    return mp.sqrt((g11 + g22 + mp.sqrt((g11 - g22) ** 2 + 4 * g12 ** 2)) / 2)


def gap(e, D):
    o, _ = ray(mp.mpf(e), mp.mpf(D), mp.mpf(1), 0, 0)
    return (lq(o, o) - 1) / (2 * mp.sqrt(sum(c * c for c in o)))


def vector(e, D, fov, u, near=None):
    E, DD, FOV = mp.mpf(e), mp.mpf(D), mp.mpf(fov)
    x = frame(E, DD, FOV, mp.mpf(u[0]), mp.mpf(u[1]))
    v = {"elevation": e, "distance": D, "fov": fov, "u": u, "x": None}
    if near is not None:
        v["near"] = near
    if x is not None:
        v["x"] = [n20(c) for c in x]
        v["scale"] = n20(scale(E, DD, FOV, mp.mpf(u[0]), mp.mpf(u[1])))
    return v


def edge_points(e, D, fov):
    """Points 1e-4 and 1e-8 inside the edge along a random line across the screen, if it crosses one."""
    E, DD, FOV = mp.mpf(e), mp.mpf(D), mp.mpf(fov)
    u0 = [random.uniform(-1.7, 1.7), random.uniform(-0.95, 0.95)]
    a = random.uniform(0, 2 * mp.pi)
    dirn = [mp.cos(a), mp.sin(a)]
    at = lambda s: (mp.mpf(u0[0]) + s * dirn[0], mp.mpf(u0[1]) + s * dirn[1])
    hit = lambda s: frame(E, DD, FOV, *at(s)) is not None
    # walk out along the line in steps of 0.02 for at most 2 units until the hit changes
    h0 = hit(0)
    lo, hi = None, None
    for k in range(1, 101):
        if hit(k * mp.mpf(0.02)) != h0:
            lo, hi = (k - 1) * mp.mpf(0.02), k * mp.mpf(0.02)
            break
    if lo is None:
        return []
    for _ in range(300):
        mid = (lo + hi) / 2
        if hit(mid) == h0:
            lo = mid
        else:
            hi = mid
    s_edge = lo
    side = -1 if h0 else 1  # the hit side lies toward s = 0 when the start hits
    out = []
    for off in (1e-4, 1e-8):
        s = s_edge + side * off
        u = [float(at(s)[0]), float(at(s)[1])]
        out.append(vector(e, D, fov, u, off))
    return out


random.seed(13)
cases = [(55 * mp.pi / 180, 5.0, 50 * mp.pi / 180),  # home, inside the bowl
         (mp.pi / 2, 4.0, 50 * mp.pi / 180),  # straight above the vertex
         (-mp.pi / 2, 3.0, 50 * mp.pi / 180),  # straight below, inside the lower bowl
         (0.0, 5.0, 70 * mp.pi / 180),  # level, outside both
         (0.1, 20.0, 40 * mp.pi / 180),  # low and far: grazing rays
         (-0.6, 2.0, 90 * mp.pi / 180)]  # below the rim, outside
while len(cases) < 18:
    e, D, fov = random.uniform(-1.5707, 1.5707), 1.5 * (40 / 1.5) ** random.uniform(0, 1), random.uniform(0.70, 1.74)
    if abs(gap(e, D)) >= 0.05:
        cases.append((e, D, fov))
out = []
for (e, D, fov) in cases:
    e, D, fov = float(e), float(D), float(fov)
    for _ in range(6):
        out.append(vector(e, D, fov, [random.uniform(-1.78, 1.78), random.uniform(-1, 1)]))
    for _ in range(4):
        out += edge_points(e, D, fov)
json.dump({"frame": out}, open("tests/unit/data/hyperboloid.json", "w"), indent=1)
print(len(out), "vectors,", sum(1 for o in out if o["x"] is None), "missing the sheet,",
      sum(1 for o in out if "near" in o), "next to the edge")
