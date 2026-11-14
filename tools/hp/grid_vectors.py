"""High-precision reference values for the unit grid (src/math/grid.ts), 100 digits, mpmath.
Writes tests/unit/data/grid.json. Run: python tools/hp/grid_vectors.py

A grid camera is the isometry G = A(S0) B(E0) R(theta): Cartesian boostX(X0) boostY(Y0), polar
rotation(2 pi phi0) boostX(r0), horocyclic parabolic(p0) boostY(h0), then rotation(theta). A(S)
shifts S and nothing else, so everything below is computed relative to A(S0) and S0 is added back
exactly; that keeps the numbers small at any S0.

- points: frame points q at distances 1e-11 .. 0.5 from the screen centre, for E0 up to 55: the
  exact grid coordinates of G q (E absolute, dS relative to S0) and the offset term B of offsetTerm.
- walks: sequences of moves N = rotation(alpha) boostX(d) rotation(beta), the float64 parameters
  given to the test, composed exactly; the exact camera after every step.
- lines: frame points exactly on grid lines at deep zoom (lines of level k at subdivision m), for
  the phase arithmetic of the per-frame slot data (src/render/grid.ts)."""
import json
import math
import random
import mpmath as mp

mp.mp.dps = 100
TURN = 2 * mp.pi
FRAC = 256
PER_R = {"earth": 6371000, "km": 1000, "m": 1, "R": 1}


