"""M: motifs for step 16: a kite whose edges are bent into curves, paired by the rotations about P
and Q, drawn per pixel from two polylines.

The kite K = T u s1 T has corners P, R, Q, R' (R' = s1 R). rho_P = s2 s1 turns about P and carries
PR' onto PR; rho_Q = s3 s1 turns about Q and carries QR' onto QR. A motif gives c1 from P to R (a
polyline in the P frame, the world's Poincare coordinates) and c2 from R to Q (a polyline in the Q
frame: the world moved along x so Q is at 0). Their copies c1' = rho_P^-1 c1 and c2' = rho_Q^-1 c2 are
the same polylines turned about the frame's centre, exactly.

Per pixel: fold into T; an odd word goes once more across side 1 (y in K). In T, y is in the bulge of
PR when a ray from y away from PR (into T) crosses c1 an odd number of times: then letters 1, 0
(y -> rho_P^-1 y). Else the same for QR with c2 in the Q frame: letters 2, 0. In s1 T, m = rho_P y is
tested against c1 with the ray away from PR the other way: letters 0, 1; else rho_Q y against c2:
letters 0, 2. de: Euclidean distance to the polylines in their frames times 2 / (1 - |w|^2), from y
and from its turned copies (the distances to c1' and c2').

Checked:
  M1 rho_P is the turn by 2 pi / p in the P frame, rho_Q by -2 pi / q in the Q frame, and they carry
     PR' onto PR, QR' onto QR;
  M2 random motifs in 7 groups pass or fail the validity test (c1 inside T u s2 T, c2 inside
     T u s3 T, the four curves meet only at P, R, Q, R'); every valid one:
  M3 the rule's tile is the one tile (of all kites near the point) whose boundary winds around it;
  M4 seams: points 1e-7 either side of each curve get the two tiles that share it, and the letters of
     the nearest curve name the tile on the other side;
  M5 de against the hyperbolic distance to the curves (brute force over dense points on them);
  M6 points within rounding of the straight edges PR and QR are never sent to a neighbour by mistake.
"""
import math, random, sys, os, time, cmath
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_wythoff import normals, refl, mink, norm_pt, dist, cross


def to_disk(x):
    return complex(x[0], x[1]) / (1 + x[2])


def from_disk(w):
    r2 = abs(w) ** 2
    return np.array([2 * w.real, 2 * w.imag, 1 + r2]) / (1 - r2)


def boost(d):
    """moves along x by -d: the point at distance d on +x goes to the origin."""
    c, s = math.cosh(d), math.sinh(d)
    return np.array([[c, 0, -s], [0, 1, 0], [-s, 0, c]])


class Kite:
    def __init__(self, p, q, r):
        self.p, self.q, self.r = p, q, r
        self.ns = normals(p, q, r)
        self.S = [refl(n) for n in self.ns]
        n = self.ns
        self.P = norm_pt(cross(n[0], n[1]))
        self.Q = norm_pt(cross(n[0], n[2]))
        self.R = norm_pt(cross(n[1], n[2]))
        self.Rp = self.S[0] @ self.R
        self.dPQ = dist(self.P, self.Q)
        self.B = boost(self.dPQ)
        self.Binv = boost(-self.dPQ)
        self.rhoP = self.S[1] @ self.S[0]
        self.rhoQ = self.S[2] @ self.S[0]
        self.turnP = cmath.exp(2j * math.pi / p)
        self.turnQ = cmath.exp(-2j * math.pi / q)
        # unit directions away from PR (P frame) and QR (Q frame), into T
        a = math.pi / p
        self.awayPR = complex(math.sin(a), -math.cos(a))
        phi = math.pi - math.pi / q
        self.awayQR = complex(-math.sin(phi), math.cos(phi))

    def inT(self, x, tol=0.0):
        return all(mink(x, n) <= tol for n in self.ns)

    def fold(self, x):
        word = []
        for _ in range(200):
            moved = False
            for j in range(3):
                d = mink(x, self.ns[j])
                if d > 0:
                    x = x - 2 * d * self.ns[j]
                    word.append(j)
                    moved = True
            if not moved:
                return x, word
        raise RuntimeError("fold did not settle")

    def qframe(self, x):
        return to_disk(self.B @ x)


# ---------------------------------------------------------------------------- M1

