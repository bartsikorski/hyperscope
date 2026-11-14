"""High-precision reference values for the band view (120 digits, mpmath).
Writes tests/unit/data/band.json. Run: python tools/hp/band_vectors.py

The inputs are float64 states as the app holds them (y0, s), and the reference is the definition, not
the relative form the app uses: the frame point of u is T(y0)^-1 P(s u_x, y0 + s u_y), with
P(x, y) = (sinh x / cos y, tan y, cosh x / cos y) and T(y0) the boost along the y axis that takes the
origin to P(0, y0). A zoom about u0 by k moves the centre to the band point of v = (1 - 1/k) u0, so
N = T(y0)^-1 B(s v_x) T(y0 + s v_y), with B the boost along the band's geodesic; each zoom vector
records y0' and where N sends the frame origin and the frame point 0.5 (Poincare coordinates)."""
import json
import mpmath as mp

mp.mp.dps = 120
STEP = 0.9  # MAX_ZOOM_STEP_W

def n20(x): return mp.nstr(x, 20)

def P(x, y): return [mp.sinh(x) / mp.cos(y), mp.tan(y), mp.cosh(x) / mp.cos(y)]

def boost_y(y0, p):
    """T(y0)^-1 p: cosh b = 1 / cos y0, sinh b = tan y0."""
    ch, sh = 1 / mp.cos(y0), mp.tan(y0)
    return [p[0], ch * p[1] - sh * p[2], ch * p[2] - sh * p[1]]

def boost_y_fwd(y0, p):
    ch, sh = 1 / mp.cos(y0), mp.tan(y0)
    return [p[0], ch * p[1] + sh * p[2], ch * p[2] + sh * p[1]]

def boost_x(a, p):
    return [mp.cosh(a) * p[0] + mp.sinh(a) * p[2], p[1], mp.sinh(a) * p[0] + mp.cosh(a) * p[2]]

def to_poincare(p): return [p[0] / (1 + p[2]), p[1] / (1 + p[2])]
def from_poincare(w):
    r2 = w[0] ** 2 + w[1] ** 2
    return [2 * w[0] / (1 - r2), 2 * w[1] / (1 - r2), (1 + r2) / (1 - r2)]

def frame(y0, s, u):
    y = y0 + s * u[1]
    if abs(y) >= mp.pi / 2: return None
    x = boost_y(y0, P(s * u[0], y))
    return x, s / mp.cos(y)

def N_apply(y0, s, v, p):
    return boost_y(y0, boost_x(s * v[0], boost_y_fwd(y0 + s * v[1], p)))

out = {"frame": [], "zoom": []}
US = [(0.3, 0.2), (-0.9, 0.5), (0.0, 0.01), (1.2, -0.4), (0.4, -0.99), (-1.6, 0.97)]
KS = [2.0, 0.5, 1.1]
half = mp.pi / 2
for y0m in [mp.mpf(0), mp.mpf("0.7"), mp.mpf("-1.2"), half - mp.mpf("1e-3"), half - mp.mpf("1e-6"), half - mp.mpf("1e-9"), -(half - mp.mpf("1e-12"))]:
    y0f = float(y0m)
    Y0 = mp.mpf(y0f)
    gap = half - abs(Y0)
    for sm in [gap * mp.mpf("0.3"), gap * 3, mp.mpf("1.9")]:
        sf = float(sm)
        S = mp.mpf(sf)
        for u in US:
            U = (mp.mpf(u[0]), mp.mpf(u[1]))
            f = frame(Y0, S, U)
            edge = max(U[1] - (half - Y0) / S, -(half + Y0) / S - U[1])
            if f: out["frame"].append({"y0": y0f, "s": sf, "u": list(u), "x": [n20(t) for t in f[0]], "scale": n20(f[1]), "edge": n20(edge)})
            for k in KS:
                K = mp.mpf(k)
                v = ((1 - 1 / K) * U[0], (1 - 1 / K) * U[1])
                fv = frame(Y0, S, v)
                if fv is None: continue
                w = to_poincare(fv[0])
                if mp.sqrt(w[0] ** 2 + w[1] ** 2) > STEP or mp.cos(Y0 + S * v[1]) < mp.mpf("1e-12"): continue
                a = to_poincare(N_apply(Y0, S, v, [0, 0, 1]))
                b = to_poincare(N_apply(Y0, S, v, from_poincare([mp.mpf("0.5"), 0])))
                out["zoom"].append({"y0": y0f, "s": sf, "u0": list(u), "k": k, "y1": n20(Y0 + S * v[1]), "a": [n20(t) for t in a], "b": [n20(t) for t in b]})
json.dump(out, open("tests/unit/data/band.json", "w"), indent=1)
print({k: len(v) for k, v in out.items()})
