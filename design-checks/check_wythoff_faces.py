"""W: Wythoff tilings for step 15: which face a point is in, its distance to the edges, the neighbour
across the nearest edge, and the face's exact identity, all from small tables built on the CPU.

Two domains, one per-pixel rule. A non-snub tiling is invariant under the whole group, so the pixel is
folded into the triangle T, where at most three lines cut it (the lines through G perpendicular to the
active mirrors) and at most three faces meet it (around P, Q and R). The snub is invariant under the
rotations only: the pixel is folded into the kite K = T u s1 T (an odd word reflects once more across
side 1), where a list of edge lines and the faces meeting K are precomputed. Per pixel either way:
  bits_e = <y, m_e> > 0 for every listed line e; the face is the first f with (bits ^ want_f) & mask_f = 0;
  de = min over e in mask_f of asinh|<y, m_e>| (exact for a convex face, whose mask holds every edge
  that can be nearest to a point of the domain); the neighbour across the nearest line comes from a
  per-(face, line) table.
Checked against brute force over the whole tiling (edges and faces enumerated in a disc):
  W1 every point of the domain lies in exactly one face, and that face is the true one;
  W2 de equals the true distance to the tiling's edges;
  W3 across the nearest edge the table's neighbour is the true face there (points just either side of
     random edges);
  W4 the face's identity mod l (as the shader carries it) equals the one from its own word, and the
     identities of the faces within 3 R are distinct;
  W5 the edge length per area (an edge on the domain's boundary counted half) from the formula against
     the tiling's edges clipped to the domain;
  W6 the kite tables applied to the non-snub tilings agree with the triangle tables (two mechanisms);
  W7 snub: the three edge lengths are equal; table sizes for many groups.
"""
import math, random, sys, os, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_wythoff import normals, refl, mink, norm_pt, dist, cross, generator, fsolve, seg_dist_each

# from check_tileid.py (copied: that script runs its checks when imported)
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


CORNER_MIRRORS = {"P": (0, 1), "Q": (0, 2), "R": (1, 2)}
MIRROR_CORNERS = {0: ("P", "Q"), 1: ("P", "R"), 2: ("Q", "R")}
TYPES = {"P": 0, "Q": 1, "R": 2, "T": 3}


def solve_mod(A, b, l):
    """x with A x = b mod l (Gauss-Jordan over F_l)."""
    M = [list(map(int, A[i])) + [int(b[i])] for i in range(3)]
    for c in range(3):
        piv = next(r for r in range(c, 3) if M[r][c] % l)
        M[c], M[piv] = M[piv], M[c]
        inv = pow(M[c][c], l - 2, l)
        M[c] = [v * inv % l for v in M[c]]
        for r in range(3):
            if r != c and M[r][c]:
                f = M[r][c]; M[r] = [(vr - f * vc) % l for vr, vc in zip(M[r], M[c])]
    return np.array([M[i][3] for i in range(3)], dtype=np.int64)


def cross2(a, b): return a[0] * b[1] - a[1] * b[0]
def unit(m): return m / math.sqrt(mink(m, m))
def klein(x): return np.array([x[0] / x[2], x[1] / x[2]])


def corners_of(ns):
    return {"P": norm_pt(cross(ns[0], ns[1])), "Q": norm_pt(cross(ns[0], ns[2])), "R": norm_pt(cross(ns[1], ns[2]))}


def orders(p, q, r): return {"P": p, "Q": q, "R": r}


def snub_generator(ns):
    s = [refl(n) for n in ns]
    rot = [s[0] @ s[1], s[0] @ s[2], s[1] @ s[2]]
    def f(v):
        G = generator(ns, [abs(v[0]), abs(v[1]), 1.0])
        L = [dist(G, M @ G) for M in rot]
        return [L[0] - L[1], L[1] - L[2]]
    sol = fsolve(f, [1, 1])
    return generator(ns, [abs(sol[0]), abs(sol[1]), 1.0])


# ----------------------------------------------------------------------------- the group, enumerated

