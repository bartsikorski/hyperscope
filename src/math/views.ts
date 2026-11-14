// Views: maps from screen coordinates to the plane, and the camera updates for zoom and pan.
//
// Screen coordinates u are complex, centred, y up, scaled so the vertical extent is +-1:
//   u = ((px + 1/2 - W/2) + i (H/2 - py - 1/2)) / (H/2)
// A view's frame(u) is the point of the plane under u, relative to the screen-centre point; the world
// point of a pixel is camera * frame(u).
//
// Disk pictures (Poincare): the picture point is z = c + s u. The state keeps c, the scale s and
// sigma = 1 - |c|^2 directly, so nothing is computed as a difference of nearly equal numbers:
//   w = u / (lambda - conj(c) u),   lambda = sigma / s           (w = M_c(z), the frame point)
// Checked against 700-digit arithmetic down to sigma = 1e-300 (design-checks/check_math.py). The frame
// depends only on c and lambda; sigma and s matter separately only for the zoom below.
//
// Klein, half-plane, local and band views follow at the end, each with its frame, zoom and the numbers the
// shader needs; their closed forms were checked at 300 digits (design-checks/check_views.py). The
// dispatch functions (frameOf, zoomPicture, ...) let the camera code treat every view alike.

import type { Complex } from "./complex.ts";
import { cadd, cabs2, cconj, cdiv, cmul, csub, cscale } from "./complex.ts";
import type { Mat3, Vec3 } from "./lorentz.ts";
import { apply, boostX, identity, mul, rotation, translationTo } from "./lorentz.ts";
import { fromPoincare, toPoincare } from "./models.ts";

export interface DiskPicture {
  /** Where the screen centre sits in the disk picture. */
  c: Complex;
  /** 1 - |c|^2, kept directly. */
  sigma: number;
  /** Picture units per unit of u. */
  s: number;
}

export const HOME_PICTURE: DiskPicture = { c: [0, 0], sigma: 1, s: 1.05 };

/** The disk picture with |c|^2 + sigma = 1 restored after rounding, from whichever of the two is the
 *  smaller (and so the precise one): near the rim sigma, kept directly for that reason, sets |c| (c
 *  keeps its direction); near the centre c sets sigma. Every computed disk picture goes through it.
 *  Left alone the two drift apart, and the Klein rim opening, which measures the picture from the
 *  cursor and back every frame, grew that mismatch frame by frame into a visible jitter (design
 *  notes, "Opening the Klein rim"). A sigma that is not a number, or not above 0, is passed on for
 *  the zoom limits to refuse. */
export function diskPicture(c: Complex, sigma: number, s: number): DiskPicture {
  if (!(sigma > 0)) return { c, sigma, s };
  const r2 = c[0] * c[0] + c[1] * c[1];
  if (r2 <= sigma) return { c, sigma: 1 - r2, s };
  const t = Math.sqrt(Math.max(0, 1 - sigma) / r2);
  return { c: [c[0] * t, c[1] * t], sigma, s };
}

export function screenToU(px: number, py: number, width: number, height: number): Complex {
  const h = height / 2;
  return [(px + 0.5 - width / 2) / h, (height / 2 - py - 0.5) / h];
}

export function uToScreen(u: Complex, width: number, height: number): [number, number] {
  const h = height / 2;
  return [u[0] * h + width / 2 - 0.5, height / 2 - u[1] * h - 0.5];
}

export interface FramePoint {
  /** Poincare coordinate relative to the screen-centre frame. */
  w: Complex;
  /** The same point on the hyperboloid. */
  x: Vec3;
  /** Plane length per unit of u at this point (multiply by 2 / height for one pixel). */
  scale: number;
}

/** Poincare disk: the frame point under u, or null outside the disk. */
export function poincareFrame(pic: DiskPicture, u: Complex): FramePoint | null {
  const lambda = pic.sigma / pic.s;
  const den = csub([lambda, 0], cmul(cconj(pic.c), u));
  const w = cdiv(u, den);
  const r2 = cabs2(w);
  if (r2 >= 1) return null;
  // |dw/du| = lambda / |den|^2, and the Poincare metric is 2 |dw| / (1 - |w|^2)
  const scale = ((lambda / cabs2(den)) * 2) / (1 - r2);
  return { w, x: fromPoincare(w), scale };
}

/** Isometry of the disk z -> (alpha z + beta) / (conj(beta) z + conj(alpha)) as a Lorentz matrix:
 *  a translation to beta / conj(alpha) after a rotation by 2 arg(alpha). */
export function mobiusToLorentz(alpha: Complex, beta: Complex): Mat3 {
  const a = cdiv(beta, cconj(alpha));
  const theta = 2 * Math.atan2(alpha[1], alpha[0]);
  return mul(translationTo(fromPoincare(a)), rotation(theta));
}

/** Largest frame radius the screen centre may move to in one zoom step: a hyperbolic distance of
 *  2 atanh(0.9), about 2.9. Only zooms aimed at or past the boundary reach it. */
export const MAX_ZOOM_STEP_W = 0.9;
/** Zoom limits of the picture state itself, far beyond what the renderer resolves (the interface
 *  stops earlier, at the precise-mode limit): sigma and s above 1e-280 allow about 900 doublings of
 *  a flight toward the edge before float64 underflow, lambda below 1e30 keeps |den|^2 finite. */
export const MIN_SIGMA = 1e-280;
export const MAX_LAMBDA = 1e30;

/** Zoom the picture by factor k about the screen point u0 (k > 1 zooms in). Returns the new
 *  picture and N, the isometry from the new frame to the old one: camera' = camera * N.
 *  The new screen centre is the old picture point under v = (1 - 1/k) u0, and its sigma is
 *    sigma' = sigma (1 - |w(v)|^2) |1 - conj(c) v / lambda|^2     (w = the frame map above)
 *  which equals 1 - |c + s v|^2 but has full relative precision at any depth and is positive exactly
 *  when v is inside the disk. When v would land beyond MAX_ZOOM_STEP_W (the cursor is outside the
 *  disk, or a zoom-out aims past the boundary) v is pulled back toward the screen centre, so the
 *  point under the cursor moves a little instead of the centre leaving the disk. A step past
 *  MIN_SIGMA or MAX_LAMBDA leaves the picture as it is (N = identity). */
