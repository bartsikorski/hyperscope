"""High-precision reference values for the deep-zoom view maps (700 digits, mpmath).
Writes tests/unit/data/deepzoom.json. Run: python tools/hp/deepzoom_vectors.py"""
import json
import mpmath as mp

mp.mp.dps = 700
out = []
for depth in ["1e-3", "1e-8", "1e-15", "1e-40", "1e-120", "1e-300"]:
    for theta in ["0.7", "2.9"]:
        sigma = mp.mpf(depth)
        c = mp.sqrt(1 - sigma) * mp.expj(mp.mpf(theta))
        s = sigma / mp.mpf("3.7")
        for u in [(0.3, 0.2), (-0.9, 0.5), (0.0, 0.01), (1.2, -0.4)]:
            uu = mp.mpc(*u)
            z = c + s * uu
            w = (z - c) / (1 - mp.conj(c) * z)
            out.append({"model": "poincare", "c": [float(c.real), float(c.imag)], "sigma": depth,
                        "s": mp.nstr(s, 20), "u": list(u), "w": [mp.nstr(w.real, 20), mp.nstr(w.imag, 20)]})
for imc in ["1", "1e-10", "1e-100", "1e-250"]:
    c = mp.mpc("0.3", imc)
    s = c.imag / mp.mpf("2.5")
    for u in [(0.3, 0.2), (-0.9, 0.5), (1.2, -0.4)]:
        uu = mp.mpc(*u)
        z = c + s * uu
        w = 1j * (z - c) / (z - mp.conj(c))
        out.append({"model": "halfplane", "imc": imc, "s": mp.nstr(s, 20), "u": list(u),
                    "w": [mp.nstr(w.real, 20), mp.nstr(w.imag, 20)]})
json.dump(out, open("tests/unit/data/deepzoom.json", "w"), indent=1)
print(len(out), "vectors")
