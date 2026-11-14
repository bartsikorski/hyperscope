"""H: chiral colourings (step 14): transitive actions of the rotation group on k colours, colouring kites.

The rotation group of the (p, q, r) triangle group is <a, b | a^p = b^q = (ab)^r = 1> with
a = s1 s2 (about P), b = s3 s1 (about Q), so ab = s1 (s2 s3) s1 (about s1 R). A chiral colouring is a
pair of permutations alpha, beta of k colours with alpha^p = beta^q = (alpha beta)^r = id, transitive.
Each kite (T and its mirror image across side 1) of an even element h gets the colour pi(h)(0).
Per pixel the fold word is read in pairs (each pair a rotation), and an odd word pairs its last
reflection with side 1 (the kite of h s1). Checked here:
  H1 counts per colour count and the search time;
  H2 the colour is a function of the kite (a point's kite found geometrically), on random points;
  H3 re-centering by a rotation-type word, carrying the camera permutation along its pairs, keeps
     every point's colour;
  H4 the colour across sides 2 and 3 (the formula the shader uses for anti-aliasing) equals the
     colour of the point reflected across that side;
  H5 the full colourings (version 1's search) restricted to rotations satisfy the same relations.
"""
import math, random, sys, os, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_wythoff import normals, refl, mink, norm_pt, dist

sys.setrecursionlimit(10000)


def chiral_actions(p, q, r, k):
    """Transitive actions of <a, b | a^p, b^q, (ab)^r> on k points, point 0 the start, points numbered
    in the order the search meets them (Sims' low-index method: define the next undefined image in
    breadth-first order, check the relators where they are defined)."""
    out = []
    # f[g][x]: image of x under generator g in (a, a^-1, b, b^-1); inverse of g is g ^ 1
    f = [[None] * k for _ in range(4)]
    rels = [([0], p), ([2], q), ([0, 2], r)]

    def trace_ok():
        # (word)^m must close on every point where it is defined; a point that comes back after n
        # whole periods closes it only when n divides m
        for per, m in rels:
            for x in range(k):
                y = x
                for n in range(1, m + 1):
                    for g in per:
                        y = f[g][y] if y is not None else None
                    if y is None or y == x:
                        break
                if y is None:
                    continue
                if y != x or m % n != 0:
                    return False
        return True

    def rec(n):
        for x in range(n):
            for g in range(4):
                if f[g][x] is None:
                    gi = g ^ 1
                    cands = [y for y in range(n) if f[gi][y] is None] + ([n] if n < k else [])
                    for y in cands:
                        f[g][x] = y
                        f[gi][y] = x
                        if trace_ok():
                            rec(n + (1 if y == n else 0))
                        f[g][x] = None
                        f[gi][y] = None
                    return
        if n == k:
            out.append(([f[0][x] for x in range(k)], [f[2][x] for x in range(k)]))
    rec(1)
    return out


def canon(alpha, beta, k):
    best = None
    for s0 in range(k):
        lab, order, i = {s0: 0}, [s0], 0
        ia = [0] * k; ib = [0] * k
        for x in range(k): ia[alpha[x]] = x; ib[beta[x]] = x
        while i < len(order):
            x = order[i]; i += 1
            for y in (alpha[x], ia[x], beta[x], ib[x]):
                if y not in lab: lab[y] = len(order); order.append(y)
        form = tuple(lab[g[x]] for x in order for g in (alpha, beta))
        best = form if best is None or form < best else best
    return best


def chiral_colourings(p, q, r, k):
    seen, out = set(), []
    for a, b in chiral_actions(p, q, r, k):
        c = canon(a, b, k)
        if c not in seen:
            seen.add(c); out.append((a, b))
    return out


def compose(a, b): return [a[i] for i in b]          # (a o b)(i) = a(b(i))
def inverse(a):
    r = [0] * len(a)
    for i, v in enumerate(a): r[v] = i
    return r


def pair_perms(alpha, beta):
    """tau[i][j] = the permutation of r_i r_j (mirror indices 0, 1, 2 for sides 1, 2, 3)."""
    k = len(alpha)
    I = list(range(k))
    ai, bi = inverse(alpha), inverse(beta)
    t = [[I] * 3 for _ in range(3)]
    t[0][1] = alpha                       # s1 s2 = a
    t[1][0] = ai                          # s2 s1 = a^-1
    t[2][0] = beta                        # s3 s1 = b
    t[0][2] = bi                          # s1 s3 = b^-1
    t[1][2] = compose(ai, bi)             # s2 s3 = (s2 s1)(s1 s3) = a^-1 b^-1
    t[2][1] = compose(beta, alpha)        # s3 s2 = (s3 s1)(s1 s2) = b a
    return t


def fold_word(x, ns):
    word = []
    for _ in range(300):
        moved = False
        for j, n in enumerate(ns):
            d = mink(x, n)
            if d > 0:
                x = x - 2 * d * n; word.append(j); moved = True
        if not moved: break
    return x, word


