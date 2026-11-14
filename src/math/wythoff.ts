// Wythoff tilings (design notes, step 15): vertices at the images of a generator point G of the
// triangle, edges from G to its mirror images across the active mirrors, faces around the corners
// P, Q, R and, in the snub, triangles. Each tiling is drawn from small tables over a domain the pixel
// is folded into: the triangle T for the tilings every mirror keeps, the kite T u s1 T (the rotations'
// domain) for the snub. Per pixel (wythoffAt): the signs of <y, m_e> over the listed edge lines pick
// the face, the least distance to the face's own lines is the distance to the nearest edge, and the
// line's other face is the one across it.
// Checked numerically before this was written (design-checks/check_wythoff.py, check_wythoff_faces.py).
// Origin: Wythoff's construction and the snub (W. A. Wythoff 1918; H. S. M. Coxeter, Regular Polytopes),
// drawn per pixel as in Matt Zucker's and Roice Nelson's GPU tilings. See CREDITS.md.

import type { TriangleGroup } from "./groups.ts";
import { lorentzCross } from "./groups.ts";
import type { Vec3 } from "./lorentz.ts";
import { apply, dist, mink, normalizePoint, normalizeSpacelike, reflection, reflectPoint } from "./lorentz.ts";
import type { TileMat } from "./tileid.ts";
import { applyTile, carryTile, identityTile, stepTile, tileIdentity } from "./tileid.ts";

/** "lines" is version 1's tiling; the others name the active mirrors (sides 1, 2, 3) as the ringed
 *  nodes of the Coxeter diagram, then the snub and a free point. */
export const CONSTRUCTIONS = ["lines", "010", "001", "100", "110", "101", "011", "111", "snub", "free"] as const;
export type Construction = (typeof CONSTRUCTIONS)[number];
export type Weights = [number, number, number];

/** Table sizes in the shader's Frame block. */
export const MAX_WY_LINES = 16;
export const MAX_WY_FACES = 16;

/** Face kinds: around P, Q, R, and the snub's triangles. */
export const KINDS = 4;

export interface WyFace {
  /** 0, 1, 2 around P, Q, R; 3 a snub triangle. */
  kind: number;
  /** Bit e: line e bounds the face near the domain (0 for a face that is only across a line). */
  mask: number;
  /** Bit e: the face lies where <y, m_e> > 0. */
  want: number;
  /** The element carrying the face of its kind at the domain's own corner (or, for a snub triangle,
   *  the triangle around s1 G... below) to this one, as a reflection word. */
  word: number[];
  /** Its centre, in the domain's coordinates. */
  centre: Vec3;
  /** Mosaic: its vector mod l (math/tileid.ts), S_word times the kind's own vector. */
  id: number[];
}

export interface Wythoff {
  construction: Exclude<Construction, "lines">;
  /** The weights G was built from (the snub's solved). */
  weights: Weights;
  G: Vec3;
  /** The domain: the kite (the snub) or the triangle. */
  kite: boolean;
  /** Unit normals of the listed edge lines. */
  lines: Vec3[];
  /** Per line, its two faces (indices into faces). */
  sides: [number, number][];
  /** Faces [0, matching) meet the domain and carry masks; the rest lie across a masked line. */
  faces: WyFace[];
  matching: number;
  /** Per kind, its colour index among the kinds that exist (-1 when it does not). */
  colourOf: number[];
  /** How many kinds exist. */
  kinds: number;
  /** Edge length per area in the line share's convention (reference.ts shadingOf: the strip of
   *  width w around a length L inside the domain covers w L / 2 per side). */
  lengthPerArea: number;
}

const CORNER_MIRRORS: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
];
const MIRROR_CORNERS: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
];

const orders = (g: TriangleGroup) => [g.p, g.q, g.r];
const cornerPoints = (g: TriangleGroup): Vec3[] => [g.corners.P, g.corners.Q, g.corners.R];