def check_turns(K):
    def turn(theta):
        c, s = math.cos(theta), math.sin(theta)
        return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    e1 = np.max(np.abs(K.rhoP - turn(2 * math.pi / K.p)))
    e2 = np.max(np.abs(K.B @ K.rhoQ @ K.Binv - turn(-2 * math.pi / K.q)))
    # PR' onto PR and QR' onto QR (endpoints)
    e3 = max(np.max(np.abs(K.rhoP @ K.Rp - K.R)), np.max(np.abs(K.rhoQ @ K.Rp - K.R)), np.max(np.abs(K.rhoQ @ K.Q - K.Q)))
    # the ray directions point into T: a point a little along them from the edge's middle is in T
    mPR = to_disk(K.R) / 2
    mQR = K.qframe(K.R) / 2
    ok = K.inT(from_disk(mPR + 1e-3 * K.awayPR)) and K.inT(K.Binv @ from_disk(mQR + 1e-3 * K.awayQR))
    return max(e1, e2, e3), ok


# ---------------------------------------------------------------------------- motifs

def bezier(p0, p1, p2, p3, n):
    t = np.linspace(0, 1, n)
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def chain(a, b, ctrl, per):
    """a cubic Bezier chain from a to b through 3n - 1 control points, `per` samples per segment."""
    pts = [a] + list(ctrl) + [b]
    out = []
    for i in range(0, len(pts) - 1, 3):
        seg = bezier(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], per + 1)
        out.extend(seg[:-1] if i + 3 < len(pts) - 1 else seg)
    return np.array(out)


def random_motif(K, rng, amp):
    """c1 (P frame) and c2 (Q frame) as polylines of 47 points: two Bezier segments each, the
    controls offset across the chord by up to amp times its length."""
    P0, R0, Q0 = 0j, to_disk(K.R), to_disk(K.Q)

    def ctrl(a, b):
        d = b - a
        nrm = d * 1j / abs(d)
        cs = []
        for t in (1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6):
            cs.append(a + t * d + nrm * abs(d) * amp * (2 * rng.random() - 1))
        return cs

    c1 = chain(P0, R0, ctrl(P0, R0), 23)
    c2w = chain(R0, Q0, ctrl(R0, Q0), 23)
    c2 = np.array([K.qframe(from_disk(w)) for w in c2w])
    c2[0] = K.qframe(K.R)
    c2[-1] = 0j
    return c1, c2


def dense(poly, k):
    """each segment cut into k: points along the straight segments of the frame."""
    out = []
    for i in range(len(poly) - 1):
        for s in range(k):
            out.append(poly[i] + (poly[i + 1] - poly[i]) * s / k)
    out.append(poly[-1])
    return np.array(out)


def world_curves(K, c1, c2, k=8):
    """the four curves of the identity tile as dense world points, in boundary order P R Q R' P."""
    d1 = dense(c1, k)
    d2 = dense(c2, k)
    A = [from_disk(w) for w in d1]                                     # P -> R
    Bq = [K.Binv @ from_disk(w) for w in d2]                           # R -> Q
    Cq = [K.Binv @ from_disk(w / K.turnQ) for w in d2[::-1]]           # Q -> R' (c2' = rho_Q^-1 c2)
    D = [from_disk(w / K.turnP) for w in d1[::-1]]                     # R' -> P (c1' = rho_P^-1 c1)
    return [np.array(A), np.array(Bq), np.array(Cq), np.array(D)]


def seg_intersect(a, b, c, d):
    def orient(p, q, r):
        return (q - p).real * (r - p).imag - (q - p).imag * (r - p).real
    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def valid(K, c1, c2):
    # containment: every dense point but the ends strictly inside its double triangle
    for w in dense(c1, 8)[1:-1]:
        x = from_disk(w)
        if not (K.inT(x, -1e-12) or K.inT(K.S[1] @ x, -1e-12)):
            return "c1 leaves T u s2 T"
    for w in dense(c2, 8)[1:-1]:
        x = K.Binv @ from_disk(w)
        if not (K.inT(x, -1e-12) or K.inT(K.S[2] @ x, -1e-12)):
            return "c2 leaves T u s3 T"
    # simplicity: the four curves (world disk, dense) cross nowhere but at their shared ends
    curves = [np.array([to_disk(x) for x in c]) for c in world_curves(K, c1, c2, 4)]
    loop = np.concatenate([curves[0], curves[1][1:], curves[2][1:], curves[3][1:]])
    n = len(loop) - 1
    segs = [(loop[i], loop[i + 1]) for i in range(n)]
    lo = np.array([[min(a.real, b.real), min(a.imag, b.imag)] for a, b in segs])
    hi = np.array([[max(a.real, b.real), max(a.imag, b.imag)] for a, b in segs])
    for i in range(n):
        cand = np.nonzero((lo[:, 0] <= hi[i, 0]) & (hi[:, 0] >= lo[i, 0]) & (lo[:, 1] <= hi[i, 1]) & (hi[:, 1] >= lo[i, 1]))[0]
        for j in cand:
            if j <= i + 1 or (i == 0 and j == n - 1):
                continue
            if seg_intersect(*segs[i], *segs[j]):
                return "the curves cross"
    return None


