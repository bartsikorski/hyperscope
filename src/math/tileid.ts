// Exact tile identity (design notes, step 14): the triangle group acting on F_l^3, l a prime, so the
// shader can follow which tile a pixel lies in with integers and no rounding.
//
// The reflections are S_j v = v - (2B_j . v) e_j with 2B_ij = -2cos(pi / m_ij) (2 on the diagonal),
// m_12 = p, m_13 = q, m_23 = r, reduced mod l: the Coxeter group's geometric representation, which
// needs 2cos(pi / m) in F_l, so l = +-1 mod 2m for each m above 2. The vector w with 2B_1 . w =
// 2B_2 . w = 0 is fixed by S_1 and S_2, the stabiliser of P, so a tile (the polygon around P's image)
// has the identity A S_h w for the camera's matrix A and the fold word's h. The camera carries A
// (ViewState.tile) and re-centering multiplies it on the right along its word, like the colour
// permutation; any invertible A gives a valid labelling.
// Checked numerically before this was written (design-checks/check_tileid.py).
// Credits: the geometric representation of Coxeter groups (Tits; Humphreys, Reflection Groups and
// Coxeter Groups, 5.3); HyperRogue's field quotients (Zeno Rogue) name cells modulo a prime the same
// way. The hash's finaliser is prospector32 from Chris Wellons' hash prospector (Unlicense).

import type { TriangleGroup } from "./groups.ts";

export type TileMat = number[];

export interface TileIdentity {
  /** The prime. */
  l: number;
  /** -2B_j mod l: A S_j = A + (A e_j) d_j^T, row by row. */
  d: [number[], number[], number[]];
  /** Fixed by S_1 and S_2: the tile around P. */
  w: number[];
  /** S_3 w: the tile across side 3. */
  w3: number[];
  /** Fixed by the two reflections at P, Q and R (w_P is w): a Wythoff face around that corner. */
  corners: [number[], number[], number[]];
  /** 2B v = (1, 1, 1): fixed by no reflection, a snub triangle (an odd image of G). */
  vt: number[];
}

const mod = (a: number, l: number) => ((a % l) + l) % l;

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

/** a^e mod l (l below 2^13, so products stay exact). */
function powMod(a: number, e: number, l: number): number {
  let r = 1;
  a = mod(a, l);
  while (e > 0) {
    if (e & 1) r = (r * a) % l;
    a = (a * a) % l;
    e = Math.floor(e / 2);
  }
  return r;
}

function primeFactors(n: number): number[] {
  const out: number[] = [];
  for (let d = 2; d * d <= n; d++)
    if (n % d === 0) {
      out.push(d);
      while (n % d === 0) n /= d;
    }
  if (n > 1) out.push(n);
  return out;
}

/** The first prime above 4096 with l = +-1 mod 2m for every m of the group above 2 and 2B invertible
 *  mod l (in 36 groups up to 64 the first such prime makes it singular, (6, 16, 48) at 4127, and
 *  then the vector fixed by S_1 and S_2 is fixed by S_3 too: every tile would get one identity). */
export function tilePrime(p: number, q: number, r: number): number {
  const ms = [p, q, r].filter((m) => m > 2);
  for (let l = 4097; ; l++) if (isPrime(l) && ms.every((m) => (l - 1) % (2 * m) === 0 || (l + 1) % (2 * m) === 0) && det3(twoBOf(p, q, r, l), l) !== 0) return l;
}

/** 2B mod l: 2 on the diagonal, -2cos(pi / m_ij) off it. */
function twoBOf(p: number, q: number, r: number, l: number): number[][] {
  const m = [
    [1, p, q],
    [p, 1, r],
    [q, r, 1],
  ];
  return m.map((row, i) => row.map((v, j) => (i === j ? 2 : mod(-twoCos(v, l), l))));
}

/** The determinant mod l (each product below 2^26). */
function det3(a: number[][], l: number): number {
  const [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] = a;
  return mod(a0 * mod(b1 * c2 - b2 * c1, l) - a1 * mod(b0 * c2 - b2 * c0, l) + a2 * mod(b0 * c1 - b1 * c0, l), l);
}

/** The order of the 2 x 2 matrix [[t, -1], [1, 0]] mod l, up to cap (0 when above it). */
function order2(t: number, l: number, cap: number): number {
  let [a, b, c, d] = [1, 0, 0, 1];
  for (let n = 1; n <= cap; n++) {
    [a, b, c, d] = [mod(a * t + b, l), mod(-a, l), mod(c * t + d, l), mod(-c, l)];
    if (a === 1 && b === 0 && c === 0 && d === 1) return n;
  }
  return 0;
}

/** 2cos(pi k / m) in F_l for some k prime to 2m: z + 1/z for z of order 2m, z in F_l when l = 1 mod 2m
 *  (the smallest primitive root's power), else in F_l^2 (the smallest t whose companion matrix has
 *  order 2m). Any such root keeps the relations; this fixes the choice. */
export function twoCos(m: number, l: number): number {
  if (m === 2) return 0;
  if ((l - 1) % (2 * m) === 0) {
    const fs = primeFactors(l - 1);
    let g = 2;
    while (!fs.every((f) => powMod(g, (l - 1) / f, l) !== 1)) g++;
    const z = powMod(g, (l - 1) / (2 * m), l);
    return (z + powMod(z, l - 2, l)) % l;
  }
  for (let t = 0; t < l; t++) if (order2(t, l, 2 * m) === 2 * m) return t;
  throw new Error(`no 2cos(pi/${m}) mod ${l}`);
}

