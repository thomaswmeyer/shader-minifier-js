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
  and fail with an error if the output would still contain either. An
  expression of unknown type counts as unsafe; a call to an overloaded user
  function is known when every overload returns the same type.
- `--expand-macros`: expand `#define`s so neither the definitions nor the
  long macro names reach the output (upstream keeps them as feature switches).
  Macros used in `#if` conditions or defined inside `#if` blocks are left alone.
- `--fold-builtins`: evaluate builtin calls on literals (`radians(45.)` →
  `.7853982`, `normalize(vec2(3.,4.))` → `vec2(.6,.8)`) at float32 precision,
  only when the result is shorter. Under the flag, operators on literals fold
  the way the GPU's compiler folds them too, float32 operands and one
  rounding per operation, printed with the shortest float32 digits
  (`2.*3.141592653589793` → `6.2831855`) and only when not longer. Inputs
  GLSL leaves undefined or implementation-defined (`round(.5)`,
  `pow(0.,0.)`, `atan(0.,0.)`) are not folded.
- `--no-pi-substitution`: keep literals like `3.14159265` instead of
  `acos(-1.)`, which can cost precision under `mediump`.
- `--drop-default-precision`: drop precision statements that restate the
  stage's default (`precision highp float;` in a vertex shader, `mediump int`
  in a fragment shader, `lowp` samplers). The stage is `--stage`, else the
  file extension (`.vert`/`.vs`, `.frag`/`.fs`), else a builtin only one stage
  has (`gl_Position`, `gl_FragCoord`, `discard`, ...). A shader that proves
  neither, such as a transform-feedback vertex shader that never writes
  `gl_Position`, keeps its `float` and `int` statements.
- `--inline-single-use`: inline a never-written global used exactly once
  (outside loops) into that use, and substitute a global passed as an
  always-identical argument straight into the function body instead of
  declaring a local for it, when that is not longer. Upstream does both only
  under `--aggressive-inlining`, which also copies every constant to every use.
  Neither happens where a local or parameter at the use would capture a name
  of the inlined value, and a value that calls a function is only inlined
  into `main` (or another entry point from `--no-renaming-list`), since a
  helper may run in a loop.
- After every rewrite pass the minifier checks that no variable use was
  copied into a scope where its name means another variable, and fails with
  an internal error instead of emitting the shader. Upstream rules that could
  do this are fixed here: inlining a local past a later local of a name its
  value reads, `--move-declarations` hoisting a declaration above an earlier
  use of its name, argument inlining into a body whose other parameter has
  the name, function reordering pulling alternatives out of `#ifdef` blocks,
  and identifiers named in a kept `#define` being renamed or removed (they
  are pinned). `PORTING.md` section 5.2 lists each, and its "Upstream
  candidates" note lists the ones worth offering back to upstream.
- `--preprocess` also decides constant `#if` expressions (`#if ( 1 > 0 ) &&
  defined( USE_MAP )`), which engine shaders like three.js's put inside
  argument lists where the parser cannot keep them. A bare identifier in the
  condition still leaves it to the compiler.
- Float literals above ~7.9e28 (the .NET `decimal` limit) are accepted.
- Struct fields named like swizzle components (`float q;`, `vec3 rgb;`) are
  accepted and kept under their names; upstream refuses the declaration.
- Prefix `+`/`-` never merge into `++`/`--` (`-(--a)` prints as `- --a`).

## Results

`test/tomto/` holds six GLSL ES 3.00 shaders from tom.to's ink mark, a WebGL2
particle engine (transform-feedback sim, instanced stroke quads, composite),
5,381 bytes of source. Output bytes from upstream Shader Minifier 1.5.1
(.NET), spglsl (Google ANGLE, C++ built to wasm) and the port with the Vite
plugin's defaults, externals preserved in all three:

| Shader | Source | Upstream (.NET) | spglsl (ANGLE) | Port |
|---|--:|--:|--:|--:|
| sim.vert | 2,094 | 1,034 | 1,034 | 986 |
| sim.frag | 80 | 74 | 74 | 74 |
| stroke.vert | 1,666 | 564 | 576 | 564 |
| stroke.frag | 897 | 375 | 389 | 375 |
| comp.vert | 166 | 136 | 136 | 136 |
| comp.frag | 478 | 255 | 275 | 243 |
| **total** | **5,381** | **2,438** | **2,484** | **2,378** |

