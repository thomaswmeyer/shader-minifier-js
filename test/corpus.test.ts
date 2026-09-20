// The pixel test (test/pixels.test.ts) over shaders from open source projects that ship on the
// web, vendored under test/corpus/ with their licenses; test/corpora.ts describes them and wraps
// them. Each shader runs under the plugin's defaults and under upstream's rewrites alone, and
// each three.js program is linked as a real vertex and fragment pair. Refresh the corpora with
// `npm run corpus:gl-transitions` and `npm run corpus:three`. Skips without a browser.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Minifier } from "../src/api.js";
import { ParseError, type Options } from "../src/options.js";
import { glTransitions, pluginOptions, threePrograms, threeShaders, variants, type CorpusShader } from "./corpora.js";
import { compareVaryings, countDifferingPixels, glslVersion, judgePixels, perturbFloatLiterals, seeds, shaderInterface, ShaderRunner, type RenderConfig } from "./pixels.js";

interface Case { name: string; file: string; stage: "frag" | "vert"; source: string; options: Options; uniforms?: RenderConfig["uniforms"] }

const cases: Case[] = [];
for (const [corpus, shaders] of [["gl-transitions", glTransitions()], ["three", threeShaders()]] as [string, CorpusShader[]][]) {
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

// A vertex and fragment shader of one program, minified separately as the plugin minifies them,
// must still link: GL matches uniforms, varyings and the *type names* of struct-typed uniforms
// across the two stages, and each half is renamed on its own. The pixel test never sees a real
// pair (it gives each shader a generated partner), so nothing else catches this.
describe("three.js programs still link after minification", () => {
  for (const { name, vert, frag } of threePrograms()) {
    it(name, async (ctx) => {
      if (unavailable !== null) { ctx.skip(); return; }
      const cfg = (v: string, f: string): RenderConfig => ({ mode: "link", version: 2, source: v, fragmentSource: f, inputs: [], size: 8, vertices: 1, instances: 1 });
      const original = await runner.run(cfg(vert.source, frag.source));
      if (!original.ok) { ctx.skip(`the original program does not link: ${original.error.split("\n")[0]}`); return; }
      const options = { ...pluginOptions(), ...vert.options };
      const result = await runner.run(cfg(minify(options, vert.name, vert.source), minify(options, frag.name, frag.source)));
      expect(result.ok, result.ok ? "" : result.error.split("\n")[0]).toBe(true);
    }, 60000);
  }
});