/** x with A x = b mod l (Gauss-Jordan; A invertible mod l, as 2B is for these primes). */
function solveMod(A: number[][], b: number[], l: number): number[] {
  const M = A.map((row, i) => [...row.map((v) => mod(v, l)), mod(b[i], l)]);
  for (let c = 0; c < 3; c++) {
    const piv = [c, c + 1, c + 2].find((r) => r < 3 && M[r][c] !== 0);
    if (piv === undefined) throw new Error(`2B is singular mod ${l}`);
    [M[c], M[piv]] = [M[piv], M[c]];
    const inv = powMod(M[c][c], l - 2, l);
    M[c] = M[c].map((v) => (v * inv) % l);
    for (let r = 0; r < 3; r++)
      if (r !== c && M[r][c] !== 0) {
        const f = M[r][c];
        M[r] = M[r].map((v, k) => mod(v - f * M[c][k], l));
      }
  }
  return M.map((row) => row[3]);
}

const cache = new Map<string, TileIdentity>();

export function tileIdentity(g: Pick<TriangleGroup, "p" | "q" | "r">): TileIdentity {
  const key = `${g.p},${g.q},${g.r}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const l = tilePrime(g.p, g.q, g.r);
  const twoB = twoBOf(g.p, g.q, g.r, l);
  const d = twoB.map((row) => row.map((v) => mod(-v, l))) as [number[], number[], number[]];
  const cross = (r1: number[], r2: number[]) => [mod(r1[1] * r2[2] - r1[2] * r2[1], l), mod(r1[2] * r2[0] - r1[0] * r2[2], l), mod(r1[0] * r2[1] - r1[1] * r2[0], l)];
  const w = cross(twoB[0], twoB[1]);
  const k3 = mod(twoB[2][0] * w[0] + twoB[2][1] * w[1] + twoB[2][2] * w[2], l);
  const w3 = [w[0], w[1], mod(w[2] - k3, l)];
  const t: TileIdentity = { l, d, w, w3, corners: [w, cross(twoB[0], twoB[2]), cross(twoB[1], twoB[2])], vt: solveMod(twoB, [1, 1, 1], l) };
  cache.set(key, t);
  return t;
}

export const identityTile = (): TileMat => [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A S_j: column j's entries times d_j added to each row (the shader's update, tiling.glsl). */
export function stepTile(a: TileMat, j: number, t: TileIdentity): TileMat {
  const out = a.slice();
  const dj = t.d[j];
  for (let r = 0; r < 3; r++) {
    const x = a[3 * r + j];
    for (let c = 0; c < 3; c++) out[3 * r + c] = (a[3 * r + c] + x * dj[c]) % t.l;
  }
  return out;
}

/** The camera's matrix carried along a word (re-centering), or the fold's. */
export function carryTile(a: TileMat, word: readonly number[], t: TileIdentity): TileMat {
  for (const j of word) a = stepTile(a, j, t);
  return a;
}

export function applyTile(a: TileMat, v: number[], l: number): number[] {
  return [0, 1, 2].map((r) => (a[3 * r] * v[0] + a[3 * r + 1] * v[1] + a[3 * r + 2] * v[2]) % l);
}

/** The identity of the folded point's tile and of the tile across side 3. */
export function tileOf(a: TileMat, word: readonly number[], t: TileIdentity): { id: number[]; across: number[] } {
  const m = carryTile(a, word, t);
  return { id: applyTile(m, t.w, t.l), across: applyTile(m, t.w3, t.l) };
}

/** A matrix the camera can carry for this group: entries below l and a determinant of +-1 mod l
 *  (every product of reflections has one, and any such matrix gives a valid labelling). */
export function fitsTile(a: unknown, t: TileIdentity): a is TileMat {
  if (!Array.isArray(a) || a.length !== 9 || !a.every((v) => Number.isInteger(v) && v >= 0 && v < t.l)) return false;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = a as number[];
  const l = t.l;
  // cofactor expansion, each product below 2^26
  const det = mod(m0 * mod(m4 * m8 - m5 * m7, l) - m1 * mod(m3 * m8 - m5 * m6, l) + m2 * mod(m3 * m7 - m4 * m6, l), l);
  return det === 1 || det === l - 1;
}

export const isIdentityTile = (a: TileMat) => a.every((v, i) => v === (i % 4 === 0 ? 1 : 0));

/** The hash of an identity, a uint32 (tiling.glsl mosaicHash, bit for bit). */
export function mosaicHash(v: readonly number[]): number {
  let h = (Math.imul(v[0], 0x8da6b343) ^ Math.imul(v[1], 0xd8163841) ^ Math.imul(v[2], 0xcb1ab31f)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
}

/** The hash of a Wythoff face's identity v of kind k (0, 1, 2 around P, Q, R; 3 a snub triangle):
 *  (v1, v2, v3 + k l), so kinds never share and the faces around P hash as step 14's tiles. */
export const faceHash = (v: readonly number[], kind: number, l: number) => mosaicHash([v[0], v[1], v[2] + kind * l]);

/** The hash as a position in [0, 1), 24 bits as a float32 holds them exactly. */
export const mosaicT = (v: readonly number[]) => (mosaicHash(v) >>> 8) / 16777216;