export function zoomPoincare(pic: DiskPicture, u0: Complex, k: number): { pic: DiskPicture; N: Mat3 } {
  const lambda = pic.sigma / pic.s;
  const cbar = cconj(pic.c);
  const frameAt = (v: Complex) => cdiv(v, csub([lambda, 0], cmul(cbar, v)));
  let v = cscale(u0, 1 - 1 / k);
  // frame radius grows along the ray from the centre, so bisect for the farthest allowed point
  if (!(cabs2(frameAt(v)) <= MAX_ZOOM_STEP_W ** 2)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (cabs2(frameAt(cscale(v, mid))) <= MAX_ZOOM_STEP_W ** 2) lo = mid;
      else hi = mid;
    }
    v = cscale(v, lo);
  }
  const q = csub([1, 0], cscale(cmul(cbar, v), 1 / lambda));
  const sigma = pic.sigma * (1 - cabs2(frameAt(v))) * cabs2(q);
  const D = cscale(v, pic.s);
  const c: Complex = [pic.c[0] + D[0], pic.c[1] + D[1]];
  // N(z) = ((sigma - c conj(D)) z + D) / (conj(D) z + (sigma - conj(c) D)), of the form
  // (alpha z + beta) / (conj(beta) z + conj(alpha)); dividing both by s leaves N unchanged and keeps
  // the numbers of order 1 at any depth: alpha = lambda - c conj(v), beta = v
  const alpha = csub([lambda, 0], cmul(pic.c, cconj(v)));
  const N = mobiusToLorentz(alpha, v);
  const s = pic.s / k;
  if (!(sigma >= MIN_SIGMA && s >= MIN_SIGMA && sigma / s <= MAX_LAMBDA)) return { pic, N: identity() };
  return { pic: diskPicture(c, sigma, s), N };
}

// ----------------------------------------------------------------------------- Klein disk

// The picture z = c + s u lies in the Klein disk, and the frame is centred on the screen-centre point
// P_c by the pure boost T(P_c)^-1. Applied to the homogeneous point (c + s u, 1) and divided by
// s / sqrt(sigma), the frame point is h / sqrt(h_t^2 - |h_s|^2) with
//   h = ( r u + c (c . u) / (1 + r),  lambda - c . u ),   r = sqrt(sigma),  lambda = sigma / s
// whose entries are all of order 1 at any depth. Klein is not conformal: the plane length per unit of
// u differs by direction, and the largest one (used for the pixel footprint) is
//   sqrt(sigma + |sigma u + lambda c|^2 / N^2) / N,   N^2 = h_t^2 - |h_s|^2.

function kleinH(c: Complex, lambda: number, r: number, u: Complex): Vec3 {
  const cu = c[0] * u[0] + c[1] * u[1];
  const f = cu / (1 + r);
  return [r * u[0] + c[0] * f, r * u[1] + c[1] * f, lambda - cu];
}

export function kleinFrame(pic: DiskPicture, u: Complex): FramePoint | null {
  const lambda = pic.sigma / pic.s;
  const h = kleinH(pic.c, lambda, Math.sqrt(pic.sigma), u);
  const n2 = h[2] * h[2] - h[0] * h[0] - h[1] * h[1];
  if (!(n2 > 0 && h[2] > 0)) return null;
  const n = Math.sqrt(n2);
  const x: Vec3 = [h[0] / n, h[1] / n, h[2] / n];
  const gx = pic.sigma * u[0] + lambda * pic.c[0];
  const gy = pic.sigma * u[1] + lambda * pic.c[1];
  return { w: toPoincare(x), x, scale: Math.sqrt(pic.sigma + (gx * gx + gy * gy) / n2) / n };
}

/** The screen point u of the frame point x in the Klein picture (kleinFrame's inverse), or null when x
 *  lies behind it. h(u) = t x for some t > 0; with a = c . u the dot of h's space part with c gives
 *  a = t c . x_s (r + |c|^2 / (1 + r) = 1, as |c|^2 = 1 - r^2), so t = lambda / (x_t + c . x_s) and
 *  u = (t x_s - c a / (1 + r)) / r. */
export function kleinScreenOf(pic: DiskPicture, x: Vec3): Complex | null {
  const lambda = pic.sigma / pic.s;
  const r = Math.sqrt(pic.sigma);
  const den = x[2] + pic.c[0] * x[0] + pic.c[1] * x[1];
  if (!(den > 0)) return null;
  const t = lambda / den;
  const f = (t * (pic.c[0] * x[0] + pic.c[1] * x[1])) / (1 + r);
  return [(t * x[0] - pic.c[0] * f) / r, (t * x[1] - pic.c[1] * f) / r];
}

/** Klein radius of the same hyperbolic step limit as MAX_ZOOM_STEP_W in the Poincare disk. */
export const KLEIN_STEP = Math.tanh(2 * Math.atanh(MAX_ZOOM_STEP_W));

/** Zoom the Klein picture by k about u0, like zoomPoincare: the screen centre moves to the picture
 *  point under v = (1 - 1/k) u0 (kleinShift), pulled back to the KLEIN_STEP radius when the cursor is
 *  far, and s becomes s / k. */
export function zoomKlein(pic: DiskPicture, u0: Complex, k: number): { pic: DiskPicture; N: Mat3 } {
  const lambda = pic.sigma / pic.s;
  const r = Math.sqrt(pic.sigma);
  const radius = (v: Complex) => {
    const h = kleinH(pic.c, lambda, r, v);
    return h[2] > 0 && h[2] * h[2] > h[0] * h[0] + h[1] * h[1] ? Math.hypot(h[0], h[1]) / h[2] : Infinity;
  };
  const v = limitStep(cscale(u0, 1 - 1 / k), (w) => radius(w) <= KLEIN_STEP);
  const step = kleinShift(pic, v, pic.s / k);
  const { sigma, s } = step.pic;
  if (!(sigma >= MIN_SIGMA && s >= MIN_SIGMA && sigma / s <= MAX_LAMBDA)) return { pic, N: identity() };
  return step;
}

/** The Klein picture with its screen centre moved to the picture point under v (inside the disk)
 *  and scale s1, and N, the isometry from the new frame to the old one (camera' = camera * N). With
 *  h = h(v):
 *    sigma' = sigma (h_t^2 - |h_s|^2) / lambda^2
 *  and N = T(P_c)^-1 T(P_c') as a Mobius map of Poincare frame coordinates: zeta = c / (1 + r) is the
 *  Poincare coordinate of the screen-centre point, beta = zeta' - zeta and alpha = (1 - |zeta|^2) -
 *  zeta conj(beta), all built from v-sized terms (sigma - sigma' never as a difference). With s1 = s
 *  the picture is the same, only measured from v: u' = u - v. */
