// WebGL2 renderer: one sample program per (view, content) pair, compiled on first use and cached,
// fed by the std140 Frame block, and one display program. Samples are blended into an accumulation
// target as a running mean, acc = acc (1 - 1/n) + sample / n, in linear light: RGBA16F when float
// targets are available, else 8-bit sRGB (the hardware blends in linear light and stores sRGB,
// good for the few samples allowed there). The display pass scales the target to the canvas and
// encodes it as sRGB with a dither. A target as large as the picture is drawn without the unit
// grid, and the display pass draws the grid once over it (one display program per view and grid,
// design notes, step 10); a smaller one, while moving, has the grid in every sample.

import { SOURCES } from "../content/looks.ts";
import { GRID_KINDS } from "../math/grid.ts";
import type { PaletteTable } from "../content/palettes.ts";
import { TABLE_LEVELS, TABLE_SIZE } from "../content/palettes.ts";
import type { ContentKind, Rewrite, Sources, Variant, ViewKind } from "./assemble.ts";
import { assemble, assembleDisplay, BASIC, mapLog } from "./assemble.ts";
import type { Motif } from "../math/motifs.ts";
import type { TileImage } from "../content/tileimage.ts";
import type { ScenePicture } from "./reference.ts";
import type { FrameInput } from "./frame.ts";
import { FRAME_WORDS, MOTIF_WORDS, packFrame, packMotif } from "./frame.ts";
import { stripColumns } from "./reference.ts";
import { MAX_SAMPLES, MAX_SAMPLES_8BIT, sampleOffset } from "./samples.ts";
import type { Tile } from "./shot.ts";

/** One frame's numbers without the target size and the sample's offset. */
export type FramePart = Omit<FrameInput, "width" | "height" | "offset">;

/** Everything a sample needs except the target size and the sample's offset. A band drawn in strips
 *  (input/strips.ts) has their parts: each drawn into the columns of the screen between its `from`
 *  and `to` (in u, reference.ts stripColumns), the others as the spec itself says. */
export type FrameSpec = FramePart & { strips?: (FramePart & { from: number; to: number })[] };

/** A benchmark experiment (bench/experiments.ts): it rewrites the chunks of the programs drawn while
 *  it is set, may draw several variants with one program, and sets that program's own uniforms.
 *  The app never sets one. */
export interface Experiment {
  name: string;
  rewrite?(chunk: string, src: string, view: ViewKind, content: ContentKind, variant: Variant): string;
  /** The variant the program is compiled for; the variants mapped to one share its program. */
  compiled?(variant: Variant): Variant;
  /** Called after the program is bound, with the variant and the frame drawn. */
  bind?(gl: WebGL2RenderingContext, prog: WebGLProgram, variant: Variant, spec: FrameSpec): void;
}

export interface Accumulator {
  readonly width: number;
  readonly height: number;
  readonly tex: WebGLTexture;
  readonly fb: WebGLFramebuffer;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  /** RGBA16F accumulation; false means 8-bit sRGB targets and at most MAX_SAMPLES_8BIT samples. */
  readonly floatTargets: boolean;
  readonly maxSamples: number;
  private programs = new Map<string, WebGLProgram>();
  private palettes = new Map<PaletteTable, WebGLTexture>();
  private ubo: WebGLBuffer;
  /** The Motif block (binding 1), and the motif it holds. */
  private motifUbo: WebGLBuffer;
  private motifHeld: Motif | null = null;
  /** Your own tile pictures' textures, the last two used (most recent last). */
  private pictures: { image: TileImage; tex: WebGLTexture }[] = [];
  /** The picture uniforms' locations per program. */
  private pictureUniforms = new WeakMap<WebGLProgram, { u: WebGLUniformLocation | null; v: WebGLUniformLocation | null; info: WebGLUniformLocation | null; fill: WebGLUniformLocation | null }>();
  private vao: WebGLVertexArrayObject;
  private frame = new ArrayBuffer(FRAME_WORDS * 4);
  /** Benchmarks only: the experiment drawn instead of the production programs, or null. */
  experiment: Experiment | null = null;

