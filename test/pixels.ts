// Semantic oracle for the minifier: render a shader and its minified form in headless Chromium
// (ANGLE on SwiftShader, the compiler behind Chrome's WebGL) with the same deterministic inputs
// and compare what they produce. test/pixels-harness.js is the browser side.
//
// The browser comes from Playwright: `npx playwright install chromium`, or point
// CHROMIUM_EXECUTABLE at a Chromium binary. Without one, the pixel tests skip.
import * as path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";
import { repoRoot } from "./golden.js";

export interface ShaderInput { name: string; type: string; size: number; array: boolean; flat: boolean }
export interface RenderConfig {
  /**
   * compile: compile `source` alone, as the shader `stage` says, and report the compiler's verdict.
   * link: compile `source` as the vertex shader and `fragmentSource` as the fragment shader and link them.
   * program: link them and draw, so a real pair is rendered rather than a shader with a generated partner.
   */
  mode: "compile" | "pixels" | "varyings" | "link" | "program";
  /** compile mode: which stage `source` is. */
  stage?: "vert" | "frag";
  version: 1 | 2;
  source: string;
  /** link and program modes: the fragment shader of the pair. */
  fragmentSource?: string;
  /** pixels: the fragment shader's inputs to feed; varyings: the vertex shader's outputs to capture. */
  inputs: ShaderInput[];
  size: number;
  vertices: number;
  instances: number;
  /** Values for uniforms by name (arrays for vectors); anything else is hashed from its name. */
  uniforms?: Record<string, number | boolean | number[]>;
  /** Changes every generated input (uniforms, textures, attributes, the well-known names). Default 0. */
  seed?: number;
}

/** The seeds each case is rendered with: three sets of inputs reach branches one set would miss. */
export const seeds = [0, 1, 2];
export type RenderResult = { ok: true; data: number[] } | { ok: false; error: string };