def elements(ns, rmax, even_only=False):
    """Group elements (matrix, word) whose image of the incentre lies within rmax, by BFS; the word
    is the product order M = R[w0] R[w1] ... (as the fold's)."""
    R = [refl(n) for n in ns]
    G0 = np.linalg.inv(np.array([[mink(a, b) for b in ns] for a in ns])) @ np.array(ns)
    inc = norm_pt(-G0.sum(axis=0))
    key = lambda M: tuple(np.round(M @ inc, 7))
    seen = {key(np.eye(3)): (np.eye(3), ())}
    frontier = [(np.eye(3), ())]
    while frontier:
        nxt = []
        for M, w in frontier:
            for j in range(3):
                M2 = M @ R[j]; k = key(M2)
                if k in seen or (M2 @ inc)[2] > math.cosh(rmax): continue
                seen[k] = (M2, w + (j,)); nxt.append((M2, w + (j,)))
        frontier = nxt
    out = list(seen.values())
    return [e for e in out if len(e[1]) % 2 == 0] if even_only else out


def polygon_sorted(c, pts):
    """Vertices around the centre c by angle (in Klein coordinates; convex)."""
    kc = klein(c)
    return sorted(pts, key=lambda v: math.atan2(*(klein(v) - kc)[::-1]))


def build_world(ns, G, active, snub, rmax=3.9, face_r=None):
    """Edges (pairs) and faces (centre, type, word, vertices) of the tiling: group elements within
    rmax, faces (and their edges) with centres within face_r."""
    lim = math.cosh(face_r if face_r is not None else rmax)
    p, q, r = ns_orders
    C = corners_of(ns); m_of = orders(p, q, r)
    R = [refl(n) for n in ns]
    els = elements(ns, rmax)
    edges, faces = {}, {}
    def ek(a, b):
        ka, kb = tuple(np.round(a, 6)), tuple(np.round(b, 6))
        return min(ka, kb) + max(ka, kb)
    if snub:
        rot = {"P": R[0] @ R[1], "Q": R[0] @ R[2], "R": R[1] @ R[2]}
        base = [(G, rot[X] @ G) for X in "PQR"]
        for M, w in els:
            if len(w) % 2: continue
            if (M @ G)[2] < lim:
                for a, b in base: edges.setdefault(ek(M @ a, M @ b), (M @ a, M @ b))
            for X in "PQR":
                if m_of[X] < 3: continue
                c = M @ C[X]
                key = tuple(np.round(c, 6))
                if c[2] > lim or key in faces: continue
                verts = [M @ np.linalg.matrix_power(rot[X], k) @ G for k in range(m_of[X])]
                faces[key] = ("PQR".index(X), c, w, X, polygon_sorted(c, verts))
        for M, w in els:
            if len(w) % 2 == 0: continue
            verts = [M @ R[j] @ G for j in range(3)]
            c = norm_pt(sum(verts))
            if c[2] > lim: continue
            faces.setdefault(tuple(np.round(c, 6)), (3, c, w, "T", polygon_sorted(c, verts)))
    else:
        for M, w in els:
            if (M @ G)[2] < lim:
                for a in active: edges.setdefault(ek(M @ G, M @ R[a] @ G), (M @ G, M @ R[a] @ G))
            for X in "PQR":
                j, k = CORNER_MIRRORS[X]
                ex = face_exists(X, active, m_of)
                if not ex: continue
                c = M @ C[X]
                if c[2] > lim or tuple(np.round(c, 6)) in faces: continue
                # the orbit of G under the dihedral group at X
                orb = []
                D = R[j] @ R[k]
                for t in range(m_of[X]):
                    Dt = np.linalg.matrix_power(D, t)
                    orb += [Dt @ G, Dt @ R[j] @ G]
                uniq = {}
                for v in orb: uniq.setdefault(tuple(np.round(v, 7)), v)
                verts = [M @ v for v in uniq.values()]
                faces.setdefault(tuple(np.round(c, 6)), ("PQR".index(X), c, w, X, polygon_sorted(c, verts)))
    return list(edges.values()), list(faces.values())


def face_exists(X, active, m_of):
    j, k = CORNER_MIRRORS[X]
    n = (j in active) + (k in active)
    return n == 2 or (n == 1 and m_of[X] >= 3)


# ----------------------------------------------------------------------------- the triangle tables

