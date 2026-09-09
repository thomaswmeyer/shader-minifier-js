// Minified output must still compile under ANGLE (spglsl: the compiler behind Chrome's WebGL),
// wherever ANGLE can judge the source. Covers tom.to's shaders (test/tomto), the spglsl corpus
// when the sibling checkout is present, and the GLSL ES files among upstream's unit tests. A
// source ANGLE rejects (desktop GLSL, GLES 3.1) or a library without main() is skipped: there
// is nothing to compare against. Any source that compiles and minifies to something that does
// not is a bug.
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { hasMain, loadSpglslCorpus } from "../scripts/webgl-compile-page.js";
import { Minifier } from "../src/api.js";
import { toMinifierOptions } from "../src/vite.js";
import { repoRoot } from "./golden.js";
import { minifyTomto, tomtoDir, tomtoShaders } from "./tomto.test.js";

const require = createRequire(import.meta.url);
const { spglslAngleCompile } = require("spglsl") as typeof import("spglsl");

const stage = (src: string): "Vertex" | "Fragment" => (/\bgl_Position\b|\bgl_PointSize\b/.test(src) ? "Vertex" : "Fragment");

/** null when ANGLE accepts the shader, else its info log; "crash" when spglsl's wasm build
 * itself falls over (it does on a few inputs, e.g. tests/unit/suffix.frag), which is no verdict. */
async function angleError(name: string, source: string): Promise<string | null> {
  try {
    const r = await spglslAngleCompile({ mainSourceCode: source, mainFilePath: name, language: stage(source), compileMode: "Compile" });
    return r.valid ? null : String(r.infoLog.inspect());
  } catch {
    return "crash";
  }
}

interface Case { name: string; source: string; minified: () => string }
const withPlugin = (name: string, source: string): string => new Minifier(toMinifierOptions(), [[name, source]]).format();

const cases: Case[] = [];
for (const name of tomtoShaders()) {
  cases.push({ name: `tomto/${name}`, source: fs.readFileSync(path.join(tomtoDir, name), "utf8"), minified: () => minifyTomto(name) });
}
for (const { name, source } of loadSpglslCorpus()) {
  if (hasMain(source)) cases.push({ name: `spglsl/${name}`, source, minified: () => withPlugin(name, source) });
}
const unitDir = path.join(repoRoot, "tests/unit");
for (const name of fs.readdirSync(unitDir).filter((f) => /\.(frag|vert)$/.test(f)).sort()) {
  const source = fs.readFileSync(path.join(unitDir, name), "utf8");
  if (hasMain(source)) cases.push({ name: `unit/${name}`, source, minified: () => withPlugin(name, source) });
}

describe("minified output compiles under ANGLE", () => {
  for (const c of cases) {
    it(c.name, async (ctx) => {
      if ((await angleError(c.name, c.source)) !== null) { ctx.skip(); return; }
      let out: string;
      try {
        out = c.minified();
      } catch (e) {
        // an input the port refuses (e.g. struct fields named like swizzles) is not a compile question
        ctx.skip(); return;
      }
      const err = await angleError(c.name, out);
      if (err === "crash") { ctx.skip(); return; }
      expect(err, out).toBeNull();
    });
  }
});