/** The active mirrors of a construction (snub: all three). */
export function activeOf(c: Exclude<Construction, "lines" | "free" | "snub">): Weights {
  return [0, 1, 2].map((j) => (c[j] === "1" ? 1 : 0)) as Weights;
}

/** G from three weights w_j >= 0: -(w1 m1 + w2 m2 + w3 m3) normalised, m the dual basis of the mirror
 *  normals (<m_i, n_j> = delta_ij), so <G, n_j> is -w_j times one factor. */
export function generatorOf(g: TriangleGroup, w: Weights): Vec3 {
  const n = g.normals;
  // the Gram matrix and its inverse; m_i = sum_j (Gram^-1)_ij n_j
  const gram = n.map((a) => n.map((b) => mink(a, b)));
  const inv = invert3(gram);
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((c) => inv[i][0] * n[0][c] + inv[i][1] * n[1][c] + inv[i][2] * n[2][c]));
  const x: Vec3 = [0, 1, 2].map((c) => -(w[0] * m[0][c] + w[1] * m[1][c] + w[2] * m[2][c])) as Vec3;
  return normalizePoint(x);
}

function invert3(a: number[][]): number[][] {
  const [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] = a;
  const d = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  return [
    [(b1 * c2 - b2 * c1) / d, (a2 * c1 - a1 * c2) / d, (a1 * b2 - a2 * b1) / d],
    [(b2 * c0 - b0 * c2) / d, (a0 * c2 - a2 * c0) / d, (a2 * b0 - a0 * b2) / d],
    [(b0 * c1 - b1 * c0) / d, (a1 * c0 - a0 * c1) / d, (a0 * b1 - a1 * b0) / d],
  ];
}

/** G's images under the rotations about P, Q, R (s1 s2, s1 s3, s2 s3), reflected point by point:
 *  the rotations' matrices about far corners lose digits that the points keep. */
function rotatedG(g: TriangleGroup, G: Vec3): Vec3[] {
  return CORNER_MIRRORS.map(([a, b]) => reflectPoint(reflectPoint(G, g.normals[b]), g.normals[a]));
}

/** The snub's weights (u, v, 1): G's three edges, to its images under the rotations about P, Q
 *  and R, equally long (Newton in float64 with a difference Jacobian, as check_wythoff.py). */
export function snubWeights(g: TriangleGroup): Weights {
  const f = (v: number[]): number[] => {
    const G = generatorOf(g, [Math.abs(v[0]), Math.abs(v[1]), 1]);
    const L = rotatedG(g, G).map((x) => dist(G, x));
    return [L[0] - L[1], L[1] - L[2]];
  };
  let x = [1, 1];
  for (let it = 0; it < 60; it++) {
    const F = f(x);
    if (Math.max(Math.abs(F[0]), Math.abs(F[1])) < 1e-15) break;
    const h = 1e-7;
    const J = [0, 1].map((k) => {
      const xk = [...x];
      xk[k] += h;
      const Fk = f(xk);
      return [(Fk[0] - F[0]) / h, (Fk[1] - F[1]) / h];
    });
    // J[k] is column k
    const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
    const dx = [(J[1][1] * F[0] - J[1][0] * F[1]) / det, (-J[0][1] * F[0] + J[0][0] * F[1]) / det];
    x = [x[0] - dx[0], x[1] - dx[1]];
  }
  return [Math.abs(x[0]), Math.abs(x[1]), 1];
}

/** The face around a corner (its two mirrors, angle pi/m) exists unless G is the corner or the
 *  angle is pi/2 with G on one of the two mirrors (a face of two vertices, an edge). */
function faceExists(X: number, active: boolean[], m: number): boolean {
  const [j, k] = CORNER_MIRRORS[X];
  const n = (active[j] ? 1 : 0) + (active[k] ? 1 : 0);
  return n === 2 || (n === 1 && m >= 3);
}

const cache = new Map<string, Wythoff>();

