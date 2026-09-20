// The pixel test (test/pixels.test.ts) over shaders from open source projects that ship on the
// web, vendored under test/corpus/ with their licenses; test/corpora.ts describes them and wraps
// them. Each shader runs under the plugin's defaults and under upstream's rewrites alone, and
// each three.js program is linked as a real vertex and fragment pair. Refresh the corpora with
// `npm run corpus:gl-transitions` and `npm run corpus:three`. Skips without a browser.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Minifier } from "../src/api.js";
import * as Printer from "../src/printer.js";
import { ParseError, type Options } from "../src/options.js";
import { babylonShaders, glTransitions, playcanvasShaders, pluginOptions, programs, threeShaders, variants, type CorpusShader } from "./corpora.js";
import { compareVaryings, countDifferingPixels, glslVersion, judgePixels, perturbFloatLiterals, seeds, shaderInterface, ShaderRunner, type RenderConfig } from "./pixels.js";

interface Case { name: string; file: string; stage: "frag" | "vert"; source: string; options: Options; uniforms?: RenderConfig["uniforms"] }

const cases: Case[] = [];
for (const [corpus, shaders] of [["gl-transitions", glTransitions()], ["three", threeShaders()], ["babylon", babylonShaders()], ["playcanvas", playcanvasShaders()]] as [string, CorpusShader[]][]) {
  for (const s of shaders) {
    // gl-transitions are wrapped into a complete fragment shader, whatever the file is called.
    const file = corpus === "gl-transitions" ? s.name.replace(/\.glsl$/, ".frag") : s.name;
    for (const [label, options] of variants()) {
      cases.push({ name: `${corpus}/${s.name} [${label}]`, file, stage: file.endsWith(".vert") ? "vert" : "frag", source: s.source, options: { ...options, ...s.options }, uniforms: s.uniforms });
    }
  }
}

const runner = new ShaderRunner();
let unavailable: string | null = "not opened";

beforeAll(async () => { unavailable = await runner.open(); }, 60000);
afterAll(async () => { await runner.close(); });

const minify = (options: Options, file: string, source: string): string =>
  new Minifier(options, [[file, source]]).format({ ...options, outputFormat: "text" });

describe("open source shader corpus renders the same", () => {
  for (const c of cases) {
    it(c.name, async (ctx) => {
      if (unavailable !== null) { ctx.skip(); return; }
      const version = glslVersion(c.source);
      let minified: string;
      try {
        minified = minify(c.options, c.file, c.source);
      } catch (e) {
        if (e instanceof ParseError) { ctx.skip(`the minifier refuses the source: ${e.message.split("\n")[0]}`); return; }
        throw e;
      }
      const mode = c.stage === "frag" ? "pixels" : "varyings";
      const inputs = shaderInterface(c.file, c.source, c.stage);
      const cfg = (source: string, seed: number): RenderConfig => ({ mode, version, source, inputs, size: 48, vertices: 16, instances: 2, uniforms: c.uniforms, seed });
      // Several sets of inputs, so branches one set misses are still exercised.
      for (const seed of seeds) {
        const original = await runner.run(cfg(c.source, seed));
        if (!original.ok) { ctx.skip(`WebGL rejects the original: ${original.error.split("\n")[0]}`); return; }
        const result = await runner.run(cfg(minified, seed));
        expect(result.ok, `minified shader failed: ${result.ok ? "" : result.error}\n${minified.slice(0, 4000)}`).toBe(true);
        if (!result.ok) return;
        if (mode === "varyings") {
          const cmp = compareVaryings(original.data, result.data, 1e-5);
          expect(cmp.same, `seed ${seed}: ${cmp.summary}\n${minified.slice(0, 4000)}`).toBe(true);
          continue;
        }
        const perturbed = await runner.run(cfg(perturbFloatLiterals(c.source), seed));
        const noise = perturbed.ok ? countDifferingPixels(original.data, perturbed.data, 1) : 0;
        const cmp = judgePixels(original.data, result.data, noise);
        if (cmp.chaotic) { ctx.skip(`chaotic shader (seed ${seed}): ${cmp.summary}`); return; }
        expect(cmp.same, `seed ${seed}: ${cmp.summary}\n${minified.slice(0, 4000)}`).toBe(true);
      }
    }, 120000);
  }
});

