// npm run half: what a highp-to-mediump reduction would cost, per corpus. Every fragment shader is
// rendered as written and again with every float intermediate rounded to fp16 (test/half.ts), the
// way a phone runs mediump, and the two images are compared the way the pixel test compares a
// minified shader with its original. A shader "within rounding" would survive the reduction; the
// others say how far off they land. Needs the browser the pixel tests use.
import { babylonShaders, glTransitions, playcanvasShaders, threeShaders, type CorpusShader } from "../test/corpora.js";
import { emulateHalf } from "../test/half.js";
import { activeSource, countDifferingPixels, glslVersion, judgePixels, seeds, shaderInterface, ShaderRunner, type RenderConfig } from "../test/pixels.js";
import { readTomto, tomtoShaders } from "../test/tomto.js";

interface Corpus { name: string; shaders: CorpusShader[] }
const corpora: Corpus[] = [
  { name: "tom.to", shaders: tomtoShaders().filter((n) => n.endsWith(".frag")).map((n) => ({ name: n, source: readTomto(n) })) },
  { name: "gl-transitions", shaders: glTransitions() },
  { name: "three.js", shaders: threeShaders() },
  { name: "Babylon.js", shaders: babylonShaders() },
  { name: "PlayCanvas", shaders: playcanvasShaders() },
];
const only = process.argv[2];

const runner = new ShaderRunner();
const why = await runner.open();
if (why !== null) { console.error(`no browser: ${why}`); process.exit(1); }

type Verdict = "within rounding" | "visible" | "broken" | "skipped";
const rows: { corpus: string; counts: Record<Verdict, number>; worst: string[] }[] = [];
for (const corpus of corpora) {
  if (only && corpus.name !== only) continue;
  const counts: Record<Verdict, number> = { "within rounding": 0, visible: 0, broken: 0, skipped: 0 };
  const worst: string[] = [];
  for (const s of corpus.shaders) {
    const file = s.name.replace(/\.glsl$/, ".frag");
    if (!file.endsWith(".frag")) continue;
    // three.js keeps its #if chains; the compiler decides them the same way for both renders. The
    // source is preprocessed here only so the emulation sees one declaration per name.
    const source = corpus.name === "three.js" ? activeSource(s.source).source : s.source;
    let half: string;
    try { half = emulateHalf(file, source); } catch (e) { counts.skipped++; worst.push(`${s.name}: ${String(e).split("\n")[0]}`); continue; }
    const version = glslVersion(source);
    const inputs = shaderInterface(file, source, "frag");
    const cfg = (src: string, seed: number): RenderConfig => ({ mode: "pixels", version, source: src, inputs, size: 48, vertices: 16, instances: 2, uniforms: s.uniforms, seed });
    let verdict: Verdict = "within rounding";
    let detail = "";
    for (const seed of seeds) {
      const a = await runner.run(cfg(source, seed));
      if (!a.ok) { verdict = "skipped"; detail = a.error.split("\n")[0]; break; }
      const b = await runner.run(cfg(half, seed));
      if (!b.ok) { verdict = "broken"; detail = b.error.split("\n")[0]; break; }
      const cmp = judgePixels(a.data, b.data, 0);
      if (cmp.same) continue;
      const moved = countDifferingPixels(a.data, b.data, 8);
      const pixels = a.data.length / 4;
      verdict = "visible";
      detail = `seed ${seed}: ${moved} of ${pixels} pixels off by more than 8 levels`;
      break;
    }
    counts[verdict]++;
    if (verdict !== "within rounding") worst.push(`${s.name}: ${verdict}, ${detail}`);
  }
  rows.push({ corpus: corpus.name, counts, worst });
}
await runner.close();

console.log("| corpus | fragment shaders | within rounding | visibly different | emulation rejected | skipped |");
console.log("|---|--:|--:|--:|--:|--:|");
for (const r of rows) {
  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  console.log(`| ${r.corpus} | ${total} | ${r.counts["within rounding"]} | ${r.counts.visible} | ${r.counts.broken} | ${r.counts.skipped} |`);
}
console.log();
for (const r of rows) for (const w of r.worst) console.log(`${r.corpus}/${w}`);