export function kleinShift(pic: DiskPicture, v: Complex, s1: number): { pic: DiskPicture; N: Mat3 } {
  const lambda = pic.sigma / pic.s;
  const r = Math.sqrt(pic.sigma);
  const h = kleinH(pic.c, lambda, r, v);
  const sigma = (pic.sigma * (h[2] * h[2] - h[0] * h[0] - h[1] * h[1])) / (lambda * lambda);
  const D = cscale(v, pic.s);
  const c: Complex = [pic.c[0] + D[0], pic.c[1] + D[1]];
  const r1 = Math.sqrt(sigma);
  const cv = pic.c[0] * v[0] + pic.c[1] * v[1];
  const dr = (pic.sigma * (cv * (2 * lambda - cv) + h[0] * h[0] + h[1] * h[1])) / (lambda * lambda) / (r + r1); // r - r'
  const zeta = cscale(pic.c, 1 / (1 + r));
  const beta = cadd(cscale(D, 1 / (1 + r1)), cscale(pic.c, dr / ((1 + r) * (1 + r1))));
  const sigP = (2 * r) / (1 + r);
  const alpha = csub([sigP, 0], cmul(zeta, cconj(beta)));
  // scaling alpha and beta together leaves N unchanged; dividing by sigP keeps them of order 1
  const N = mobiusToLorentz(cscale(alpha, 1 / sigP), cscale(beta, 1 / sigP));
  return { pic: diskPicture(c, sigma, s1), N };
}

/** Pull v toward 0 until ok(v) holds (ok(0) always does): the frame step guard of every zoom. */
function limitStep(v: Complex, ok: (v: Complex) => boolean): Complex {
  if (ok(v)) return v;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ok(cscale(v, mid))) lo = mid;
    else hi = mid;
  }
  return cscale(v, lo);
}

// ----------------------------------------------------------------------------- upper half-plane

// The picture z = c + s u lies in the upper half-plane. Translations along the real axis and
// scalings are isometries there, so the view depends only on mu = 2 Im c / s: the boundary line sits
// at Im u = -mu / 2. The frame point is w = i (z - c) / (z - conj c) = i u / (u + i mu), and
//   1 - |w|^2 = mu (mu + 2 Im u) / |u + i mu|^2,   plane length per unit of u = 2 / (mu + 2 Im u)
// both free of cancellation even right at the boundary.

export interface HalfPlanePicture {
  mu: number;
}

export function halfPlaneFrame(pic: HalfPlanePicture, u: Complex): FramePoint | null {
  const m = pic.mu + 2 * u[1];
  if (!(m > 0)) return null;
  const d: Complex = [u[0], u[1] + pic.mu];
  const w = cdiv([-u[1], u[0]], d);
  const q = (pic.mu * m) / cabs2(d);
  return { w, x: [(2 * w[0]) / q, (2 * w[1]) / q, (2 - q) / q], scale: 2 / m };
}

/** Zoom by k about u0: mu' = k (mu + 2 Im v), and N(w) = ((mu + i conj v) w + v) / (conj(v) w + (mu - i v)). */
export function zoomHalfPlane(pic: HalfPlanePicture, u0: Complex, k: number): { pic: HalfPlanePicture; N: Mat3 } {
  const v = limitStep(cscale(u0, 1 - 1 / k), (w) => {
    const f = halfPlaneFrame(pic, w);
    return f !== null && cabs2(f.w) <= MAX_ZOOM_STEP_W ** 2;
  });
  const mu = k * (pic.mu + 2 * v[1]);
  if (!(mu <= MAX_LAMBDA && mu > 0)) return { pic, N: identity() };
  return { pic: { mu }, N: mobiusToLorentz([pic.mu + v[1], v[0]], v) };
}

// ----------------------------------------------------------------------------- local view

// Azimuthal equidistant around the screen-centre point: the pixel at u lies at distance ell |u| in
// the direction of u, so the view looks Euclidean near the centre at any zoom. The plane length per
// unit of u is ell radially and ell sinh(d) / d around the centre, the larger.

export interface LocalPicture {
  ell: number;
}

export function localFrame(pic: LocalPicture, u: Complex): FramePoint {
  const r = Math.hypot(u[0], u[1]);
  const d = pic.ell * r;
  const sh = Math.sinh(d);
  const x: Vec3 = r > 0 ? [(u[0] * sh) / r, (u[1] * sh) / r, Math.cosh(d)] : [0, 0, 1];
  return { w: toPoincare(x), x, scale: d > 0 ? (pic.ell * sh) / d : pic.ell };
}

/** Zoom by k about u0: ell' = ell / k, and N slides along the ray through u0 by ell (1 - 1/k) |u0|, so
 *  the point under the cursor stays put. */
export function zoomLocal(pic: LocalPicture, u0: Complex, k: number): { pic: LocalPicture; N: Mat3 } {
  const ell = pic.ell / k;
  const r = Math.hypot(u0[0], u0[1]);
  if (!(ell >= 1e-30)) return { pic, N: identity() };
  if (r === 0) return { pic: { ell }, N: identity() };
  const phi = Math.atan2(u0[1], u0[0]);
  return { pic: { ell }, N: mul(rotation(phi), mul(boostX(pic.ell * (1 - 1 / k) * r), rotation(-phi))) };
}

// ----------------------------------------------------------------------------- band

// The band |Im z| < pi/2 around one geodesic, conformal (w = tanh(z/2) maps it onto the Poincare
// disk). The band point (x, y) lies at distance x along the geodesic and at distance b, sinh b = tan y,
// from it:   P(x, y) = (sinh x / cos y, tan y, cosh x / cos y),   plane length per band unit 1 / cos y.
// The picture keeps y0, the band height of the screen centre, and s, band units per unit of u; moves
// along the geodesic are camera moves and never touch it. The frame point of u is P(s u_x, y0 + s u_y)
// moved so that the centre lands on the origin, in the relative form, where nothing of size
// 1 / cos y0 is subtracted: with c0 = cos y0, s0 = sin y0, a = s u_x, d = s u_y,
//   C = cos(y0 + d) = c0 - 2 sin(d/2) (c0 sin(d/2) + s0 cos(d/2)),   k = C c0,
//   m = cosh a - 1 = 2 sinh^2(a/2),
//   x = ( sinh a / C,  (2 cos(y0 + d/2) sin(d/2) - s0 m) / k,  1 + (m + 2 sin^2(d/2)) / k )
// Checked in float32 against 60-digit values down to an edge gap pi/2 - |y0| of 1e-12, where float32
// underflow starts to show, so that gap is the zoom limit (design-checks/check_m2.py, A1 to A3).

export interface BandPicture {
  /** Band height of the screen centre, |y0| < pi/2. */
  y0: number;
  /** Band units per unit of u. */
  s: number;
}

/** Smallest edge gap pi/2 - |y0| (as cos y0) the screen centre may reach. */
export const MIN_BAND_GAP = 1e-12;
/** Largest s, zoomed out: the band then fills 0.4 of the screen height. */
export const MAX_BAND_S = Math.PI / 0.8;

/** Distances in band units from the screen centre to the upper and lower edge, pi/2 - y0 and
 *  pi/2 + y0, each with full relative precision however close the edge is. */
function bandGaps(y0: number): [number, number] {
  const c0 = Math.cos(y0);
  const s0 = Math.sin(y0);
  return [Math.atan2(c0, s0), Math.atan2(c0, -s0)];
}

