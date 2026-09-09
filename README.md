# shader-minifier-js

A TypeScript port of [Shader Minifier](https://github.com/laurentlb/Shader_Minifier)
(Ctrl-Alt-Test, F#, Apache 2.0): a GLSL/HLSL minifier for size-constrained WebGL
and demoscene shaders. Zero runtime dependencies, Node >= 20, ESM.

The port tracks upstream version 1.5.1 module for module and is validated by
upstream's own golden test corpus: all 96 commands in `tests/commands.txt`
produce byte-identical output. Deliberate deviations are listed in
`PORTING.md` section 5.2 and, where they touch a golden file, `tests/DEVIATIONS.md`.

## CLI

Same flags as upstream, plus the port additions listed below.

```sh
npm run build
node bin/shader-minifier.js --format text -o out.frag in.frag
node bin/shader-minifier.js --help
```

## Library

```ts
import { minify } from "shader-minifier-js";

const { code, exportedNames } = minify(source, { preserveExternals: true, webgl: true });
// or several files, renamed consistently:
const result = minify([{ name: "a.frag", content: a }, { name: "b.vert", content: b }]);
result.format("js"); // any upstream output format: text, indented, c-variables, c-array, js, nasm, rust, json
```

`Minifier`, `parseOptions`, `Ast`, `Printer` and `runParser` are exported for
lower-level use.

## Vite plugin

```ts
// vite.config.ts
import { shaderMinifier } from "shader-minifier-js/vite";

export default { plugins: [shaderMinifier()] };
```

```ts
import frag from "./shader.frag"; // a minified string; `?raw` imports are minified too
```

Files matching `.glsl`, `.frag`, `.vert`, `.vs`, `.fs` are minified at load
time. Defaults are chosen for WebGL: `webgl`, `preserveExternals`,
`noOverloading`, `noPiSubstitution`, `expandMacros` and `foldBuiltins` are on,
so uniform and attribute names are kept, macros and constant builtin calls are
folded away, and the output only uses constructs ANGLE accepts. Every other
upstream flag is available as a camelCased option (`noRenaming`,
`noRenamingList`, `noInlining`, `aggressiveInlining`, `noSequence`,
`noRemoveUnused`, `preprocess`, `moveDeclarations`), `include` overrides the
file pattern, and `options` passes any raw minifier option.

## Port additions

- `--webgl`: skip two upstream rewrites whose output Chrome rejects (`?:` on
  struct values; a void call folded into a comma sequence, an ES 3.00 rule),
  and fail with an error if the output would still contain either.
- `--expand-macros`: expand `#define`s so neither the definitions nor the
  long macro names reach the output (upstream keeps them as feature switches).
  Macros used in `#if` conditions or defined inside `#if` blocks are left alone.
- `--fold-builtins`: evaluate builtin calls on literals (`radians(45.)` →
  `.7853982`, `normalize(vec2(3.,4.))` → `vec2(.6,.8)`) at float32 precision,
  only when the result is shorter.
- `--no-pi-substitution`: keep literals like `3.14159265` instead of
  `acos(-1.)`, which can cost precision under `mediump`.
- `--drop-default-precision`: drop precision statements that restate the
  stage's default (`precision highp float;` in a vertex shader, `mediump int`
  in a fragment shader, `lowp` samplers). The stage is read off the code: a
  shader that writes `gl_Position` or `gl_PointSize` is a vertex shader.
- `--inline-single-use`: inline a never-written global used exactly once
  (outside loops) into that use, and substitute a global passed as an
  always-identical argument straight into the function body instead of
  declaring a local for it, when that is not longer. Upstream reserves both
  for `--aggressive-inlining`, which also duplicates constants everywhere.
- Float literals above ~7.9e28 (the .NET `decimal` limit) are accepted.
- Prefix `+`/`-` never merge into `++`/`--` (`-(--a)` prints as `- --a`).

## Results

The six shaders in `test/tomto/` (tom.to's ink mark: a WebGL2 particle engine
with a transform-feedback sim, instanced stroke quads and a composite pass;
5,381 bytes of GLSL ES 3.00) minified by upstream Shader Minifier 1.5.1
(.NET), by spglsl (Google ANGLE's compiler, C++ built to wasm) and by this
port with the Vite plugin's defaults. Bytes of output; externals preserved
in all three.

| Shader | Source | Upstream (.NET) | spglsl (ANGLE) | Port |
|---|--:|--:|--:|--:|
| sim.vert | 2,094 | 1,034 | 1,034 | 986 |
| sim.frag | 80 | 74 | 74 | 74 |
| stroke.vert | 1,666 | 564 | 576 | 564 |
| stroke.frag | 897 | 375 | 389 | 375 |
| comp.vert | 166 | 136 | 136 | 136 |
| comp.frag | 478 | 255 | 275 | 240 |
| **total** | **5,381** | **2,438** | **2,484** | **2,375** |

The port is 2.6% under upstream and 4.4% under spglsl. Where none of the
port additions apply (the stroke shaders) its output is byte-identical to
upstream's, as the goldens require. Upstream beats spglsl through its
inlining of single-use locals into expressions; spglsl's only wins over
upstream, dropping a vertex shader's default precision statement and folding
a `const` used once, are `--drop-default-precision` and
`--inline-single-use` here, which is what puts the port under both. Every
output compiles under ANGLE (`test/angle-compile.test.ts`).

## Development

```sh
npm test                 # goldens, round-trip, re-parse validity, unit tests, vite build
npm run golden [filter]  # golden commands with diffs; --update-golden to regenerate
npm run webgl-page       # writes tests/out/webgl-compile.html; open in Chrome to compile every corpus shader
scripts/sync-tests.sh    # re-vendor tests/ from ../shader-minifier and re-apply tests/DEVIATIONS.md
```

The spglsl corpus test and the WebGL page look for spglsl's shaders in
`../spglsl/project/test/shaders` (or `$SPGLSL_SHADERS`) and skip when absent.
`PORTING.md` has the module map and the porting notes.

Two tests guard real-world output rather than upstream parity:

- `test/tomto/` holds tom.to's six ink shaders (a WebGL2 particle engine: transform
  feedback, instanced strokes, a composite) as model inputs, minified with the
  Vite plugin's defaults and pinned to `.expected` goldens so a size regression
  fails the build. `UPDATE_GOLDEN=1 npm test` rewrites them.
- `test/angle-compile.test.ts` compiles every minified output with ANGLE, the
  GLSL ES compiler behind Chrome's WebGL, through the `spglsl` package. It
  covers `test/tomto`, the spglsl corpus, and the GLSL ES files among upstream's
  unit tests; sources ANGLE itself rejects (desktop GLSL, which is most of the
  demoscene corpus) and libraries without `main()` are skipped. `spglsl` is a
  prebuilt wasm package but not a dependency of the port: the test skips unless
  you `npm install --no-save spglsl` first.

### Reproducing the comparison

The port, with the plugin's flags spelled out (`-o /dev/stdout` prints the
minified shader; the goldens in `test/tomto/*.expected` are the same output):

