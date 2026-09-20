// npm run corpus:gl-transitions: vendor the gl-transitions shaders (MIT, with two BSD entries) into
// test/corpus/gl-transitions/, one .glsl per transition with its author and license in a header
// comment, params.json with each transition's default uniform values, LICENSE and VERSION.
// The pixel test wraps them for WebGL1 (test/corpus.test.ts).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { repoRoot } from "../test/golden.js";

const version = process.argv[2] ?? "1.71.0";
const out = path.join(repoRoot, "test/corpus/gl-transitions");
const work = path.join(repoRoot, "tests/out/gl-transitions-pack");

interface Transition { name: string; author: string; license: string; glsl: string; defaultParams: Record<string, unknown>; paramsTypes: Record<string, string> }

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
execFileSync("npm", ["pack", `gl-transitions@${version}`, "--pack-destination", work], { stdio: "inherit" });
execFileSync("tar", ["xzf", path.join(work, `gl-transitions-${version}.tgz`), "-C", work]);
const pkg = path.join(work, "package");
const transitions = JSON.parse(fs.readFileSync(path.join(pkg, "gl-transitions.json"), "utf8")) as Transition[];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(pkg, "LICENSE"), path.join(out, "LICENSE"));
fs.writeFileSync(path.join(out, "VERSION"), `gl-transitions ${version} (https://github.com/gl-transitions/gl-transitions)\n`);
const params: Record<string, Record<string, unknown>> = {};
for (const t of transitions.sort((a, b) => a.name.localeCompare(b.name))) {
  const header = `// gl-transitions ${version}: ${t.name} by ${t.author}, license ${t.license}\n`;
  fs.writeFileSync(path.join(out, `${t.name}.glsl`), header + t.glsl.replace(/\r\n/g, "\n").trimEnd() + "\n");
  params[t.name] = t.defaultParams;
}
fs.writeFileSync(path.join(out, "params.json"), JSON.stringify(params, null, 1) + "\n");
console.log(`wrote ${transitions.length} transitions to ${path.relative(repoRoot, out)}`);
