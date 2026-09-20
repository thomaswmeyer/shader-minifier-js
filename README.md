# shader-minifier-js

A TypeScript port of [Shader Minifier](https://github.com/laurentlb/Shader_Minifier)
(Ctrl-Alt-Test, F#, Apache 2.0): a GLSL minifier for size-constrained WebGL
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
`noOverloading`, `noPiSubstitution`, `expandMacros`, `foldBuiltins`,
`dropDefaultPrecision`, `inlineSingleUse` and `removeUnusedDeclarations` are
on, so uniform and attribute names are kept, macros and constant builtin calls
are folded away, unused globals, structs and precision statements go, and the
output only uses constructs ANGLE accepts. Every other
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
  in a fragment shader, `lowp` samplers), and a precision qualifier on a
  declaration that restates the precision already in force (`mediump vec3 c;`
  after `precision mediump float;`). The stage is `--stage`, else the
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
- `--remove-unused-declarations`: remove a global that nothing reads or
  writes, a struct type that nothing names, and a `precision` statement for a
  sampler type the shader never declares. Uniforms, inputs and outputs stay,
  as do names a kept `#define` uses and a global whose initializer has an
  effect. Upstream removes unused functions but keeps these; engine shaders
  assembled from chunks carry many (three.js's depth pass keeps seventeen
  sampler precision statements and two light structs for nothing).
- `--remove-unused-varyings`: remove a varying no fragment shader of the run
  reads, together with the assignments that fed it, and a fragment input
  nothing reads. This is the one removal that needs both halves of a program
  at once, so it only acts when the run holds a vertex and a fragment shader
  together (`shader-minifier a.vert a.frag`). That also keeps it away from a
  transform-feedback vertex shader, whose outputs the application looks up by
  name and which has no fragment partner. A varying the vertex shader reads
  back, or whose value has an effect, stays. Unlike the other removals this
  one should change what the GPU does, since a varying costs an interpolator
  slot and the vertex work behind it whatever the driver can prove.
- `--remove-unused-uniforms`: remove a plain uniform no shader of the run
  reads. Like the varyings it needs both stages together, since a uniform one
  file ignores may be the one its partner reads, and a uniform block is left
  alone because its members are looked up through the block. Opt-in and off
  by default: an application looks a uniform up by name and may treat a null
  location as an error rather than a no-op. Worth 2.9% of the three.js
  programs and 4.0% of the PlayCanvas ones raw, and 811 and 258 bytes with
  each program compressed on its own. Compressed as one blob it costs a few
  bytes instead, because each program's dead uniforms are a different subset
  and removing them desynchronises programs that were compressing against
  each other; that is the blob's artifact, not a reason to skip it.
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

## Running the browser tests

The pixel test and the corpus test render in headless Chromium and skip
without one. They need Playwright's browser once:

```sh
npx playwright install chromium   # downloads Chromium for the installed Playwright
npm run pixels                    # test/pixels.test.ts and test/corpus.test.ts, about six minutes
npm test                          # runs them too when the browser is there
```

On a machine with a Chromium of its own, `CHROMIUM_EXECUTABLE=/path/to/chrome
npm run pixels` uses that binary instead. Skipping is what keeps these tests
optional for a contributor without Chromium, and it would also make a CI run
green while testing nothing, so `REQUIRE_BROWSER=1` turns a missing browser
into a failure. `.github/workflows/ci.yml` sets it, installs Chromium through
Playwright and runs the whole suite on every push and pull request. Every case renders with three sets
of inputs; a failure message carries the seed, the pixel counts, the
shader's own one-ulp noise and the minified source. A skip carries its
reason: the source WebGL rejects, a shader the minifier refuses, or one so
chaotic that a pixel comparison cannot judge it. The ANGLE compile test and
the spglsl column of `npm run metrics` need `npm install --no-save spglsl`.

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
  allowed as many again, since constant folding rounds like that, and a
  difference of at most 8 levels on at most 2% of the pixels counts as
  rounding too (a PMREM convolution drifts that much with every rewrite
  disabled). Needs a
  browser: `npx playwright install chromium`, or set `CHROMIUM_EXECUTABLE`;
  otherwise the test skips. `npm run pixels` runs just this test.
- `test/corpus.test.ts` runs the same comparison over shaders from open
  source projects that ship on the web, vendored under `test/corpus/` with
  their licenses: the 125 gl-transitions (MIT, two BSD), wrapped for WebGL1
  with each transition's default parameters, and the programs four engines
  assemble for their materials — three.js (MIT), Babylon.js (Apache-2.0),
  PlayCanvas (MIT) and CesiumJS (Apache-2.0) — dumped from a real renderer in
  the harness's browser so the chunk expansion and the runtime `#define`s are
  the ones a site ships. `npm run corpus:gl-transitions`,
  `corpus:three`, `corpus:babylon`, `corpus:playcanvas` and `corpus:cesium`
  refresh them from the npm packages; the version is recorded next to each.
  The engine shaders are also compiled and drawn in vertex/fragment pairs, so
  a rename that only breaks across the two stages is caught.

- `test/tomto.test.ts` pins the six tom.to shaders above, minified with the
  plugin's defaults, to `test/tomto/*.expected`. `UPDATE_GOLDEN=1 npm test`
  rewrites them.
- `test/angle-compile.test.ts` compiles every minified output with ANGLE, the
  compiler behind Chrome's WebGL, through the `spglsl` package: `test/tomto`,
  the spglsl corpus, and the GLSL ES files among upstream's unit tests. Sources
  ANGLE rejects (desktop GLSL, most of the demoscene corpus) and libraries
  without `main()` are skipped. `spglsl` is prebuilt wasm and not a
  dependency; the test skips unless you `npm install --no-save spglsl` first.

### Results on the open source corpus

`npm run metrics` minifies every corpus four ways and, when spglsl is
installed, a fifth: the port with upstream's rewrites only (what the goldens
pin), the Vite plugin's defaults, those defaults plus `--preprocess`, and
Google ANGLE's minifier. Output bytes, externals kept in all of them.

