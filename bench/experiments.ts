// The equivalent formulas of the design's benchmark list (design notes, step 10 plan), each written
// as text patches over the production chunks. A patch must match exactly once, so an experiment
// fails loudly when the code under it changes instead of measuring something else. Two won their
// A/B and are now the production code (design notes, step 10): the grid's rates from the frame map's
// Jacobian, whose experiment is gone, and the grid drawn once in the display pass, which bench/ab.ts
// still times against the grid in every sample (the way moving frames draw it).

import { SOURCES } from "../src/content/looks.ts";
import { motifSpecOf, type MotifRef } from "../src/content/motifs.ts";
import { compileMotif } from "../src/math/motifs.ts";
import type { Wythoff } from "../src/math/wythoff.ts";
import type { Experiment } from "../src/render/gl.ts";
import type { Scene } from "./scenes.ts";

/** An experiment of the A/B runs: a rewrite of the chunks, or B's own scene (the same picture by
 *  other data), or both. */
export interface BenchExperiment extends Experiment {
  /** The scene B draws, when B differs by its data, not its code. */
  sceneB?(s: Scene): Scene;
}

/** Replace each `old` (which must occur exactly once) by its `new`. */
function patch(label: string, src: string, pairs: [string, string][]): string {
  for (const [old, next] of pairs) {
    const n = src.split(old).length - 1;
    if (n !== 1) throw new Error(`${label}: expected one match, found ${n}, of:\n${old}`);
    src = src.replace(old, () => next);
  }
  return src;
}

/** Replace the text from `start` through `end` (each once) by `next`. */
function between(label: string, src: string, start: string, end: string, next: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end);
  if (a < 0 || b < a || src.indexOf(start, a + 1) >= 0 || src.indexOf(end, b + 1) >= 0) throw new Error(`${label}: markers not found once:\n${start}\n${end}`);
  return src.slice(0, a) + next + src.slice(b + end.length);
}

const FOLD_START = "  // groups.ts fold: sweeps over sides 1, 2, 3 until nothing moves, at most MAX_SWEEPS";
const FOLD_END = "  if (moved) return target; // hit the sweep cap: treated as far away";

/** Fold: the dihedral step at P (the wedge between sides 1 and 2, angle pi/p, has P at the origin),
 *  then one test of side 3, repeated. The inside source only: it needs nothing but the point. */
const foldDihedral: Experiment = {
  name: "fold-dihedral",
  rewrite(chunk, src, _view, _content, variant) {
    if (chunk !== "content/tiling.glsl") return src;
    if (SOURCES[variant.source] !== "inside" || variant.relief) throw new Error("fold-dihedral draws the inside source without relief only");
    return between("fold-dihedral", src, FOLD_START, FOLD_END, `  // the dihedral step: turn x by its angle into the wedge 0 <= angle <= pi/p at P, then side 3
  vec3 x = uCamera * xf;
  float t = atan(-uNormals[1].x, uNormals[1].y);
  bool settled = false;
  for (int it = 0; it < MAX_SWEEPS; it++) {
    float a = atan(x.y, x.x);
    a -= 2.0 * t * floor(a / (2.0 * t));
    if (a > t) {
      a = 2.0 * t - a;
#if WYTHOFF == 2 || MOTIF || TILEIMAGE == 2
      odd = !odd; // the mirror across side 2; the turns by 2t are even
#endif
    }
    // rebuilt from its radius and angle, then put back on the hyperboloid (float32 rounding of the
    // angle otherwise moves far points off it)
    x.xy = length(x.xy) * vec2(cos(a), sin(a));
    x.z = sqrt(1.0 + dot(x.xy, x.xy));
    vec3 n = uNormals[2].xyz;
    float d = mink(x, n);
    if (d <= 0.0) {
      settled = true;
      break;
    }
    x -= 2.0 * d * n;
#if WYTHOFF == 2 || MOTIF || TILEIMAGE == 2
    odd = !odd;
#endif
  }
  if (!settled) return target;`);
  },
};

/** Reflection without a branch: every side moves the point by max(d, 0), and the colour
 *  permutation is composed every time and selected. */
