// npm run webgl-page: writes tests/out/webgl-compile.html, which compiles minified shaders in WebGL 1/2.
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { Minifier } from "../src/api.js";
import * as Printer from "../src/printer.js";
import { loadCommands, repoRoot } from "../test/golden.js";

export const spglslShaders = process.env.SPGLSL_SHADERS ?? path.resolve(repoRoot, "../spglsl/project/test/shaders");

// GLES 3.1 features (atomic counters, images, multiview...) are outside WebGL 1/2, the port's target.
const outOfScope = /-(GLES3_1|WEBGL3)\.(frag|vert)$/;

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

export function loadSpglslCorpus(): { name: string; source: string }[] {
  if (!fs.existsSync(spglslShaders)) return [];
  return walk(spglslShaders)
    .filter((f) => /\.(frag|vert)$/.test(f) && !outOfScope.test(f))
    .sort()
    .map((f) => ({ name: path.relative(spglslShaders, f), source: fs.readFileSync(f, "utf8") }));
}

// A file without main() is a library: keep its functions so sizes compare like-for-like with spglsl.
export const hasMain = (source: string): boolean => /\bmain\s*\(/.test(source);

export function minifyToText(name: string, source: string): string {
  const options = Minifier.parseOptions(["--format", "text", ...(hasMain(source) ? [] : ["--no-remove-unused"])]);
  return Printer.print(new Minifier(options, [[name, source]]).shaders[0].code);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main(): void {
interface Entry { name: string; version: 1 | 2; stage: "frag" | "vert"; original: string; minified: string }
const entries: Entry[] = [];

process.chdir(repoRoot);

for (const { name, source } of loadSpglslCorpus()) {
  let minified: string;
  try { minified = minifyToText(name, source); } catch { continue; }
  entries.push({ name: `spglsl/${name}`, version: /#version 3\d0 es/.test(source) ? 2 : 1, stage: name.endsWith(".vert") ? "vert" : "frag", original: source, minified });
}

const commands = loadCommands();
function minifyCommand(outputName: string): { source: string; minified: string } {
  const argv = commands.find((a) => a[a.indexOf("-o") + 1] === outputName);
  if (argv === undefined) throw new Error("no command for " + outputName);
  const { options, filenames } = Minifier.parseOptionsWithFiles(argv);
  const source = fs.readFileSync(filenames[0], "utf8");
  return { source, minified: Printer.print(new Minifier(options, [[filenames[0], source]]).shaders[0].code) };
}

// tests/compile.txt: "shadertoy" entries are validated with tests/shadertoy.h.glsl prepended; "110" entries as plain GLSL.
const shadertoyHeader = "#version 300 es\n" + fs.readFileSync("tests/shadertoy.h.glsl", "utf8");
const compileList = fs.readFileSync("tests/compile.txt", "utf8").split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3 && !p[0].startsWith("#"));
for (const [kind, stage, out] of compileList) {
  if (kind !== "shadertoy" && kind !== "110") continue;
  const base = path.basename(out).replace(/\.minind\./, ".");
  const outputName = commands.map((a) => a[a.indexOf("-o") + 1]).find((o) => path.basename(o).replace(/\.expected$/, "").replace(/\.frag$/, "") === base.replace(/\.frag$/, ""));
  if (outputName === undefined) throw new Error("no golden command for " + out);
  const { source, minified } = minifyCommand(outputName);
  const es100 = (s: string) => (/^\s*precision /m.test(s) ? "" : "precision highp float;\n") + s.replace(/^#version.*\n/m, "");
  entries.push(kind === "shadertoy"
    ? { name: `shadertoy/${base}`, version: 2, stage: stage as "frag", original: shadertoyHeader + source, minified: shadertoyHeader + minified }
    : { name: `glsl110/${base}`, version: 1, stage: stage as "frag", original: es100(source), minified: es100(minified) });
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>shader-minifier-js WebGL compile check</title>
<style>body{font:13px monospace}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px;vertical-align:top}.ok{background:#dfd}.fail{background:#fdd}pre{white-space:pre-wrap}</style>
<h1>WebGL compile check</h1>
<p id="summary"></p>
<table id="table"><tr><th>shader</th><th>WebGL</th><th>original</th><th>minified</th><th>minified log</th></tr></table>
<pre id="results"></pre>
<script>
const entries = ${JSON.stringify(entries)};
const gls = { 1: document.createElement("canvas").getContext("webgl"), 2: document.createElement("canvas").getContext("webgl2") };
function compile(gl, stage, src) {
  if (!gl) return { ok: false, log: "no context" };
  const sh = gl.createShader(stage === "vert" ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
  const log = gl.getShaderInfoLog(sh) || ""; gl.deleteShader(sh);
  return { ok, log };
}
const results = entries.map((e) => {
  const gl = gls[e.version];
  const original = compile(gl, e.stage, e.original), minified = compile(gl, e.stage, e.minified);
  return { name: e.name, version: e.version, ok: minified.ok, originalOk: original.ok, log: minified.log, originalLog: original.log };
});
const table = document.getElementById("table");
for (const r of results) {
  const tr = table.insertRow();
  for (const [text, cls] of [[r.name], ["WebGL" + r.version], [r.originalOk ? "ok" : "FAIL", r.originalOk ? "ok" : "fail"], [r.ok ? "ok" : "FAIL", r.ok ? "ok" : "fail"], [r.log]]) {
    const td = tr.insertCell(); td.textContent = text; if (cls) td.className = cls;
  }
}
const regressions = results.filter((r) => r.originalOk && !r.ok).length;
document.getElementById("summary").textContent = results.length + " shaders, " + results.filter((r) => r.ok).length + " minified compile OK, " + regressions + " regressions (original OK but minified fails)";
document.getElementById("results").textContent = JSON.stringify(results, null, 1);
</script>
`;
fs.mkdirSync("tests/out", { recursive: true });
fs.writeFileSync("tests/out/webgl-compile.html", html);
console.log(`wrote tests/out/webgl-compile.html with ${entries.length} shaders`);
}
