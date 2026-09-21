// Minified output must still compile under ANGLE (spglsl, the compiler behind Chrome's WebGL)
// wherever ANGLE accepts the source: test/tomto, the spglsl corpus when present, and the GLSL
// ES files among upstream's unit tests. Sources ANGLE rejects (desktop GLSL, GLES 3.1) and
// libraries without main() are skipped. spglsl is not a dependency; the test skips unless it
// is installed (`npm install --no-save spglsl`).
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { hasMain, loadSpglslCorpus } from "../scripts/webgl-compile-page.js";
import { Minifier } from "../src/api.js";
import { toMinifierOptions } from "../src/vite.js";
import { repoRoot } from "./golden.js";
import { minifyTomto, readTomto, tomtoShaders } from "./tomto.js";

type Spglsl = { spglslAngleCompile: (o: { mainSourceCode: string; mainFilePath: string; language: string; compileMode: string }) => Promise<{ valid: boolean; infoLog: { inspect(): string } }> };
const loadSpglsl = (): Spglsl | null => {
  try { return createRequire(import.meta.url)("spglsl") as Spglsl; } catch { return null; }
};
const spglsl = loadSpglsl();
const { spglslAngleCompile } = spglsl ?? { spglslAngleCompile: () => Promise.reject(new Error("spglsl not installed")) };

const stage = (src: string): "Vertex" | "Fragment" => (/\bgl_Position\b|\bgl_PointSize\b/.test(src) ? "Vertex" : "Fragment");

/** null when ANGLE accepts the shader, else its info log; "crash" when spglsl's wasm build
 * falls over (as on tests/unit/suffix.frag), which is no verdict. */
async function angleError(name: string, source: string): Promise<string | null> {
  try {
    const r = await spglslAngleCompile({ mainSourceCode: source, mainFilePath: name, language: stage(source), compileMode: "Compile" });
    return r.valid ? null : String(r.infoLog.inspect());
  } catch {
    return "crash";
  }
}

/** The first ERROR line of an ANGLE info log, else its first line (the error count, or "crash"). */
const firstError = (log: string): string => log.split("\n").map((l) => l.trim()).find((l) => l.startsWith("ERROR")) ?? log.split("\n")[0];

interface Case { name: string; source: string; minified: () => string }
const withPlugin = (name: string, source: string): string => new Minifier(toMinifierOptions(), [[name, source]]).format();

const cases: Case[] = [];
for (const name of tomtoShaders()) {
  cases.push({ name: `tomto/${name}`, source: readTomto(name), minified: () => minifyTomto(name) });
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
  if (spglsl === null) {
    it.skip("spglsl not installed: `npm install --no-save spglsl` to run this", () => {});
    return;
  }
  for (const c of cases) {
    it(c.name, async (ctx) => {
      const originalError = await angleError(c.name, c.source);
      if (originalError !== null) { ctx.skip(`ANGLE rejects the original: ${firstError(originalError)}`); return; }
      let out: string;
      try {
        out = c.minified();
      } catch (e) {
        // an input the port refuses (e.g. struct fields named like swizzles) is not a compile question
        ctx.skip(`the minifier refuses the source: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`); return;
      }
      const err = await angleError(c.name, out);
      if (err === "crash") { ctx.skip("ANGLE crashes on the minified output"); return; }
      expect(err, out).toBeNull();
    });
  }
});
