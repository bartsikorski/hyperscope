"""F: exact tile identity: the geometric representation of the triangle group reduced mod a prime l."""
import math, random, itertools, time
import numpy as np

def is_prime(n): return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))

def roots_2cos(m, l):
    """2cos(pi k / m), gcd(k, 2m) = 1, in F_l: z + 1/z for z of multiplicative order 2m (l = 1 mod 2m),
    or the trace of such an element of F_{l^2} (l = -1 mod 2m)."""
    if m == 2: return 0
    if (l - 1) % (2 * m) == 0:
        g = next(g for g in range(2, l) if all(pow(g, (l - 1) // f, l) != 1 for f in set(prime_factors(l - 1))))
        z = pow(g, (l - 1) // (2 * m), l)
        return (z + pow(z, l - 2, l)) % l
    # l = -1 mod 2m: solve the minimal polynomial of 2cos(pi/m) by brute force over F_l (Chebyshev: T_m(t/2) = -1)
    for t in range(l):
        # order of the 2x2 matrix [[t, -1], [1, 0]] (eigenvalues z, 1/z with z + 1/z = t) must be exactly 2m
        if mat_order(np.array([[t, l - 1], [1, 0]], dtype=np.int64), l, 4 * m) == 2 * m: return t
    raise ValueError

def prime_factors(n):
    f, d = [], 2
    while d * d <= n:
        while n % d == 0: f.append(d); n //= d
        d += 1
    if n > 1: f.append(n)
    return f

def mat_order(A, l, cap):
    M = np.eye(A.shape[0], dtype=np.int64)
    for k in range(1, cap + 1):
        M = (M @ A) % l
        if np.array_equal(M, np.eye(A.shape[0], dtype=np.int64)): return k
    return None

def choose_prime(p, q, r, lo=4096):
    m = [x for x in (p, q, r) if x > 2]
    l = lo
    while True:
        l += 1
        if is_prime(l) and all((l - 1) % (2 * x) == 0 or (l + 1) % (2 * x) == 0 for x in m):
            # 2B must be invertible mod l (singular for 36 groups up to 64 at their first prime, e.g. (6, 16, 48) at 4127)
            c = {x: roots_2cos(x, l) for x in (p, q, r)}
            mm = [[1, p, q], [p, 1, r], [q, r, 1]]
            B = [[2 if i == j else (-c[mm[i][j]]) % l for j in range(3)] for i in range(3)]
            det = (B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0]) + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0])) % l
            if det != 0: return l

def rep(p, q, r, l):
    """s_i(v) = v - 2 B(e_i, v) e_i with B_ij = -cos(pi/m_ij); in F_l with c_m = 2cos(pi/m): -2B_ij = c_m."""
    c = {x: roots_2cos(x, l) for x in (p, q, r)}
    m = [[1, p, q], [p, 1, r], [q, r, 1]]
    twoB = np.array([[2 if i == j else (-c[m[i][j]]) % l for j in range(3)] for i in range(3)], dtype=np.int64)
    S = []
    for i in range(3):
        M = np.eye(3, dtype=np.int64)
        M[i, :] = (M[i, :] - twoB[i, :]) % l          # s_i(e_j) = e_j - 2B_ij e_i: row i changes
        S.append(M % l)
    return S, twoB

def check(p, q, r):
    l = choose_prime(p, q, r)
    S, twoB = rep(p, q, r, l)
    I = np.eye(3, dtype=np.int64)
    ok = all(np.array_equal((s @ s) % l, I) for s in S)
    orders = [mat_order((S[0] @ S[1]) % l, l, 4 * p), mat_order((S[0] @ S[2]) % l, l, 4 * q), mat_order((S[1] @ S[2]) % l, l, 4 * r)]
    # a vector fixed by s_1 and s_2 (the P stabiliser): 2B(e_1, w) = 2B(e_2, w) = 0
    w = None
    for a in range(l):
        for b in range(1, 2):
            v = np.array([a, 0, b], dtype=np.int64)
            # solve for v[1] from the first equation
            for y in range(l):
                v[1] = y
                if (twoB[0] @ v) % l == 0 and (twoB[1] @ v) % l == 0: w = v.copy(); break
            if w is not None: break
        if w is not None: break
    fixed = all(np.array_equal((s @ w) % l, w % l) for s in S[:2])
    # tiles: g w over random words; collisions between distinct tiles (by real geometry) are what matters
    return l, ok, orders, fixed, w

if __name__ == "__main__":
    for g in [(7, 3, 2), (5, 4, 2), (6, 4, 2), (8, 3, 2), (4, 5, 2), (3, 3, 4), (2, 3, 7), (3, 7, 2), (12, 3, 2), (20, 20, 20)]:
        t0 = time.time()
        l, ok, orders, fixed, w = check(*g)
        print(f"F1 {g}: prime {l}, s_i^2 = 1 {ok}, orders of s1s2, s1s3, s2s3 = {orders} (want {g}), P-stabiliser fixes w {fixed}  [{time.time()-t0:.1f}s]")

# ---------------------------------------------------------------- F2: the identity is a function of the tile
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_wythoff import normals, refl, mink, norm_pt, fold as rfold

def fold_word(x, ns):
    word = []
    for _ in range(300):
        moved = False
        for j, n in enumerate(ns):
            d = mink(x, n)
            if d > 0: x = x - 2 * d * n; word.append(j); moved = True
        if not moved: break
    return x, word

def tile_id(A, word, S, w, l):
    for j in word: A = (A @ S[j]) % l
    return tuple((A @ w) % l)

def check_ids(p, q, r, n=4000, radius=3.5):
    l, ok, orders, fixed, w = check(p, q, r)
    S, _ = rep(p, q, r, l)
    ns = normals(p, q, r); R = [refl(v) for v in ns]
    random.seed(11)
    pts = []
    for _ in range(n):
        d, a = radius * math.sqrt(random.random()), random.uniform(0, 2 * math.pi)
        pts.append(np.array([math.sinh(d) * math.cos(a), math.sinh(d) * math.sin(a), math.cosh(d)]))
    I = np.eye(3, dtype=np.int64)
    by_tile = {}
    for x in pts:
        _, word = fold_word(x, ns)
        M = np.eye(3)
        for j in word: M = M @ R[j]
        centre = tuple(np.round(M @ np.array([0, 0, 1.0]), 6))          # the tile centre g P, real geometry
        by_tile.setdefault(centre, set()).add(tile_id(I, word, S, w, l))
    same = all(len(v) == 1 for v in by_tile.values())
    ids = [next(iter(v)) for v in by_tile.values()]
    collisions = len(ids) - len(set(ids))
    # re-centering: move the world by a rotation-type g (the camera's fold word), carry A along it
    worst = 0
    for trial in range(200):
        c = pts[trial]
        _, cw = fold_word(c, ns)
        if len(cw) % 2: cw.append(0)
        g = np.eye(3)
        for j in cw: g = R[j] @ g
        A = I.copy()
        for j in cw: A = (A @ S[j]) % l
        for x in pts[200 + trial * 5: 205 + trial * 5]:
            _, w0 = fold_word(x, ns); _, w1 = fold_word(g @ x, ns)
            worst += tile_id(I, w0, S, w, l) != tile_id(A, w1, S, w, l)
    print(f"F2 {(p,q,r)}: {len(by_tile)} tiles within {radius} R, one identity per tile {same}, {collisions} collisions; after re-centering {worst} of 1000 changed")

for g in [(7, 3, 2), (5, 4, 2), (3, 3, 4), (2, 3, 7)]:
    check_ids(*g)