/** The tables of a Wythoff construction (cached). Weights are needed for "free" only. */
export function wythoff(g: TriangleGroup, construction: Exclude<Construction, "lines">, weights?: Weights): Wythoff {
  const key = `${g.p},${g.q},${g.r}|${construction}|${construction === "free" ? weights!.join(",") : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let t: Wythoff;
  if (construction === "snub") t = snubTables(g);
  else {
    const w = construction === "free" ? weights! : activeOf(construction);
    if (!w || w.length !== 3 || !w.every((v) => Number.isFinite(v) && v >= 0) || !w.some((v) => v > 0)) throw new Error("a free point needs three weights of at least 0, not all 0");
    t = triangleTables(g, construction, w);
  }
  if (t.lines.length > MAX_WY_LINES || t.faces.length > MAX_WY_FACES) throw new Error(`(${g.p},${g.q},${g.r}) ${construction}: ${t.lines.length} lines and ${t.faces.length} faces, more than the shader holds`);
  cache.set(key, t);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return t;
}

function colourIndices(exists: boolean[]): { colourOf: number[]; kinds: number } {
  let n = 0;
  const colourOf = exists.map((e) => (e ? n++ : -1));
  return { colourOf, kinds: n };
}

function withIds(g: TriangleGroup, faces: Omit<WyFace, "id">[]): WyFace[] {
  const ids = tileIdentity(g);
  const own = [...ids.corners, ids.vt];
  return faces.map((f) => ({ ...f, id: applyTile(carryTile(identityTile(), f.word, ids), own[f.kind], ids.l) }));
}

// ----------------------------------------------------------------------------- the triangle

function triangleTables(g: TriangleGroup, construction: Exclude<Construction, "lines" | "snub">, w: Weights): Wythoff {
  const active = w.map((v) => v > 0);
  const G = generatorOf(g, w);
  const m = orders(g);
  const C = cornerPoints(g);
  const R = g.normals.map(reflection);
  // the line through G perpendicular to each active mirror a
  const lineOf: number[] = [-1, -1, -1];
  const lines: Vec3[] = [];
  for (let a = 0; a < 3; a++)
    if (active[a]) {
      lineOf[a] = lines.length;
      lines.push(normalizeSpacelike(lorentzCross(G, g.normals[a])));
    }
  const exists = [0, 1, 2].map((X) => faceExists(X, active, m[X]));
  const faces: Omit<WyFace, "id">[] = [];
  const faceOf: number[] = [-1, -1, -1];
  for (let X = 0; X < 3; X++) {
    if (!exists[X]) continue;
    let mask = 0;
    let want = 0;
    for (const a of CORNER_MIRRORS[X])
      if (active[a]) {
        mask |= 1 << lineOf[a];
        if (mink(C[X], lines[lineOf[a]]) > 0) want |= 1 << lineOf[a];
      }
    faceOf[X] = faces.length;
    faces.push({ kind: X, mask, want, word: [], centre: C[X] });
  }
  const matching = faces.length;
  // each line's two faces: the corners on its mirror, or across the mirror b that the line is when
  // the other corner's face is an edge
  const sides: [number, number][] = [];
  for (let a = 0; a < 3; a++) {
    if (!active[a]) continue;
    const [X1, X2] = MIRROR_CORNERS[a];
    if (exists[X1] && exists[X2]) sides.push([faceOf[X1], faceOf[X2]]);
    else {
      const [X, gone] = exists[X1] ? [X1, X2] : [X2, X1];
      const b = CORNER_MIRRORS[gone].find((c) => c !== a)!;
      sides.push([faceOf[X], faces.length]);
      faces.push({ kind: X, mask: 0, want: 0, word: [b], centre: apply(R[b], C[X]) });
    }
  }
  // edge length per area: a half-edge from G to the foot on mirror a counts twice, or once along a side
  let length = 0;
  for (let a = 0; a < 3; a++) {
    if (!active[a]) continue;
    const mid = normalizePoint([G[0] + apply(R[a], G)[0], G[1] + apply(R[a], G)[1], G[2] + apply(R[a], G)[2]]);
    const h = dist(G, mid);
    const alongSide = [0, 1, 2].some((b) => b !== a && Math.abs(mink(G, g.normals[b])) < 1e-12 && Math.abs(mink(mid, g.normals[b])) < 1e-12);
    length += alongSide ? h : 2 * h;
  }
  const area = Math.PI * (1 - 1 / g.p - 1 / g.q - 1 / g.r);
  return { construction, weights: [...w], G, kite: false, lines, sides, faces: withIds(g, faces), matching, ...colourIndices([...exists, false]), lengthPerArea: length / area };
}

// ----------------------------------------------------------------------------- the kite (snub)

/** Do two convex polygons share interior points? Separating lines: the polygons are apart (or only
 *  touch) when one's edge line has the other on its far side or on it. In Minkowski products rather
 *  than Klein coordinates, which lose their digits far out. */
function convexMeet(A: Vec3[], B: Vec3[]): boolean {
  for (const [P, Q] of [
    [A, B],
    [B, A],
  ]) {
    // a point inside P (the kite's corner Q is no corner when q = 2, so not a vertex's side)
    const inside = normalizePoint(P.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]] as Vec3, [0, 0, 0] as Vec3));
    for (let i = 0; i < P.length; i++) {
      const n = lorentzCross(P[i], P[(i + 1) % P.length]);
      const nn = Math.hypot(n[0], n[1], n[2]);
      const own = Math.sign(mink(inside, n));
      if (Q.every((v) => own * mink(v, n) <= 1e-12 * nn * Math.hypot(v[0], v[1], v[2]))) return false;
    }
  }
  return true;
}

interface SnubFace {
  kind: number;
  centre: Vec3;
  /** Its vertices in order around it, and their keys (the rotation carrying G there, mod l). */
  verts: Vec3[];
  keys: string[];
  word: number[];
  key: string;
  meets: boolean;
}

/** The snub's tables over the kite: a walk over the vertices rho G (rho a rotation) from G, each with
 *  its faces (rho times the faces around P, Q, R with at least 3 sides, and the triangles rho Delta_j,
 *  Delta_j = (G, s_j s_i G, s_j s_k G)), going on from a vertex while one of its faces meets the kite.
 *  Vertices and faces are named exactly, by the rotation mod l (math/tileid.ts) and by the face's
 *  identity, so a point reached along two words is never taken for two. */
function snubTables(g: TriangleGroup): Wythoff {
  const weights = snubWeights(g);
  const G = generatorOf(g, weights);
  const m = orders(g);
  const C = cornerPoints(g);
  const R = g.normals.map(reflection);
  const kite: Vec3[] = [C[0], C[2], C[1], apply(R[0], C[2])];
  const ids = tileIdentity(g);
  const own = [...ids.corners, ids.vt];
  const tkey = (A: TileMat) => A.join(",");
  const vkey = (kind: number, v: number[]) => `${kind}:${v.join(",")}`;
  // rotation steps: about corner X by +-2 pi / m (words [a, b] and [b, a])
  const steps: number[][] = CORNER_MIRRORS.flatMap(([a, b]) => [
    [a, b],
    [b, a],
  ]);
  // a point's image under a word, reflection by reflection: the points met on the way stay near the
  // walk, where a word's matrix can carry the origin far off and lose every digit
  const img = (word: number[], v: Vec3): Vec3 => {
    let x = v;
    for (let i = word.length - 1; i >= 0; i--) x = reflectPoint(x, g.normals[word[i]]);
    return x;
  };
  // the faces at G: its polygons' vertices in turn (G rotated about the corner) and its triangles'
  const around = [0, 1, 2].map((X) => {
    const [a, b] = CORNER_MIRRORS[X];
    const vs: Vec3[] = [G];
    for (let k = 1; k < m[X]; k++) vs.push(reflectPoint(reflectPoint(vs[k - 1], g.normals[b]), g.normals[a]));
    return vs;
  });
  const faces = new Map<string, SnubFace>();
  const facesAt = (A: TileMat, word: number[]): SnubFace[] => {
    const here: SnubFace[] = [];
    const add = (kind: number, id: number[], make: () => Omit<SnubFace, "key" | "meets" | "kind">) => {
      const key = vkey(kind, id);
      let f = faces.get(key);
      if (!f) {
        const made = make();
        f = { kind, key, ...made, meets: convexMeet(made.verts, kite) };
        faces.set(key, f);
      }
      here.push(f);
    };
    for (let X = 0; X < 3; X++) {
      if (m[X] < 3) continue;
      const [a, b] = CORNER_MIRRORS[X];
      add(X, applyTile(A, own[X], ids.l), () => {
        const keys: string[] = [];
        let B = A;
        for (let k = 0; k < m[X]; k++) {
          keys.push(tkey(B));
          B = stepTile(stepTile(B, a, ids), b, ids);
        }
        return { centre: img(word, C[X]), verts: around[X].map((v) => img(word, v)), keys, word };
      });
    }
    for (let j = 0; j < 3; j++) {
      const Aj = stepTile(A, j, ids);
      add(3, applyTile(Aj, own[3], ids.l), () => {
        const others = [0, 1, 2].filter((i) => i !== j);
        const verts = [img(word, G), ...others.map((i) => img([...word, j, i], G))];
        const c = normalizePoint([verts[0][0] + verts[1][0] + verts[2][0], verts[0][1] + verts[1][1] + verts[2][1], verts[0][2] + verts[1][2] + verts[2][2]]);
        return { centre: c, verts, keys: [tkey(A), ...others.map((i) => tkey(stepTile(Aj, i, ids)))], word: [...word, j] };
      });
    }
    return here;
  };
  const seen = new Set<string>([tkey(identityTile())]);
  const queue: { word: number[]; A: TileMat }[] = [{ word: [], A: identityTile() }];
  for (let qi = 0; qi < queue.length; qi++) {
    const { word, A } = queue[qi];
    if (!facesAt(A, word).some((f) => f.meets)) continue;
    for (const [a, b] of steps) {
      const A2 = stepTile(stepTile(A, a, ids), b, ids);
      const k = tkey(A2);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ word: [...word, a, b], A: A2 });
    }
    if (queue.length > 20000) throw new Error("the snub's walk did not close");
  }
  // edge -> the faces that have it
  const ekey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const byEdge = new Map<string, SnubFace[]>();
  for (const f of faces.values())
    f.keys.forEach((a, i) => {
      const k = ekey(a, f.keys[(i + 1) % f.keys.length]);
      byEdge.set(k, [...(byEdge.get(k) ?? []), f]);
    });
  const meeting = [...faces.values()].filter((f) => f.meets).sort((a, b) => a.kind - b.kind || a.word.length - b.word.length || (a.key < b.key ? -1 : 1));
  const out: Omit<WyFace, "id">[] = meeting.map((f) => ({ kind: f.kind, mask: 0, want: 0, word: f.word, centre: f.centre }));
  const index = new Map(meeting.map((f, i) => [f.key, i]));
  const lines: Vec3[] = [];
  const sides: [number, number][] = [];
  const lineIndex = new Map<string, number>();
  const cutsKite = (n: Vec3) => {
    const v = kite.map((x) => mink(x, n));
    return Math.min(...v) < -1e-12 && Math.max(...v) > 1e-12;
  };
  meeting.forEach((f, fi) => {
    f.verts.forEach((a, i) => {
      const b = f.verts[(i + 1) % f.verts.length];
      const n = normalizeSpacelike(lorentzCross(a, b));
      if (!cutsKite(n) && !convexMeet([f.centre, a, b], kite)) return;
      const k = ekey(f.keys[i], f.keys[(i + 1) % f.keys.length]);
      let e = lineIndex.get(k);
      if (e === undefined) {
        const others = byEdge.get(k)!.filter((h) => h.key !== f.key);
        if (others.length !== 1) throw new Error(`a snub edge with ${others.length + 1} faces`);
        const other = others[0];
        let oi = index.get(other.key);
        if (oi === undefined) {
          oi = out.length;
          index.set(other.key, oi);
          out.push({ kind: other.kind, mask: 0, want: 0, word: other.word, centre: other.centre });
        }
        e = lines.length;
        lineIndex.set(k, e);
        lines.push(n);
        sides.push([fi, oi]);
      }
      out[fi].mask |= 1 << e;
      if (mink(f.centre, lines[e]) > 0) out[fi].want |= 1 << e;
    });
  });
  const exists = [m[0] >= 3, m[1] >= 3, m[2] >= 3, true];
  const deg = m.reduce((s, mx) => s + (mx === 2 ? 1 : 2), 0);
  const L = dist(G, rotatedG(g, G)[0]);
  const area = Math.PI * (1 - 1 / g.p - 1 / g.q - 1 / g.r);
  // deg / 2 edges of length L per kite (area 2 T), each counted twice in the line share's convention
  return { construction: "snub", weights, G, kite: true, lines, sides, faces: withIds(g, out), matching: meeting.length, ...colourIndices(exists), lengthPerArea: (deg * L) / (2 * area) };
}

// ----------------------------------------------------------------------------- per pixel

export interface WyHit {
  /** The face (index into faces) and the line across which its nearest edge lies (-1: none near). */
  face: number;
  line: number;
  /** Distance to the nearest edge. */
  de: number;
}

/** The face holding y (in the domain), its distance to the nearest edge and that edge's line: the
 *  shader's rule (tiling.glsl), in float64. */
export function wythoffAt(t: Wythoff, y: Vec3): WyHit {
  let bits = 0;
  for (let e = 0; e < t.lines.length; e++) if (mink(y, t.lines[e]) > 0) bits |= 1 << e;
  let face = -1;
  for (let f = 0; f < t.matching; f++)
    if (((bits ^ t.faces[f].want) & t.faces[f].mask) === 0) {
      face = f;
      break;
    }
  if (face < 0) {
    // rounding where several lines meet: the face with fewest lines on the wrong side
    let best = Infinity;
    for (let f = 0; f < t.matching; f++) {
      let n = 0;
      for (let x = (bits ^ t.faces[f].want) & t.faces[f].mask; x; x &= x - 1) n++;
      if (n < best) [best, face] = [n, f];
    }
  }
  let de = Infinity;
  let line = -1;
  const mask = t.faces[face].mask;
  for (let e = 0; e < t.lines.length; e++)
    if (mask & (1 << e)) {
      const d = Math.asinh(Math.abs(mink(y, t.lines[e])));
      if (d < de) [de, line] = [d, e];
    }
  return { face, line, de };
}

/** The face across line e from face f. */
export const faceAcross = (t: Wythoff, f: number, e: number): number => (t.sides[e][0] === f ? t.sides[e][1] : t.sides[e][0]);

/** The Wythoff symbol of a construction for (p, q, r): G at a corner "m | others", on a side "a b | c",
 *  inside "p q r |", the snub "| p q r". */
export function wythoffSymbol(g: Pick<TriangleGroup, "p" | "q" | "r">, c: Exclude<Construction, "lines" | "free">): string {
  const m = [g.p, g.q, g.r];
  if (c === "snub") return `| ${m.join(" ")}`;
  const on = [0, 1, 2].filter((j) => c[j] === "1");
  if (on.length === 3) return `${m.join(" ")} |`;
  if (on.length === 1) {
    // G at the corner opposite the active mirror: mirror 1 (side 2) is opposite Q, and so on
    const X = [2, 1, 0][on[0]];
    return `${m[X]} | ${m.filter((_, i) => i !== X).join(" ")}`;
  }
  // G on the inactive mirror: its two corners, then the third
  const k = [0, 1, 2].find((j) => !on.includes(j))!;
  const [X1, X2] = MIRROR_CORNERS[k];
  const X3 = 3 - X1 - X2;
  return `${m[X1]} ${m[X2]} | ${m[X3]}`;
}