  /** floatTargets: false forces the 8-bit path (to test it on machines that have float targets). */
  constructor(gl: WebGL2RenderingContext, options: { floatTargets?: boolean } = {}) {
    this.gl = gl;
    this.ubo = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.frame.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);
    this.motifUbo = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.motifUbo);
    gl.bufferData(gl.UNIFORM_BUFFER, MOTIF_WORDS * 4, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, this.motifUbo);
    this.vao = gl.createVertexArray()!;
    this.floatTargets = options.floatTargets !== false && gl.getExtension("EXT_color_buffer_float") !== null && this.floatRenderable();
    this.maxSamples = this.floatTargets ? MAX_SAMPLES : MAX_SAMPLES_8BIT;
  }

  /** The sample program for a view, content and variant, compiled and linked on first use. Throws
   *  with the compile log mapped to chunk names and lines. */
  program(view: ViewKind, content: ContentKind, drawn: Variant): WebGLProgram {
    const exp = this.experiment;
    const variant = exp?.compiled?.(drawn) ?? drawn;
    const key = `${view}+${content}+${SOURCES[variant.source]}${variant.chiral ? "+chiral" : ""}${variant.relief ? "+relief" : ""}${variant.grid ? `+${GRID_KINDS[variant.grid - 1]}` : ""}${variant.wythoff ? `+wy${variant.wythoff}` : ""}${variant.motif ? "+motif" : ""}${variant.image ? `+img${variant.image}` : ""}${exp ? `@${exp.name}` : ""}`;
    let prog = this.programs.get(key);
    if (!prog) {
      const gl = this.gl;
      const rewrite: Rewrite | undefined = exp?.rewrite && ((chunk, src) => exp.rewrite!(chunk, src, view, content, variant));
      prog = this.link(key, assemble(view, content, variant, "webgl", rewrite));
      gl.uniformBlockBinding(prog, gl.getUniformBlockIndex(prog, "Frame"), 0);
      if (variant.motif) gl.uniformBlockBinding(prog, gl.getUniformBlockIndex(prog, "Motif"), 1);
      // the palette sits on unit 1, so the sampler never points at the accumulation target on unit 0
      gl.useProgram(prog);
      gl.uniform1i(gl.getUniformLocation(prog, "uPalette"), 1);
      // the tile picture on unit 2
      if (variant.image) {
        gl.uniform1i(gl.getUniformLocation(prog, "uImage"), 2);
        const at = (name: string) => gl.getUniformLocation(prog!, name);
        this.pictureUniforms.set(prog, { u: at("uImageU"), v: at("uImageV"), info: at("uImageInfo"), fill: at("uImageFill") });
      }
      this.programs.set(key, prog);
    }
    return prog;
  }

  /** The palette's texture: 256 x 1 half floats with all mip levels, REPEAT along the cycle. */
  private paletteTexture(table: PaletteTable): WebGLTexture {
    let tex = this.palettes.get(table);
    if (!tex) {
      const gl = this.gl;
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, TABLE_LEVELS, gl.RGBA16F, TABLE_SIZE, 1);
      table.bits.forEach((bits, L) => gl.texSubImage2D(gl.TEXTURE_2D, L, 0, 0, TABLE_SIZE >> L, 1, gl.RGBA, gl.HALF_FLOAT, bits));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.palettes.set(table, tex);
    }
    return tex;
  }

  /** A tile picture's texture: SRGB8_ALPHA8 with every level as content/tileimage.ts made them
   *  (premultiplied in linear light), trilinear, mirrored repeat. The last two pictures are kept. */
  private pictureTexture(image: TileImage): WebGLTexture {
    const held = this.pictures.findIndex((p) => p.image === image);
    if (held >= 0) {
      const [p] = this.pictures.splice(held, 1);
      this.pictures.push(p);
      return p.tex;
    }
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, image.levels.length, gl.SRGB8_ALPHA8, image.width, image.height);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    image.levels.forEach((lv, L) => gl.texSubImage2D(gl.TEXTURE_2D, L, 0, 0, lv.width, lv.height, gl.RGBA, gl.UNSIGNED_BYTE, lv.data));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    this.pictures.push({ image, tex });
    while (this.pictures.length > 2) gl.deleteTexture(this.pictures.shift()!.tex);
    return tex;
  }

  /** Bind the picture's texture on unit 2 and set its uniforms in the program (bound). */
  private bindPicture(prog: WebGLProgram, pic: ScenePicture, fill: readonly number[]): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.pictureTexture(pic.image));
    const loc = this.pictureUniforms.get(prog);
    if (!loc) return;
    const m = pic.map;
    gl.uniform3f(loc.u, m.u[0], m.u[1], m.u[2]);
    gl.uniform3f(loc.v, m.v[0], m.v[1], m.v[2]);
    gl.uniform4f(loc.info, m.s, m.maxLod, pic.tint ? 1 : 0, 0);
    gl.uniform4f(loc.fill, fill[0], fill[1], fill[2], 0);
  }

  /** The display program, or with a view and a grid (1 + its index in GRID_KINDS) the one that
   *  draws that grid over the target. */
  private displayProgram(view?: ViewKind, grid = 0): WebGLProgram {
    const key = view && grid ? `display+${view}+${GRID_KINDS[grid - 1]}` : "display";
    let prog = this.programs.get(key);
    if (!prog) {
      prog = this.link(key, assembleDisplay("webgl", view, grid));
      if (grid) this.gl.uniformBlockBinding(prog, this.gl.getUniformBlockIndex(prog, "Frame"), 0);
      this.programs.set(key, prog);
    }
    return prog;
  }

  /** Compile and link a program (the renderer's own, or an experiment's). */
  link(key: string, src: Sources): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, text: string, label: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, text);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) ?? "";
        gl.deleteShader(sh);
        throw new Error(`${label} shader of ${key} does not compile:\n${type === gl.FRAGMENT_SHADER ? mapLog(log, src.chunks) : log}`);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, src.vertex, "vertex");
    const fs = compile(gl.FRAGMENT_SHADER, src.fragment, "fragment");
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${key} does not link:\n${gl.getProgramInfoLog(prog)}`);
    return prog;
  }

  /** An accumulation target of the given size. */
  createTarget(width: number, height: number): Accumulator {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.floatTargets ? gl.RGBA16F : gl.SRGB8_ALPHA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width, height, tex, fb };
  }

  deleteTarget(t: Accumulator): void {
    this.gl.deleteFramebuffer(t.fb);
    this.gl.deleteTexture(t.tex);
  }

  /** Blend sample i (0 = the pixel centre, which replaces what the target held) into the target;
   *  with `tile`, the target is that part of a picture of `tile.full` pixels. */
  sample(spec: FrameSpec, target: Accumulator, i: number, tile?: Tile & { full: [number, number] }): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.width, target.height);
    const { style, plain } = spec.scene;
    const grid = spec.grid ? GRID_KINDS.indexOf(spec.grid.kind) + 1 : 0;
    const mo = spec.scene.motif ?? null;
    const wy = mo ? null : spec.scene.wythoff;
    // a Wythoff tiling colours face kinds, not the colouring's tiles
    const chiral = !wy && style.source === "colouring" && spec.scene.colouring.kind === "chiral";
    // your own picture over version 1's tiling only
    const pic = !mo && !wy ? (spec.scene.picture ?? null) : null;
    const image = pic ? (pic.mode === "chiral" ? 2 : 1) : 0;
    const variant: Variant = plain ? { ...BASIC, grid } : { source: SOURCES.indexOf(style.source), chiral, relief: style.relief > 0, grid, wythoff: wy ? (wy.kite ? 2 : 1) : 0, motif: !!mo, image };
    if (mo && !plain) this.uploadMotif(mo);
    const prog = this.program(spec.picture.model, plain ? "plain" : "tiling", variant);
    gl.useProgram(prog);
    if (pic && !plain) this.bindPicture(prog, pic, spec.scene.shading.fillFactor);
    this.experiment?.bind?.(gl, prog, variant, spec);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture(style.palette));
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendColor(0, 0, 0, 1 / (i + 1));
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    gl.bindVertexArray(this.vao);
    this.byStrip(spec, target.width, target.height, tile, (part) => {
      this.uploadFrame({ ...part, ...placed(target.width, target.height, sampleOffset(i), tile) });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  /** Call draw once for the spec, or once per strip with the scissor on that strip's columns of the
   *  target (of a picture tile.full pixels when it is a tile). A grid spec without strips is a
   *  picture drawn whole. */
  private byStrip(spec: FrameSpec, width: number, height: number, tile: (Tile & { full: [number, number] }) | undefined, draw: (part: FramePart) => void): void {
    if (!spec.strips || spec.strips.length < 2) {
      draw(spec);
      return;
    }
    const gl = this.gl;
    const [fullW, fullH] = tile ? tile.full : [width, height];
    const left = tile ? tile.x : 0;
    const cols = stripColumns(spec.strips, fullW, fullH);
    gl.enable(gl.SCISSOR_TEST);
    spec.strips.forEach((part, j) => {
      const x0 = Math.max(0, cols[j][0] - left);
      const x1 = Math.min(width, cols[j][1] - left);
      if (x1 <= x0) return;
      gl.scissor(x0, 0, x1 - x0, height);
      draw(part);
    });
    gl.disable(gl.SCISSOR_TEST);
  }

  /** Fill the Motif block (binding 1) when the motif changed. */
  private uploadMotif(m: Motif): void {
    if (m === this.motifHeld) return;
    const gl = this.gl;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, this.motifUbo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, packMotif(m));
    this.motifHeld = m;
  }

  /** Fill the Frame block (binding 0) with one frame's numbers. */
  uploadFrame(f: FrameInput): void {
    const gl = this.gl;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, packFrame(f, this.frame));
  }

  /** Draw the target scaled to width x height into a framebuffer (null = the canvas), as sRGB with
   *  a dither of `dither` 8-bit steps. With `grid`, the frame whose unit grid is drawn over the
   *  target (its samples drawn without it, at width x height, or as the tile of a larger picture). */
  display(target: Accumulator, width: number, height: number, framebuffer: WebGLFramebuffer | null = null, dither = 1, grid?: { spec: FrameSpec; tile?: Tile & { full: [number, number] } }): void {
    const gl = this.gl;
    const kind = grid?.spec.grid ? GRID_KINDS.indexOf(grid.spec.grid.kind) + 1 : 0;
    const prog = this.displayProgram(grid?.spec.picture.model, kind);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.uniform1i(gl.getUniformLocation(prog, "uAccum"), 0);
    gl.uniform3f(gl.getUniformLocation(prog, "uDisplay"), width, height, dither);
    gl.bindVertexArray(this.vao);
    if (kind)
      this.byStrip(grid!.spec, width, height, grid!.tile, (part) => {
        this.uploadFrame({ ...part, ...placed(width, height, [0, 0], grid!.tile) });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      });
    else gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Read the canvas back as RGBA8, top row first. Call in the same task as display(). */
  readCanvas(): Uint8Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.readTopDown(gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  /** Off screen at width x height: `samples` samples, displayed without dither, read back as RGBA8,
   *  top row first (like the reference renderer). With `tile`, only that part of the picture (and
   *  the pixels returned are the tile's). The unit grid is drawn once over the samples, or with
   *  `gridPerSample` in each of them (as while moving). */
  renderPixels(spec: FrameSpec, fullWidth: number, fullHeight: number, samples = 1, tile?: Tile, gridPerSample = false): Uint8Array {
    const gl = this.gl;
    const [width, height] = tile ? [tile.width, tile.height] : [fullWidth, fullHeight];
    const placedTile = tile && { ...tile, full: [fullWidth, fullHeight] as [number, number] };
    const once = !!spec.grid && !gridPerSample;
    const target = this.createTarget(width, height);
    for (let i = 0; i < samples; i++) this.sample(once ? { ...spec, grid: null } : spec, target, i, placedTile);
    const fb = gl.createFramebuffer()!;
    const rb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    this.display(target, width, height, fb, 0, once ? { spec, tile: placedTile } : undefined);
    const out = this.readTopDown(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteRenderbuffer(rb);
    this.deleteTarget(target);
    return out;
  }

  /** Whether an RGBA16F texture is complete as a render target (the extension alone does not
   *  promise it on every driver). */
  private floatRenderable(): boolean {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 4, 4);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return ok;
  }

  /** The largest tile this GPU can draw and read back in one piece. */
  get maxTile(): number {
    const gl = this.gl;
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, dims[0], dims[1]);
  }

  private readTopDown(width: number, height: number): Uint8Array {
    const raw = new Uint8Array(width * height * 4);
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, raw);
    const out = new Uint8Array(raw.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) out.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return out;
  }
}

/** The frame's size and pixel shift for a target of width x height, shifted by `offset` pixels, or
 *  for a tile of a larger picture: a tile moves the pixel grid right by its x, and down by its
 *  distance from the picture's bottom. */
function placed(width: number, height: number, [ox, oy]: [number, number], tile?: Tile & { full: [number, number] }): Pick<FrameInput, "width" | "height" | "offset"> {
  return tile
    ? { width: tile.full[0], height: tile.full[1], offset: [ox + tile.x, oy - (tile.full[1] - tile.y - tile.height)] }
    : { width, height, offset: [ox, oy] };
}