export const glslVersion = (source: string): 1 | 2 => (/^\s*#version\s+3\d0\s+es/m.test(source) ? 2 : 1);

/**
 * The shader with its conditional directives decided from the #defines in the file (three.js
 * puts `#define NUM_DIR_LIGHT_SHADOWS 1` above `#if NUM_DIR_LIGHT_SHADOWS > 0`), and those
 * defines' integer values. The minifier's own preprocessor only decides `#if 0/1` and `#ifdef`.
 */
export function activeSource(source: string): { source: string; defines: Map<string, number> } {
  const defines = new Map<string, number>();
  const evaluate = (expr: string): boolean => {
    const js = expr
      .replace(/\bdefined\s*\(\s*(\w+)\s*\)|\bdefined\s+(\w+)/g, (_m, a, b) => (defines.has(a ?? b) ? "1" : "0"))
      .replace(/\b(\d+)[uU]?\b/g, "$1")
      .replace(/\b[A-Za-z_]\w*\b/g, (id) => String(defines.get(id) ?? 0));
    try { return Boolean(new Function(`return (${js});`)()); } catch { return false; }
  };
  const stack: boolean[] = []; // whether each open block is active
  const taken: boolean[] = []; // whether a branch of it has been taken
  const active = (): boolean => stack.every(Boolean);
  const out: string[] = [];
  for (const line of source.split("\n")) {
    const m = /^\s*#\s*(\w+)\s*(.*?)\s*$/.exec(line);
    if (m === null) { if (active()) out.push(line); continue; }
    const [, kw, rest] = m;
    if (kw === "if" || kw === "ifdef" || kw === "ifndef") {
      const cond = kw === "if" ? evaluate(rest) : defines.has(rest.split(/\s/)[0]) === (kw === "ifdef");
      stack.push(active() && cond); taken.push(cond);
    } else if (kw === "elif") {
      const outer = stack.slice(0, -1).every(Boolean);
      const cond = !taken[taken.length - 1] && evaluate(rest);
      stack[stack.length - 1] = outer && cond; if (cond) taken[taken.length - 1] = true;
    } else if (kw === "else") {
      const outer = stack.slice(0, -1).every(Boolean);
      stack[stack.length - 1] = outer && !taken[taken.length - 1]; taken[taken.length - 1] = true;
    } else if (kw === "endif") { stack.pop(); taken.pop(); }
    else if (active()) {
      if (kw === "define") {
        // function-like only when the parenthesis follows the name directly: `#define S (1+2)` is object-like
        const d = /^(\w+)(\s*)(.*)$/.exec(rest);
        if (d !== null && !(d[2] === "" && d[3].startsWith("("))) { const v = Number(d[3].replace(/[uU]$/, "")); defines.set(d[1], Number.isFinite(v) ? v : NaN); }
      }
      else if (kw === "undef") defines.delete(rest.split(/\s/)[0]);
      out.push(line);
    }
  }
  return { source: out.join("\n"), defines };
}

/** The `in`/`varying` (fragment) or `out`/`varying` (vertex) declarations of a shader, from the port's parser, after deciding its conditionals. */
export function shaderInterface(name: string, source: string, stage: "frag" | "vert"): ShaderInput[] {
  const wanted = stage === "frag" ? ["in", "varying", "attribute"] : ["out", "varying"];
  const inputs: ShaderInput[] = [];
  const active = activeSource(source);
  const sizeOf = (s: { kind: string; value?: number; ident?: { name: string } }): number =>
    s.kind === "Int" ? s.value! : s.kind === "Var" ? active.defines.get(s.ident!.name) ?? NaN : NaN;
  // Macros are expanded first: PlayCanvas declares a parameter through one
  // (`float f(SHADOWMAP_ACCEPT(shadowMap), ...)`), which the parser cannot represent, and this
  // only wants to read the declarations.
  for (const tl of runParser({ ...defaultOptions(), expandMacros: true }, name, active.source).code) {
    if (tl.kind !== "TLDecl") continue;
    const [ty, elts] = tl.decl;
    if (!ty.typeQ.some((q) => wanted.includes(q)) || ty.name.kind !== "TypeName") continue;
    for (const elt of elts) {
      const sizes = [...ty.arraySizes, ...elt.sizes];
      const size = sizes.length === 0 ? 1 : sizes.reduce((a, s) => a * sizeOf(s as { kind: string; value?: number; ident?: { name: string } }), 1);
      if (size === 0) continue; // an array behind `#if N > 0` with N = 0
      inputs.push({ name: elt.name.name, type: ty.name.ident.name, size, array: sizes.length > 0, flat: ty.typeQ.includes("flat") });
    }
  }
  return inputs;
}

/** ES 1.00 fragment shaders need a default float precision; desktop `#version` lines must go. */
export const toEs100 = (source: string): string =>
  (/^\s*precision\s/m.test(source) ? "" : "precision highp float;\n") + source.replace(/^\s*#version[^\n]*\n/m, "");

export class ShaderRunner {
  private browser: Browser | null = null;
  private page: Page | null = null;

  /**
   * null when the browser is up. A string says why it is not, and the semantic tests skip on it,
   * which is what makes them optional locally. REQUIRE_BROWSER=1 turns that into a throw instead,
   * so CI gates on them rather than reporting a green run that tested nothing.
   */
  async open(): Promise<string | null> {
    try {
      this.browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
      });
      this.page = await this.browser.newPage();
      await this.page.addScriptTag({ path: path.join(repoRoot, "test/pixels-harness.js") });
      return null;
    } catch (e) {
      await this.close();
      const why = String(e instanceof Error ? e.message.split("\n")[0] : e);
      if (process.env.REQUIRE_BROWSER) throw new Error(`REQUIRE_BROWSER is set but no browser launched: ${why}`);
      return why;
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  async run(cfg: RenderConfig): Promise<RenderResult> {
    if (this.page === null) throw new Error("browser not open");
    return this.page.evaluate((c) => (window as unknown as { runShader: (c: RenderConfig) => RenderResult }).runShader(c), cfg);
  }
}

export interface Comparison { same: boolean; summary: string }

/**
 * The shader with every float literal moved to the next float32 (`.5` -> `.50000006`). Rendering
 * this against the original measures how many pixels the shader itself flips on one-ulp changes,
 * which is the noise a minifier's constant folding (done in double, rounded once) may also make.
 */
export function perturbFloatLiterals(source: string): string {
  const next32 = (x: number): number => {
    const f = new Float32Array([x]);
    const u = new Uint32Array(f.buffer);
    if (f[0] === 0) return 1.4e-45;
    u[0] += f[0] > 0 ? 1 : -1;
    return f[0];
  };
  return source.split("\n").map((line) => (/^\s*#/.test(line) ? line : line.replace(
    /(?<![\w.])(\d+\.\d*|\.\d+)([eE][-+]?\d+)?(?![\w.])|(?<![\w.])(\d+)([eE][-+]?\d+)(?![\w.])/g,
    (m) => next32(Number(m)).toPrecision(9).replace(/(\.\d*?)0+(e|$)/, "$1$2").replace(/\.(e|$)/, ".0$1"),
  ))).join("\n");
}

/** RGBA8 pixels: every channel within `tolerance` levels. */
export function comparePixels(a: number[], b: number[], tolerance: number): Comparison {
  return comparePixelsWithin(a, b, tolerance, 0);
}

/**
 * Like comparePixels, but a shader that flips `noise` pixels of its own on one-ulp literal
 * changes (see perturbFloatLiterals) is allowed as many again from the minified form.
 */
export function comparePixelsWithin(a: number[], b: number[], tolerance: number, noise: number): Comparison {
  if (a.length !== b.length) return { same: false, summary: `pixel counts differ: ${a.length} vs ${b.length}` };
  let maxDiff = 0, badPixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
    maxDiff = Math.max(maxDiff, d);
    if (d > tolerance) badPixels++;
  }
  const distinct = new Set<number>();
  for (let i = 0; i < a.length; i += 4) distinct.add((a[i] << 24) | (a[i + 1] << 16) | (a[i + 2] << 8) | a[i + 3]);
  const allowed = 2 * noise;
  return {
    same: badPixels <= allowed,
    summary: `${badPixels} of ${a.length / 4} pixels differ by more than ${tolerance} (max ${maxDiff}); ${allowed} allowed, the original flips ${noise} on one-ulp literal changes; the original image has ${distinct.size} distinct colours`,
  };
}