def t_tables(ns, G, active):
    """Lines L_a (through G, perpendicular to each active mirror a), faces around the corners of T
    that exist, each with mask, wanted bits and, per line, its neighbour (corner, the reflection that
    carries it, local centre)."""
    p, q, r = ns_orders
    C = corners_of(ns); m_of = orders(p, q, r); R = [refl(n) for n in ns]
    lines = {a: unit(cross(G, ns[a])) for a in active}
    faces = []
    for X in "PQR":
        if not face_exists(X, active, m_of): continue
        j, k = CORNER_MIRRORS[X]
        mask = [a for a in (j, k) if a in active]
        want = {a: mink(C[X], lines[a]) > 0 for a in mask}
        nb = {}
        for a in mask:
            X2 = [c for c in MIRROR_CORNERS[a] if c != X][0]
            if face_exists(X2, active, m_of):
                nb[a] = (X2, (), C[X2])
            else:
                # X2 degenerate: L_a is the mirror b through X2 other than a; across it lies s_b X
                b = [c for c in CORNER_MIRRORS[X2] if c != a][0]
                assert abs(abs(mink(lines[a], ns[b])) - 1) < 1e-9, "L_a should be mirror b"
                nb[a] = (X, (b,), R[b] @ C[X])
        faces.append({"X": X, "mask": mask, "want": want, "nb": nb, "centre": C[X], "word": ()})
    return lines, faces


def t_eval(y, lines, faces):
    s = {a: mink(y, m) for a, m in lines.items()}
    hits = [f for f in faces if all((s[a] > 0) == f["want"][a] for a in f["mask"])]
    if not hits: return None, 0, None, None
    f = hits[0]
    de, a = min((math.asinh(abs(s[a])), a) for a in f["mask"]) if f["mask"] else (math.inf, None)
    return f, len(hits), de, a


# ----------------------------------------------------------------------------- the kite tables

def kite_corners(ns):
    C = corners_of(ns); s0 = refl(ns[0])
    return [C["P"], C["R"], C["Q"], s0 @ C["R"]]


def line_poly_dist(m, poly):
    v = [mink(x, m) for x in poly]
    if min(v) < 0 < max(v): return 0.0
    return min(math.asinh(abs(t)) for t in v)


def convex_intersect(A, B):
    """Separating axis test for two convex polygons (Klein coordinates, Euclidean); polygons that
    only touch do not meet."""
    for poly in (A, B):
        n = len(poly)
        for i in range(n):
            e = poly[(i + 1) % n] - poly[i]; ax = np.array([-e[1], e[0]])
            pa = [ax @ v for v in A]; pb = [ax @ v for v in B]
            if max(pa) <= min(pb) + 1e-12 or max(pb) <= min(pa) + 1e-12: return False
    return True


def kite_tables(ns, world_edges, world_faces, max_inside):
    """Faces meeting the kite, their masks (the edges that can be a kite point's nearest, and those
    whose line cuts the kite), the line list, and per (face, line) the face on the other side.
    (Every face of a snub is regular, so an edge is nearest exactly in the triangle it makes with the
    face's centre.)"""
    K = kite_corners(ns); Kk = [klein(v) for v in K]
    D = max_inside + 0.05
    meet = [f for f in world_faces if convex_intersect([klein(v) for v in f[4]], Kk)]
    lines, line_key = [], {}
    def edge_key(a, b):
        ka, kb = tuple(np.round(a, 6)), tuple(np.round(b, 6)); return min(ka, kb) + max(ka, kb)
    face_by_edge = {}
    for f in world_faces:
        vs = f[4]
        for i in range(len(vs)):
            a, b = vs[i], vs[(i + 1) % len(vs)]
            if len(vs) == 2 and i == 1: break
            face_by_edge.setdefault(edge_key(a, b), []).append(f)
    faces = []
    for f in meet:
        vs = f[4]; mask = []; want = {}; nb = {}
        kc = klein(f[1])
        for i in range(len(vs)):
            a, b = vs[i], vs[(i + 1) % len(vs)]
            m = unit(cross(a, b))
            # the edge's own part of a regular face (the triangle from the centre, where it is the
            # nearest edge) meets the kite, or its line cuts the kite (needed by the face test)
            if line_poly_dist(m, K) > 0 and not convex_intersect([kc, klein(a), klein(b)], Kk): continue
            k = edge_key(a, b)
            if k not in line_key: line_key[k] = len(lines); lines.append(m)
            e = line_key[k]
            mask.append(e); want[e] = mink(f[1], lines[e]) > 0
            others = [g for g in face_by_edge[k] if g is not f and tuple(np.round(g[1], 6)) != tuple(np.round(f[1], 6))]
            assert len(others) == 1, f"edge with {len(others)} other faces"
            g = others[0]
            nb[e] = (g[3], g[2], g[1])
        faces.append({"X": f[3], "mask": mask, "want": want, "nb": nb, "centre": f[1], "word": f[2]})
    return lines, faces


