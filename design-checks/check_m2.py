"""Milestone 2: numerical checks of the formulas in Precise design v2 (doubles, float32, mpmath)."""
import math, random, sys
import numpy as np
import mpmath as mp
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from check_math import mink, normals, fold

f32 = np.float32
def hyp_from_poincare(w):
    r2 = abs(w) ** 2
    return np.array([2 * w.real / (1 - r2), 2 * w.imag / (1 - r2), (1 + r2) / (1 - r2)])

def dist(a, b):
    return math.acosh(max(1.0, -mink(a, b)))

# ------------------------------------------------------------------------------------------ A. band
def band_point(x, y):
    """Fermi coordinates along the x axis: sinh b = tan y."""
    return np.array([math.sinh(x) / math.cos(y), math.tan(y), math.cosh(x) / math.cos(y)])

def check_band():
    random.seed(2)
    worst = 0
    for _ in range(2000):
        x, y = random.uniform(-3, 3), random.uniform(-1.5, 1.5)
        w = complex(math.tanh(x / 2) * 1, 0)
        w = np.tanh(complex(x, y) / 2)
        worst = max(worst, np.max(np.abs(band_point(x, y) - hyp_from_poincare(w)) / band_point(x, y)[2]))
    print(f"A1 band: Fermi form = tanh(z/2) to the disk, worst relative {worst:.1e}")
    # conformal factor: |dP| = |dz| / cos y
    worst = 0
    for _ in range(500):
        x, y = random.uniform(-3, 3), random.uniform(-1.4, 1.4)
        h = 1e-6
        for d in [(h, 0), (0, h)]:
            a, b = band_point(x, y), band_point(x + d[0], y + d[1])
            v = b - a
            ds = math.sqrt(v[0] ** 2 + v[1] ** 2 - v[2] ** 2)
            worst = max(worst, abs(ds / (h / math.cos(y)) - 1))
    print(f"A2 band: metric |dz|/cos y, worst {worst:.1e}")

def band_centred(ux, uy, y0, s, dt=np.float64):
    """Frame point relative to the screen centre (0, y0), in relative form (shader formula)."""
    c0, s0 = dt(math.cos(y0)), dt(math.sin(y0))
    x, d = dt(s) * dt(ux), dt(s) * dt(uy)
    C = c0 * dt(np.cos(d)) - s0 * dt(np.sin(d))                  # cos y
    chm1 = dt(2) * dt(np.sinh(x / 2)) ** 2                          # cosh x - 1
    sh = dt(np.sin(d / 2))
    cmid = c0 * dt(np.cos(d / 2)) - s0 * sh                         # cos((y + y0)/2)
    k = C * c0
    return np.array([dt(np.sinh(x)) / C, (dt(2) * cmid * sh - s0 * chm1) / k, dt(1) + (chm1 + dt(2) * sh * sh) / k])

def check_band_precision():
    mp.mp.dps = 60
    random.seed(3)
    for g0 in [0.3, 1e-3, 1e-6, 1e-12, 1e-20]:
        y0 = mp.pi / 2 - mp.mpf(g0)
        s = mp.mpf(g0) * 0.3            # a screen spans 0.3 of the gap: the edge is in view
        worst = 0
        for _ in range(300):
            ux, uy = random.uniform(-1.7, 1.7), random.uniform(-1, 1)
            # reference: boost the Fermi point by -b0 in mpmath
            x, y = s * ux, y0 + s * uy
            P = [mp.sinh(x) / mp.cos(y), mp.tan(y), mp.cosh(x) / mp.cos(y)]
            ch, sh0 = 1 / mp.cos(y0), mp.tan(y0)
            ref = [P[0], ch * P[1] - sh0 * P[2], ch * P[2] - sh0 * P[1]]
            # float32 shader inputs: cos y0 and sin y0 computed in float64 from g0 and rounded once
            c0, s0 = float(mp.sin(mp.mpf(g0))), float(mp.cos(mp.mpf(g0)))
            got = band_centred_from(ux, uy, c0, s0, float(s), np.float32)
            refv = np.array([float(v) for v in ref])
            # error as a hyperbolic distance between the two points
            gv = got.astype(np.float64)
            gv = gv / math.sqrt(max(1e-300, -mink(gv, gv)))
            worst = max(worst, dist(gv, refv))
        print(f"A3 band float32 at gap {g0:g} (edge in view): worst point error {worst:.1e} R")

def band_centred_from(ux, uy, c0, s0, s, dt):
    c0, s0 = dt(c0), dt(s0)
    x, d = dt(s) * dt(ux), dt(s) * dt(uy)
    C = c0 * dt(np.cos(d)) - s0 * dt(np.sin(d))
    chm1 = dt(2) * dt(np.sinh(x / dt(2))) ** 2
    sh = dt(np.sin(d / dt(2)))
    cmid = c0 * dt(np.cos(d / dt(2))) - s0 * sh
    k = C * c0
    return np.array([dt(np.sinh(x)) / C, (dt(2) * cmid * sh - s0 * chm1) / k, dt(1) + (chm1 + dt(2) * sh * sh) / k])

