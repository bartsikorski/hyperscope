"""Numerical checks of the formulas in the precise design (doubles + mpmath reference)."""
import math, cmath, random
import numpy as np
import mpmath as mp

mp.mp.dps = 700
ETA = np.diag([1.0, 1.0, -1.0])


def mink(a, b):
    return a[0] * b[0] + a[1] * b[1] - a[2] * b[2]


def normals(p, q, r):
    """Mirror normals of the (p,q,r) triangle; vertex P (angle pi/p) at the origin.
    m1: y = 0, m2: line through origin at angle pi/p, m3: opposite side.
    Region = {x : <x,n_i> <= 0}; <n_i,n_j> = -cos(pi/m_ij)."""
    n1 = np.array([0.0, -1.0, 0.0])                      # region y >= 0
    t = math.pi / p
    n2 = np.array([-math.sin(t), math.cos(t), 0.0])      # region below the line at angle t
    # n3 = (a, b, c): <n1,n3> = -b = -cos(pi/q)  (angle at the vertex on the x axis = pi/q)
    #                 <n2,n3> = -a sin t + b cos t = -cos(pi/r)
    b = math.cos(math.pi / q)
    a = (b * math.cos(t) + math.cos(math.pi / r)) / math.sin(t)
    c = math.sqrt(a * a + b * b - 1.0)                   # real iff hyperbolic
    n3 = np.array([a, b, c])
    return [n1, n2, n3]


def fold(x, ns, maxit=500):
    k = 0
    for it in range(maxit):
        moved = False
        for n in ns:
            d = mink(x, n)
            if d > 0:
                x = x - 2 * d * n
                k += 1
                moved = True
        if not moved:
            return x, k, it
    return x, k, maxit


def point(d, phi):
    return np.array([math.sinh(d) * math.cos(phi), math.sinh(d) * math.sin(phi), math.cosh(d)])


def check_group(p, q, r):
    ns = normals(p, q, r)
    G = np.array([[mink(a, b) for b in ns] for a in ns])
    want = np.array([[1, -math.cos(math.pi / p), -math.cos(math.pi / q)],
                     [-math.cos(math.pi / p), 1, -math.cos(math.pi / r)],
                     [-math.cos(math.pi / q), -math.cos(math.pi / r), 1]])
    assert np.allclose(G, want, atol=1e-12), (G, want)
    o = np.array([0.0, 0.0, 1.0])
    assert mink(o, ns[0]) <= 1e-15 and mink(o, ns[1]) <= 1e-15 and mink(o, ns[2]) < 0, "origin not in region"
    random.seed(1)
    worst, iters = 0.0, []
    for _ in range(20000):
        x = point(random.uniform(0, 7), random.uniform(0, 2 * math.pi))
        y, k, it = fold(x, ns)
        assert all(mink(y, n) <= 1e-9 for n in ns), "fold did not land in region"
        worst = max(worst, abs(mink(y, y) + 1))
        iters.append(k)
    return worst, np.percentile(iters, [50, 95, 100])


for g in [(7, 3, 2), (4, 6, 2), (8, 3, 2), (5, 4, 2), (3, 3, 4), (4, 4, 3), (2, 3, 7)]:
    w, pc = check_group(*g)
    print(f"group {g}: Gram ok, region ok, max |<x,x>+1| after fold {w:.1e}, reflections p50/p95/max {pc}")


# ---------- deep zoom in the disk: w = u / (lam - conj(c) u), lam = sigma / s
def ref_disk(c, s, u):
    c, s, u = mp.mpc(c), mp.mpf(s), mp.mpc(u)
    z = c + s * u
    return (z - c) / (1 - mp.conj(c) * z)