def kite_eval(y, lines, faces):
    s = [mink(y, m) for m in lines]
    hits = [f for f in faces if all((s[e] > 0) == f["want"][e] for e in f["mask"])]
    if not hits: return None, 0, None, None
    f = hits[0]
    de, e = min((math.asinh(abs(s[e])), e) for e in f["mask"])
    return f, len(hits), de, e


# ----------------------------------------------------------------------------- brute force

def fold_word(x, ns):
    word = []
    for _ in range(300):
        moved = False
        for j, n in enumerate(ns):
            d = mink(x, n)
            if d > 0: x = x - 2 * d * n; word.append(j); moved = True
        if not moved: break
    return x, word


def seg_cross(a, b, c, d):
    """Proper intersection of segments ab and cd (Klein coordinates)."""
    def o(p1, p2, p3): return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0])
    return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0


def true_face(x, world_faces, EK, centres):
    """The face whose centre the segment from x reaches without crossing an edge."""
    kx = klein(x)
    best = None
    near = np.argsort([dist(x, c) for c in centres])[:12]
    for i in near:
        kc = klein(centres[i])
        if not any(seg_cross(kx, kc, a, b) for a, b in EK): return world_faces[i]
    return best


def same(a, b, tol=1e-6): return np.max(np.abs(a - b)) < tol


ns_orders = None


