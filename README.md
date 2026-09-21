# shader-minifier-js

A TypeScript port of [Shader Minifier](https://github.com/laurentlb/Shader_Minifier)
(Ctrl-Alt-Test, F#, Apache 2.0): a GLSL minifier for size-constrained WebGL
and demoscene shaders. Zero runtime dependencies, Node >= 20, ESM.

The port tracks Shader Minifier version 1.5.1 module for module and is
validated by Shader Minifier's own golden test corpus: all 96 commands in
`tests/commands.txt` produce byte-identical output. Deliberate deviations are listed in
`PORTING.md` section 5.2 and, where they touch a golden file, `tests/DEVIATIONS.md`.

## CLI

Same flags as Shader Minifier, plus the port additions listed below.

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
result.format("js"); // any Shader Minifier output format: text, indented, c-variables, c-array, js, nasm, rust, json
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
time. An `#include "file"` line is replaced by that file's text first,
relative to the including file and recursively, and the included files are
watched, since WebGL has no `#include` and an engine resolves it before the
compiler sees the shader. Defaults are chosen for WebGL: `webgl`, `preserveExternals`,
`noOverloading`, `noPiSubstitution`, `expandMacros`, `approximateFolds`,
`dropDefaultPrecision` and `inlineSingleUse` are on and `removeUnused` is
`"declarations"`, so uniform and attribute names are kept, macros and
constant builtin calls are folded away, unused globals, structs and
precision statements go, and the output only uses constructs ANGLE accepts.
Every other flag is available under the minifier option's name
(`noRenaming`, `noRenamingList`, `inlining`, `noSequence`, `preprocess`,
`moveDeclarations`), `include` overrides the file pattern, and `options`
passes any raw minifier option. `level` picks
the optimisation level the settings start from (`-O0` to `-O3` below;
default 2).

Two ways to treat some shaders differently. In the config, `overrides`
lists settings for the files a pattern matches, applied in order over the
ones above:

```ts
shaderMinifier({
  overrides: [
    { include: /noise|hash/, approximateFolds: false }, // a hash function is not to be folded
    { include: /\.vert$/, level: 1 },
  ],
})
```

In the shader itself, a `#pragma shader_minifier <flags>` line sets the
rewrite flags for that file, on top of the run's, and is removed from the
output. It works on the command line as well as in the plugin, and travels
with the file, which is where the person who knows the shader has a hash
function in it can say so:

```glsl
#pragma shader_minifier -O1 --no-approximate-folds
```

A pragma may set the rewrites and the target (`--webgl`, `--stage`,
`--preprocess`), not the output format, the renaming, or the removals that
need every stage of a run (`--remove-unused-varyings`, `-uniforms`); `-O3`
in a pragma means `-O2` for that file.

## Port additions

The additions below are off by default on the command line, so the output
stays byte-identical to Shader Minifier's; `-O0` to `-O3` turn them on in
coherent groups. `-O0` is Shader Minifier's rewrites only. `-O1` adds what
changes neither meaning nor interface: literals read as the float32 the GPU
sees (folded that way, printed with the fewest digits), no pi substitution,
default precision statements dropped, single-use globals inlined, unused
declarations removed.
`-O2` is what the Vite plugin does, `-O1` plus macro expansion and the
folding of builtin calls and divisions. `-O3` also removes unused varyings
and uniforms, which needs both stages in one run and an application that
tolerates a null uniform location. Flags after a level override it
(`-O2 --no-approximate-folds`), and a level after a flag resets its group. The
target flags, `--webgl`, `--preserve-externals`, `--no-overloading`,
`--stage` and `--preprocess`, are not part of a level: the plugin is
`-O2 --webgl --preserve-externals --no-overloading`.

Two of Shader Minifier's pairs of switches are also one setting each:
`--inlining none|default|aggressive` is `--no-inlining` and
`--aggressive-inlining`, and `--remove-unused none|functions|declarations`
is `--no-remove-unused`, Shader Minifier's default and
`--remove-unused-declarations`. The old spellings still work and set the
same setting, so the last one given wins instead of two booleans
contradicting each other.

- `--webgl`: skip two Shader Minifier rewrites whose output Chrome rejects (`?:` on
  struct values; a void call folded into a comma sequence, an ES 3.00 rule),
  and fail with an error if the output would still contain either. An
  expression of unknown type counts as unsafe; a call to an overloaded user
  function is known when every overload returns the same type.
- `--expand-macros`: expand `#define`s so neither the definitions nor the
  long macro names reach the output (Shader Minifier keeps them as feature switches).
  Macros used in `#if` conditions or defined inside `#if` blocks are left alone.
- Float literals are read as the float32 the GPU's compiler makes of them.
  Every literal is printed with the fewest digits that read back to the same
  float32 (`6.283185307179586` → `6.2831855`, `123456789.` → `123456790.`),
  which is lossless since GLSL `float` is 32-bit everywhere, and operators
  on literals fold the same way: float32 operands and one rounding per
  operation, only when not longer. Shader Minifier keeps the digits as
  written and folds in decimal, which can land one ulp off (`4.3+3.4` →
  `7.7`, where the GPU computes `7.7000003`); `--decimal-folds` restores
  both, and the goldens run with it. Division has 2.5 ulp of latitude in the
  spec, so its float32 fold waits for `--approximate-folds`. A `lf` literal
  is a double and is left alone.
- `--approximate-folds`: evaluate builtin calls on literals (`radians(45.)` →
  `.7853982`, `normalize(vec2(3.,4.))` → `vec2(.6,.8)`) and constant
  divisions at float32 precision, only when the result is shorter. Inputs
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
  declaring a local for it, when that is not longer. Shader Minifier does both only
  under `--aggressive-inlining`, which also copies every constant to every use.
  Neither happens where a local or parameter at the use would capture a name
  of the inlined value, and a value that calls a function is only inlined
  into `main` (or another entry point from `--no-renaming-list`), since a
  helper may run in a loop.
- `--remove-unused-declarations`: remove a global that nothing reads or
  writes, a struct type that nothing names, and a `precision` statement for a
  sampler type the shader never declares. Uniforms, inputs and outputs stay,
  as do names a kept `#define` uses and a global whose initializer has an
  effect. Shader Minifier removes unused functions but keeps these; engine shaders
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
  reads, and a uniform block from every stage that reads nothing of it. Like
  the varyings it needs both stages together, since a uniform one file
  ignores may be the one its partner reads. A block goes whole or not at all,
  because its members are looked up through the block; while the other stage
  keeps it the program's interface does not change, since the application
  finds the block by name in the linked program. Opt-in and off by default:
  an application looks a uniform up by name and may treat a null location, or
  a block index that is not there, as an error rather than a no-op
  (Babylon.js checks it). Worth 3.1% of the three.js programs raw, 4.5% of
  the PlayCanvas ones and 19.6% of the Babylon.js ones, whose `Material`
  block is declared in both stages and read in one; with each shader file
  compressed on its own 2.8%, 3.5% and 15.4%. Compressed as one blob the
  three.js gain shrinks and the Babylon.js one turns into a few bytes' cost,
  because a vertex shader's copy of a block compresses against the fragment
  shader's; that is the blob's artifact, not a reason to skip it.
- After every rewrite pass the minifier checks that no variable use was
  copied into a scope where its name means another variable, and fails with
  an internal error instead of emitting the shader. Shader Minifier rules that could
  do this are fixed here: inlining a local past a later local of a name its
  value reads, `--move-declarations` hoisting a declaration above an earlier
  use of its name, argument inlining into a body whose other parameter has
  the name, function reordering pulling alternatives out of `#ifdef` blocks,
  and identifiers named in a kept `#define` being renamed or removed (they
  are pinned). `PORTING.md` section 5.2 lists each, and its "Upstream
  candidates" note lists the ones worth offering back to Shader Minifier.
- `--preprocess` also decides constant `#if` expressions (`#if ( 1 > 0 ) &&
  defined( USE_MAP )`), so a shader whose defines are all in the file loses
  its dead branches. A bare identifier in the condition still leaves it to
  the compiler.
- Without it, every `#if` is kept for the compiler, including the ones
  engine shaders put inside argument lists, struct bodies and parameter
  lists (three.js: `getTangentFrame( -vViewPosition, normal,\n#if defined(
  USE_NORMALMAP ) ...`). A chain standing where an expression does is parsed
  and minified around; one around a group of struct members or parameters is
  kept as text with what it names pinned. A name declared in both branches
  of a `#if` is one variable, kept, never inlined and renamed once, where
  Shader Minifier binds every use to the last declaration. So the plugin takes a
  shader whose defines are injected at runtime as it comes.
- Float literals above ~7.9e28 (the .NET `decimal` limit) are accepted.
- Struct fields named like swizzle components (`float q;`, `vec3 rgb;`) are
  accepted and kept under their names; Shader Minifier refuses the declaration.
- Prefix `+`/`-` never merge into `++`/`--` (`-(--a)` prints as `- --a`).

## Results

`npm run metrics` minifies every corpus four ways and, when spglsl is
installed, a fifth. The columns:

- **Shader Minifier (.NET)**: the original, version 1.5.1. The numbers come
  from this port run with only Shader Minifier's own rewrites, which is what
  the goldens pin; on the tom.to shaders that output matches the .NET binary
  byte for byte.
- **shader-minifier-js**: this repository, with the Vite plugin's defaults,
  so the port additions above are on.
- **js +preprocess**: the same, plus `--preprocess`, so every `#if` the
  file can decide is decided. This is the column comparable with spglsl,
  which always evaluates the preprocessor and so emits a shader for one set
  of defines; shader-minifier-js keeps every `#ifdef` by default, which is a
  different product and what a site ships when its defines arrive at
  runtime. Babylon.js and PlayCanvas run their own preprocessor before the
  driver sees the GLSL, so for them the two columns coincide.
- **spglsl (ANGLE)**: ANGLE's shader translator, built to wasm and run
  offline through the `spglsl` package on one shader at a time with its
  minify and mangle options on. The number is the size of the GLSL text it
  emits, externals kept. It gets the same single source as the other columns
  and no link-time or runtime context, so this is a wire-size comparison,
  not the compile ANGLE does in the browser.
- **js vs .NET**, **preprocessed vs spglsl**: how much smaller
  shader-minifier-js's output is than that column, the spglsl one taken from
  the preprocessed column so that like is compared with like.

The corpora: tom.to is six GLSL ES 3.00 shaders from tom.to's ink mark, a
WebGL2 particle engine, under `test/tomto`; gl-transitions, three.js,
Babylon.js, PlayCanvas and CesiumJS are vendored under `test/corpus`, the
last a globe renderer rather than a game engine, captured from a running
scene since a Cesium shader as written is not a whole shader; the Shadertoy
row is the eight Shadertoy shaders in Shader Minifier's own test corpus
under `tests/real`, each wrapped in a Shadertoy header and `main()`.

A minifier that refuses any shader of a corpus gets no total for that
corpus, only the count of refusals, and its comparison cell stays blank; a
total over fewer shaders would read as a smaller size. Five PlayCanvas
shaders declare a function parameter through a macro, which Shader Minifier
cannot parse without `--expand-macros`. ANGLE rejects two Shadertoy
shaders, one for a byte order mark at the top of the file and one for a
`texture` overload it does not have; WebGL rejects both as well, and the
pixel test skips them for the same reason.

Output bytes, externals kept in all of them; three.js runs with
`--preprocess`:

| corpus | shaders | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | js +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 6 | 5,381 | 2,438 | 2,377 | 2.5% | 2,377 | 2,484 | 4.3% |
| gl-transitions | 125 | 169,066 | 69,608 | 67,711 | 2.7% | 67,645 | 79,689 | 15.1% |
| three.js | 56 | 1,337,454 | 217,909 | 129,932 | 40.4% | 129,932 | 143,890 | 9.7% |
| Babylon.js | 18 | 276,701 | 97,016 | 47,117 | 51.4% | 47,117 | 59,928 | 21.4% |
| PlayCanvas | 20 | 191,012 | 5 refused | 48,662 |  | 48,662 | 60,037 | 18.9% |
| CesiumJS | 32 | 174,106 | 72,874 | 69,143 | 5.1% | 40,414 | 43,750 | 7.6% |
| Shadertoy (Shader Minifier tests) | 8 | 99,447 | 44,904 | 44,203 | 1.6% | 42,648 | 2 refused |  |

Shaders ship compressed, so the same corpora after compression. Two
variables: the codec (brotli -q 11 is what a CDN serves, gzip -9 what an
older server gives; they differ mainly in window size) and the unit.
Compressing a corpus as one blob lets each shader compress against its
near-twins. The engines never ship that way: three.js assembles its programs
from chunks in the browser, and a shader in a real bundle sits far from any
twin. The per-shader table is the one to judge by; the blob is an upper
bound.

| corpus | minified raw | each alone | as one blob | of the compression, cross-shader |
|---|--:|--:|--:|--:|
| tom.to | 2,377 | 1,593 | 1,090 | 32% |
| gl-transitions | 67,711 | 35,790 | 14,016 | 61% |
| three.js | 129,932 | 43,101 | 12,453 | 71% |
| Babylon.js | 47,117 | 15,529 | 6,065 | 61% |
| PlayCanvas | 48,662 | 17,957 | 5,278 | 71% |
| CesiumJS | 69,143 | 22,860 | 11,359 | 50% |

**brotli -q 11, each shader on its own**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | js +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,755 | 1,620 | 1,593 | 1.7% | 1,593 | 1,621 | 1.7% |
| gl-transitions | 67,081 | 36,710 | 35,790 | 2.5% | 35,677 | 39,307 | 9.2% |
| three.js | 269,870 | 68,734 | 43,101 | 37.3% | 43,101 | 46,531 | 7.4% |
| Babylon.js | 67,148 | 30,152 | 15,529 | 48.5% | 15,529 | 17,418 | 10.8% |
| PlayCanvas | 47,336 | 5 refused | 17,957 |  | 17,957 | 20,615 | 12.9% |
| CesiumJS | 38,439 | 24,080 | 22,860 | 5.1% | 15,196 | 16,507 | 7.9% |
| Shadertoy (Shader Minifier tests) | 30,115 | 17,407 | 17,039 | 2.1% | 16,498 | 2 refused |  |

**brotli -q 11, whole corpus as one blob**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | js +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,167 | 1,114 | 1,090 | 2.2% | 1,090 | 1,132 | 3.7% |
| gl-transitions | 29,088 | 14,389 | 14,016 | 2.6% | 14,036 | 15,188 | 7.6% |
| three.js | 22,926 | 14,620 | 12,453 | 14.8% | 12,453 | 13,713 | 9.2% |
| Babylon.js | 15,744 | 9,552 | 6,065 | 36.5% | 6,065 | 7,192 | 15.7% |
| PlayCanvas | 8,444 | 5 refused | 5,278 |  | 5,278 | 5,254 | -0.5% |
| CesiumJS | 17,592 | 11,648 | 11,359 | 2.5% | 6,925 | 7,484 | 7.5% |
| Shadertoy (Shader Minifier tests) | 25,952 | 14,281 | 13,965 | 2.2% | 13,507 | 2 refused |  |

**gzip -9**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | js +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,458 | 1,179 | 1,158 | 1.8% | 1,158 | 1,213 | 4.5% |
| gl-transitions | 35,330 | 16,508 | 16,031 | 2.9% | 16,001 | 17,470 | 8.4% |
| three.js | 196,245 | 20,948 | 16,774 | 19.9% | 16,774 | 19,536 | 14.1% |
| Babylon.js | 40,713 | 11,930 | 7,204 | 39.6% | 7,204 | 8,901 | 19.1% |
| PlayCanvas | 24,421 | 5 refused | 7,072 |  | 7,072 | 7,276 | 2.8% |
| CesiumJS | 25,813 | 14,153 | 13,843 | 2.2% | 8,149 | 8,747 | 6.8% |
| Shadertoy (Shader Minifier tests) | 29,728 | 16,149 | 15,796 | 2.2% | 15,252 | 2 refused |  |

The order of the three minifiers is the same under every codec and unit.
The unit changes the margin: shader-minifier-js's win over Shader Minifier
on three.js is 37.3% per shader and 14.8% as a blob, since the blob already
compresses the repeated chunk text. gzip gives slightly larger margins than
brotli. As blobs the engine corpora compress 10 to 58 fold, mostly one
program against another, which makes them useful for finding bugs and a poor
measure of size.

Compared like with like, through the preprocessed column, shader-minifier-js
is smaller than spglsl on every corpus, at every codec and unit, except
PlayCanvas as one blob by 0.5%. On CesiumJS the difference between the two
shader-minifier-js columns is the point: with every `#if` kept it is 69,143
bytes, with the file's own defines decided 40,414 and the whole of that is
dead preprocessor branches, not rewriting. One caveat about the spglsl
column, which counts against this table rather than against spglsl: the
pixel harness checks shader-minifier-js's output, never spglsl's, so its
number is bytes ANGLE emitted, not bytes verified to render the same.

## Running the browser tests

The pixel test and the corpus test render in headless Chromium and skip
without one. They need Playwright's browser once:

```sh
npx playwright install chromium   # downloads Chromium for the installed Playwright
npm run pixels                    # test/pixels.test.ts and test/corpus.test.ts, about eight minutes
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

Three tests guard real output rather than parity with Shader Minifier:

- `test/pixels.test.ts` is the semantic oracle: every shader is rendered in
  headless Chromium (ANGLE on SwiftShader, Chrome's own WebGL compiler) both
  as written and as minified, with the same deterministic uniforms, textures
  and inputs, and the results must match. Fragment shaders are compared by
  pixels, vertex shaders by transform-feedback output. It covers `test/tomto`,
  the semantic fixtures in `test/pixels/` (one per class of bug found), and
  the WebGL-compatible shaders of Shader Minifier's corpus, each with the
  Vite plugin's defaults and with Shader Minifier's rewrites alone. A shader
  that flips pixels on a one-ulp change of its own literals (a raymarcher at a hit threshold) is
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
  the ones a site ships. The three.js shaders also run with their `#if`s
  kept, as the plugin sees them, once as dumped and once with every runtime
  define the file leaves undecided switched on, so the compiler decides the
  kept branches both ways. `npm run corpus:gl-transitions`,
  `corpus:three`, `corpus:babylon`, `corpus:playcanvas` and `corpus:cesium`
  refresh them from the npm packages; the version is recorded next to each.
  The engine shaders are also compiled and drawn in vertex/fragment pairs, so
  a rename that only breaks across the two stages is caught.

- `test/tomto.test.ts` pins the six tom.to shaders above, minified with the
  Vite plugin's defaults, to `test/tomto/*.expected`. `UPDATE_GOLDEN=1 npm test`
  rewrites them.
- `test/angle-compile.test.ts` compiles every minified output with ANGLE, the
  compiler behind Chrome's WebGL, through the `spglsl` package: `test/tomto`,
  the spglsl corpus, and the GLSL ES files among Shader Minifier's unit tests. Sources
  ANGLE rejects (desktop GLSL, most of the demoscene corpus) and libraries
  without `main()` are skipped. `spglsl` is prebuilt wasm and not a
  dependency; the test skips unless you `npm install --no-save spglsl` first.

### Reproducing the comparison

shader-minifier-js, with the Vite plugin's defaults spelled out as flags
(the goldens in `test/tomto/*.expected` are this output):

```sh
npm run build
node bin/shader-minifier.js --format text -O2 --webgl --preserve-externals --no-overloading \
  test/tomto/sim.vert -o /dev/stdout | wc -c
```

spglsl:

```sh
npm install --no-save spglsl
node scripts/minify-with-spglsl.mjs test/tomto/*.vert test/tomto/*.frag
```

Shader Minifier (.NET), from a clone at `../shader-minifier`, built and run
in a .NET 8 SDK container; `--preserve-externals --no-overloading` are the
two flags it shares with the defaults above:

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

Apache-2.0, like Shader Minifier; see `LICENSE` and `NOTICE`. The test
corpus in `tests/` is Shader Minifier's, under `tests/LICENSE-shader-minifier`.