// A vertex and fragment shader of one program, minified separately as the plugin minifies them.
// Two things are checked that no single-shader test can see, because the pixel test gives each
// shader a generated partner rather than its real one:
//
//   the program still links. GL matches uniforms, varyings and the *type names* of struct-typed
//     uniforms across the two stages, and each half is renamed on its own.
//   it still draws the same picture. A varying the two halves disagree about, in name, type or
//     interpolation, shows up here and nowhere else.
//
// A pair whose original draws nothing (one flat colour, usually because the generated uniforms put
// the geometry off screen) is skipped: comparing two blank images proves nothing.
//
// Each pair runs twice: under the plugin's defaults, and with --remove-unused-varyings, which is
// the flag that needs both halves and whose mistakes are exactly what this test can see.
describe("engine programs link and draw the same after minification", () => {
  const flat = (px: number[]): boolean => px.every((v, i) => v === px[i % 4]);
  const pairVariants: [string, Partial<Options>][] = [["plugin", {}], ["plugin +remove-unused-varyings", { removeUnusedVaryings: true }]];
  const allPrograms = [...programs(threeShaders()).map((p) => ({ ...p, corpus: "three" })), ...programs(babylonShaders()).map((p) => ({ ...p, corpus: "babylon" })), ...programs(playcanvasShaders()).map((p) => ({ ...p, corpus: "playcanvas" }))];
  for (const { corpus, name, vert, frag } of allPrograms) for (const [label, extra] of pairVariants) {
    it(`${corpus}/${name} [${label}]`, async (ctx) => {
      if (unavailable !== null) { ctx.skip(); return; }
      const options = { ...pluginOptions(), ...vert.options, ...extra };
      const cfg = (mode: "link" | "program", v: string, f: string, seed = 0): RenderConfig =>
        ({ mode, version: 2, source: v, fragmentSource: f, inputs: [], size: 48, vertices: 24, instances: 1, seed });
      const linked = await runner.run(cfg("link", vert.source, frag.source));
      if (!linked.ok) { ctx.skip(`the original program does not link: ${linked.error.split("\n")[0]}`); return; }
      // Both halves in one run, so the cross-file passes see the pair.
      const both = new Minifier(options, [[vert.name, vert.source], [frag.name, frag.source]]);
      const [minVert, minFrag] = both.shaders.map((s) => Printer.print(s.code));
      const relinked = await runner.run(cfg("link", minVert, minFrag));
      expect(relinked.ok, relinked.ok ? "" : relinked.error.split("\n")[0]).toBe(true);
      if (!relinked.ok) return;

      for (const seed of seeds) {
        const original = await runner.run(cfg("program", vert.source, frag.source, seed));
        if (!original.ok) { ctx.skip(`WebGL rejects the original program: ${original.error.split("\n")[0]}`); return; }
        if (flat(original.data)) continue; // nothing was drawn with this seed's uniforms
        const result = await runner.run(cfg("program", minVert, minFrag, seed));
        expect(result.ok, result.ok ? "" : result.error.split("\n")[0]).toBe(true);
        if (!result.ok) return;
        // The same one-ulp allowance the single-shader test uses, measured on this pair.
        const noisy = await runner.run(cfg("program", perturbFloatLiterals(vert.source), perturbFloatLiterals(frag.source), seed));
        const noise = noisy.ok ? countDifferingPixels(original.data, noisy.data, 1) : 0;
        const cmp = judgePixels(original.data, result.data, noise);
        if (cmp.chaotic) { ctx.skip(`chaotic program (seed ${seed}): ${cmp.summary}`); return; }
        expect(cmp.same, `seed ${seed}: ${cmp.summary}`).toBe(true);
      }
    }, 120000);
  }
});
