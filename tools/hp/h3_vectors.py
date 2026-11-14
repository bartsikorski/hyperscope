"""High-precision reference values for the plane inside H3 (120 digits, mpmath).
Writes tests/unit/data/h3.json. Run: python tools/hp/h3_vectors.py

The inputs are float64 states as the app holds them (h, pitch, fov) and screen points u; the
reference is the definition, not the projective form the app uses: in R^{3,1} the eye is
E = (0, 0, sinh h, cosh h) over the plane z = 0, the pixel's unit direction D = (a, b, c cosh h,
c sinh h) with (a, b, c) the normalised w = (f u_x, cos p + f u_y sin p, -sin p + f u_y cos p),
f = tan(fov / 2), and the ray cosh t E + sinh t D meets the plane at tanh t = tanh h / (-c). The
frame point is that point's (x, y, w) coordinates. The scale is the largest plane length per unit
of u, from central differences of the frame point at step 1e-40 (exact to far beyond float64)."""
import json
import random
import mpmath as mp

mp.mp.dps = 120

def n20(x): return mp.nstr(x, 20)

def frame(h, p, fov, ux, uy):
    f = mp.tan(fov / 2)
    w = [f * ux, mp.cos(p) + f * uy * mp.sin(p), -mp.sin(p) + f * uy * mp.cos(p)]
    L = mp.sqrt(sum(x * x for x in w))
    a, b, c = (x / L for x in w)
    if not (-c > mp.tanh(h)):
        return None
    t = mp.atanh(mp.tanh(h) / (-c))
    return [a * mp.sinh(t), b * mp.sinh(t), mp.cosh(t) * mp.cosh(h) + c * mp.sinh(t) * mp.sinh(h)]

def mink(p, q): return p[0] * q[0] + p[1] * q[1] - p[2] * q[2]

def scale(h, p, fov, ux, uy):
    e = mp.mpf(10) ** -40
    def d(dx, dy):
        a = frame(h, p, fov, ux + dx, uy + dy)
        b = frame(h, p, fov, ux - dx, uy - dy)
        return [(a[j] - b[j]) / (2 * e) for j in range(3)]
    t1, t2 = d(e, 0), d(0, e)
    g11, g12, g22 = mink(t1, t1), mink(t1, t2), mink(t2, t2)
    return mp.sqrt((g11 + g22 + mp.sqrt((g11 - g22) ** 2 + 4 * g12 ** 2)) / 2)

random.seed(12)
out = []
cases = [(0.3, mp.pi / 6, 70 * mp.pi / 180)]
for _ in range(11):
    cases.append((10 ** random.uniform(-2, 0.778), random.uniform(0, 1.5707), random.uniform(0.70, 1.74)))
cases += [(0.01, 0.02, 70 * mp.pi / 180), (6.0, 1.5707963, 70 * mp.pi / 180)]
for (h, p, fov) in cases:
    h, p, fov = float(h), float(p), float(fov)
    for _ in range(8):
        u = [random.uniform(-1.8, 1.8), random.uniform(-1, 1)]
        x = frame(mp.mpf(h), mp.mpf(p), mp.mpf(fov), mp.mpf(u[0]), mp.mpf(u[1]))
        if x is None:
            out.append({"h": h, "pitch": p, "fov": fov, "u": u, "x": None})
            continue
        out.append({"h": h, "pitch": p, "fov": fov, "u": u, "x": [n20(c) for c in x],
                    "scale": n20(scale(mp.mpf(h), mp.mpf(p), mp.mpf(fov), mp.mpf(u[0]), mp.mpf(u[1])))})
json.dump({"frame": out}, open("tests/unit/data/h3.json", "w"), indent=1)
print(len(out), "vectors,", sum(1 for o in out if o["x"] is None), "above the horizon")
