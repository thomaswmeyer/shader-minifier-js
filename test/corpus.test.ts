// The pixel test (test/pixels.test.ts) over shaders from open source projects that ship on the
// web, vendored under test/corpus/ with their licenses:
//
//   gl-transitions (MIT, two BSD): 125 fragment transitions, wrapped for WebGL1 the way the
//     project's own runtime wraps them, with each transition's default parameters.
//   three.js (MIT): the programs three.js assembles for its materials, dumped from a real
//     renderer by scripts/dump-three-shaders.ts; vertex and fragment shaders, WebGL2.
//
// Each shader runs under the plugin's defaults and under upstream's rewrites alone. Refresh with
// `npm run corpus:gl-transitions` and `npm run corpus:three`. Skips without a browser.
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Minifier } from "../src/api.js";
import { ParseError, type Options } from "../src/options.js";
import { toMinifierOptions } from "../src/vite.js";
import { repoRoot } from "./golden.js";
import { compareVaryings, countDifferingPixels, glslVersion, judgePixels, perturbFloatLiterals, seeds, shaderInterface, ShaderRunner, type RenderConfig } from "./pixels.js";

interface Case { name: string; stage: "frag" | "vert"; source: string; options: Options; uniforms?: RenderConfig["uniforms"] }

const pluginDefaults = toMinifierOptions();
const upstreamOnly = toMinifierOptions({ noPiSubstitution: false, expandMacros: false, foldBuiltins: false, dropDefaultPrecision: false, inlineSingleUse: false, removeUnusedDeclarations: false });
const variants: [string, Options][] = [["plugin", pluginDefaults], ["upstream", upstreamOnly]];

const cases: Case[] = [];
const corpus = path.join(repoRoot, "test/corpus");
const list = (dir: string, re: RegExp): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort() : []);

// gl-transitions: `vec4 transition(vec2 uv)` over getFromColor/getToColor, progress and ratio.
const gltDir = path.join(corpus, "gl-transitions");
const gltParams: Record<string, Record<string, number | boolean | number[]>> = fs.existsSync(path.join(gltDir, "params.json")) ? JSON.parse(fs.readFileSync(path.join(gltDir, "params.json"), "utf8")) : {};
const gltHeader = `precision highp float;
varying vec2 _uv;
uniform sampler2D from, to;
uniform float progress, ratio;
vec4 getFromColor(vec2 uv) { return texture2D(from, uv); }
vec4 getToColor(vec2 uv) { return texture2D(to, uv); }
`;
const gltFooter = "\nvoid main() { gl_FragColor = transition(_uv); }\n";
for (const file of list(gltDir, /\.glsl$/)) {
  const name = file.replace(/\.glsl$/, "");
  const source = gltHeader + fs.readFileSync(path.join(gltDir, file), "utf8") + gltFooter;
  for (const [label, options] of variants) cases.push({ name: `gl-transitions/${name} [${label}]`, stage: "frag", source, options, uniforms: gltParams[name] });
}

// three.js: complete programs, as the renderer compiled them. They put `#if` blocks inside
// argument lists, which the parser cannot represent, so they need --preprocess, which decides
// every conditional from the #defines three.js wrote at the top.
const threeDir = path.join(corpus, "three");
for (const file of list(threeDir, /\.(vert|frag)$/)) {
  const source = fs.readFileSync(path.join(threeDir, file), "utf8");
  for (const [label, options] of variants) cases.push({ name: `three/${file} [${label}]`, stage: file.endsWith(".vert") ? "vert" : "frag", source, options: { ...options, preprocess: true } });
}

const runner = new ShaderRunner();
let unavailable: string | null = "not opened";

beforeAll(async () => { unavailable = await runner.open(); }, 60000);
afterAll(async () => { await runner.close(); });

describe("open source shader corpus renders the same", () => {
  for (const c of cases) {
    it(c.name, async (ctx) => {
      if (unavailable !== null) { ctx.skip(); return; }
      const version = glslVersion(c.source);
      const file = path.basename(c.name.split(" ")[0]);
      let minified: string;
      try {
        minified = new Minifier(c.options, [[file, c.source]]).format({ ...c.options, outputFormat: "text" });
      } catch (e) {
        if (e instanceof ParseError) { ctx.skip(`the minifier refuses the source: ${e.message.split("\n")[0]}`); return; }
        throw e;
      }
      const mode = c.stage === "frag" ? "pixels" : "varyings";
      const inputs = shaderInterface(file, c.source, c.stage);
      const cfg = (source: string): RenderConfig => ({ mode, version, source, inputs, size: 48, vertices: 16, instances: 2, uniforms: c.uniforms });
      // Several sets of inputs, so branches one set misses are still exercised.
      for (const seed of seeds) {
        const at = (source: string): RenderConfig => ({ ...cfg(source), seed });
        const original = await runner.run(at(c.source));
        if (!original.ok) { ctx.skip(`WebGL rejects the original: ${original.error.split("\n")[0]}`); return; }
        const result = await runner.run(at(minified));
        expect(result.ok, `minified shader failed: ${result.ok ? "" : result.error}\n${minified.slice(0, 4000)}`).toBe(true);
        if (!result.ok) return;
        if (mode === "varyings") {
          const cmp = compareVaryings(original.data, result.data, 1e-5);
          expect(cmp.same, `seed ${seed}: ${cmp.summary}\n${minified.slice(0, 4000)}`).toBe(true);
          continue;
        }
        const perturbed = await runner.run(at(perturbFloatLiterals(c.source)));
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
  const dir = path.join(corpus, "three");
  const names = [...new Set(list(dir, /\.(vert|frag)$/).map((f) => f.replace(/\.(vert|frag)$/, "")))]
    .filter((n) => fs.existsSync(path.join(dir, n + ".vert")) && fs.existsSync(path.join(dir, n + ".frag")));
  for (const name of names) {
    it(name, async (ctx) => {
      if (unavailable !== null) { ctx.skip(); return; }
      const options = { ...pluginDefaults, preprocess: true };
      const min = (ext: string): string => {
        const file = `${name}.${ext}`;
        const source = fs.readFileSync(path.join(dir, file), "utf8");
        return new Minifier(options, [[file, source]]).format({ ...options, outputFormat: "text" });
      };
      const cfg = (vert: string, frag: string): RenderConfig => ({ mode: "link", version: 2, source: vert, fragmentSource: frag, inputs: [], size: 8, vertices: 1, instances: 1 });
      const original = await runner.run(cfg(fs.readFileSync(path.join(dir, name + ".vert"), "utf8"), fs.readFileSync(path.join(dir, name + ".frag"), "utf8")));
      if (!original.ok) { ctx.skip(`the original program does not link: ${original.error.split("\n")[0]}`); return; }
      const result = await runner.run(cfg(min("vert"), min("frag")));
      expect(result.ok, result.ok ? "" : result.error.split("\n")[0]).toBe(true);
    }, 60000);
  }
});