export function bandFrame(pic: BandPicture, u: Complex): FramePoint | null {
  const [up, down] = bandGaps(pic.y0);
  const d = pic.s * u[1];
  if (!(d < up && d > -down)) return null;
  const c0 = Math.cos(pic.y0);
  const s0 = Math.sin(pic.y0);
  // as the shader computes it (views/band.glsl): from sin and cos of d / 2 and sinh of a / 2 only
  const sh = Math.sin(d / 2);
  const ch = Math.sqrt(Math.max(0, 1 - sh * sh)); // cos(d / 2): |d / 2| < pi / 2 inside the band
  const C = c0 - 2 * sh * (c0 * sh + s0 * ch);
  if (!(C > 0)) return null;
  const h = Math.sinh((pic.s * u[0]) / 2);
  const m = 2 * h * h;
  const cmid = c0 * ch - s0 * sh;
  const k = C * c0;
  const x: Vec3 = [(2 * h * Math.sqrt(1 + h * h)) / C, (2 * cmid * sh - s0 * m) / k, 1 + (m + 2 * sh * sh) / k];
  return { w: toPoincare(x), x, scale: pic.s / C };
}

/** The isometry from the frame centred at the band point under v (its x axis along the band) to
 *  the screen-centre frame. It carries the origin to the frame point p of v and the x axis to the
 *  band direction there, both from the relative form, never from boosts of size 1 / cos y0: the
 *  band direction is the u_x derivative of the frame point, (cosh a / C, -s0 sinh a / k, sinh a / k),
 *  moved back to the origin by the boost from p. */
export function bandMoveTo(pic: BandPicture, v: Complex): Mat3 {
  const fp = bandFrame(pic, v);
  if (!fp) throw new Error("bandMoveTo: v is outside the band");
  const p = fp.x;
  const a = pic.s * v[0];
  const c0 = Math.cos(pic.y0);
  const s0 = Math.sin(pic.y0);
  const C = pic.s / fp.scale;
  const t = apply(translationTo([-p[0], -p[1], p[2]]), [Math.cosh(a) / C, (-s0 * Math.sinh(a)) / (C * c0), Math.sinh(a) / (C * c0)]);
  return mul(translationTo(p), rotation(Math.atan2(t[1], t[0])));
}

/** Zoom by k about u0: s' = s / k and y0' = y0 + s v_y with v = (1 - 1/k) u0, pulled back like the
 *  other views' steps and so that the new centre keeps an edge gap of MIN_BAND_GAP; N = bandMoveTo(v). */
export function zoomBand(pic: BandPicture, u0: Complex, k: number): { pic: BandPicture; N: Mat3 } {
  const v = limitStep(cscale(u0, 1 - 1 / k), (w) => {
    const f = bandFrame(pic, w);
    return f !== null && cabs2(f.w) <= MAX_ZOOM_STEP_W ** 2 && Math.cos(pic.y0 + pic.s * w[1]) >= MIN_BAND_GAP;
  });
  const s = pic.s / k;
  if (!(s >= 1e-30 && s <= MAX_LAMBDA)) return { pic, N: identity() };
  return { pic: { y0: pic.y0 + pic.s * v[1], s }, N: bandMoveTo(pic, v) };
}

/** Zooming out keeps the edge gap pi/2 - |y0| at least BAND_EASE s, moving y0 toward 0 with the
 *  camera fixed (the screen-centre point and the band's direction there stay, the band's geodesic
 *  moves): the rows of large tiles then stay within about 1.4 R of the screen centre, where float32
 *  places them well (design v2, "Precision along the band"). */
export const BAND_EASE = 1 / 3;
export function easeBand(pic: BandPicture): BandPicture {
  const gap = Math.atan2(Math.cos(pic.y0), Math.abs(Math.sin(pic.y0)));
  const want = BAND_EASE * pic.s;
  if (gap >= want) return pic;
  return { y0: Math.sign(pic.y0) * Math.max(0, Math.PI / 2 - want), s: pic.s };
}

// ----------------------------------------------------------------------------- the plane inside H3

// The eye stands in hyperbolic space H3 at height h above the frame origin (the foot point) and looks
// along the frame's +y, pitch below level, with a vertical field of view fov. The pixel at u looks
// along w = (f u_x, cos pitch + f u_y sin pitch, -sin pitch + f u_y cos pitch) (right, forward, up),
// f = tan(fov / 2), and its ray meets the plane at the frame point
//   x = H / sqrt(H_t^2 - |H_s|^2),   H = (w_x sinh h, w_y sinh h, -w_z),
// linear in u like the Klein frame: the ray cosh t E + sinh t D from the eye E meets the plane where
// tanh t = tanh h / (-c) (c = w's up part, normalised), and that point is this one (design doc,
// "Plane inside H3", refinement: equal to 1e-48 at 50 digits; tools/hp/h3_vectors.py). Rays at or
// above the horizon (H_t <= |H_s|) miss the plane. Not conformal: the plane length per unit of u is
// largest along the ray's grazing direction, from the Jacobian's Gram matrix.

export interface H3Picture {
  /** Eye height above the plane, in R. */
  h: number;
  /** How far the view's centre looks below level, radians. */
  pitch: number;
  /** Vertical field of view, radians. */
  fov: number;
}

/** Eye height from 64 km (0.01 R: lower, the ground under the eye needs a pixel footprint below
 *  float32's 1e-5) to 6 R; pitch from level to straight down; field of view 40 to 100 degrees. */
export const H3_MIN_H = 0.01;
export const H3_MAX_H = 6;
export const H3_MIN_PITCH = 0;
export const H3_MAX_PITCH = Math.PI / 2;
export const H3_MIN_FOV = (40 * Math.PI) / 180;
export const H3_MAX_FOV = (100 * Math.PI) / 180;
export const H3_HOME: H3Picture = { h: 0.3, pitch: Math.PI / 6, fov: (70 * Math.PI) / 180 };

/** The pixel's direction w (unnormalised) and H. */
function h3H(pic: H3Picture, u: Complex): { w: Vec3; H: Vec3 } {
  const f = Math.tan(pic.fov / 2);
  const cp = Math.cos(pic.pitch);
  const sp = Math.sin(pic.pitch);
  const w: Vec3 = [f * u[0], cp + f * u[1] * sp, -sp + f * u[1] * cp];
  const sh = Math.sinh(pic.h);
  return { w, H: [w[0] * sh, w[1] * sh, -w[2]] };
}

/** dx along u's x and y: (dH + x <x, dH>) / n, with dH = (sinh h f, 0, 0) and (0, sinh h f sin pitch, -f cos pitch). */
function h3Jacobian(pic: H3Picture, x: Vec3, n: number): [Vec3, Vec3] {
  const f = Math.tan(pic.fov / 2);
  const sh = Math.sinh(pic.h);
  const along = (d: Vec3): Vec3 => {
    const k = x[0] * d[0] + x[1] * d[1] - x[2] * d[2];
    return [(d[0] + x[0] * k) / n, (d[1] + x[1] * k) / n, (d[2] + x[2] * k) / n];
  };
  return [along([sh * f, 0, 0]), along([0, sh * f * Math.sin(pic.pitch), -f * Math.cos(pic.pitch)])];
}

