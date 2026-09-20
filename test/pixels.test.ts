// The minified shader must compute what the original computes. Each case renders both in
// headless Chromium with the same deterministic inputs (test/pixels.ts) and compares pixels
// (fragment shaders) or transform-feedback output (vertex shaders). Covers test/tomto, the
// semantic fixtures in test/pixels/, and the WebGL-compatible shaders of upstream's corpus.
// Skips when no browser launches: `npx playwright install chromium` or set CHROMIUM_EXECUTABLE.
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Minifier } from "../src/api.js";
import { ParseError, type Options } from "../src/options.js";
import { pluginOptions, upstreamOptions } from "./corpora.js";
import { repoRoot } from "./golden.js";
import { compareVaryings, countDifferingPixels, glslVersion, judgePixels, perturbFloatLiterals, seeds, shaderInterface, ShaderRunner, toEs100, type RenderConfig } from "./pixels.js";
import { readTomto, tomtoShaders } from "./tomto.js";

interface Case { name: string; stage: "frag" | "vert"; source: string; options: Options }

const pluginDefaults = pluginOptions();
/** Upstream's rewrites alone (--webgl only skips two of them), externals kept so uniforms can be set by name. */
const upstreamOnly: Options = upstreamOptions();

const cases: Case[] = [];
const add = (name: string, source: string, variants: [string, Options][] = [["plugin", pluginDefaults], ["upstream", upstreamOnly]]): void => {
  const stage = name.endsWith(".vert") ? "vert" : "frag";
  for (const [label, options] of variants) cases.push({ name: `${name} [${label}]`, stage, source, options });
};

for (const name of tomtoShaders()) add(`tomto/${name}`, readTomto(name));

const fixtureDir = path.join(repoRoot, "test/pixels");
for (const name of fs.readdirSync(fixtureDir).filter((f) => /\.(frag|vert)$/.test(f)).sort()) {
  add(`pixels/${name}`, fs.readFileSync(path.join(fixtureDir, name), "utf8"));
}

// Upstream's real-world shaders that WebGL can compile: the GLSL 1.10/1.30 ones as ES 1.00, the
// shadertoy ones wrapped the way shadertoy.com does, as tests/compile.txt lists them. Unlike
// tests/shadertoy.h.glsl (made for a compile check without textures) the wrapper keeps the real
// texture builtin, since the harness binds textures; its prototype makes function reordering run.
const shadertoyHeader = `#version 300 es
precision highp float;
uniform vec3 iResolution; uniform float iTime, iTimeDelta; uniform int iFrame; uniform vec4 iMouse, iDate;
uniform float iChannelTime[4]; uniform vec3 iChannelResolution[4];
uniform sampler2D iChannel0, iChannel1, iChannel2, iChannel3;
void mainImage(out vec4 O, vec2 f);
`;
const shadertoyFooter = "\nout vec4 shadertoy_out_color;\nvoid main(){ mainImage(shadertoy_out_color, gl_FragCoord.xy); }\n";
const compileList = fs.readFileSync(path.join(repoRoot, "tests/compile.txt"), "utf8").split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3 && !p[0].startsWith("#"));
for (const [kind, , out] of compileList) {
  if (kind !== "shadertoy" && kind !== "110") continue;
  const base = path.basename(out).replace(".minind", "");
  const file = path.join(repoRoot, "tests/real", base);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  add(`real/${base}`, kind === "shadertoy" ? shadertoyHeader + source + shadertoyFooter : toEs100(source));
}

const runner = new ShaderRunner();
let unavailable: string | null = "not opened";

beforeAll(async () => { unavailable = await runner.open(); }, 60000);
afterAll(async () => { await runner.close(); });

describe("minified shaders render the same pixels", () => {
  for (const c of cases) {
    it(c.name, async (ctx) => {
      if (unavailable !== null) { ctx.skip(); return; }
      const version = glslVersion(c.source);
      let minified: string;
      try {
        minified = new Minifier(c.options, [[path.basename(c.name.split(" ")[0]), c.source]]).format({ ...c.options, outputFormat: "text" });
      } catch (e) {
        if (e instanceof ParseError) { ctx.skip(`the minifier refuses the source: ${e.message.split("\n")[0]}`); return; }
        throw e;
      }
      const mode = c.stage === "frag" ? "pixels" : "varyings";
      const inputs = shaderInterface(c.name, c.source, c.stage);
      const cfg = (source: string): RenderConfig => ({ mode, version, source, inputs, size: 48, vertices: 16, instances: 2 });
      // Several sets of inputs, so branches one set misses are still exercised.
      for (const seed of seeds) {
        const at = (source: string): RenderConfig => ({ ...cfg(source), seed });
        const original = await runner.run(at(c.source));
        if (!original.ok) { ctx.skip(`WebGL rejects the original: ${original.error.split("\n")[0]}`); return; }
        const result = await runner.run(at(minified));
        expect(result.ok, `minified shader failed: ${result.ok ? "" : result.error}\n${minified}`).toBe(true);
        if (!result.ok) return;
        if (mode === "varyings") {
          const cmp = compareVaryings(original.data, result.data, 1e-5);
          expect(cmp.same, `seed ${seed}: ${cmp.summary}\n${minified}`).toBe(true);
          continue;
        }
        // Constant folding rounds like a one-ulp change of a literal; a shader that flips pixels on
        // that (a raymarcher at a hit threshold) may flip as many again in its minified form.
        const perturbed = await runner.run(at(perturbFloatLiterals(c.source)));
        const noise = perturbed.ok ? countDifferingPixels(original.data, perturbed.data, 1) : 0;
        const cmp = judgePixels(original.data, result.data, noise);
        if (cmp.chaotic) { ctx.skip(`chaotic shader (seed ${seed}): ${cmp.summary}`); return; }
        expect(cmp.same, `seed ${seed}: ${cmp.summary}\n${minified}`).toBe(true);
      }
    }, 60000);
  }
});
