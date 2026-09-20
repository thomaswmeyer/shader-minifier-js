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
import * as zlib from "node:zlib";
import { Minifier } from "../src/api.js";
import type { Options } from "../src/options.js";
import { babylonShaders, glTransitions, playcanvasShaders, pluginOptions, threeShaders, upstreamOptions } from "../test/corpora.js";
import { repoRoot } from "../test/golden.js";
import { readTomto, tomtoShaders } from "../test/tomto.js";

type Spglsl = { spglslAngleCompile: (o: object) => Promise<{ valid: boolean; output?: string }> };
let spglsl: Spglsl | null = null;
try { spglsl = createRequire(import.meta.url)("spglsl") as Spglsl; } catch { /* optional */ }

interface Shader { name: string; source: string; options?: Partial<Options> }
interface Corpus { name: string; shaders: Shader[] }


const corpora: Corpus[] = [];
corpora.push({ name: "tom.to", shaders: tomtoShaders().map((n) => ({ name: n, source: readTomto(n) })) });

const glt = glTransitions();
if (glt.length > 0) corpora.push({ name: "gl-transitions", shaders: glt });
const three = threeShaders();
if (three.length > 0) corpora.push({ name: "three.js", shaders: three });
const babylon = babylonShaders();
if (babylon.length > 0) corpora.push({ name: "Babylon.js", shaders: babylon });
const playcanvas = playcanvasShaders();
if (playcanvas.length > 0) corpora.push({ name: "PlayCanvas", shaders: playcanvas });
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

const upstream = upstreamOptions();
const plugin = pluginOptions();
const text = (options: Options, s: Shader): string | null => {
  try {
    const o = { ...options, ...s.options };
    return new Minifier(o, [[s.name, s.source]]).format({ ...o, outputFormat: "text" });
  } catch { return null; }
};
const angle = async (s: Shader): Promise<string | null> => {
  if (spglsl === null) return null;
  try {
    const r = await spglsl.spglslAngleCompile({ mainSourceCode: s.source, mainFilePath: s.name, language: /\bgl_Position\b|\bgl_PointSize\b/.test(s.source) ? "Vertex" : "Fragment", compileMode: "Optimize", minify: true, mangle: true });
    return r.valid && typeof r.output === "string" ? r.output : null;
  } catch { return null; }
};

const pct = (a: number, b: number): string => (b === 0 ? "" : `${(100 * (b - a) / b).toFixed(1)}%`);
// What actually ships: the shaders of a corpus travel together in one bundle, compressed once, so
// the number that matters is the compression of their concatenation, not the sum of compressing
// each alone. It also counts what the shaders share, which is most of an engine's chunk text.
// Brotli at quality 11 is what a CDN serves a static asset with.
// Brotli at quality 11 is what a CDN serves a static asset with; gzip -9 is what an older server
// or a proxy without brotli gives. The two disagree here, and the reason is the window: gzip looks
// back 32 KB, brotli much further, so gzip cannot compress one shader against another once a
// corpus is bigger than its window. Any claim about "compressed size" has to say which.
const brotli = (parts: string[]): number =>
  zlib.brotliCompressSync(Buffer.from(parts.join("\n"), "utf8"), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const gzip = (parts: string[]): number => zlib.gzipSync(Buffer.from(parts.join("\n"), "utf8"), { level: 9 }).length;
const rows: string[] = [];
rows.push(`| corpus | shaders | source | upstream rewrites | plugin defaults | plugin vs upstream | spglsl (ANGLE) | plugin vs spglsl |`);
rows.push(`|---|--:|--:|--:|--:|--:|--:|--:|`);
const header = `| corpus | source | upstream rewrites | plugin defaults | plugin vs upstream | spglsl (ANGLE) | plugin vs spglsl |\n|---|--:|--:|--:|--:|--:|--:|`;
const compressed: string[] = [header];
const compressedGz: string[] = [header];
const largest: string[] = [];
for (const corpus of corpora) {
  let source = 0, up = 0, pl = 0, sp = 0, spSource = 0, upSource = 0, plSource = 0, refusedUp = 0, refusedPl = 0, refusedSp = 0;
  const perShader: [string, number, number | null, number | null, number | null][] = [];
  const texts: Record<"source" | "up" | "pl" | "sp", string[]> = { source: [], up: [], pl: [], sp: [] };
  for (const s of corpus.shaders) {
    const u = text(upstream, s), p = text(plugin, s), a = await angle(s);
    source += s.source.length;
    texts.source.push(s.source);
    if (u === null) refusedUp++; else { up += u.length; upSource += s.source.length; texts.up.push(u); }
    if (p === null) refusedPl++; else { pl += p.length; plSource += s.source.length; texts.pl.push(p); }
    if (a === null) refusedSp++; else { sp += a.length; spSource += s.source.length; texts.sp.push(a); }
    perShader.push([s.name, s.source.length, u === null ? null : u.length, p === null ? null : p.length, a === null ? null : a.length]);
  }
  for (const [rows, z] of [[compressed, brotli], [compressedGz, gzip]] as [string[], (p: string[]) => number][]) {
    const cSource = z(texts.source), cUp = z(texts.up), cPl = z(texts.pl);
    const cSp = spglsl === null ? null : z(texts.sp);
    rows.push(`| ${corpus.name} | ${cSource.toLocaleString("en")} | ${cUp.toLocaleString("en")} | ${cPl.toLocaleString("en")} | ${refusedUp === refusedPl ? pct(cPl, cUp) : ""} | ${cSp === null ? "n/a" : cSp.toLocaleString("en")} | ${cSp !== null && refusedSp === refusedPl && refusedSp === 0 ? pct(cPl, cSp) : ""} |`);
  }
  const note = (n: number) => (n > 0 ? ` (${n} refused)` : "");
  rows.push(`| ${corpus.name} | ${corpus.shaders.length} | ${source.toLocaleString("en")} | ${up.toLocaleString("en")}${note(refusedUp)} | ${pl.toLocaleString("en")}${note(refusedPl)} | ${refusedUp === refusedPl ? pct(pl, up) : ""} | ${spglsl === null ? "n/a" : sp.toLocaleString("en") + note(refusedSp)} | ${spglsl !== null && refusedSp === refusedPl && refusedSp === 0 ? pct(pl, sp) : ""} |`);
  perShader.sort((x, y) => y[1] - x[1]);
  for (const [name, src, u, p, a] of perShader.slice(0, 3)) largest.push(`| ${corpus.name}/${name} | ${src.toLocaleString("en")} | ${u ?? "refused"} | ${p ?? "refused"} | ${a === null ? (spglsl === null ? "n/a" : "refused") : a} |`);
}
console.log(rows.join("\n"));
console.log("\nAfter brotli -q 11, each corpus compressed as one bundle:\n");
console.log(compressed.join("\n"));
console.log("\nAfter gzip -9, the same:\n");
console.log(compressedGz.join("\n"));
console.log("\nLargest shaders of each corpus:\n");
console.log("| shader | source | upstream rewrites | plugin defaults | spglsl |\n|---|--:|--:|--:|--:|");
console.log(largest.join("\n"));