/** The larger plane length per unit of u of a map with Jacobian columns t1, t2 (tangent vectors):
 *  the square root of the larger eigenvalue of their Gram matrix. */
export function largestStretch(t1: Vec3, t2: Vec3): number {
  const g11 = t1[0] * t1[0] + t1[1] * t1[1] - t1[2] * t1[2];
  const g22 = t2[0] * t2[0] + t2[1] * t2[1] - t2[2] * t2[2];
  const g12 = t1[0] * t2[0] + t1[1] * t2[1] - t1[2] * t2[2];
  return Math.sqrt((g11 + g22 + Math.hypot(g11 - g22, 2 * g12)) / 2);
}

export function h3Frame(pic: H3Picture, u: Complex): FramePoint | null {
  const { H } = h3H(pic, u);
  const n2 = H[2] * H[2] - H[0] * H[0] - H[1] * H[1];
  if (!(n2 > 0 && H[2] > 0)) return null;
  const n = Math.sqrt(n2);
  const x: Vec3 = [H[0] / n, H[1] / n, H[2] / n];
  const [t1, t2] = h3Jacobian(pic, x, n);
  return { w: toPoincare(x), x, scale: largestStretch(t1, t2) };
}

/** Signed distance from u to the horizon in units of u, positive above it: g / |grad g| with
 *  g = w_z + sinh h |(w_x, w_y)|, which is negative exactly where the ray meets the plane. */
export function h3Edge(pic: H3Picture, u: Complex): number {
  const { w } = h3H(pic, u);
  const f = Math.tan(pic.fov / 2);
  const sh = Math.sinh(pic.h);
  const r = Math.hypot(w[0], w[1]);
  if (r === 0) return w[2] / f;
  const g = w[2] + sh * r;
  const gx = (sh * w[0] * f) / r;
  const gy = f * Math.cos(pic.pitch) + (sh * w[1] * f * Math.sin(pic.pitch)) / r;
  return g / Math.hypot(gx, gy);
}

/** How far below level the horizon lies, radians: asin(tanh h). */
export function horizonAngle(h: number): number {
  return Math.asin(Math.tanh(h));
}

/** What a zoom inside H3 keeps of the pitch at height h (design notes, Inside H³: the view tilts
 *  with the zoom). Below the horizon, with d the view's angle below it and r = π/2 − α the angle
 *  from the horizon to straight down: c = d r / (r − d), from 0 at the horizon to Infinity straight
 *  down, so that d = c r / (c + r) is about c while r is large and closes on r as r shrinks. Above
 *  the horizon: d / α, from −1 level to 0 at the horizon. */
export function tiltOf(pitch: number, h: number): number {
  const a = horizonAngle(h);
  const r = Math.PI / 2 - a;
  const d = pitch - a;
  if (d < 0) return d / a;
  return d >= r ? Infinity : (d * r) / (r - d);
}

/** The pitch at height h that has the tilt c (tiltOf's inverse), within the pitch's limits. */
export function pitchOf(c: number, h: number): number {
  if (c === Infinity) return H3_MAX_PITCH;
  if (c <= -1) return H3_MIN_PITCH;
  const a = horizonAngle(h);
  const r = Math.PI / 2 - a;
  const p = c < 0 ? a * (1 + c) : a + (c * r) / (c + r);
  return Math.min(H3_MAX_PITCH, Math.max(H3_MIN_PITCH, p));
}

/** The pitch after the eye goes from height h0 to h1, keeping its tilt (tiltOf): the view looks
 *  further down as the eye rises, and lifts as it descends, the horizon staying near its place on
 *  the screen until the plane is a disk below, which then comes to the screen centre. */
export function tiltWith(pitch: number, h0: number, h1: number): number {
  if (h0 === h1 || pitch >= H3_MAX_PITCH || pitch <= H3_MIN_PITCH) return pitch;
  return pitchOf(tiltOf(pitch, h0), h1);
}

/** Change the eye height by 1 / k (k > 1 lowers it), within H3_MIN_H and H3_MAX_H, tilting the view
 *  with it (tiltWith); the eye stays over its foot point, so N is the identity. */
export function zoomH3(pic: H3Picture, k: number): { pic: H3Picture; N: Mat3 } {
  const h = Math.min(H3_MAX_H, Math.max(H3_MIN_H, pic.h / k));
  return { pic: { ...pic, h, pitch: tiltWith(pic.pitch, pic.h, h) }, N: identity() };
}

// ----------------------------------------------------------------------------- the hyperboloid

// The plane as the upper sheet of t^2 - x^2 - y^2 = 1 in Euclidean 3D (design notes, "Step 13: the
// hyperboloid"). The frame coordinates are the embedding's, so a pixel's frame point is where its ray
// meets the surface. An orbit camera looks at the vertex V = (0, 0, 1) from distance D at elevation
// e: it sits at o = V + D (0, -cos e, sin e) and looks along F = (0, cos e, -sin e), with right
// R = (1, 0, 0) and up U = (0, sin e, cos e); the pixel at u looks along d = F + f (u_x R + u_y U),
// f = tan(fov / 2). With Q(a, b) = a_t b_t - a_x b_x - a_y b_y = -<a, b>, the ray o + lambda d meets
// the quadric where A lambda^2 + 2 B lambda + C = 0, A = Q(d, d), B = Q(o, d), C = Q(o, o) - 1.

export interface HyperboloidPicture {
  /** The camera's angle above the tangent plane at the vertex, radians (negative from below). */
  elevation: number;
  /** Euclidean distance from the camera to the vertex, in R. */
  distance: number;
  /** Vertical field of view, radians. */
  fov: number;
}

export const HB_MIN_ELEVATION = -Math.PI / 2;
export const HB_MAX_ELEVATION = Math.PI / 2;
export const HB_MIN_DISTANCE = 1.5;
export const HB_MAX_DISTANCE = 40;
export const HB_MIN_FOV = H3_MIN_FOV;
export const HB_MAX_FOV = H3_MAX_FOV;
export const HB_HOME: HyperboloidPicture = { elevation: (55 * Math.PI) / 180, distance: 5, fov: (50 * Math.PI) / 180 };
/** Beyond the screen's half-height of 1, a distance in u stands for "no edge near". */
const FAR_EDGE = 1e6;

const lq = (a: Vec3, b: Vec3): number => a[2] * b[2] - a[0] * b[0] - a[1] * b[1];

interface Orbit {
  o: Vec3;
  F: Vec3;
  R: Vec3;
  U: Vec3;
  f: number;
}

