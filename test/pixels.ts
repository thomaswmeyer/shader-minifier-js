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

export interface ShaderInput { name: string; type: string; size: number; flat: boolean }
export interface RenderConfig {
  mode: "pixels" | "varyings";
  version: 1 | 2;
  source: string;
  /** pixels: the fragment shader's inputs to feed; varyings: the vertex shader's outputs to capture. */
  inputs: ShaderInput[];
  size: number;
  vertices: number;
  instances: number;
}
export type RenderResult = { ok: true; data: number[] } | { ok: false; error: string };

export const glslVersion = (source: string): 1 | 2 => (/^\s*#version\s+3\d0\s+es/m.test(source) ? 2 : 1);

/** The `in`/`varying` (fragment) or `out`/`varying` (vertex) declarations of a shader, from the port's parser. */
export function shaderInterface(name: string, source: string, stage: "frag" | "vert"): ShaderInput[] {
  const wanted = stage === "frag" ? ["in", "varying", "attribute"] : ["out", "varying"];
  const inputs: ShaderInput[] = [];
  for (const tl of runParser(defaultOptions(), name, source).code) {
    if (tl.kind !== "TLDecl") continue;
    const [ty, elts] = tl.decl;
    if (!ty.typeQ.some((q) => wanted.includes(q)) || ty.name.kind !== "TypeName") continue;
    for (const elt of elts) {
      const sizes = [...ty.arraySizes, ...elt.sizes];
      const size = sizes.length === 0 ? 1 : sizes.reduce((a, s) => a * (s.kind === "Int" ? s.value : NaN), 1);
      inputs.push({ name: elt.name.name, type: ty.name.ident.name, size, flat: ty.typeQ.includes("flat") });
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

  /** null when no browser could be launched (the tests then skip). */
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
      return String(e instanceof Error ? e.message.split("\n")[0] : e);
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