def rot(a):
    c, s = mp.cos(a), mp.sin(a)
    return mp.matrix([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def bx(d):
    c, s = mp.cosh(d), mp.sinh(d)
    return mp.matrix([[c, 0, s], [0, 1, 0], [s, 0, c]])


def by(d):
    c, s = mp.cosh(d), mp.sinh(d)
    return mp.matrix([[1, 0, 0], [0, c, s], [0, s, c]])


def par(a):
    """The parabolic isometry fixing the ideal point (0, 1, 1): p -> p + a, h kept."""
    return mp.matrix([[1, -a, a], [a, 1 - a * a / 2, a * a / 2], [a, -a * a / 2, 1 + a * a / 2]])


def shift(kind, s):
    return bx(s) if kind == "cartesian" else rot(TURN * s) if kind == "polar" else par(s)


def lift(kind, e):
    return bx(e) if kind == "polar" else by(e)


def coords(kind, p):
    """(S, E) of a point of the hyperboloid."""
    x, y, t = p[0], p[1], p[2]
    if kind == "cartesian":
        return mp.atanh(x / t), mp.asinh(y)
    if kind == "polar":
        return mp.atan2(y, x) / TURN, mp.asinh(mp.sqrt(x * x + y * y))
    return x / (t - y), -mp.log(t - y)


def decompose(kind, m):
    """(dS, E, theta) of an isometry m = A(dS) B(E) R(theta)."""
    o = m * mp.matrix([0, 0, 1])
    s, e = coords(kind, o)
    r = lift(kind, -e) * shift(kind, -s) * m
    return s, e, mp.atan2(r[1, 0], r[0, 0])


def move(alpha, d, beta):
    return rot(mp.mpf(alpha)) * bx(mp.mpf(d)) * rot(mp.mpf(beta))


def fixed(s):
    return str(int(mp.nint(s * mp.mpf(2) ** FRAC)))


def big_s(r, kind, whole):
    """A start S0 with all 256 fractional bits in use (polar: turns in [0, 1))."""
    n = r.getrandbits(FRAC)
    if kind != "polar":
        n += whole << FRAC
    return n


def num(x):
    return mp.nstr(x, 20)


r = random.Random(20261028)
out = {"points": [], "walks": [], "lines": []}

# ------------------------------------------------------------------------------------- points
E0S = {"cartesian": [0.0, 1e-9, 0.3, -2.0, 7.0, 30.0, -30.0, 55.0, -55.0],
       "polar": [0.0, 1e-9, 0.3, 2.0, 7.0, 30.0, 55.0],
       "horocyclic": [0.0, 1e-9, 0.3, -2.0, 7.0, 30.0, -30.0, 55.0, -55.0]}
for kind, e0s in E0S.items():
    for e0 in e0s:
        for dist in [1e-11, 1e-7, 1e-3, 0.1, 0.5]:
            for _ in range(3):
                a = r.uniform(-math.pi, math.pi)
                theta = r.uniform(-math.pi, math.pi)
                x, y = math.sinh(dist) * math.cos(a), math.sinh(dist) * math.sin(a)
                q = mp.matrix([x, y, mp.sqrt(1 + mp.mpf(x) ** 2 + mp.mpf(y) ** 2)])
                p = lift(kind, mp.mpf(e0)) * rot(mp.mpf(theta)) * q
                s, e = coords(kind, p)
                scale = mp.cosh(e0) if kind == "cartesian" else TURN * mp.cosh(e0) if kind == "polar" else mp.exp(-e0)
                out["points"].append({"kind": kind, "e0": e0, "theta": theta, "q": [x, y, float(q[2])], "dist": dist,
                                      "e": num(e), "de": num(e - e0), "ds": num(s), "b": num(s * scale)})

# -------------------------------------------------------------------------------------- walks
WALKS = [
    ("cartesian", "home", 0, 0.0, 0.0, (1e-3, 1.0), 100),
    ("cartesian", "far 30", -4321, 30.0, 0.3, (1e-11, 1e-2), 100),
    ("cartesian", "far -55", 77, -55.0, -2.0, (1e-9, 0.5), 100),
    ("polar", "home", 0, 0.0, 0.0, (1e-3, 1.0), 100),
    ("polar", "near centre", 0, 1e-3, 2.0, (1e-12, 1e-3), 100),
    ("polar", "far 30", 0, 30.0, 0.3, (1e-11, 1e-2), 100),
    ("polar", "far 55", 0, 55.0, -1.0, (1e-9, 0.5), 100),
    ("horocyclic", "home", 0, 0.0, 0.0, (1e-3, 1.0), 100),
    ("horocyclic", "far up", 98765, -30.0, 0.3, (1e-11, 1e-2), 100),
    ("horocyclic", "far down", -12, 30.0, 1.0, (1e-11, 1e-2), 100),
    ("horocyclic", "far -55", 5, -55.0, -2.5, (1e-9, 0.5), 100),
]
for kind, name, whole, e0, theta0, (dmin, dmax), steps in WALKS:
    s0 = 0 if name == "home" else big_s(r, kind, whole)
    s = mp.mpf(s0) / mp.mpf(2) ** FRAC
    e, th = mp.mpf(e0), mp.mpf(theta0)
    walk = {"kind": kind, "name": name, "s0": str(s0), "e0": e0, "theta0": theta0, "steps": []}
    for i in range(steps):
        alpha, beta = r.uniform(-math.pi, math.pi), r.uniform(-math.pi, math.pi)
        d = 10 ** r.uniform(math.log10(dmin), math.log10(dmax))
        ds, e, th = decompose(kind, lift(kind, e) * rot(th) * move(alpha, d, beta))
        s = s + ds
        if kind == "polar":
            s = s - mp.floor(s)
        walk["steps"].append({"n": [alpha, d, beta], "s": fixed(s), "e": num(e), "theta": num(th)})
    out["walks"].append(walk)

# the polar camera moved exactly onto the centre, then off again
s, e, th = mp.mpf("0.1"), mp.mpf(0.5), mp.mpf(0.7)
walk = {"kind": "polar", "name": "through the centre", "s0": fixed(s), "e0": 0.5, "theta0": 0.7, "steps": []}
for alpha, d, beta in [(-0.7, -0.5, 0.3), (0.4, 1e-6, 0.0), (1.1, -0.2, -0.4)]:
    ds, e, th = decompose("polar", lift("polar", e) * rot(th) * move(alpha, d, beta))
    s = s + ds
    s = s - mp.floor(s)
    walk["steps"].append({"n": [alpha, d, beta], "s": fixed(s), "e": num(e), "theta": num(th)})
out["walks"].append(walk)

# -------------------------------------------------------------------------------------- lines
def spread_log2(kind, e, delta):
    if kind == "cartesian":
        return mp.log(mp.cosh(e), 2)
    if kind == "polar":
        return mp.log(TURN * mp.sinh(e) / delta, 2)
    return -e / mp.log(2)


def subdivision(kind, big_l):
    m = int(mp.floor(big_l))
    return max(2, m) if kind == "polar" else m


LINE_CASES = [
    ("cartesian", "km", -4321, 30.0, 0.4, 1e-9),
    ("cartesian", "earth", 12, -55.0, 1.3, 1e-11),
    ("cartesian", "R", 0, 0.7, -0.2, 1e-3),
    ("polar", "km", 0, 30.0, 0.4, 1e-9),
    ("polar", "earth", 0, 55.0, -2.2, 1e-11),
    ("polar", "m", 0, 2.0, 0.9, 1e-4),
    ("horocyclic", "km", 98765, -30.0, 0.4, 1e-9),
    ("horocyclic", "R", -3, 20.0, 2.0, 1e-9),
    ("horocyclic", "earth", 7, -55.0, 0.1, 1e-11),
]
for kind, unit, whole, e0, theta, lpx in LINE_CASES:
    per_r = PER_R[unit]
    s0 = big_s(r, kind, whole)
    S0 = mp.mpf(s0) / mp.mpf(2) ** FRAC
    E0 = mp.mpf(e0)
    cam_inv = rot(-mp.mpf(theta)) * lift(kind, -E0)  # (B(E0) R(theta))^-1
    k_top = math.floor(math.log10(2 * per_r) + 1e-9)
    kf = math.floor(math.log10(8 * lpx * per_r)) + 1
    case = {"kind": kind, "unit": unit, "s0": str(s0), "e0": e0, "theta": theta, "lpx": lpx, "points": []}
    tries = 0
    while len(case["points"]) < 24 and tries < 2000:
        tries += 1
        k = kf + r.randrange(3)
        if k > k_top:
            continue
        delta = mp.mpf(10) ** k / per_r
        unit_s = 1 if kind == "polar" else delta
        # a point up to 300 px from the centre, nudged onto a line of level k
        de = mp.mpf(r.uniform(-300, 300) * lpx)
        dd = mp.mpf(r.uniform(-300, 300) * lpx)
        e = E0 + de
        big_l = spread_log2(kind, e, delta)
        frac_l = big_l - mp.floor(big_l)
        if kind != "polar" or big_l > 2:
            if frac_l < 0.05 or frac_l > 0.95:
                continue  # m is ambiguous this close to a whole L
        m = subdivision(kind, big_l)
        if r.random() < 0.5:
            family = "spread"
            step = unit_s / mp.mpf(2) ** m
            f = mp.cosh(e) if kind == "cartesian" else TURN * mp.sinh(e) if kind == "polar" else mp.exp(-e)
            s = mp.nint((S0 + dd / f) / step) * step
        else:
            family = "even"
            e = mp.nint(e / delta) * delta
            f = mp.cosh(e) if kind == "cartesian" else TURN * mp.sinh(e) if kind == "polar" else mp.exp(-e)
            s = S0 + dd / f
        point = lift(kind, e) * mp.matrix([0, 0, 1])
        q = cam_inv * shift(kind, s - S0) * point
        x, y = float(q[0]), float(q[1])
        if math.hypot(x, y) > 400 * lpx:
            continue
        case["points"].append({"k": k, "m": m, "family": family, "q": [x, y, float(q[2])]})
    out["lines"].append(case)

json.dump(out, open("tests/unit/data/grid.json", "w"), separators=(",", ":"))
print(len(out["points"]), "points,", sum(len(w["steps"]) for w in out["walks"]), "walk steps,",
      sum(len(c["points"]) for c in out["lines"]), "line points")