export function hbOrbit(pic: HyperboloidPicture): Orbit {
  const ce = Math.cos(pic.elevation);
  const se = Math.sin(pic.elevation);
  return { o: [0, -pic.distance * ce, 1 + pic.distance * se], F: [0, ce, -se], R: [1, 0, 0], U: [0, se, ce], f: Math.tan(pic.fov / 2) };
}

function hbRay(orbit: Orbit, u: Complex): Vec3 {
  const { F, U, f } = orbit;
  return [f * u[0], F[1] + f * u[1] * U[1], F[2] + f * u[1] * U[2]];
}

/** The two roots q / A and C / q of A l^2 + 2 B l + C = 0, q = -(B + sign(B) sqrt(B^2 - AC)), or
 *  null when the line misses the quadric (B^2 < AC). */
function hbRoots(A: number, B: number, C: number): [number, number] | null {
  const disc = B * B - A * C;
  if (!(disc >= 0)) return null;
  const q = -(B + (B >= 0 ? 1 : -1) * Math.sqrt(disc));
  if (q === 0) return null;
  return [q / A, C / q];
}

/** Where the ray from o along d first meets the upper sheet ahead (lambda > 0, t > 0), or null. */
export function hbHit(o: Vec3, d: Vec3): { lambda: number; p: Vec3 } | null {
  const roots = hbRoots(lq(d, d), lq(o, d), lq(o, o) - 1);
  if (!roots) return null;
  let best = Infinity;
  for (const l of roots) if (l > 0 && l < best && o[2] + l * d[2] > 0) best = l;
  if (!(best < Infinity)) return null;
  return { lambda: best, p: [o[0] + best * d[0], o[1] + best * d[1], o[2] + best * d[2]] };
}

/** dp along u's x and y on the surface: lambda (e - d Q(p, e) / Q(p, d)), e = f R and f U. */
function hbJacobian(orbit: Orbit, d: Vec3, lambda: number, p: Vec3): [Vec3, Vec3] {
  const pd = lq(p, d);
  const along = (e: Vec3): Vec3 => {
    const k = lq(p, e) / pd;
    return [lambda * (e[0] - d[0] * k), lambda * (e[1] - d[1] * k), lambda * (e[2] - d[2] * k)];
  };
  const { R, U, f } = orbit;
  return [along([f * R[0], f * R[1], f * R[2]]), along([f * U[0], f * U[1], f * U[2]])];
}

export function hyperboloidFrame(pic: HyperboloidPicture, u: Complex): FramePoint | null {
  const orbit = hbOrbit(pic);
  const d = hbRay(orbit, u);
  const hit = hbHit(orbit.o, d);
  if (!hit) return null;
  // onto the sheet by t from x and y: never NaN, unlike dividing by sqrt(Q(p, p)), which far up the
  // sheet (t^2 eps near 1) can come out negative; along the surface either way loses only eps t
  const x: Vec3 = [hit.p[0], hit.p[1], Math.hypot(1, hit.p[0], hit.p[1])];
  const [t1, t2] = hbJacobian(orbit, d, hit.lambda, x);
  return { w: toPoincare(x), x, scale: largestStretch(t1, t2) };
}

/** Signed distance from u to the edge of the surface's picture in units of u, positive outside: the
 *  nearer of the silhouette, where the ray grazes the upper sheet (B^2 - AC = 0; only from outside
 *  both bowls, C < 0, where the grazing point o - (C / B) d is ahead and on the upper sheet), and
 *  infinity, where the visible root runs off along the asymptotic cone (A = 0; for upward rays whose
 *  finite root C / q is not the hit). Each by its first-order distance |g| / |grad g|; FAR_EDGE when
 *  neither applies. */
export function hyperboloidEdge(pic: HyperboloidPicture, u: Complex): number {
  const orbit = hbOrbit(pic);
  const { o, R, U, f } = orbit;
  const d = hbRay(orbit, u);
  const A = lq(d, d);
  const B = lq(o, d);
  const C = lq(o, o) - 1;
  const hit = hbHit(o, d) !== null;
  // d/du of A and B: e = f R, f U
  const dA: Complex = [2 * f * lq(d, R), 2 * f * lq(d, U)];
  const dB: Complex = [f * lq(o, R), f * lq(o, U)];
  let dist = FAR_EDGE;
  if (C < 0 && B !== 0) {
    // the grazing point's lambda, -B / A = -C / B on the curve: the second form, since C does not
    // change with u, still says which sheet the nearby curve grazes where A is near 0 (rays next
    // to the cone's lower half, whose graze runs off down the lower sheet)
    const l = -C / B;
    if (l > 0 && o[2] + l * d[2] > 0) {
      const disc = B * B - A * C;
      const g = Math.hypot(2 * B * dB[0] - C * dA[0], 2 * B * dB[1] - C * dA[1]);
      if (g > 0) dist = Math.min(dist, Math.abs(disc) / g);
    }
  }
  if (d[2] > 0) {
    const disc = B * B - A * C;
    const q = -(B + (B >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, disc)));
    const l = C / q;
    const finiteHit = disc >= 0 && q !== 0 && l > 0 && o[2] + l * d[2] > 0;
    const g = Math.hypot(dA[0], dA[1]);
    if (!finiteHit && g > 0) dist = Math.min(dist, Math.abs(A) / g);
  }
  return hit ? -dist : dist;
}

/** The light from the upper left behind the camera, in the camera's axes (right, up, back), and the
 *  part of the colour it cannot take away: settled on test renders, enough to model the bowl (lit
 *  on one side) without darkening the tiling's own colours much. */
export const HB_LIGHT: Vec3 = [-0.6, 0.6, 0.5];
export const HB_AMBIENT = 0.4;

/** The soft Lambert term at frame point x seen along the ray of u: HB_AMBIENT + (1 - HB_AMBIENT)
 *  max(0, n . L), n the Euclidean normal (-x, -y, t) turned toward the camera. */
export function hyperboloidShade(pic: HyperboloidPicture, u: Complex, x: Vec3): number {
  const orbit = hbOrbit(pic);
  const d = hbRay(orbit, u);
  const nl = Math.hypot(x[0], x[1], x[2]);
  let n: Vec3 = [-x[0] / nl, -x[1] / nl, x[2] / nl];
  if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0) n = [-n[0], -n[1], -n[2]];
  const { F, R, U } = orbit;
  const [a, b, c] = HB_LIGHT;
  const L: Vec3 = [a * R[0] + b * U[0] - c * F[0], a * R[1] + b * U[1] - c * F[1], a * R[2] + b * U[2] - c * F[2]];
  const ll = Math.hypot(L[0], L[1], L[2]);
  const dot = (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / ll;
  return HB_AMBIENT + (1 - HB_AMBIENT) * Math.max(0, dot);
}

/** The Euclidean distance-like gap between the camera and the surface, (Q(o, o) - 1) / |grad|, with
 *  grad = 2 (-x, -y, t): positive inside a bowl, negative outside; first order near the surface. */
