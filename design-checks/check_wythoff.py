"""D/E: Wythoff and snub tilings drawn from a kite (T and its mirror image across side 1)."""
import math, random, itertools, sys, time
import numpy as np

def fsolve(f, x0, it=60):
    x = np.array(x0, float)
    for _ in range(it):
        F = np.array(f(x)); 
        if np.max(np.abs(F)) < 1e-14: break
        Jm = np.zeros((2, 2)); h = 1e-7
        for k in range(2):
            d = np.zeros(2); d[k] = h; Jm[:, k] = (np.array(f(x + d)) - F) / h
        x = x - np.linalg.solve(Jm, F)
    return x

def mink(a, b): return a[0]*b[0] + a[1]*b[1] - a[2]*b[2]
J = np.diag([1.0, 1.0, -1.0])

def normals(p, q, r):
    n1 = np.array([0.0, -1.0, 0.0]); t = math.pi / p
    n2 = np.array([-math.sin(t), math.cos(t), 0.0])
    b = math.cos(math.pi / q); a = (b * math.cos(t) + math.cos(math.pi / r)) / math.sin(t)
    return [n1, n2, np.array([a, b, math.sqrt(a*a + b*b - 1)])]

def refl(n): return np.eye(3) - 2 * np.outer(n, J @ n)          # x -> x - 2<x,n> n
def norm_pt(x): x = x / math.sqrt(-mink(x, x)); return x if x[2] > 0 else -x
def dist(a, b): return math.acosh(max(1.0, -mink(a, b)))
def cross(a, b):                                                  # Minkowski cross: <c,a> = <c,b> = 0
    c = np.cross(a, b); return np.array([c[0], c[1], -c[2]])

def fold(x, ns):
    par = 0
    for _ in range(200):
        moved = False
        for n in ns:
            d = mink(x, n)
            if d > 0: x = x - 2*d*n; par ^= 1; moved = True
        if not moved: break
    return x, par

def kite_fold(x, ns):
    y, par = fold(x, ns)
    return (y - 2*mink(y, ns[0])*ns[0]) if par else y            # odd: once more across side 1

def generator(ns, w):
    Gm = np.array([[mink(a, b) for b in ns] for a in ns])
    dual = np.linalg.inv(Gm) @ np.array(ns)                      # rows n*_i with <n*_i, n_j> = delta_ij
    return norm_pt(-(np.array(w) @ dual))

def seg_dist(x, A, B):
    """Distance from x to the geodesic segment AB."""
    m = cross(A, B); m = m / math.sqrt(mink(m, m))
    # tangent at A toward B, and at B toward A: x projects inside iff on B's side at A and A's side at B
    TA = B + mink(A, B) * A; TB = A + mink(A, B) * B
    if mink(x, TA) > 0 and mink(x, TB) > 0:                      # sign convention checked below
        return math.asinh(abs(mink(x, m)))
    return min(dist(x, A), dist(x, B))

def seg_dist_many(x, A, B):
    """Vectorised seg_dist over edge arrays A, B (E x 3)."""
    mk = lambda u, v: u[..., 0]*v[..., 0] + u[..., 1]*v[..., 1] - u[..., 2]*v[..., 2]
    c = np.cross(A, B); m = c * np.array([1, 1, -1]); m = m / np.sqrt(mk(m, m))[:, None]
    ab = mk(A, B)[:, None]
    TA = B + ab * A; TB = A + ab * B
    inside = (mk(x[None, :], TA) > 0) & (mk(x[None, :], TB) > 0)
    dl = np.arcsinh(np.abs(mk(x[None, :], m)))
    dA = np.arccosh(np.maximum(1, -mk(x[None, :], A))); dB = np.arccosh(np.maximum(1, -mk(x[None, :], B)))
    return np.where(inside, dl, np.minimum(dA, dB)).min()

def seg_dist_each(x, A, B):
    mk = lambda u, v: u[..., 0]*v[..., 0] + u[..., 1]*v[..., 1] - u[..., 2]*v[..., 2]
    c = np.cross(A, B); m = c * np.array([1, 1, -1]); m = m / np.sqrt(mk(m, m))[:, None]
    ab = mk(A, B)[:, None]
    TA = B + ab * A; TB = A + ab * B
    inside = (mk(x[None, :], TA) > 0) & (mk(x[None, :], TB) > 0)
    dl = np.arcsinh(np.abs(mk(x[None, :], m)))
    dA = np.arccosh(np.maximum(1, -mk(x[None, :], A))); dB = np.arccosh(np.maximum(1, -mk(x[None, :], B)))
    return np.where(inside, dl, np.minimum(dA, dB))

def check_seg_dist():
    random.seed(1); worst = 0
    for _ in range(300):
        A = norm_pt(np.array([random.uniform(-1,1), random.uniform(-1,1), 2])); B = norm_pt(np.array([random.uniform(-1,1), random.uniform(-1,1), 2]))
        x = norm_pt(np.array([random.uniform(-1,1), random.uniform(-1,1), 2]))
        # brute force along the segment
        d = math.acosh(-mink(A, B)); best = 1e9
        for i in range(4001):
            s = d * i / 4000; P = (math.sinh(d - s) * A + math.sinh(s) * B) / math.sinh(d)
            best = min(best, dist(x, P))
        worst = max(worst, abs(best - seg_dist(x, A, B)))
    print(f"D0 segment distance vs sampling: worst {worst:.1e}")