worst = 0
for depth in [1e-3, 1e-8, 1e-15, 1e-40, 1e-120, 1e-300]:
    theta = 0.7
    sigma_mp = mp.mpf(depth)                     # 1 - |c|^2, stored directly
    r_mp = mp.sqrt(1 - sigma_mp)
    c_mp = r_mp * mp.expj(theta)
    s_mp = sigma_mp / mp.mpf(3.7)                # keeps lam = 3.7
    lam = float(sigma_mp / s_mp)
    c = complex(c_mp)                             # only |c| ~ 1 to float precision is needed
    for u in [0.3 + 0.2j, -0.9 + 0.5j, 0.01j, 1.2 - 0.4j]:
        # float32-like evaluation
        u32 = np.complex64(u)
        w32 = u32 / (np.float32(lam) - np.complex64(c.conjugate()) * u32)
        ref = complex(ref_disk(c_mp, s_mp, u))
        err = abs(w32 - ref) / abs(ref)
        worst = max(worst, err)
print(f"disk deep zoom to sigma=1e-300: worst relative error of w in float32 = {worst:.1e}")

# zoom step update of sigma: sigma' = sigma - 2 Re(conj c * D) - |D|^2, D = s (1 - 1/k) u0
sigma = 1e-200
r = math.sqrt(1 - sigma) if sigma > 1e-16 else 1.0
c = cmath.exp(0.7j) * (1 - sigma / 2)
s = sigma / 3.7
u0, k = 0.4 - 0.25j, 2.0
D = s * (1 - 1 / k) * u0
sigma_new = sigma - 2 * (c.conjugate() * D).real - abs(D) ** 2
c_mp = mp.sqrt(1 - mp.mpf(sigma)) * mp.expj(0.7)
c_new_mp = c_mp + mp.mpf(s) * (1 - 1 / mp.mpf(k)) * mp.mpc(u0)
sigma_ref = 1 - abs(c_new_mp) ** 2
print(f"zoom update of sigma at 1e-200: relative error {abs(sigma_new - float(sigma_ref)) / float(sigma_ref):.1e}")

# ---------- half-plane: w = u / (i mu + u), mu = 2 Im c / s
worst = 0
for ImC in [1.0, 1e-10, 1e-100, 1e-250]:
    c_mp = mp.mpc(0.3, ImC)
    s_mp = mp.mpf(ImC) / 2.5
    mu = float(2 * c_mp.imag / s_mp)
    for u in [0.3 + 0.2j, -0.9 + 0.5j, 1.2 - 0.4j]:
        z = c_mp + s_mp * mp.mpc(u)
        ref = complex((z - c_mp) / (z - mp.conj(c_mp)))
        u32 = np.complex64(u)
        w32 = u32 / (np.complex64(1j * mu) + u32)
        worst = max(worst, abs(w32 - ref) / abs(ref))
print(f"half-plane deep zoom to Im c = 1e-250: worst relative error in float32 = {worst:.1e}")

# ---------- plane in H^3: horizon at sin(alpha) = tanh(h), hit by tanh t = tanh(h)/d
def mink4(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3]


worst = 0
for h in [0.05, 0.5, 2.0]:
    P0 = np.array([0, 0, math.sinh(h), math.cosh(h)])
    ex, ey = np.array([1.0, 0, 0, 0]), np.array([0, 1.0, 0, 0])
    edown = -np.array([0, 0, math.cosh(h), math.sinh(h)])
    assert abs(mink4(edown, edown) - 1) < 1e-12 and abs(mink4(edown, P0)) < 1e-12
    for d in [math.tanh(h) + 1e-3, 0.5 * (1 + math.tanh(h)), 0.999]:
        a = math.sqrt(1 - d * d)
        v = a * ex + d * edown
        t = math.atanh(math.tanh(h) / d)
        Q = math.cosh(t) * P0 + math.sinh(t) * v
        worst = max(worst, abs(Q[2]))
        assert abs(mink4(Q, Q) + 1) < 1e-9
    # rays with d <= tanh h never reach the plane
print(f"H3 plane hit: worst |z| at the hit point = {worst:.1e}; horizon below horizontal by asin(tanh h)")