const reflectBranchless: Experiment = {
  name: "reflect-branchless",
  rewrite(chunk, src) {
    if (chunk !== "content/tiling.glsl") return src;
    return patch("reflect-branchless", src, [
      [
        `      if (d > 0.0) {
        x -= 2.0 * d * n;
#if WYTHOFF == 2 || MOTIF || TILEIMAGE == 2
        odd = !odd;
#endif
#if SOURCE == 0 && WYTHOFF == 0 && CHIRAL
        // colourings.ts carry: the word read in pairs, each a rotation
        if (pend < 0) pend = j;
        else {
          if (pend != j) perm = composePerm(perm, pairPerm(pend, j));
          pend = -1;
        }
#elif SOURCE == 0 && WYTHOFF == 0
        perm = composePerm(perm, uPerm[j + 1]);
#elif SOURCE == 4
        a0 = tileStep(a0, j);
        a1 = tileStep(a1, j);
        a2 = tileStep(a2, j);
#elif SOURCE == 2
        // reference.ts depthAt: walls through the start's centre do not count
        float ds = mink(s, n);
        if (abs(ds) > uLight.z) {
          crossed += 1.0;
          if (ds > 0.0) shared += 1.0;
        }
        s -= 2.0 * ds * n;
#endif
#if RELIEF
        t1 -= 2.0 * mink(t1, n) * n;
        t2 -= 2.0 * mink(t2, n) * n;
#endif
        moved = true;
      }`,
        `      bool on = d > 0.0;
      float k = on ? 1.0 : 0.0;
      x -= 2.0 * k * d * n;
#if WYTHOFF == 2 || MOTIF || TILEIMAGE == 2
      odd = odd != on;
#endif
#if SOURCE == 0 && WYTHOFF == 0 && CHIRAL
      // a pair is completed (or started) only by a reflection, so this one stays a branch
      if (on) {
        if (pend < 0) pend = j;
        else {
          if (pend != j) perm = composePerm(perm, pairPerm(pend, j));
          pend = -1;
        }
      }
#elif SOURCE == 0 && WYTHOFF == 0
      uint next = composePerm(perm, uPerm[j + 1]);
      perm = on ? next : perm;
#elif SOURCE == 4
      uvec3 b0 = tileStep(a0, j);
      uvec3 b1 = tileStep(a1, j);
      uvec3 b2 = tileStep(a2, j);
      a0 = on ? b0 : a0;
      a1 = on ? b1 : a1;
      a2 = on ? b2 : a2;
#elif SOURCE == 2
      float ds = mink(s, n);
      float wall = k * step(uLight.z, abs(ds));
      crossed += wall;
      shared += wall * step(0.0, ds);
      s -= 2.0 * k * ds * n;
#endif
#if RELIEF
      t1 -= 2.0 * k * mink(t1, n) * n;
      t2 -= 2.0 * k * mink(t2, n) * n;
#endif
      moved = moved || on;`,
      ],
    ]);
  },
};

/** Geometry: the fold on the Poincare disk point pw, each side a circle inversion (centre n.xy / n.z,
 *  radius 1 / n.z; a line through the origin when n.z is 0), back to the hyperboloid once for the
 *  distances. The side test is <x, n> times 1 - |w|^2 > 0. */
const geometryComplex: Experiment = {
  name: "geometry-complex",
  rewrite(chunk, src) {
    if (chunk !== "content/tiling.glsl") return src;
    return patch("geometry-complex", src, [
      ["  vec3 x = uCamera * xf;\n  bool moved = true;", "  vec3 x = uCamera * xf;\n  vec2 pw = x.xy / (1.0 + x.z);\n  bool moved = true;"],
      ["      float d = mink(x, n);", "      float d = 2.0 * dot(pw, n.xy) - n.z * (1.0 + dot(pw, pw));"],
      [
        "        x -= 2.0 * d * n;",
        `        if (n.z == 0.0) {
          pw -= 2.0 * dot(pw, n.xy) * n.xy;
        } else {
          vec2 c = n.xy / n.z;
          vec2 v = pw - c;
          pw = c + v / (n.z * n.z * dot(v, v));
        }`,
      ],
      [FOLD_END, `${FOLD_END}\n  x = fromPoincare(pw);`],
    ]);
  },
};

/** Footprint: the plane length per pixel from the screen derivatives of the frame point instead of
 *  the frame map's own scale. */
const footprintDerivatives: Experiment = {
  name: "footprint-derivatives",
  rewrite(chunk, src) {
    if (chunk !== "main.frag") return src;
    return patch("footprint-derivatives", src, [
      [
        "  float lpx = scale * uScreen.z;",
        `  vec3 dx = dFdx(x);
  vec3 dy = dFdy(x);
  float lpx = sqrt(max(0.0, max(mink(dx, dx), mink(dy, dy))));`,
      ],
    ]);
  },
};