The port is 2.5% under upstream and 4.3% under spglsl. Where no port addition
applies (the stroke shaders) it matches upstream byte for byte. Upstream beats
spglsl by inlining single-use locals into expressions; spglsl's two wins over
upstream, a vertex shader's default precision statement and a `const` used
once, are `--drop-default-precision` and `--inline-single-use` here. The three
bytes comp.frag gives back are `1.-.34` kept as written: upstream's `.66` is
one float32 ulp off what the GPU computes from the source. Every output
compiles under ANGLE (`test/angle-compile.test.ts`) and renders the same
pixels as its source (`test/pixels.test.ts`).

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

Three tests guard real output rather than upstream parity:

- `test/pixels.test.ts` is the semantic oracle: every shader is rendered in
  headless Chromium (ANGLE on SwiftShader, Chrome's own WebGL compiler) both
  as written and as minified, with the same deterministic uniforms, textures
  and inputs, and the results must match. Fragment shaders are compared by
  pixels, vertex shaders by transform-feedback output. It covers `test/tomto`,
  the semantic fixtures in `test/pixels/` (one per class of bug found), and
  the WebGL-compatible shaders of upstream's corpus, each under the plugin's
  defaults and under upstream's rewrites alone. A shader that flips pixels on
  a one-ulp change of its own literals (a raymarcher at a hit threshold) is
  allowed as many again, since constant folding rounds like that. Needs a
  browser: `npx playwright install chromium`, or set `CHROMIUM_EXECUTABLE`;
  otherwise the test skips. `npm run pixels` runs just this test.
- `test/corpus.test.ts` runs the same comparison over shaders from open
  source projects that ship on the web, vendored under `test/corpus/` with
  their licenses: the 125 gl-transitions (MIT, two BSD), wrapped for WebGL1
  with each transition's default parameters, and the programs three.js (MIT)
  assembles for its materials, dumped from a real renderer in the harness's
  browser so the chunk expansion and the runtime `#define`s are the ones a
  game ships. `npm run corpus:gl-transitions` and `npm run corpus:three`
  refresh them from the npm packages; the version is recorded next to each.

- `test/tomto.test.ts` pins the six tom.to shaders above, minified with the
  plugin's defaults, to `test/tomto/*.expected`. `UPDATE_GOLDEN=1 npm test`
  rewrites them.
- `test/angle-compile.test.ts` compiles every minified output with ANGLE, the
  compiler behind Chrome's WebGL, through the `spglsl` package: `test/tomto`,
  the spglsl corpus, and the GLSL ES files among upstream's unit tests. Sources
  ANGLE rejects (desktop GLSL, most of the demoscene corpus) and libraries
  without `main()` are skipped. `spglsl` is prebuilt wasm and not a
  dependency; the test skips unless you `npm install --no-save spglsl` first.

### Reproducing the comparison

The port, with the plugin's flags spelled out (the goldens in
`test/tomto/*.expected` are this output):

```sh
npm run build
node bin/shader-minifier.js --format text --preserve-externals --no-overloading \
  --no-pi-substitution --webgl --expand-macros --fold-builtins \
  --drop-default-precision --inline-single-use test/tomto/sim.vert -o /dev/stdout | wc -c
```

spglsl:

```sh
npm install --no-save spglsl
node scripts/minify-with-spglsl.mjs test/tomto/*.vert test/tomto/*.frag
```

Upstream, from a clone at `../shader-minifier`, built and run in a .NET 8 SDK
container; `--preserve-externals --no-overloading` are the two flags it
shares with the plugin:

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

A pull that hangs under Docker Desktop on macOS is waiting on the keychain
credential helper; point `DOCKER_CONFIG` at a directory whose `config.json`
is `{}`.

## License

Apache-2.0, like upstream; see `LICENSE` and `NOTICE`. The test corpus in
`tests/` is upstream's, under `tests/LICENSE-shader-minifier`.
