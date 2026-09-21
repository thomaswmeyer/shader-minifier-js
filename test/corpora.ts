// The vendored corpora and the option sets the semantic tests and `npm run metrics` share, so a
// change to how a corpus is wrapped or to what "upstream's rewrites alone" means happens once.
//
//   gl-transitions (MIT, two BSD): fragment transitions, wrapped the way the project's own runtime
//     wraps them, with each transition's default parameters.
//   three.js (MIT): the programs three.js assembles for its materials, dumped from a real renderer
//     by scripts/dump-three-shaders.ts. They put `#if` blocks inside argument lists, struct bodies
//     and parameter lists; the parser keeps those for the compiler's preprocessor, and the corpus
//     still runs them with --preprocess so the sizes compare with the other minifiers, which see
//     preprocessed input too. test/corpus.test.ts also renders them without it.
//   PlayCanvas (MIT): a third engine, dumped by scripts/dump-playcanvas-shaders.ts the same way.
//   Babylon.js (Apache-2.0): the same idea for a second engine, dumped by
//     scripts/dump-babylon-shaders.ts. Babylon resolves its own conditionals before handing the
//     shader to WebGL, so these need no --preprocess; they bring uniform blocks and a different
//     macro style instead.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Options } from "../src/options.js";
import { toMinifierOptions } from "../src/vite.js";
import { repoRoot } from "./golden.js";

export interface CorpusShader {
  /** The file name, which decides the stage (`.vert`/`.frag`). */
  name: string;
  source: string;
  /** Options this shader needs on top of whichever set it is minified with. */
  options?: Partial<Options>;
  /** Values for uniforms by name, for the pixel test. */
  uniforms?: Record<string, number | boolean | number[]>;
}

/** The Vite plugin's defaults: what a site gets. */
export const pluginOptions = (): Options => toMinifierOptions();
/** Upstream's rewrites alone, externals kept: what the goldens pin. */
export const upstreamOptions = (): Options => toMinifierOptions({
  noPiSubstitution: false, expandMacros: false, foldBuiltins: false,
  dropDefaultPrecision: false, inlineSingleUse: false, removeUnusedDeclarations: false,
});
export const variants = (): [string, Options][] => [["plugin", pluginOptions()], ["upstream", upstreamOptions()]];

const corpusDir = path.join(repoRoot, "test/corpus");
const list = (dir: string, re: RegExp): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort() : []);

// `vec4 transition(vec2 uv)` over getFromColor/getToColor, progress and ratio.
const gltDir = path.join(corpusDir, "gl-transitions");
const gltHeader = `precision highp float;
varying vec2 _uv;
uniform sampler2D from, to;
uniform float progress, ratio;
vec4 getFromColor(vec2 uv) { return texture2D(from, uv); }
vec4 getToColor(vec2 uv) { return texture2D(to, uv); }
`;
const gltFooter = "\nvoid main() { gl_FragColor = transition(_uv); }\n";

export function glTransitions(): CorpusShader[] {
  const paramsFile = path.join(gltDir, "params.json");
  const params: Record<string, Record<string, number | boolean | number[]>> = fs.existsSync(paramsFile) ? JSON.parse(fs.readFileSync(paramsFile, "utf8")) : {};
  return list(gltDir, /\.glsl$/).map((file) => ({
    name: file,
    source: gltHeader + fs.readFileSync(path.join(gltDir, file), "utf8") + gltFooter,
    uniforms: params[file.replace(/\.glsl$/, "")],
  }));
}

const engineShaders = (dir: string, options?: Partial<Options>): CorpusShader[] =>
  list(path.join(corpusDir, dir), /\.(vert|frag)$/).map((file) => ({
    name: file,
    source: fs.readFileSync(path.join(corpusDir, dir, file), "utf8"),
    options,
  }));

export const threeShaders = (): CorpusShader[] => engineShaders("three", { preprocess: true });
export const babylonShaders = (): CorpusShader[] => engineShaders("babylon");
export const playcanvasShaders = (): CorpusShader[] => engineShaders("playcanvas");

export interface Program { name: string; vert: CorpusShader; frag: CorpusShader }

/** An engine's shaders paired by name, which is how they are compiled and linked. */
export function programs(shaders: CorpusShader[]): Program[] {
  const byName = new Map(shaders.map((s) => [s.name, s]));
  const names = [...new Set([...byName.keys()].map((f) => f.replace(/\.(vert|frag)$/, "")))].sort();
  return names.flatMap((name) => {
    const vert = byName.get(name + ".vert"), frag = byName.get(name + ".frag");
    return vert !== undefined && frag !== undefined ? [{ name, vert, frag }] : [];
  });
}