# ---------------------------------------------------------------------------- the rule

def odd_crossings(y, d, poly):
    """crossings of the ray y + t d (t > 0) with the polyline, odd?"""
    count = 0
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        e = b - a
        den = d.real * (-e.imag) - d.imag * (-e.real)
        if den == 0:
            continue
        r = a - y
        t = (r.real * (-e.imag) - r.imag * (-e.real)) / den
        s = (d.real * r.imag - d.imag * r.real) / den
        if t > 0 and 0 <= s < 1:
            count += 1
    return count % 2 == 1


def seg_dist(w, poly):
    best = math.inf
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        e = b - a
        t = max(0.0, min(1.0, ((w - a) * e.conjugate()).real / abs(e) ** 2))
        best = min(best, abs(w - (a + t * e)))
    return best


def poincare_dist(a, b):
    return 2 * math.atanh(min(1 - 1e-16, abs(a - b) / abs(1 - b.conjugate() * a)))


def nearest(w, poly):
    """the Euclidean nearest point of the polyline."""
    best, at = math.inf, poly[0]
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        e = b - a
        t = max(0.0, min(1.0, ((w - a) * e.conjugate()).real / abs(e) ** 2))
        z = a + t * e
        if abs(w - z) < best:
            best, at = abs(w - z), z
    return at


def true_dist(w, poly):
    """the hyperbolic distance to the polyline (straight in this frame), by golden-section search on
    every segment that comes within three times the Euclidean distance."""
    e0 = seg_dist(w, poly)
    best = math.inf
    g = (math.sqrt(5) - 1) / 2
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        if seg_dist(w, [a, b]) > 3 * e0 + 1e-12:
            continue
        f = lambda t: poincare_dist(w, a + t * (b - a))
        lo, hi = 0.0, 1.0
        for _ in range(80):
            m1, m2 = hi - g * (hi - lo), lo + g * (hi - lo)
            if f(m1) < f(m2):
                hi = m2
            else:
                lo = m1
        best = min(best, f(lo), f(0.0), f(1.0))
    return best


def rule(K, c1, c2, x, exact=False):
    y, word = K.fold(x)
    if len(word) % 2:
        y = K.S[0] @ y
        word.append(0)
    wP = to_disk(y)
    extra = []
    if wP.imag >= 0:
        if odd_crossings(wP, K.awayPR, c1):
            extra = [1, 0]
        elif odd_crossings(K.qframe(y), K.awayQR, c2):
            extra = [2, 0]
    else:
        if odd_crossings(wP * K.turnP, -K.awayPR, c1):
            extra = [0, 1]
        elif odd_crossings(K.qframe(y) * K.turnQ, -K.awayQR, c2):
            extra = [0, 2]
    for j in extra:
        y = K.S[j] @ y
    word += extra
    h = np.eye(3)
    for j in word:
        h = h @ K.S[j]
    # de and the letters across the nearest curve
    wP = to_disk(y)
    wQ = K.qframe(y)
    lamP = 2 / (1 - abs(wP) ** 2)
    lamQ = 2 / (1 - abs(wQ) ** 2)
    if exact:
        # the hyperbolic distance to the Euclidean nearest point of each polyline
        cands = [(poincare_dist(v, nearest(v, c)), lt) for v, c, lt in ((wP, c1, [1, 0]), (wP * K.turnP, c1, [0, 1]), (wQ, c2, [2, 0]), (wQ * K.turnQ, c2, [0, 2]))]
    else:
        cands = [(seg_dist(wP, c1) * lamP, [1, 0]), (seg_dist(wP * K.turnP, c1) * lamP, [0, 1]),
                 (seg_dist(wQ, c2) * lamQ, [2, 0]), (seg_dist(wQ * K.turnQ, c2) * lamQ, [0, 2])]
    de, across = min(cands, key=lambda c: c[0])
    return h, y, de, across