export function hyperboloidGap(pic: HyperboloidPicture): number {
  const { o } = hbOrbit(pic);
  return (lq(o, o) - 1) / (2 * Math.hypot(o[0], o[1], o[2]));
}

/** Change the orbit distance by 1 / k (k > 1 brings the camera in), within the limits. */
export function zoomHyperboloid(pic: HyperboloidPicture, k: number): { pic: HyperboloidPicture; N: Mat3 } {
  return { pic: { ...pic, distance: Math.min(HB_MAX_DISTANCE, Math.max(HB_MIN_DISTANCE, pic.distance / k)) }, N: identity() };
}

// ----------------------------------------------------------------------------- every view alike

export type Model = "poincare" | "klein" | "halfplane" | "local" | "h3" | "hyperboloid" | "band";
export const MODELS: Model[] = ["poincare", "klein", "halfplane", "local", "h3", "hyperboloid", "band"];
/** The number key of each view. */
export const VIEW_KEYS: Record<Model, string> = { poincare: "1", klein: "2", halfplane: "3", local: "4", h3: "5", hyperboloid: "6", band: "7" };
/** Views whose map from the screen is conformal: a pixel covers the same plane length in every
 *  direction, so the grid's line widths follow from the plane alone (render/grid.ts gridRates). */
export const CONFORMAL: Record<Model, boolean> = { poincare: true, klein: false, halfplane: true, local: false, h3: false, hyperboloid: false, band: true };

export type Picture =
  | ({ model: "poincare" } & DiskPicture)
  | ({ model: "klein" } & DiskPicture)
  | ({ model: "halfplane" } & HalfPlanePicture)
  | ({ model: "local" } & LocalPicture)
  | ({ model: "h3" } & H3Picture)
  | ({ model: "hyperboloid" } & HyperboloidPicture)
  | ({ model: "band" } & BandPicture);

/** Home pictures: the whole disk with a margin, the half-plane with its boundary at the bottom edge
 *  (c = i, s = 1), the local view with the same centre scale as the Poincare home, the band 0.8 of
 *  the screen high. */
export const HOME: { [M in Model]: Extract<Picture, { model: M }> } = {
  poincare: { model: "poincare", ...HOME_PICTURE },
  klein: { model: "klein", ...HOME_PICTURE },
  halfplane: { model: "halfplane", mu: 2 },
  local: { model: "local", ell: 2 * HOME_PICTURE.s },
  h3: { model: "h3", ...H3_HOME },
  hyperboloid: { model: "hyperboloid", ...HB_HOME },
  band: { model: "band", y0: 0, s: Math.PI / 1.6 },
};

export function frameOf(pic: Picture, u: Complex): FramePoint | null {
  switch (pic.model) {
    case "poincare": return poincareFrame(pic, u);
    case "klein": return kleinFrame(pic, u);
    case "halfplane": return halfPlaneFrame(pic, u);
    case "local": return localFrame(pic, u);
    case "h3": return h3Frame(pic, u);
    case "hyperboloid": return hyperboloidFrame(pic, u);
    case "band": return bandFrame(pic, u);
  }
}

export function zoomPicture(pic: Picture, u0: Complex, k: number): { pic: Picture; N: Mat3 } {
  switch (pic.model) {
    case "poincare": { const z = zoomPoincare(pic, u0, k); return { pic: { ...z.pic, model: "poincare" }, N: z.N }; }
    case "klein": { const z = zoomKlein(pic, u0, k); return { pic: { ...z.pic, model: "klein" }, N: z.N }; }
    case "halfplane": { const z = zoomHalfPlane(pic, u0, k); return { pic: { ...z.pic, model: "halfplane" }, N: z.N }; }
    case "local": { const z = zoomLocal(pic, u0, k); return { pic: { ...z.pic, model: "local" }, N: z.N }; }
    case "h3": { const z = zoomH3(pic, k); return { pic: { ...z.pic, model: "h3" }, N: z.N }; }
    case "hyperboloid": { const z = zoomHyperboloid(pic, k); return { pic: { ...z.pic, model: "hyperboloid" }, N: z.N }; }
    case "band": { const z = zoomBand(pic, u0, k); return { pic: { ...z.pic, model: "band" }, N: z.N }; }
  }
}

/** The frame point's derivatives along u's x and y (the frame map's Jacobian, in closed form) in the
 *  views that are not conformal, Klein and local; null in the conformal ones, where a pixel's plane
 *  rates follow from its scale alone (render/grid.ts gridRates). x is frameOf(pic, u).x.
 *    Klein: x = h / n with h linear in u, so dx = (dh + x <x, dh>) / n.
 *    local: x = (sinh(d) e, cosh d) with d = ell |u|, e = u / |u|: along e the map stretches by
 *    ell cosh d, across it by ell sinh(d) / d. */
export function frameJacobian(pic: Picture, u: Complex, x: Vec3): [Vec3, Vec3] | null {
  switch (pic.model) {
    case "klein": {
      const lambda = pic.sigma / pic.s;
      const r = Math.sqrt(pic.sigma);
      const [c0, c1] = pic.c;
      const h = kleinH(pic.c, lambda, r, u);
      const n = Math.sqrt(h[2] * h[2] - h[0] * h[0] - h[1] * h[1]);
      const along = (d: Vec3): Vec3 => {
        const k = x[0] * d[0] + x[1] * d[1] - x[2] * d[2];
        return [(d[0] + x[0] * k) / n, (d[1] + x[1] * k) / n, (d[2] + x[2] * k) / n];
      };
      return [along([r + (c0 * c0) / (1 + r), (c1 * c0) / (1 + r), -c0]), along([(c0 * c1) / (1 + r), r + (c1 * c1) / (1 + r), -c1])];
    }
    case "local": {
      const len = Math.hypot(u[0], u[1]);
      const [e0, e1] = len > 0 ? [u[0] / len, u[1] / len] : [1, 0];
      const d = pic.ell * len;
      const ch = Math.cosh(d);
      const so = d > 0 ? Math.sinh(d) / d : 1;
      const sh = Math.sinh(d);
      const col = (k: 0 | 1): Vec3 => {
        const ek = k === 0 ? e0 : e1;
        return [pic.ell * (ch * e0 * ek + so * ((k === 0 ? 1 : 0) - e0 * ek)), pic.ell * (ch * e1 * ek + so * ((k === 1 ? 1 : 0) - e1 * ek)), pic.ell * sh * ek];
      };
      return [col(0), col(1)];
    }
    case "h3": {
      const { H } = h3H(pic, u);
      return h3Jacobian(pic, x, Math.sqrt(H[2] * H[2] - H[0] * H[0] - H[1] * H[1]));
    }
    case "hyperboloid": {
      const orbit = hbOrbit(pic);
      const d = hbRay(orbit, u);
      const hit = hbHit(orbit.o, d);
      return hit ? hbJacobian(orbit, d, hit.lambda, x) : null;
    }
    default:
      return null;
  }
}