def run(g, kind, w=None, npts=1500, seed=1):
    """kind: an active set (tuple), 'snub' or 'free' with weights w."""
    global ns_orders
    p, q, r = g; ns_orders = g
    ns = normals(p, q, r); R = [refl(n) for n in ns]
    snub = kind == "snub"
    if snub: G = snub_generator(ns); active = (0, 1, 2)
    else:
        wt = w if kind == "free" else [1.0 if j in kind else 0.0 for j in range(3)]
        active = tuple(j for j in range(3) if wt[j] > 0)
        G = generator(ns, wt)
    edges, wfaces = build_world(ns, G, active, snub)
    EA = np.array([e[0] for e in edges]); EB = np.array([e[1] for e in edges])
    centres = [f[1] for f in wfaces]
    rnd = random.Random(seed)
    # the largest distance to an edge (domain samples, brute force)
    K = kite_corners(ns)
    def kite_points(n):
        out = []
        Kk = [klein(v) for v in K]
        while len(out) < n:
            a, b = rnd.uniform(-1, 1), rnd.uniform(-1, 1)
            if a * a + b * b >= 0.98: continue
            kp = np.array([a, b])
            # inside the convex kite (counterclockwise or clockwise, same side of every edge)
            sg = [cross2(Kk[(i + 1) % 4] - Kk[i], kp - Kk[i]) for i in range(4)]
            if all(s >= 0 for s in sg) or all(s <= 0 for s in sg):
                t = 1 / math.sqrt(1 - a * a - b * b); out.append(np.array([a * t, b * t, t]))
        return out
    kp = kite_points(1500)
    max_inside = max(seg_dist_each(x, EA, EB).min() for x in kp)
    if snub: lines, faces = kite_tables(ns, edges, wfaces, max_inside)
    else: lines, faces = t_tables(ns, G, active)
    if not snub: klines, kfaces = kite_tables(ns, edges, wfaces, max_inside)
    # W1, W2, W3 (own face), W6 on random world points
    bad1 = bad2 = bad6 = multi = 0; worst2 = 0.0; n = 0
    for _ in range(npts):
        d0, a0 = 2.2 * math.sqrt(rnd.random()), rnd.uniform(0, 2 * math.pi)
        x = np.array([math.sinh(d0) * math.cos(a0), math.sinh(d0) * math.sin(a0), math.cosh(d0)])
        true_d = seg_dist_each(x, EA, EB).min()
        if true_d < 1e-7: continue
        y, word = fold_word(x, ns)
        M = np.eye(3)
        for j in word: M = M @ R[j]
        if True:
            yk, Mk = (R[0] @ y, M @ R[0]) if len(word) % 2 else (y, M)
        if snub: f, nh, de, e = kite_eval(yk, lines, faces); Mf = Mk
        else: f, nh, de, e = t_eval(y, lines, faces); Mf = M
        n += 1
        multi += nh != 1
        tf = true_face(x, wfaces, [(klein(a), klein(b)) for a, b in edges if min(dist(x, a), dist(x, b)) < 3], centres)
        if f is None or tf is None or not same(Mf @ f["centre"], tf[1]): bad1 += 1
        err = abs(min(de, 1e9) - true_d); worst2 = max(worst2, err); bad2 += err > 1e-9
        if not snub:
            fk, nk, dk, ek = kite_eval(yk, klines, kfaces)
            if fk is None or not same(Mk @ fk["centre"], Mf @ f["centre"]) or abs(dk - de) > 1e-9: bad6 += 1
    # W3: just either side of random edges, away from their ends
    bad3 = n3 = 0
    near = [e for e in edges if min(e[0][2], e[1][2]) < math.cosh(1.8)]
    for _ in range(300):
        a, b = near[rnd.randrange(len(near))]
        t = rnd.uniform(0.15, 0.85)
        d = dist(a, b)
        mpt = (math.sinh((1 - t) * d) * a + math.sinh(t * d) * b) / math.sinh(d)
        m = unit(cross(a, b))
        eps = 1e-4 * rnd.uniform(0.5, 1)
        for sgn in (1, -1):
            x = mpt * math.cosh(eps) + sgn * math.sinh(eps) * m
            xo = mpt * math.cosh(eps) - sgn * math.sinh(eps) * m
            y, word = fold_word(x, ns)
            M = np.eye(3)
            for j in word: M = M @ R[j]
            yk, Mk = (R[0] @ y, M @ R[0]) if len(word) % 2 else (y, M)
            if snub: f, nh, de, e = kite_eval(yk, lines, faces); Mf = Mk
            else: f, nh, de, e = t_eval(y, lines, faces); Mf = M
            if f is None: bad3 += 1; continue
            X2, wd, c2 = f["nb"][e]
            other = true_face(xo, wfaces, [(klein(u), klein(v)) for u, v in edges if min(dist(xo, u), dist(xo, v)) < 3], centres)
            n3 += 1
            bad3 += other is None or not same(Mf @ c2, other[1])
    # W4: identities mod l
    l = choose_prime(p, q, r)
    S, twoB = rep(p, q, r, l)
    def wvec(X):
        j, k = CORNER_MIRRORS[X]; v = np.cross(twoB[j], twoB[k]) % l; return v
    # a snub triangle stands for an odd image of G: the vector v with 2B v = (1, 1, 1), which no
    # reflection fixes (the analogue of a point inside T)
    vG = solve_mod(twoB, [1, 1, 1], l)
    def word_mat(word):
        A = np.eye(3, dtype=np.int64)
        for j in word: A = (A @ S[j]) % l
        return A
    def ident(word, X):
        v = vG if X == "T" else wvec(X)
        return tuple((word_mat(word) @ v) % l) + (TYPES[X],)
    ids = {}
    bad4 = 0
    for f in wfaces:
        if f[1][2] > math.cosh(3.0): continue
        ids.setdefault(ident(f[2], f[3]), []).append(f[1])
    coll = sum(len(v) > 1 for v in ids.values())
    coll_types = sorted({k[3] for k, v in ids.items() if len(v) > 1})
    # the per-pixel route: fold word (+ s1 when odd for the kite) then the face's local word
    for _ in range(300):
        d0, a0 = 2.0 * math.sqrt(rnd.random()), rnd.uniform(0, 2 * math.pi)
        x = np.array([math.sinh(d0) * math.cos(a0), math.sinh(d0) * math.sin(a0), math.cosh(d0)])
        y, word = fold_word(x, ns)
        word = list(word)
        if snub:
            if len(word) % 2: word.append(0); y = R[0] @ y
            f, *_ = kite_eval(y, lines, faces)
        else: f, *_ = t_eval(y, lines, faces)
        if f is None: bad4 += 1; continue
        mine = ident(tuple(word) + tuple(f["word"]), f["X"])
        M = np.eye(3)
        for j in word: M = M @ R[j]
        match = [h for h in wfaces if same(h[1], M @ f["centre"])]
        if not match or ident(match[0][2], match[0][3]) != mine: bad4 += 1
    # W5: edge length per area of the domain (an edge on the domain's boundary counted half): the
    # formula (half-edges from G in T; for the snub, deg / 2 edges of length L per kite) against the
    # tiling's own edges clipped to the domain
    T_area = math.pi * (1 - 1 / p - 1 / q - 1 / r)
    C = corners_of(ns)
    if snub:
        dom = [klein(v) for v in K]
        m_of = orders(p, q, r)
        deg = sum(1 if m_of[X] == 2 else 2 for X in "PQR")
        formula = deg * dist(G, R[0] @ R[1] @ G) / 2
    else:
        dom = [klein(C[X]) for X in "PQR"]
        formula = 0.0
        for a in active:
            mid = norm_pt(G + R[a] @ G); h = dist(G, mid)
            on_side = any(abs(mink(G, ns[b])) < 1e-12 and abs(mink(mid, ns[b])) < 1e-12 for b in range(3) if b != a)
            formula += h / 2 if on_side else h
    w5 = formula / sum(clipped_length(a, b, dom, ns) for a, b in edges)
    out = dict(E=len(lines), F=len(faces), n=n, bad1=bad1, multi=multi, bad2=bad2, worst2=worst2, bad3=bad3, n3=n3, bad4=bad4, coll=coll, coll_types=coll_types, nid=len(ids),
               w5=w5, bad6=bad6, max_inside=max_inside)
    if snub:
        rot = [R[0] @ R[1], R[0] @ R[2], R[1] @ R[2]]
        L3 = [dist(G, M @ G) for M in rot]
        out["edge_spread"] = max(L3) - min(L3)
    return out


