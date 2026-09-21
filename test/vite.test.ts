// The plugin must work in a real vite build, not only through its hooks.
import * as fs from "node:fs";
import * as path from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { shaderMinifier, toMinifierOptions } from "../src/vite.js";
import { repoRoot } from "./golden.js";

const root = path.join(repoRoot, "tests/out/vite-sample");
const frag = "uniform float uTime;\nfloat wave(float x) { return sin(x + uTime); }\nvoid main() {\n  float a = 1.5 + 2.25;\n  gl_FragColor = vec4(wave(a));\n}\n";
const expected = "uniform float uTime;void main(){gl_FragColor=vec4(sin(3.75+uTime));}";

function writeSample(): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "a.frag"), frag);
  fs.writeFileSync(path.join(root, "main.js"), 'import a from "./a.frag";\nimport b from "./a.frag?raw";\nconsole.log(a, b);\n');
}

describe("vite plugin", () => {
  it("maps plugin options onto minifier options", () => {
    const o = toMinifierOptions({ noRenamingList: ["uColor"], noSequence: true, options: { moveDeclarations: true } });
    expect(o.webgl).toBe(true);
    expect(o.preserveExternals).toBe(true);
    expect(o.noRenamingList).toEqual(["main", "mainImage", "uColor"]);
    expect(o.noSequence).toBe(true);
    expect(o.moveDeclarations).toBe(true);
    expect(o.outputFormat).toBe("text");
  });

  it("takes a level, and overrides for the files a pattern matches", () => {
    expect(toMinifierOptions({ level: 1 }).expandMacros).toBe(false);
    expect(toMinifierOptions({ level: 1 }).inlineSingleUse).toBe(true);
    const plugin = { noRenamingList: ["uColor"], overrides: [
      { include: /noise|hash/, approximateFolds: false, noRenamingList: ["seed"] },
      { include: /\.vert$/, level: 1 as const, options: { moveDeclarations: true } },
    ] };
    expect(toMinifierOptions(plugin).approximateFolds).toBe(true); // no file: the settings above the overrides
    expect(toMinifierOptions(plugin, "/src/noise.frag").approximateFolds).toBe(false);
    expect(toMinifierOptions(plugin, "/src/noise.frag").noRenamingList).toEqual(["main", "mainImage", "uColor", "seed"]);
    expect(toMinifierOptions(plugin, "/src/water.frag").approximateFolds).toBe(true);
    expect(toMinifierOptions(plugin, "/src/water.vert").expandMacros).toBe(false);
    expect(toMinifierOptions(plugin, "/src/water.vert").moveDeclarations).toBe(true);
    expect(toMinifierOptions(plugin, "/src/water.vert").webgl).toBe(true);
    // The plugin applies them per file: the override keeps radians(45.) in the matching file.
    writeSample();
    fs.writeFileSync(path.join(root, "hash.frag"), "void main(){gl_FragColor=vec4(radians(45.));}\n");
    const load = shaderMinifier({ overrides: [{ include: /hash/, approximateFolds: false }] }).load as (id: string) => { code: string } | null;
    expect(load(path.join(root, "hash.frag"))?.code).toContain("radians(45.)");
    expect(load(path.join(root, "a.frag"))?.code).toBe(`export default ${JSON.stringify(expected)};`);
  });

  it("loads matching files as minified default exports", () => {
    writeSample();
    const plugin = shaderMinifier();
    const load = plugin.load as (id: string) => { code: string } | null;
    expect(load(path.join(root, "main.js"))).toBeNull();
    expect(load(path.join(root, "a.frag"))?.code).toBe(`export default ${JSON.stringify(expected)};`);
    expect(load(path.join(root, "a.frag?raw"))?.code).toBe(`export default ${JSON.stringify(expected)};`);
  });

  it("resolves #include relative to the including file, recursively, and watches what it read", () => {
    writeSample();
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "lib/common.glsl"), '#include "./consts.glsl"\nfloat twice(float x) { return x * TWO; }\n');
    fs.writeFileSync(path.join(root, "lib/consts.glsl"), "#define TWO 2.0\n");
    fs.writeFileSync(path.join(root, "b.frag"), '#include "lib/common.glsl"\nuniform float u;\nvoid main() { gl_FragColor = vec4(twice(u)); }\n');
    const watched: string[] = [];
    const plugin = shaderMinifier();
    const load = (plugin.load as (this: unknown, id: string) => { code: string } | null).bind({ addWatchFile: (f: string) => watched.push(f) });
    expect(load(path.join(root, "b.frag"))?.code).toBe(`export default ${JSON.stringify("uniform float u;void main(){gl_FragColor=vec4(u*2.);}")};`);
    expect(watched).toEqual([path.join(root, "lib/common.glsl"), path.join(root, "lib/consts.glsl")]);
    // The hook also runs without a plugin context, as these tests call it.
    expect((plugin.load as (id: string) => { code: string } | null)(path.join(root, "b.frag"))?.code).toContain("u*2.");
  });

  it("reports a missing include and an include cycle with the file and line", () => {
    writeSample();
    fs.writeFileSync(path.join(root, "missing.frag"), 'uniform float u;\n#include "nowhere.glsl"\nvoid main(){gl_FragColor=vec4(u);}\n');
    fs.writeFileSync(path.join(root, "loop.frag"), '#include "loop.frag"\nvoid main(){gl_FragColor=vec4(1);}\n');
    const load = shaderMinifier().load as (id: string) => unknown;
    expect(() => load(path.join(root, "missing.frag"))).toThrow(/missing\.frag:2: #include "nowhere\.glsl": no such file/);
    expect(() => load(path.join(root, "loop.frag"))).toThrow(/loop\.frag:1: #include cycle/);
  });

  it("runs in a real vite build", async () => {
    writeSample();
    const result = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [shaderMinifier()],
      build: { write: false, minify: false, rollupOptions: { input: path.join(root, "main.js") } },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const js = outputs.flatMap((o) => ("output" in o ? o.output : [])).map((c) => ("code" in c ? c.code : "")).join("\n");
    expect(js).toContain(JSON.stringify(expected));
    expect(js).not.toContain("float wave(");
  });
});