/** Plane length per unit of u at the screen centre (the largest direction, for Klein). */
export function centreScale(pic: Picture): number {
  switch (pic.model) {
    case "poincare": return (2 * pic.s) / pic.sigma;
    case "klein": return pic.s / pic.sigma;
    case "halfplane": return 2 / pic.mu;
    case "local": return pic.ell;
    case "h3": return h3Frame(pic, [0, 0])?.scale ?? Infinity;
    case "hyperboloid": return hyperboloidFrame(pic, [0, 0])?.scale ?? Infinity;
    case "band": return pic.s / Math.cos(pic.y0);
  }
}

/** The plane length per unit of u that the unit grid chooses its levels for: the centre's, but
 *  inside H3, where the centre may look at the sky and the scale grows without bound toward the
 *  horizon, the least of the centre column's at its bottom edge and straight down (where that is
 *  on the screen; a wide view's pixels shrink toward its edges, so the bottom edge may be finer).
 *  That is within a few percent of the least on a 16:9 screen (tests/unit/camera-h3.test.ts), so
 *  the grid's finest level is fine enough for the nearest ground; Infinity when all is sky. */
export function referenceScale(pic: Picture): number {
  if (pic.model === "hyperboloid") {
    // the nearest surface may lie anywhere on the screen: the least over a few points across it
    let least = Infinity;
    for (const ux of [-1, -0.5, 0, 0.5, 1]) for (const uy of [-1, -0.5, 0, 0.5, 1]) least = Math.min(least, hyperboloidFrame(pic, [ux, uy])?.scale ?? Infinity);
    return least;
  }
  if (pic.model !== "h3") return centreScale(pic);
  const down = -Math.cos(pic.pitch) / (Math.tan(pic.fov / 2) * Math.sin(pic.pitch));
  const edge = h3Frame(pic, [0, -1])?.scale ?? Infinity;
  return down > -1 ? Math.min(edge, h3Frame(pic, [0, down])?.scale ?? Infinity) : edge;
}

/** The centred picture of a model (c = 0, c = i for the half-plane, y0 = 0 for the band) with the
 *  given centre scale; the plane inside H3 has its own home picture instead (camera.ts switchModel). */
export function centredPicture(model: Model, scale: number): Picture {
  switch (model) {
    case "poincare": return { model, c: [0, 0], sigma: 1, s: scale / 2 };
    case "klein": return { model, c: [0, 0], sigma: 1, s: scale };
    case "halfplane": return { model, mu: 2 / scale };
    case "local": return { model, ell: scale };
    case "h3": return HOME.h3;
    case "hyperboloid": return HOME.hyperboloid;
    case "band": return { model, y0: 0, s: scale };
  }
}

/** Signed distance from u to the edge of the picture in units of u, positive outside: the disk
 *  pictures use (|z|^2 - 1) / (2 s) = (2 Re(conj(c) u) - lambda + s |u|^2) / 2, which is the distance
 *  next to the rim (where it matters, for anti-aliasing the edge) and of order 1 at any depth; the
 *  half-plane its line Im u = -mu / 2; the band the nearer of its two edges; the local view has no
 *  edge. The shaders use the same formulas. */
export function edgeDistance(pic: Picture, u: Complex): number {
  switch (pic.model) {
    case "poincare": case "klein":
      return (2 * (pic.c[0] * u[0] + pic.c[1] * u[1]) - pic.sigma / pic.s + pic.s * cabs2(u)) / 2;
    case "halfplane": return -(pic.mu + 2 * u[1]) / 2;
    case "local": return -Infinity;
    case "h3": return h3Edge(pic, u);
    case "hyperboloid": return hyperboloidEdge(pic, u);
    case "band": {
      const [up, down] = bandGaps(pic.y0);
      return Math.max(u[1] - up / pic.s, -down / pic.s - u[1]);
    }
  }
}

/** float32 places a frame point x to about FLOAT32_SPREAD x_t^2 of the plane: the shader's fold
 *  starts from the world point, whose coordinates are of size x_t with a relative error near 2^-24,
 *  and the error grows with their square through the fold (65 is measured: the GPU against the
 *  reference, band at 1600 x 900). The other views show such points only far smaller than a pixel,
 *  where the tiles fade to their average anyway; the band shows them at full size along its
 *  geodesic. Its strips (render/strips.ts) keep x near the camera; past the last strip the picture
 *  fades into the tiles' average colour where this error grows from FADE_ERROR_PX[0] to
 *  FADE_ERROR_PX[1] pixels, instead of breaking up. */
export const FLOAT32_SPREAD = 65 * 2 ** -24;
export const FADE_ERROR_PX: [number, number] = [0.03, 0.1];

/** How far the picture at frame point x (lpx = plane length per pixel there) fades into the tiles'
 *  average: 0 everywhere but where the band, the plane inside H3 seen from high up or the
 *  hyperboloid toward infinity reaches past float32 (FLOAT32_SPREAD). */
export function precisionFade(pic: Picture, x: Vec3, lpx: number): number {
  if (pic.model !== "band" && pic.model !== "h3" && pic.model !== "hyperboloid") return 0;
  const e = (FLOAT32_SPREAD * x[2] * x[2]) / lpx;
  const t = Math.min(1, Math.max(0, (e - FADE_ERROR_PX[0]) / (FADE_ERROR_PX[1] - FADE_ERROR_PX[0])));
  return t * t * (3 - 2 * t);
}

/** The light on the picture at frame point x seen at u, multiplying the content's colour (and the
 *  grid's): 1 but on the hyperboloid, the one view that draws a surface in space (hyperboloidShade;
 *  the shaders' VIEW_SHADE hook). */
export function viewShade(pic: Picture, u: Complex, x: Vec3): number {
  return pic.model === "hyperboloid" ? hyperboloidShade(pic, u, x) : 1;
}

/** The four numbers the view's shader chunk reads from uView. */
export function viewUniform(pic: Picture): [number, number, number, number] {
  switch (pic.model) {
    case "poincare": return [pic.sigma / pic.s, pic.c[0], -pic.c[1], pic.s];
    case "klein": return [pic.sigma / pic.s, pic.c[0], pic.c[1], Math.sqrt(pic.sigma)];
    case "halfplane": return [pic.mu, 0, 0, 0];
    case "local": return [pic.ell, 0, 0, 0];
    case "h3": return [Math.sinh(pic.h), Math.cos(pic.pitch), Math.sin(pic.pitch), Math.tan(pic.fov / 2)];
    case "hyperboloid": return [pic.distance, Math.cos(pic.elevation), Math.sin(pic.elevation), Math.tan(pic.fov / 2)];
    case "band": return [Math.cos(pic.y0), Math.sin(pic.y0), pic.s, Math.atan2(Math.cos(pic.y0), Math.abs(Math.sin(pic.y0)))];
  }
}