/** Programs: one program for every colour source and relief (still one per view, grid, chiral
 *  colouring and Wythoff domain), the variant chosen by a uniform. Each variant's shade is the
 *  production chunk with every function it defines under its own names. */
const uberShader: Experiment = {
  name: "uber-shader",
  compiled: (v) => ({ source: 0, chiral: v.chiral, relief: false, grid: v.grid, wythoff: v.wythoff, motif: v.motif, image: v.image }),
  rewrite(chunk, src) {
    if (chunk !== "content/tiling.glsl") return src;
    const defined = [...src.matchAll(/^(?:void|bool|int|uint|float|vec[234]|uvec[234]|ivec[234])\s+(\w+)\s*\(/gm)].map((m) => m[1]);
    if (!defined.includes("shade")) throw new Error("uber-shader: no shade function in the chunk");
    const names = new RegExp(`\\b(${defined.join("|")})\\b`, "g");
    // the uniforms are declared once, above the copies: the palette, a motif's block, and a tile
    // picture's texture and map
    const start = src.indexOf("layout(std140) uniform Motif {");
    const end = src.indexOf("\n};\n", start);
    if (start < 0 || end < 0) throw new Error("uber-shader: no Motif block in the chunk");
    const motifBlock = src.slice(start, end + 4);
    const imgStart = src.indexOf("uniform sampler2D uImage;");
    const imgEnd = src.indexOf("uniform vec4 uImageFill;\n");
    if (imgStart < 0 || imgEnd < imgStart) throw new Error("uber-shader: no tile picture uniforms in the chunk");
    const imageUniforms = src.slice(imgStart, imgEnd + "uniform vec4 uImageFill;\n".length);
    const body = patch("uber-shader", src, [
      ["uniform sampler2D uPalette;", ""],
      [motifBlock, ""],
      [imageUniforms, ""],
    ]);
    let out = `uniform sampler2D uPalette;\nuniform ivec2 uUber;\n#if MOTIF\n${motifBlock}#endif\n#if TILEIMAGE\n${imageUniforms}#endif\n`;
    let dispatch = "vec3 shade(vec3 xf, vec2 u, float lpx) {\n";
    for (let s = 0; s < SOURCES.length; s++)
      for (const r of [0, 1]) {
        out += `#undef SOURCE\n#define SOURCE ${s}\n#undef RELIEF\n#define RELIEF ${r}\n` + body.replace(names, `$1_${s}_${r}`) + "\n";
        dispatch += `  if (uUber.x == ${s} && uUber.y == ${r}) return shade_${s}_${r}(xf, u, lpx);\n`;
      }
    return out + "#undef SOURCE\n#define SOURCE 0\n#undef RELIEF\n#define RELIEF 0\n" + dispatch + "  return vec3(0.0);\n}\n";
  },
  bind(gl, prog, variant) {
    gl.uniform2i(gl.getUniformLocation(prog, "uUber"), variant.source, variant.relief ? 1 : 0);
  },
};

/** Colourings: permutations as int arrays (uniform: the camera's, then sigma_1..3, 8 entries each,
 *  the identity past the colour count), composed by indexing. */
const permArrays: Experiment = {
  name: "perm-arrays",
  rewrite(chunk, src, _view, _content, variant) {
    if (chunk !== "content/tiling.glsl") return src;
    if (variant.chiral || variant.motif) throw new Error("perm-arrays draws version 1's mirror colourings only");
    return patch("perm-arrays", src, [
      ["uniform sampler2D uPalette;", "uniform sampler2D uPalette;\nuniform int uPermArr[32];"],
      [
        "  uint perm = uPerm.x;",
        `  int perm[8];
  for (int i = 0; i < 8; i++) perm[i] = uPermArr[i];`,
      ],
      [
        "        perm = composePerm(perm, uPerm[j + 1]);",
        `        int composed[8];
        for (int i = 0; i < 8; i++) composed[i] = perm[uPermArr[8 + 8 * j + i]];
        perm = composed;`,
      ],
      // version 1's (a motif's tile colour reads the same line)
      ["  uint own = permAt(perm, 0u);\n  vec3 col = uColours[own].rgb;\n  // across side j", "  int own = perm[0];\n  vec3 col = uColours[own].rgb;\n  // across side j"],
      ["    uint other = permAt(perm, permAt(uPerm[j + 1], 0u));", "    int other = perm[uPermArr[8 + 8 * j]];"],
    ]);
  },
  bind(gl, prog, _variant, spec) {
    const c = spec.scene.colouring;
    const perms = [spec.scene.cameraPerm, ...(c.kind === "chiral" ? [] : c.sigma)];
    const arr = new Int32Array(32);
    perms.forEach((p, j) => {
      for (let i = 0; i < 8; i++) arr[8 * j + i] = i < p.length ? p[i] : i;
    });
    gl.uniform1iv(gl.getUniformLocation(prog, "uPermArr"), arr);
  },
};

/** Wythoff tables (step 15): read with texelFetch from two small textures instead of the Frame
 *  block's arrays, the lines (normal, faces) as RGBA32F and the faces and their Mosaic ids as two
 *  rows of RGBA32UI, on texture units 3 and 4. */
const wyTextures = new WeakMap<Wythoff, { lines: WebGLTexture; tab: WebGLTexture }>();
const wythoffTexture: BenchExperiment = {
  name: "wythoff-texture",
  rewrite(chunk, src) {
    if (chunk !== "content/tiling.glsl") return src;
    const count = (re: RegExp) => src.match(re)?.length ?? 0;
    const want: [RegExp, number][] = [[/uWyLines\[[A-Za-z_]\w*\]/g, 4], [/uWyFaces\[[A-Za-z_]\w*\]/g, 5], [/uWyIds\[[A-Za-z_]\w*\]/g, 2]];
    for (const [re, n] of want) if (count(re) < n) throw new Error(`wythoff-texture: expected at least ${n} reads matching ${re}, found ${count(re)}`);
    return patch("wythoff-texture", src, [["uniform sampler2D uPalette;", "uniform sampler2D uPalette;\nuniform highp sampler2D uWyLinesT;\nuniform highp usampler2D uWyTabT;"]])
      .replace(/uWyLines\[([A-Za-z_]\w*)\]/g, "texelFetch(uWyLinesT, ivec2(int($1), 0), 0)")
      .replace(/uWyFaces\[([A-Za-z_]\w*)\]/g, "texelFetch(uWyTabT, ivec2(int($1), 0), 0)")
      .replace(/uWyIds\[([A-Za-z_]\w*)\]/g, "texelFetch(uWyTabT, ivec2(int($1), 1), 0)");
  },
  bind(gl, prog, variant, spec) {
    const wy = spec.scene.wythoff;
    if (!variant.wythoff || !wy) return;
    let t = wyTextures.get(wy);
    if (!t) {
      // as frame.ts packFrame writes them at words 252, 316 and 380
      const lines = new Float32Array(16 * 4);
      wy.lines.forEach((m, e) => lines.set([...m, wy.sides[e][0] + 32 * wy.sides[e][1]], 4 * e));
      const tab = new Uint32Array(16 * 2 * 4);
      wy.faces.forEach((f, i) => {
        tab.set([f.mask, f.want, f.kind + 16 * Math.max(0, wy.colourOf[f.kind]), 0], 4 * i);
        tab.set([...f.id, f.kind], 64 + 4 * i);
      });
      const make = (format: number, type: number, h: number, data: ArrayBufferView, internal: number) => {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, 16, h, 0, format, type, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return tex;
      };
      gl.activeTexture(gl.TEXTURE3);
      t = { lines: make(gl.RGBA, gl.FLOAT, 1, lines, gl.RGBA32F), tab: make(gl.RGBA_INTEGER, gl.UNSIGNED_INT, 2, tab, gl.RGBA32UI) };
      wyTextures.set(wy, t);
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, t.lines);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, t.tab);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(prog, "uWyLinesT"), 3);
    gl.uniform1i(gl.getUniformLocation(prog, "uWyTabT"), 4);
  },
};

/** Motifs (step 16): the curves c1 and c2 sampled with fewer points than 48 (24, and 32 after 24
 *  failed the equivalence check). The shader's loops already stop at the count, so B is the same
 *  program drawing a motif compiled with fewer points. */
const motifPoints = (n: number): BenchExperiment => ({
  name: `motif-${n}`,
  sceneB(s) {
    const ref = s.content.state.motif;
    if (ref === undefined) throw new Error(`motif-${n} draws motifs only`);
    return { ...s, content: { ...s.content, motif: compileMotif(motifSpecOf(ref as MotifRef), n) } };
  },
});

export const EXPERIMENTS: BenchExperiment[] = [foldDihedral, reflectBranchless, geometryComplex, footprintDerivatives, uberShader, permArrays, wythoffTexture, motifPoints(24), motifPoints(32)];
