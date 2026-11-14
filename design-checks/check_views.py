# Check the closed forms for the Klein and half-plane frames and zooms against direct 300-digit
# computations from the definitions (pure boosts T(P)^-1, picture points, Mobius frame maps).
import mpmath as mp
mp.mp.dps = 300

def mink(a, b): return a[0]*b[0] + a[1]*b[1] - a[2]*b[2]
def T(p):  # pure boost origin -> p, as 3x3 list (row-major)
    x, y, t = p; k = 1/(1+t)
    return mp.matrix([[1+x*x*k, x*y*k, x], [x*y*k, 1+y*y*k, y], [x, y, t]])
def Tinv(p):
    x, y, t = p
    return T((-x, -y, t))
def vec(m): return (m[0], m[1], m[2])
def kleinPoint(z): r = 1/mp.sqrt(1 - abs(z)**2); return (z.real*r, z.imag*r, r)
def hdist(a, b): return mp.acosh(max(1, -mink(a, b)))

worst = {}
def note(k, v): worst[k] = max(worst.get(k, 0), v)

for depth in ["0.3", "1e-3", "1e-10", "1e-40"]:
    sigma = mp.mpf(depth)
    for theta in [mp.mpf("0.7"), mp.mpf("2.9")]:
        c = mp.sqrt(1 - sigma) * mp.expj(theta)
        lam = mp.mpf("1.7")
        s = sigma / lam
        r = mp.sqrt(sigma)
        Pc = kleinPoint(c)
        for u in [mp.mpc("0.3", "0.2"), mp.mpc("-0.4", "0.5"), mp.mpc("0.05", "-0.6")]:
            # direct frame point
            z = c + s*u
            if abs(z) >= 1: continue
            X = Tinv(Pc) * mp.matrix(kleinPoint(z))
            # closed form
            cu = c.real*u.real + c.imag*u.imag
            f = cu/(1+r)
            h = (r*u.real + c.real*f, r*u.imag + c.imag*f, lam - cu)
            n2 = h[2]**2 - h[0]**2 - h[1]**2
            x = tuple(hi/mp.sqrt(n2) for hi in h)
            note("klein frame (hyperbolic distance)", hdist(vec(X), x))
            # footprint: largest singular value of d(frame)/du in the eta metric, numerically
            eps = mp.mpf("1e-60")
            def fr(uu):
                zz = c + s*uu; return Tinv(Pc) * mp.matrix(kleinPoint(zz))
            J = [(fr(u + eps) - X)/eps, (fr(u + 1j*eps) - X)/eps]
            G = [[mink(vec(J[i]), vec(J[j])) for j in range(2)] for i in range(2)]
            tr = G[0][0] + G[1][1]; det = G[0][0]*G[1][1] - G[0][1]**2
            smax = mp.sqrt((tr + mp.sqrt(tr*tr - 4*det))/2)
            g = (sigma*u.real + lam*c.real, sigma*u.imag + lam*c.imag)
            scale = mp.sqrt(sigma + (g[0]**2 + g[1]**2)/n2)/mp.sqrt(n2)
            note("klein footprint (relative)", abs(scale/smax - 1))
            # zoom by k about u: sigma' and N
            for k in [mp.mpf(2), mp.mpf("0.5")]:
                v = (1 - 1/k)*u
                c1 = c + s*v
                if abs(c1) >= 1: continue
                sigma1_direct = 1 - abs(c1)**2
                cv = c.real*v.real + c.imag*v.imag
                fv = cv/(1+r)
                hv = (r*v.real + c.real*fv, r*v.imag + c.imag*fv, lam - cv)
                n2v = hv[2]**2 - hv[0]**2 - hv[1]**2
                sigma1 = sigma*n2v/lam**2
                note("klein zoom sigma' (relative)", abs(sigma1/sigma1_direct - 1))
                # N = T(Pc)^-1 T(Pc'), direct
                Ndir = Tinv(Pc) * T(kleinPoint(c1))
                # closed form via Poincare coordinates of the centre points
                r1 = mp.sqrt(sigma1)
                lam2_n2 = cv*(2*lam - cv) + hv[0]**2 + hv[1]**2
                dsig = sigma*lam2_n2/lam**2             # sigma - sigma'
                dr = dsig/(r + r1)                        # r - r'
                D = s*v
                zeta = c/(1+r)
                dzeta = D/(1+r1) + c*dr/((1+r)*(1+r1))
                sigP = 2*r/(1+r)
                alpha = sigP - zeta*mp.conj(dzeta)
                beta = dzeta
                a = beta/mp.conj(alpha); th = 2*mp.arg(alpha)
                Nc = T(( 2*a.real/(1-abs(a)**2), 2*a.imag/(1-abs(a)**2), (1+abs(a)**2)/(1-abs(a)**2))) * mp.matrix([[mp.cos(th), -mp.sin(th), 0], [mp.sin(th), mp.cos(th), 0], [0, 0, 1]])
                note("klein zoom N (max entry difference)", max(abs(Ndir[i, j] - Nc[i, j]) for i in range(3) for j in range(3)))

# half-plane: picture z = c + s u in the upper half-plane, frame w = i (z - c)/(z - conj c) = i u/(u + i mu)
for imc in ["1", "1e-10", "1e-60"]:
    c = mp.mpc("0.3", imc); s = c.imag/mp.mpf("1.3"); mu = 2*c.imag/s
    for u in [mp.mpc("0.3", "0.2"), mp.mpc("-0.4", "-0.5"), mp.mpc("0.05", "-0.6")]:
        if (mu + 2*u.imag) <= 0: continue
        w = 1j*u/(u + 1j*mu)
        q = mu*(mu + 2*u.imag)/abs(u + 1j*mu)**2
        note("half-plane 1-|w|^2 (relative)", abs(q/(1 - abs(w)**2) - 1))
        sc = 2/(mu + 2*u.imag)
        # direct: hyperbolic |dz|/Im z times s
        note("half-plane footprint (relative)", abs(sc/(s/(c.imag + s*u.imag)) - 1))
        for k in [mp.mpf(2), mp.mpf("0.5")]:
            v = (1 - 1/k)*u
            if mu + 2*v.imag <= 0: continue
            c1 = c + s*v; s1 = s/k
            mu1 = k*(mu + 2*v.imag)
            note("half-plane zoom mu' (relative)", abs(mu1/(2*c1.imag/s1) - 1))
            # N maps the new frame to the old: N(w) = F_c(F_c'^-1(w))
            Fc = lambda z: 1j*(z - c)/(z - mp.conj(c))
            Finv1 = lambda w: (w*mp.conj(c1) - 1j*c1)/(w - 1j)
            alpha = mu + 1j*mp.conj(v); beta = v
            for w in [mp.mpc(0), mp.mpc("0.3", "-0.2")]:
                direct = Fc(Finv1(w)); closed = (alpha*w + beta)/(mp.conj(beta)*w + mp.conj(alpha))
                note("half-plane zoom N (abs)", abs(direct - closed))
for k, v in worst.items(): print(f"{k:40s} {mp.nstr(v, 3)}")