def carry(perm, word, tau):
    """Compose along a word read in pairs; returns the permutation and the unpaired last mirror (or None)."""
    for i in range(0, len(word) - 1, 2):
        perm = compose(perm, tau[word[i]][word[i + 1]])
    return perm, (word[-1] if len(word) % 2 else None)


def colour_of(perm, pend, tau):
    return (compose(perm, tau[pend][0]) if pend is not None else perm)[0]


def across(perm, pend, tau, j):
    """The colour across side j (1 or 2) of the folded point's triangle."""
    return (compose(perm, tau[pend][j]) if pend is not None else compose(perm, tau[j][0]))[0]


def random_points(n, radius, seed):
    rnd = random.Random(seed)
    pts = []
    for _ in range(n):
        d, a = radius * math.sqrt(rnd.random()), rnd.uniform(0, 2 * math.pi)
        pts.append(np.array([math.sinh(d) * math.cos(a), math.sinh(d) * math.sin(a), math.cosh(d)]))
    return pts


def kite_key(word, R, ns, K):
    """The kite holding the point: h K for the even element h (the fold word, with side 1 appended when odd)."""
    w = word + [0] if len(word) % 2 else word
    M = np.eye(3)
    for j in w: M = M @ R[j]
    return tuple(np.round(M @ K, 7))


def corners(ns):
    def cr(a, b):
        c = np.cross(a, b); return norm_pt(np.array([c[0], c[1], -c[2]]))
    return cr(ns[0], ns[1]), cr(ns[0], ns[2]), cr(ns[1], ns[2])


def check_group(g, kmax=8, npts=3000, radius=3.0):
    p, q, r = g
    t0 = time.time()
    by_k = {k: chiral_colourings(p, q, r, k) for k in range(2, kmax + 1)}
    t_search = time.time() - t0
    ns = normals(p, q, r); R = [refl(n) for n in ns]
    P, Q, _ = corners(ns)
    K = norm_pt(P + Q)                    # the middle of side 1: inside the kite
    pts = random_points(npts, radius, 7)
    words = [fold_word(x, ns) for x in pts]
    bad2 = bad3 = bad4 = 0
    total = 0
    for k, cols in by_k.items():
        for alpha, beta in cols:
            tau = pair_perms(alpha, beta)
            I = list(range(k))
            # H2: one colour per kite
            kites = {}
            for (y, w) in words:
                perm, pend = carry(I, w, tau)
                kites.setdefault(kite_key(w, R, ns, K), set()).add(colour_of(perm, pend, tau))
            bad2 += sum(len(v) > 1 for v in kites.values())
            # H3: re-centering
            for t in range(40):
                c = pts[t]
                _, cw = fold_word(c, ns)
                if len(cw) % 2: cw = cw + [0]
                gm = np.eye(3)
                for j in cw: gm = R[j] @ gm
                pc, pend = carry(I, cw, tau)
                assert pend is None
                for x in pts[100 + 5 * t: 105 + 5 * t]:
                    _, w0 = fold_word(x, ns)
                    _, w1 = fold_word(gm @ x, ns)
                    a0 = colour_of(*carry(I, w0, tau), tau)
                    a1 = colour_of(*carry(pc, w1, tau), tau)
                    bad3 += a0 != a1
            # H4: across sides 2 and 3
            for (y, w) in words[:600]:
                perm, pend = carry(I, w, tau)
                for j in (1, 2):
                    # the point just across side j: reflect the folded point, then unfold by the word
                    yj = y - 2 * mink(y, ns[j]) * ns[j]
                    M = np.eye(3)
                    for i in w: M = M @ R[i]
                    xj = M @ yj
                    _, wj = fold_word(xj, ns)
                    want = colour_of(*carry(I, wj, tau), tau)
                    bad4 += want != across(perm, pend, tau, j)
            total += 1
    counts = " ".join(f"{k}:{len(v)}" for k, v in by_k.items())
    print(f"H {g}: chiral colourings by colour count {counts} (total {total}) [{t_search:.2f}s]; "
          f"kites with two colours {bad2}, colours changed by re-centering {bad3}, wrong colour across a side {bad4}")


def check_h5(g, kmax=5):
    """Full colourings (involution triples) restricted to rotations satisfy the rotation relations."""
    p, q, r = g
    from check_lowindex import colourings as full
    n = bad = 0
    for k in range(2, kmax + 1):
        for t in full(p, q, r, k):
            s = t
            alpha = compose(s[0], s[1]); beta = compose(s[2], s[0])
            def order_ok(a, m):
                x = list(range(k))
                for _ in range(m): x = compose(x, a)
                return x == list(range(k))
            n += 1
            bad += not (order_ok(alpha, p) and order_ok(beta, q) and order_ok(compose(alpha, beta), r))
    print(f"H5 {g}: {n} full colourings restricted to rotations, {bad} break a rotation relation")


if __name__ == "__main__":
    for g in [(7, 3, 2), (8, 3, 2), (5, 4, 2), (4, 5, 2), (6, 4, 2), (3, 3, 4), (2, 3, 7), (3, 7, 2)]:
        check_group(g)
    for g in [(7, 3, 2), (6, 4, 2)]:
        check_h5(g)