def rotations_ball(K, center, radius):
    """elements g of the rotation group whose kite (its point at T's incentre-ish) lies within radius."""
    c0 = norm_pt(K.P + K.Q + K.R + K.Rp)
    gens = [K.rhoP, np.linalg.inv(K.rhoP), K.rhoQ, np.linalg.inv(K.rhoQ)]
    out = [np.eye(3)]
    seen = {tuple(np.round(c0, 9))}
    frontier = [np.eye(3)]
    while frontier:
        nxt = []
        for g in frontier:
            for s in gens:
                h = g @ s
                c = h @ c0
                key = tuple(np.round(c, 9))
                if key in seen or dist(c, center) > radius:
                    continue
                seen.add(key)
                out.append(h)
                nxt.append(h)
        frontier = nxt
    return out


def winding(pts, w):
    z = pts - w
    ang = np.angle(z[1:] / z[:-1])
    return round(np.sum(ang) / (2 * math.pi))


def run(groups, per_group=40, points=400, seed=7):
    rng = random.Random(seed)
    tot = {"motifs": 0, "refused": 0, "points": 0, "seams": 0}
    worst_turn = 0
    worst_de = [0, 0, 0, 0]
    worst_ex = [0, 0, 0, 0]
    for (p, q, r) in groups:
        K = Kite(p, q, r)
        e, ok = check_turns(K)
        worst_turn = max(worst_turn, e)
        assert ok, (p, q, r, "ray directions")
        c0 = norm_pt(K.P + K.Q + K.R + K.Rp)
        reach = max(dist(c0, v) for v in (K.P, K.Q, K.R, K.Rp)) * 2.2
        # every kite within reach of a sample point (points lie within 1.8 of the origin)
        world = rotations_ball(K, np.array([0.0, 0.0, 1.0]), 1.8 + reach)
        centres = [g @ c0 for g in world]
        made = 0
        tries = 0
        while made < per_group and tries < per_group * 6:
            tries += 1
            amp = rng.choice([0.08, 0.15, 0.3, 0.5])
            c1, c2 = random_motif(K, rng, amp)
            why = valid(K, c1, c2)
            if why:
                tot["refused"] += 1
                continue
            made += 1
            tot["motifs"] += 1
            boundary = world_curves(K, c1, c2, 12)
            loop = np.concatenate([boundary[0], boundary[1][1:], boundary[2][1:], boundary[3][1:]])
            # M3: random points against the winding number of every nearby kite's boundary
            for _ in range(points // per_group * 4):
                w = cmath.rect(math.tanh(rng.random() * 0.9), 2 * math.pi * rng.random())
                x = from_disk(w)
                h, y, de, _ = rule(K, c1, c2, x)
                if de < 1e-6:
                    continue
                ball = [g for g, c in zip(world, centres) if dist(c, x) < reach]
                inside = []
                for g in ball:
                    X = g @ loop.T
                    pts = (X[0] + 1j * X[1]) / (1 + X[2])
                    if winding(pts, w) != 0:
                        inside.append(g)
                assert len(inside) == 1, (p, q, r, len(inside))
                assert np.max(np.abs(inside[0] - h)) < 1e-8 * max(1, np.max(np.abs(h))), (p, q, r)
                tot["points"] += 1
            # M4: seams across both curves, inside random kites
            ball = [g for g, c in zip(world, centres) if dist(c, c0) < 1.5]
            for curve, frame in ((c1, "P"), (c2, "Q")):
                for _ in range(6):
                    i = rng.randrange(len(curve) - 1)
                    t = 0.1 + 0.8 * rng.random()
                    a, b = curve[i], curve[i + 1]
                    z = a + t * (b - a)
                    nrm = (b - a) * 1j / abs(b - a)
                    g = rng.choice(ball)
                    sides = []
                    for sgn in (1, -1):
                        wz = z + sgn * 1e-7 * nrm
                        X = from_disk(wz) if frame == "P" else K.Binv @ from_disk(wz)
                        hh, yy, de, across = rule(K, c1, c2, g @ X)
                        sides.append((hh, across))
                    (h1, a1), (h2, a2) = sides
                    assert np.max(np.abs(h1 - h2)) > 1e-6, "both sides in one tile"
                    pair = K.rhoP if frame == "P" else K.rhoQ
                    ok1 = np.max(np.abs(h2 - h1 @ pair)) < 1e-7 * np.max(np.abs(h1)) or np.max(np.abs(h1 - h2 @ pair)) < 1e-7 * np.max(np.abs(h1))
                    assert ok1, "the two tiles are not paired by the curve's turn"
                    # the letters across the nearest curve reach the other side's tile
                    for hh, across, other in ((h1, a1, h2), (h2, a2, h1)):
                        m = hh.copy()
                        for j in across:
                            m = m @ K.S[j]
                        assert np.max(np.abs(m - other)) < 1e-7 * np.max(np.abs(hh)), "across names the wrong tile"
                    tot["seams"] += 1
            # M5: de against brute force (the hyperbolic distance to the four curves), near the curves
            for _ in range(12):
                i = rng.randrange(len(c1) - 1)
                z = c1[i] + rng.random() * (c1[i + 1] - c1[i])
                nrm = (c1[i + 1] - c1[i]) * 1j / abs(c1[i + 1] - c1[i])
                wz = z + rng.choice([1, -1]) * 10 ** rng.uniform(-7, -1) * nrm
                h, y, de, _ = rule(K, c1, c2, from_disk(wz))
                _, _, dx, _ = rule(K, c1, c2, from_disk(wz), exact=True)
                wP, wQ = to_disk(y), K.qframe(y)
                truth = min(true_dist(wP, c1), true_dist(wP * K.turnP, c1), true_dist(wQ, c2), true_dist(wQ * K.turnQ, c2))
                band = 0 if truth < 1e-3 else 1 if truth < 1e-2 else 2 if truth < 0.1 else 3
                worst_de[band] = max(worst_de[band], abs(de - truth) / truth)
                worst_ex[band] = max(worst_ex[band], abs(dx - truth) / truth)
        # M6: points within rounding of the straight edges PR and QR, far from the curves' crossings
        c1, c2 = random_motif(K, rng, 0.3)
        while valid(K, c1, c2):
            c1, c2 = random_motif(K, rng, 0.3)
        for _ in range(200):
            edge = rng.choice(["PR", "QR"])
            t = 0.05 + 0.9 * rng.random()
            if edge == "PR":
                w = to_disk(K.R) * t
                n = K.awayPR
                X = lambda v: from_disk(v)
            else:
                w = K.qframe(K.R) * t
                n = K.awayQR
                X = lambda v: K.Binv @ from_disk(v)
            for eps in (1e-15, -1e-15, 1e-13, -1e-13):
                h, y, de, _ = rule(K, c1, c2, X(w + eps * n))
                h0, y0, de0, _ = rule(K, c1, c2, X(w + 1e-9 * n))
                assert np.max(np.abs(h - h0)) < 1e-9 or de < 1e-9, ("M6", edge)
    return tot, worst_turn, worst_de, worst_ex


if __name__ == "__main__":
    t0 = time.time()
    groups = [(3, 3, 4), (6, 4, 2), (8, 3, 2), (4, 4, 3), (7, 3, 2), (5, 2, 4), (2, 3, 7)]
    tot, worst_turn, worst_de, worst_ex = run(groups, per_group=int(sys.argv[1]) if len(sys.argv) > 1 else 6)
    print(f"M1 turns and edge pairing: worst {worst_turn:.1e}")
    print(f"M2 motifs: {tot['motifs']} valid, {tot['refused']} refused")
    print(f"M3 rule = the tile whose boundary winds around the point: {tot['points']} points")
    print(f"M4 seams: {tot['seams']} points either side, tiles paired by the curve's turn, across correct")
    bands = ["d < 1e-3", "1e-3 to 1e-2", "1e-2 to 0.1", "above 0.1"]
    print("M5 de against the hyperbolic distance to the curves, worst relative error by distance:")
    print("   conformal factor x Euclidean: " + ", ".join(f"{b} {e:.1e}" for b, e in zip(bands, worst_de)))
    print("   exact distance to the Euclidean nearest point: " + ", ".join(f"{b} {e:.1e}" for b, e in zip(bands, worst_ex)))
    print(f"M6 within rounding of PR and QR: no point sent across by mistake")
    print(f"{time.time() - t0:.1f} s")