/**
 * The verdict on a fragment shader: `same` within the noise allowance; `chaotic` when the shader
 * flips more than a quarter of its pixels on a one-ulp literal change (a mosaic keyed on
 * `int(rand()*4.)`), where a pixel comparison cannot tell a rewrite's rounding from a bug and the
 * test skips with the numbers instead of failing.
 */
export function judgePixels(original: number[], minified: number[], noise: number): Comparison & { chaotic: boolean } {
  const cmp = comparePixelsWithin(original, minified, 1, noise);
  if (cmp.same) return { ...cmp, chaotic: false };
  // Rounding the literal probe cannot see (a sensitivity to uniform-driven expressions, as in a
  // PMREM convolution) is small in both level and extent; a wrong rewrite is not.
  const pixels = original.length / 4;
  let maxDiff = 0, bad = 0;
  for (let i = 0; i < original.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(original[i + c] - minified[i + c]));
    maxDiff = Math.max(maxDiff, d);
    if (d > 1) bad++;
  }
  if (maxDiff <= 8 && bad <= pixels * 0.02) return { same: true, chaotic: false, summary: `${cmp.summary}; within rounding (at most 8 levels on at most 2% of the pixels)` };
  return { ...cmp, chaotic: noise * 4 > pixels };
}

/** How many pixels `pixelsA` and `pixelsB` differ in beyond `tolerance`. */
export function countDifferingPixels(a: number[], b: number[], tolerance: number): number {
  let bad = 0;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
    if (d > tolerance) bad++;
  }
  return bad;
}

/** Captured floats: equal within a relative tolerance; NaN matches NaN. */
export function compareVaryings(a: number[], b: number[], tolerance: number): Comparison {
  if (a.length !== b.length) return { same: false, summary: `value counts differ: ${a.length} vs ${b.length}` };
  let bad = 0, first = "";
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (Number.isNaN(x) && Number.isNaN(y)) continue;
    if (Math.abs(x - y) <= tolerance * Math.max(1, Math.abs(x), Math.abs(y))) continue;
    if (bad === 0) first = ` (first at ${i}: ${x} vs ${y})`;
    bad++;
  }
  return { same: bad === 0, summary: `${bad} of ${a.length} values differ beyond ${tolerance} relative${first}` };
}
