"""High-precision reference values for one zoom step of the disk picture (120 digits, mpmath).
Writes tests/unit/data/zoomstep.json. Run: python tools/hp/zoomstep_vectors.py

The inputs are float64 states as the app holds them (c rounded to float64, sigma kept separately).
The reference is the exact zoom of the frame those numbers define, w = u / (lambda - conj(c) u):
  sigma' = sigma (1 - |w(v)|^2) |1 - conj(c) v / lambda|^2,   v = (1 - 1/k) u0
which equals 1 - |c + s v|^2 whenever sigma = 1 - |c|^2 (asserted below at 700 digits)."""
import json
import mpmath as mp

def step(c, sigma, s, u0, k):
    lam = sigma / s
    v = (1 - 1 / k) * u0
    w = v / (lam - mp.conj(c) * v)
    q = 1 - mp.conj(c) * v / lam
    sigma1 = sigma * (1 - abs(w) ** 2) * abs(q) ** 2
    D = s * v
    alpha = sigma - c * mp.conj(D)
    return sigma1, abs(w), D / mp.conj(alpha)

# the identity behind the formula, on consistent states
mp.mp.dps = 700
for depth in ["1e-3", "1e-40", "1e-300"]:
    sigma = mp.mpf(depth)
    c = mp.sqrt(1 - sigma) * mp.expj(mp.mpf("0.7"))
    s = sigma / mp.mpf("3.7")
    for u0, k in [((0.3, 0.2), 2), ((-0.9, 0.5), 0.5)]:
        sigma1, _, _ = step(c, sigma, s, mp.mpc(*u0), mp.mpf(k))
        direct = 1 - abs(c + s * (1 - 1 / mp.mpf(k)) * mp.mpc(*u0)) ** 2
        assert abs(sigma1 / direct - 1) < mp.mpf("1e-380")  # direct loses ~300 digits at 1e-300, (depth, u0, k)

mp.mp.dps = 120
out = []
for depth in ["1e-3", "1e-8", "1e-15", "1e-40", "1e-120", "1e-270"]:  # the state stops at 1e-280
    for theta in ["0.7", "2.9"]:
        for lam in ["3.7", "0.25", "40"]:
            sigma = float(mp.mpf(depth))
            c = mp.sqrt(1 - mp.mpf(sigma)) * mp.expj(mp.mpf(theta))
            cf = [float(c.real), float(c.imag)]
            s = float(mp.mpf(sigma) / mp.mpf(lam))
            for u0 in [(0.3, 0.2), (-0.9, 0.5), (0.0, 0.01), (1.2, -0.4)]:
                for k in [2.0, 0.5, 1.1]:
                    sigma1, wv, a = step(mp.mpc(*cf), mp.mpf(sigma), mp.mpf(s), mp.mpc(*u0), mp.mpf(k))
                    if wv > 0.9:
                        continue  # the step guard moves u0 here; tested separately
                    out.append({"c": cf, "sigma": sigma, "s": s, "u0": list(u0), "k": k,
                                "sigma1": mp.nstr(sigma1, 20), "a": [mp.nstr(a.real, 20), mp.nstr(a.imag, 20)]})
json.dump(out, open("tests/unit/data/zoomstep.json", "w"), indent=1)
print(len(out), "vectors")