# ------------------------------------------------------------------------------ B. plane inside H3
def h3_hit(h, a, b, c):
    """Eye at height h above the origin, unit direction (a, b, c) in the eye's frame (c up)."""
    E = np.array([0, 0, math.sinh(h), math.cosh(h)])
    V = np.array([a, b, c * math.cosh(h), c * math.sinh(h)])
    if -c <= math.tanh(h):
        return None
    t = math.atanh(math.tanh(h) / -c)
    X = math.cosh(t) * E + math.sinh(t) * V
    return X, t, E, V

def check_h3():
    random.seed(4)
    worst_on, worst_fp = 0, 0
    for _ in range(3000):
        h = 10 ** random.uniform(-6, 0.5)
        th, ph = random.uniform(0, 2 * math.pi), random.uniform(-math.pi / 2, 0)
        a, b, c = math.cos(ph) * math.cos(th), math.cos(ph) * math.sin(th), math.sin(ph)
        r = h3_hit(h, a, b, c)
        if not r: continue
        X, t, E, V = r
        worst_on = max(worst_on, abs(X[2]) / X[3])
        p = np.array([X[0], X[1], X[3]])
        worst_on = max(worst_on, abs(-mink(p, p) - 1))
        # footprint: angular step e in the eye's tangent space, analytic sinh(t) e / sin(beta) (worst direction)
        e = 1e-7
        Gp = math.sinh(t) * E + math.cosh(t) * V                       # unit tangent at the hit
        sinb = abs(Gp[2])                                                # its normal (z) component
        if sinb < 1e-3: continue
        want = math.sinh(t) * e / sinb
        # finite differences in the two angular directions; the larger one is the footprint
        def P(th_, ph_):
            r2 = h3_hit(h, math.cos(ph_) * math.cos(th_), math.cos(ph_) * math.sin(th_), math.sin(ph_))
            X2 = r2[0]; return np.array([X2[0], X2[1], X2[3]])
        p0 = P(th, ph)
        lens = []
        for dth, dph in [(e / max(1e-12, math.cos(ph)), 0), (0, e)]:
            v = P(th + dth, ph + dph) - p0
            lens.append(math.sqrt(max(0, v[0] ** 2 + v[1] ** 2 - v[2] ** 2)))
        worst_fp = max(worst_fp, abs(max(lens) / want - 1))
    print(f"B1 H3 plane: hit on z = 0 and on H2 to {worst_on:.1e}; footprint sinh(t)·dθ/sin β vs finite differences {worst_fp:.1e}")
    for h in [1e-5, 2.7e-7 * 6371 / 1, 0.1, 1, 2]:
        print(f"   horizon at h = {h:g} R: {math.degrees(math.asin(math.tanh(h))):.4g}° below level")

# --------------------------------------------------------------------------------- C. hyperboloid
def hb_hit(o, d):
    """Euclidean ray o + λd against t² - x² - y² = 1, t > 0; nearest positive hit."""
    A = d[2] ** 2 - d[0] ** 2 - d[1] ** 2
    B = o[2] * d[2] - o[0] * d[0] - o[1] * d[1]
    C = o[2] ** 2 - o[0] ** 2 - o[1] ** 2 - 1
    disc = B * B - A * C
    if disc < 0: return None
    q = -(B + math.copysign(math.sqrt(disc), B))
    roots = sorted(r for r in ([q / A] if A != 0 else []) + ([C / q] if q != 0 else []) if r > 0)
    for lam in roots:
        p = o + lam * d
        if p[2] > 0: return lam, p
    return None

def check_hyperboloid():
    random.seed(5)
    worst = 0
    n = 0
    for _ in range(3000):
        el, D = random.uniform(0.05, 1.5), random.uniform(1.5, 12)
        eye = np.array([D * math.cos(el), 0, 1 + D * math.sin(el)])
        tgt = np.array([0, 0, 1.0])
        f = (tgt - eye) / np.linalg.norm(tgt - eye)
        d = f + 0.6 * np.array([random.uniform(-1, 1) * f[2], random.uniform(-1, 1), random.uniform(-1, 1) * -f[0]])
        d /= np.linalg.norm(d)
        r = hb_hit(eye, d)
        if not r: continue
        lam, p = r
        worst = max(worst, abs(p[2] ** 2 - p[0] ** 2 - p[1] ** 2 - 1) / p[2] ** 2); n += 1
    print(f"C1 hyperboloid: stable root on the upper sheet, {n} hits, worst |<p,p>+1|/t² {worst:.1e}")

if __name__ == "__main__":
    check_band(); check_band_precision(); check_h3(); check_hyperboloid()