The `--preprocess` column is what makes the spglsl comparison apples to
apples. spglsl always evaluates the preprocessor, so its output is a shader
for one set of defines; `plugin defaults` keeps every `#ifdef`, which is a
different product. `plugin +preprocess` is the column with the same contract,
and the spglsl percentage is taken from it. Babylon.js and PlayCanvas run
their own preprocessor before handing GLSL to the driver, so their sources
hold no `#if` at all and the two plugin columns coincide.

| corpus | shaders | source | upstream rewrites | plugin defaults | plugin vs upstream | plugin +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 6 | 5,381 | 2,438 | 2,378 | 2.5% | 2,378 | 2,484 | 4.3% |
| gl-transitions | 125 | 169,066 | 69,608 | 67,955 | 2.4% | 67,889 | 79,689 | 14.8% |
| three.js | 56 | 1,337,454 | 218,875 | 131,622 | 39.9% | 131,622 | 143,890 | 8.5% |
| Babylon.js | 18 | 276,701 | 106,932 | 57,789 | 46.0% | 57,789 | 59,928 | 3.6% |
| PlayCanvas | 20 | 191,012 | 36,026 (5 refused) | 48,662 |  | 48,662 | 60,037 | 18.9% |
| CesiumJS | 32 | 174,106 | 74,426 | 70,770 | 4.9% | 41,991 | 43,750 | 4.0% |
| upstream shadertoy | 8 | 99,447 | 44,904 | 44,221 | 1.5% | 42,666 | 33,164 (2 refused) |  |

Shaders ship compressed, so the same corpora again after compression. Two
things have to be said before the numbers, because both change them.

The **codec**: brotli at quality 11 is what a CDN serves a static asset with,
gzip -9 what an older server gives. They differ mostly in window size, 32 KB
against much more.

The **unit**: compressing a whole corpus as one blob lets every shader
compress against its near-twins, and for the engines that is most of the
win. It is also not how anything ships. three.js sends its chunk library and
assembles these 56 programs in the browser, so the blob never exists;
Babylon and PlayCanvas likewise. Compressing each shader on its own is the
pessimistic end, and a shader sitting somewhere in a real JavaScript bundle,
far from any twin, is much nearer that. Judge a change on the per-shader
table; read the blob as an optimistic bound.

| corpus | minified raw | each alone | as one blob | of the compression, cross-shader |
|---|--:|--:|--:|--:|
| tom.to | 2,378 | 1,591 | 1,093 | 31% |
| gl-transitions | 67,955 | 35,880 | 14,128 | 61% |
| three.js | 131,622 | 43,355 | 12,758 | 71% |
| Babylon.js | 57,789 | 16,070 | 6,717 | 58% |
| PlayCanvas | 48,662 | 17,957 | 5,278 | 71% |
| CesiumJS | 70,770 | 23,142 | 11,870 | 49% |

