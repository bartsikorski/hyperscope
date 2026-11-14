"""High-precision reference values for the Klein, half-plane and local views (120 digits, mpmath).
Writes tests/unit/data/views.json. Run: python tools/hp/views_vectors.py

As in zoomstep_vectors.py the inputs are float64 states as the app holds them, and the reference is
the exact value of the closed forms at those numbers (design-checks/check_views.py shows at 300 digits
that the closed forms equal the definitions on consistent states). Each zoom vector records sigma'
(or mu'), and where N sends the frame origin and the frame point 0.5 (Poincare coordinates)."""
import json
import mpmath as mp

mp.mp.dps = 120
STEP = 0.9  # MAX_ZOOM_STEP_W
KLEIN_STEP = mp.tanh(2 * mp.atanh(mp.mpf(STEP)))

def n20(x): return mp.nstr(x, 20)
def cpx(z): return [n20(z.real), n20(z.imag)]

def mobius(alpha, beta, w): return (alpha * w + beta) / (mp.conj(beta) * w + mp.conj(alpha))

def klein_h(c, lam, r, u):
    cu = c.real * u.real + c.imag * u.imag
    f = cu / (1 + r)
    return (r * u.real + c.real * f, r * u.imag + c.imag * f, lam - cu)

def klein_frame(c, sigma, s, u):
    lam = sigma / s
    h = klein_h(c, lam, mp.sqrt(sigma), u)
    n2 = h[2] ** 2 - h[0] ** 2 - h[1] ** 2
    if n2 <= 0 or h[2] <= 0: return None
    n = mp.sqrt(n2)
    g = (sigma * u.real + lam * c.real, sigma * u.imag + lam * c.imag)
    return [hi / n for hi in h], mp.sqrt(sigma + (g[0] ** 2 + g[1] ** 2) / n2) / n

def klein_zoom(c, sigma, s, u0, k):
    lam = sigma / s
    r = mp.sqrt(sigma)
    v = (1 - 1 / k) * u0
    h = klein_h(c, lam, r, v)
    if not (h[2] > 0 and mp.sqrt(h[0] ** 2 + h[1] ** 2) / h[2] <= KLEIN_STEP): return None
    sigma1 = sigma * (h[2] ** 2 - h[0] ** 2 - h[1] ** 2) / lam ** 2
    D = s * v
    r1 = mp.sqrt(sigma1)
    cv = c.real * v.real + c.imag * v.imag
    dr = sigma * (cv * (2 * lam - cv) + h[0] ** 2 + h[1] ** 2) / lam ** 2 / (r + r1)
    zeta = c / (1 + r)
    beta = D / (1 + r1) + c * dr / ((1 + r) * (1 + r1))
    alpha = 2 * r / (1 + r) - zeta * mp.conj(beta)
    return sigma1, mobius(alpha, beta, 0), mobius(alpha, beta, mp.mpf("0.5"))

def half_frame(mu, u):
    m = mu + 2 * u.imag
    if m <= 0: return None
    w = 1j * u / (u + 1j * mu)
    return w, 2 / m

def half_zoom(mu, u0, k):
    v = (1 - 1 / k) * u0
    f = half_frame(mu, v)
    if f is None or abs(f[0]) > STEP: return None
    alpha = (mu + v.imag) + 1j * v.real
    return k * (mu + 2 * v.imag), mobius(alpha, v, 0), mobius(alpha, v, mp.mpf("0.5"))

def local_frame(ell, u):
    r = abs(u)
    d = ell * r
    x = [u.real * mp.sinh(d) / r, u.imag * mp.sinh(d) / r, mp.cosh(d)] if r > 0 else [0, 0, 1]
    return x, (ell * mp.sinh(d) / d if d > 0 else ell)

def local_zoom(ell, u0, k):
    # N slides by ell (1 - 1/k) |u0| along the ray through u0: in Poincare coordinates a translation
    # by tanh(t / 2) in that direction
    t = ell * (1 - 1 / k) * abs(u0)
    e = u0 / abs(u0)
    a = mp.tanh(t / 2) * e
    return ell / k, a, (mp.mpf("0.5") + a) / (1 + mp.conj(a) * mp.mpf("0.5"))

out = {"klein": [], "kleinZoom": [], "half": [], "halfZoom": [], "local": [], "localZoom": []}
US = [(0.3, 0.2), (-0.9, 0.5), (0.0, 0.01), (1.2, -0.4)]
KS = [2.0, 0.5, 1.1]
for depth in ["0.6", "1e-3", "1e-8", "1e-15", "1e-40", "1e-120", "1e-270"]:
    for theta in ["0.7", "2.9"]:
        for lamd in ["1.7", "0.4", "40"]:
            sigma = float(mp.mpf(depth))
            c = mp.sqrt(1 - mp.mpf(sigma)) * mp.expj(mp.mpf(theta))
            cf = [float(c.real), float(c.imag)]
            s = float(mp.mpf(sigma) / mp.mpf(lamd))
            C, S, Sg = mp.mpc(*cf), mp.mpf(s), mp.mpf(sigma)
            for u in US:
                f = klein_frame(C, Sg, S, mp.mpc(*u))
                if f: out["klein"].append({"c": cf, "sigma": sigma, "s": s, "u": list(u), "x": [n20(t) for t in f[0]], "scale": n20(f[1])})
                for k in KS:
                    z = klein_zoom(C, Sg, S, mp.mpc(*u), mp.mpf(k))
                    if z: out["kleinZoom"].append({"c": cf, "sigma": sigma, "s": s, "u0": list(u), "k": k,
                                                   "sigma1": n20(z[0]), "a": cpx(z[1]), "b": cpx(z[2])})
for mu in [2.0, 0.3, 17.0, 1e3, 1e12, 1e25]:
    for u in US + [(0.4, -0.1495)]:
        f = half_frame(mp.mpf(mu), mp.mpc(*u))
        if f: out["half"].append({"mu": mu, "u": list(u), "w": cpx(f[0]), "scale": n20(f[1])})
        for k in KS:
            z = half_zoom(mp.mpf(mu), mp.mpc(*u), mp.mpf(k))
            if z: out["halfZoom"].append({"mu": mu, "u0": list(u), "k": k, "mu1": n20(z[0]), "a": cpx(z[1]), "b": cpx(z[2])})
for ell in [2.1, 0.01, 1e-12, 7.0]:
    for u in US:
        x, sc = local_frame(mp.mpf(ell), mp.mpc(*u))
        out["local"].append({"ell": ell, "u": list(u), "x": [n20(t) for t in x], "scale": n20(sc)})
        for k in KS:
            if u == (0.0, 0.01) and ell == 7.0: continue
            e1, a, b = local_zoom(mp.mpf(ell), mp.mpc(*u), mp.mpf(k))
            out["localZoom"].append({"ell": ell, "u0": list(u), "k": k, "a": cpx(a), "b": cpx(b)})
json.dump(out, open("tests/unit/data/views.json", "w"), indent=1)
print({k: len(v) for k, v in out.items()})