def clipped_length(a, b, Kk, ns):
    """Length of the geodesic segment ab inside the kite (Klein: straight), edges on the boundary half."""
    ka, kb = klein(a), klein(b)
    t0, t1 = 0.0, 1.0
    n = len(Kk)
    # orientation of the kite
    area = sum(cross2(Kk[i], Kk[(i + 1) % n]) for i in range(n))
    sgn = 1 if area > 0 else -1
    on_boundary = False
    for i in range(n):
        e = Kk[(i + 1) % n] - Kk[i]
        fa = sgn * cross2(e, ka - Kk[i]); fb = sgn * cross2(e, kb - Kk[i])
        if abs(fa) < 1e-10 and abs(fb) < 1e-10: on_boundary = True; continue
        if fa < 0 and fb < 0: return 0.0
        if fa < 0: t0 = max(t0, fa / (fa - fb))
        elif fb < 0: t1 = min(t1, fa / (fa - fb))
    if t1 <= t0: return 0.0
    def pt(t):
        k = ka + t * (kb - ka); s = 1 / math.sqrt(1 - k @ k); return np.array([k[0] * s, k[1] * s, s])
    L = dist(pt(t0), pt(t1))
    return L / 2 if on_boundary else L


if __name__ == "__main__":
    KINDS = [(1,), (2,), (0,), (0, 1), (0, 2), (1, 2), (0, 1, 2), "snub"]
    NAMES = {(1,): "G at Q", (2,): "G at P", (0,): "G at R", (0, 1): "on side 3", (0, 2): "on side 2", (1, 2): "on side 1", (0, 1, 2): "omnitrunc", "snub": "snub"}
    groups = [(7, 3, 2), (5, 4, 2), (4, 5, 2), (8, 3, 2), (3, 3, 4), (2, 3, 7), (6, 4, 2), (4, 4, 3)]
    if len(sys.argv) > 1: groups = [tuple(map(int, a.split(","))) for a in sys.argv[1:]]
    for g in groups:
        for kind in KINDS + ["free"]:
            t0 = time.time()
            w = None
            if kind == "free": w = [0.3, 1.7, 0.6]
            o = run(g, kind, w, npts=800)
            name = NAMES.get(kind, "free 0.3 1.7 0.6")
            extra = f" edges equal to {o['edge_spread']:.0e}" if "edge_spread" in o else ""
            print(f"W {g} {name:10s}: lines {o['E']:2d} faces {o['F']:2d}; points {o['n']}: wrong face {o['bad1']}, "
                  f"not one face {o['multi']}, de off {o['bad2']} (worst {o['worst2']:.0e}); neighbours wrong {o['bad3']}/{o['n3']}; "
                  f"identity {o['bad4']} wrong, {o['coll']} shared {o['coll_types']} of {o['nid']}; edge length per area against clipping {o['w5']:.9f}; "
                  f"kite vs triangle {o['bad6']}; max inside {o['max_inside']:.3f}{extra} [{time.time() - t0:.0f}s]", flush=True)
