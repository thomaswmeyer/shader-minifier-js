// npm run metrics: output bytes over every corpus, as a markdown table.
//   source  -> bytes of the shader as written
//   upstream -> the port with upstream's rewrites only (the goldens' behaviour), externals kept
//   plugin   -> the Vite plugin's defaults
//   spglsl   -> Google ANGLE's minifier, when `npm install --no-save spglsl` was run
// Corpora: test/tomto, test/corpus/gl-transitions (wrapped as the pixel test wraps them),
// test/corpus/three (with --preprocess, as the pixel test runs them), and the WebGL-compatible
// shaders of upstream's corpus. A shader a minifier refuses counts under "refused" and is left out
// of that column's total, so totals are only comparable when the counts match.
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { Minifier } from "../src/api.js";
import type { Options } from "../src/options.js";
import { toMinifierOptions } from "../src/vite.js";
import { repoRoot } from "../test/golden.js";
import { readTomto, tomtoShaders } from "../test/tomto.js";

type Spglsl = { spglslAngleCompile: (o: object) => Promise<{ valid: boolean; output?: string }> };
let spglsl: Spglsl | null = null;
try { spglsl = createRequire(import.meta.url)("spglsl") as Spglsl; } catch { /* optional */ }

interface Shader { name: string; source: string; options?: Partial<Options> }
interface Corpus { name: string; shaders: Shader[] }

const corpora: Corpus[] = [];
corpora.push({ name: "tom.to", shaders: tomtoShaders().map((n) => ({ name: n, source: readTomto(n) })) });

const gltDir = path.join(repoRoot, "test/corpus/gl-transitions");
if (fs.existsSync(gltDir)) {
  const header = "precision highp float;\nvarying vec2 _uv;\nuniform sampler2D from, to;\nuniform float progress, ratio;\nvec4 getFromColor(vec2 uv) { return texture2D(from, uv); }\nvec4 getToColor(vec2 uv) { return texture2D(to, uv); }\n";
  const footer = "\nvoid main() { gl_FragColor = transition(_uv); }\n";
  corpora.push({ name: "gl-transitions", shaders: fs.readdirSync(gltDir).filter((f) => f.endsWith(".glsl")).sort().map((f) => ({ name: f, source: header + fs.readFileSync(path.join(gltDir, f), "utf8") + footer })) });
}
const threeDir = path.join(repoRoot, "test/corpus/three");
if (fs.existsSync(threeDir)) {
  corpora.push({ name: "three.js", shaders: fs.readdirSync(threeDir).filter((f) => /\.(vert|frag)$/.test(f)).sort().map((f) => ({ name: f, source: fs.readFileSync(path.join(threeDir, f), "utf8"), options: { preprocess: true } })) });
}
{
  const list = fs.readFileSync(path.join(repoRoot, "tests/compile.txt"), "utf8").split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3 && !p[0].startsWith("#"));
  const header = "#version 300 es\nprecision highp float;\nuniform vec3 iResolution; uniform float iTime, iTimeDelta; uniform int iFrame; uniform vec4 iMouse, iDate;\nuniform float iChannelTime[4]; uniform vec3 iChannelResolution[4];\nuniform sampler2D iChannel0, iChannel1, iChannel2, iChannel3;\n";
  const footer = "\nout vec4 shadertoy_out_color;\nvoid main(){ mainImage(shadertoy_out_color, gl_FragCoord.xy); }\n";
  const shaders: Shader[] = [];
  for (const [kind, , out] of list) {
    if (kind !== "shadertoy") continue;
    const base = path.basename(out).replace(".minind", "");
    const file = path.join(repoRoot, "tests/real", base);
    if (fs.existsSync(file)) shaders.push({ name: base, source: header + fs.readFileSync(file, "utf8") + footer });
  }
  corpora.push({ name: "upstream shadertoy", shaders });
}

const upstream = toMinifierOptions({ noPiSubstitution: false, expandMacros: false, foldBuiltins: false, dropDefaultPrecision: false, inlineSingleUse: false });
const plugin = toMinifierOptions();
const bytes = (options: Options, s: Shader): number | null => {
  try {
    const o = { ...options, ...s.options };
    return new Minifier(o, [[s.name, s.source]]).format({ ...o, outputFormat: "text" }).length;
  } catch { return null; }
};
const angle = async (s: Shader): Promise<number | null> => {
  if (spglsl === null) return null;
  try {
    const r = await spglsl.spglslAngleCompile({ mainSourceCode: s.source, mainFilePath: s.name, language: /\bgl_Position\b|\bgl_PointSize\b/.test(s.source) ? "Vertex" : "Fragment", compileMode: "Optimize", minify: true, mangle: true });
    return r.valid && typeof r.output === "string" ? r.output.length : null;
  } catch { return null; }
};

const pct = (a: number, b: number): string => (b === 0 ? "" : `${(100 * (b - a) / b).toFixed(1)}%`);
const rows: string[] = [];
rows.push(`| corpus | shaders | source | upstream rewrites | plugin defaults | plugin vs upstream | spglsl (ANGLE) | plugin vs spglsl |`);
rows.push(`|---|--:|--:|--:|--:|--:|--:|--:|`);
const largest: string[] = [];
for (const corpus of corpora) {
  let source = 0, up = 0, pl = 0, sp = 0, spSource = 0, upSource = 0, plSource = 0, refusedUp = 0, refusedPl = 0, refusedSp = 0;
  const perShader: [string, number, number | null, number | null, number | null][] = [];
  for (const s of corpus.shaders) {
    const u = bytes(upstream, s), p = bytes(plugin, s), a = await angle(s);
    source += s.source.length;
    if (u === null) refusedUp++; else { up += u; upSource += s.source.length; }
    if (p === null) refusedPl++; else { pl += p; plSource += s.source.length; }
    if (a === null) refusedSp++; else { sp += a; spSource += s.source.length; }
    perShader.push([s.name, s.source.length, u, p, a]);
  }
  const note = (n: number) => (n > 0 ? ` (${n} refused)` : "");
  rows.push(`| ${corpus.name} | ${corpus.shaders.length} | ${source.toLocaleString("en")} | ${up.toLocaleString("en")}${note(refusedUp)} | ${pl.toLocaleString("en")}${note(refusedPl)} | ${refusedUp === refusedPl ? pct(pl, up) : ""} | ${spglsl === null ? "n/a" : sp.toLocaleString("en") + note(refusedSp)} | ${spglsl !== null && refusedSp === refusedPl && refusedSp === 0 ? pct(pl, sp) : ""} |`);
  perShader.sort((x, y) => y[1] - x[1]);
  for (const [name, src, u, p, a] of perShader.slice(0, 3)) largest.push(`| ${corpus.name}/${name} | ${src.toLocaleString("en")} | ${u ?? "refused"} | ${p ?? "refused"} | ${a === null ? (spglsl === null ? "n/a" : "refused") : a} |`);
}
console.log(rows.join("\n"));
console.log("\nLargest shaders of each corpus:\n");
console.log("| shader | source | upstream rewrites | plugin defaults | spglsl |\n|---|--:|--:|--:|--:|");
console.log(largest.join("\n"));