**brotli -q 11, each shader on its own**

| corpus | source | upstream rewrites | plugin defaults | plugin vs upstream | plugin +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,755 | 1,623 | 1,591 | 2.0% | 1,591 | 1,621 | 1.9% |
| gl-transitions | 67,081 | 36,732 | 35,880 | 2.3% | 35,766 | 39,307 | 9.0% |
| three.js | 269,870 | 68,963 | 43,355 | 37.1% | 43,355 | 46,531 | 6.8% |
| Babylon.js | 67,148 | 30,703 | 16,070 | 47.7% | 16,070 | 17,418 | 7.7% |
| PlayCanvas | 47,336 | 11,511 | 17,957 |  | 17,957 | 20,615 | 12.9% |
| CesiumJS | 38,439 | 24,372 | 23,142 | 5.0% | 15,329 | 16,507 | 7.1% |
| upstream shadertoy | 30,115 | 17,410 | 17,043 | 2.1% | 16,503 | 12,564 |  |

**brotli -q 11, whole corpus as one blob**

| corpus | source | upstream rewrites | plugin defaults | plugin vs upstream | plugin +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,167 | 1,114 | 1,093 | 1.9% | 1,093 | 1,132 | 3.4% |
| gl-transitions | 29,088 | 14,369 | 14,128 | 1.7% | 14,077 | 15,188 | 7.3% |
| three.js | 22,926 | 15,230 | 12,758 | 16.2% | 12,758 | 13,713 | 7.0% |
| Babylon.js | 15,744 | 10,166 | 6,717 | 33.9% | 6,717 | 7,192 | 6.6% |
| PlayCanvas | 8,444 | 1,886 | 5,278 |  | 5,278 | 5,254 | -0.5% |
| CesiumJS | 17,592 | 12,073 | 11,870 | 1.7% | 7,118 | 7,484 | 4.9% |
| upstream shadertoy | 25,952 | 14,321 | 14,029 | 2.0% | 13,529 | 10,628 |  |

**gzip -9**

| corpus | source | upstream rewrites | plugin defaults | plugin vs upstream | plugin +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,458 | 1,180 | 1,156 | 2.0% | 1,156 | 1,213 | 4.7% |
| gl-transitions | 35,330 | 16,505 | 16,106 | 2.4% | 16,071 | 17,470 | 8.0% |
| three.js | 196,245 | 21,456 | 17,026 | 20.6% | 17,026 | 19,536 | 12.8% |
| Babylon.js | 40,713 | 12,431 | 7,896 | 36.5% | 7,896 | 8,901 | 11.3% |
| PlayCanvas | 24,421 | 2,298 | 7,072 |  | 7,072 | 7,276 | 2.8% |
| CesiumJS | 25,813 | 14,613 | 14,244 | 2.5% | 8,284 | 8,747 | 5.3% |
| upstream shadertoy | 29,728 | 16,194 | 15,857 | 2.1% | 15,315 | 11,962 |  |

The order of the three minifiers never changes, under either codec or either
unit, so none of the choices here are ones a compressor would have made for
free. Beyond that the unit decides the story. On the blob the plugin's win
over upstream's rewrites on three.js is 16.2%; per shader it is 37.1%,
because the blob was already getting the repetition for free. The codec
matters less, and in the same direction: gzip gives the plugin a larger
margin than brotli, so brotli is the conservative choice.

The engine corpora compress 10 to 58 fold as blobs, and most of that is one
program against another rather than anything inside a program. That is what
makes them excellent for finding bugs and poor for judging size.

Comparing like with like, the port is smaller than spglsl on every corpus, at
every codec and unit, with one exception: PlayCanvas as one blob, by 0.5%.
The upstream shadertoy corpus has no comparison, because spglsl refuses two
of its eight shaders.

One caveat about that column, which counts against this table rather than
against spglsl: the pixel harness checks the port's output, never spglsl's.
The number is bytes ANGLE emitted, not bytes of an output verified to render
the same.

### Reproducing the comparison

The port, with the plugin's flags spelled out (the goldens in
`test/tomto/*.expected` are this output):

```sh
npm run build
node bin/shader-minifier.js --format text --preserve-externals --no-overloading \
  --no-pi-substitution --webgl --expand-macros --fold-builtins \
  --drop-default-precision --inline-single-use --remove-unused-declarations \
  test/tomto/sim.vert -o /dev/stdout | wc -c
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