```sh
npm run build
node bin/shader-minifier.js --format text --preserve-externals --no-overloading \
  --no-pi-substitution --webgl --expand-macros --fold-builtins \
  --drop-default-precision --inline-single-use test/tomto/sim.vert -o /dev/stdout | wc -c
```

spglsl, through the same package the compile test uses:

```sh
npm install --no-save spglsl
node scripts/minify-with-spglsl.mjs test/tomto/*.vert test/tomto/*.frag
```

Upstream, from a clone of Shader Minifier at `../shader-minifier`, built and
run in a .NET 8 SDK container so nothing is installed on the host (the two
flags match the port's `--preserve-externals --no-overloading`; the rest of
the plugin's flags are port additions):

```sh
docker run --rm -v "$PWD/../shader-minifier:/src" -v "$PWD/test/tomto:/glsl" -w /src \
  mcr.microsoft.com/dotnet/sdk:8.0 bash -c '
    dotnet build ShaderMinifier -c Release -nologo -v q &&
    for f in /glsl/*.vert /glsl/*.frag; do
      dotnet artifacts/bin/ShaderMinifier/release/ShaderMinifier.dll \
        --format text --preserve-externals --no-overloading "$f" -o /tmp/out.glsl
      printf "%s %s\n" "$(basename "$f")" "$(wc -c < /tmp/out.glsl)"
    done'
```

If the pull hangs with Docker Desktop on macOS, it is waiting on the keychain
credential helper; `DOCKER_CONFIG=$(mktemp -d)` with an empty `config.json`
there sidesteps it, since the registry needs no credentials.

## License

Apache-2.0, like upstream; see `LICENSE` and `NOTICE`. The test corpus in
`tests/` is upstream's, under `tests/LICENSE-shader-minifier`.