def group_elements(ns, rmax):
    """Every element whose image of the triangle's incentre lies within rmax of the origin (BFS over neighbours)."""
    gens = [refl(n) for n in ns]
    inc = norm_pt(-(np.linalg.inv(np.array([[mink(a, b) for b in ns] for a in ns])) @ np.array(ns)).sum(axis=0))
    key = lambda M: tuple(np.round(M @ inc, 7))
    seen = {key(np.eye(3)): np.eye(3)}; frontier = [np.eye(3)]
    while frontier:
        nxt = []
        for M in frontier:
            for g in gens:
                M2 = M @ g; k = key(M2)
                if k in seen or (M2 @ inc)[2] > math.cosh(rmax): continue
                seen[k] = M2; nxt.append(M2)
        frontier = nxt
    return list(seen.values())

def tiling(p, q, r, kind):
    """Base edges (pairs of points) and face centres with classes; kind = active set or 'snub'."""
    ns = normals(p, q, r); s = [refl(n) for n in ns]
    P = np.array([0, 0, 1.0]); Q = norm_pt(cross(ns[0], ns[2])); R = norm_pt(cross(ns[1], ns[2]))
    if kind == "snub":
        rot = {"P": s[0] @ s[1], "Q": s[0] @ s[2], "R": s[1] @ s[2]}
        def f(v):
            G = generator(ns, [abs(v[0]), abs(v[1]), 1.0])
            L = [dist(G, M @ G) for M in rot.values()]
            return [L[0] - L[1], L[1] - L[2]]
        sol = fsolve(f, [1, 1]); G = generator(ns, [abs(sol[0]), abs(sol[1]), 1.0])
        edges = [(G, M @ G) for M in rot.values()]
        rotation_only = True
    else:
        w = [1.0 if j in kind else 0.0 for j in range(3)]
        G = generator(ns, w)
        edges = [(G, s[j] @ G) for j in kind]
        rotation_only = False
    return ns, G, edges, rotation_only, (P, Q, R)

def check_construction(p, q, r, kind, depth=9, npts=3000):
    ns, G, base, rot_only, (P, Q, R) = tiling(p, q, r, kind)
    els = group_elements(ns, 4.2)
    if rot_only: els = [M for M in els if np.linalg.det(M) > 0]
    edges = []
    for M in els:
        for A, B in base:
            a, b = M @ A, M @ B
            edges.append((a, b))
    # dedupe
    uniq = {}
    for a, b in edges:
        ka, kb = tuple(np.round(a, 6)), tuple(np.round(b, 6))
        uniq[min(ka, kb) + max(ka, kb)] = (a, b)
    edges = [e for e in uniq.values() if min(e[0][2], e[1][2]) < math.cosh(3.6)]
    # kite K = T u s1 T: sample points to find the edges within 0.35 of it
    s1 = refl(ns[0]); random.seed(7)
    def in_T(x): return all(mink(x, n) <= 1e-12 for n in ns)
    kpts = []
    while len(kpts) < 1500:
        a, b = random.uniform(-3, 3), random.uniform(-3, 3)
        x = np.array([a, b, math.sqrt(1 + a*a + b*b)])
        if dist(x, P) > 3: continue
        if in_T(x): kpts.append(x); kpts.append(s1 @ x)
    EA = np.array([e[0] for e in edges]); EB = np.array([e[1] for e in edges])
    dmin = np.full(len(edges), 1e9)
    for x in kpts: dmin = np.minimum(dmin, seg_dist_each(x, EA, EB))
    near = [e for e, d in zip(edges, dmin) if d < 0.35]
    NA = np.array([e[0] for e in near]); NB = np.array([e[1] for e in near])
    # check: for random world points, kite-fold distance over `near` equals the true distance (when < 0.3)
    worst = 0; random.seed(8); n = 0
    for _ in range(npts):
        a, b = random.uniform(-2, 2), random.uniform(-2, 2)
        x = np.array([a, b, math.sqrt(1 + a*a + b*b)])
        true = seg_dist_many(x, EA, EB)
        y = kite_fold(x, ns)
        got = seg_dist_many(y, NA, NB)
        if true < 0.3 or got < 0.3: worst = max(worst, abs(true - got)); n += 1
    return len(near), worst, n, G

if __name__ == "__main__":
    check_seg_dist()
    for (p, q, r) in [(7, 3, 2), (5, 4, 2), (4, 5, 2), (8, 3, 2), (3, 3, 4)]:
        for kind in [(2,), (0,), (1,), (1, 2), (0, 2), (0, 1), (0, 1, 2), "snub"]:
            t0 = time.time()
            k, worst, n, G = check_construction(p, q, r, kind, npts=1500)
            print(flush=True, end=""); print(f"D1 ({p},{q},{r}) {str(kind):10s}: {k:2d} segments cross the kite; kite distance vs true, {n} points: worst {worst:.1e}  [{time.time()-t0:.0f}s]")
