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
time. Defaults are chosen for WebGL: `webgl`, `preserveExternals`,
`noOverloading`, `noPiSubstitution`, `expandMacros`, `foldBuiltins`,
`dropDefaultPrecision`, `inlineSingleUse` and `removeUnusedDeclarations` are
on, so uniform and attribute names are kept, macros and constant builtin calls
are folded away, unused globals, structs and precision statements go, and the
output only uses constructs ANGLE accepts. Every other
Shader Minifier flag is available as a camelCased option (`noRenaming`,
`noRenamingList`, `noInlining`, `aggressiveInlining`, `noSequence`,
`noRemoveUnused`, `preprocess`, `moveDeclarations`), `include` overrides the
file pattern, and `options` passes any raw minifier option.

## Port additions

The additions below are off by default on the command line, so the output
stays byte-identical to Shader Minifier's; `-O0` to `-O3` turn them on in
coherent groups. `-O0` is Shader Minifier's rewrites only. `-O1` adds what
changes neither meaning nor interface: no pi substitution, default precision
statements dropped, single-use globals inlined, unused declarations removed.
`-O2` is what the Vite plugin does, `-O1` plus macro expansion and the
folding of builtin calls and divisions. `-O3` also removes unused varyings
and uniforms, which needs both stages in one run and an application that
tolerates a null uniform location. Flags after a level override it
(`-O2 --no-fold-builtins`), and a level after a flag resets its group. The
target flags, `--webgl`, `--preserve-externals`, `--no-overloading`,
`--stage` and `--preprocess`, are not part of a level: the plugin is
`-O2 --webgl --preserve-externals --no-overloading`.

- `--webgl`: skip two Shader Minifier rewrites whose output Chrome rejects (`?:` on
  struct values; a void call folded into a comma sequence, an ES 3.00 rule),
  and fail with an error if the output would still contain either. An
  expression of unknown type counts as unsafe; a call to an overloaded user
  function is known when every overload returns the same type.
- `--expand-macros`: expand `#define`s so neither the definitions nor the
  long macro names reach the output (Shader Minifier keeps them as feature switches).
  Macros used in `#if` conditions or defined inside `#if` blocks are left alone.
- Operators on literals fold the way the GPU's compiler folds them: float32
  operands and one rounding per operation, printed with the shortest float32
  digits (`2.*3.141592653589793` → `6.2831855`) and only when not longer.
  Upstream folds in decimal, which can land one ulp off (`4.3+3.4` → `7.7`,
  where the GPU computes `7.7000003`); `--decimal-folds` restores that, and
  the goldens run with it. Division has 2.5 ulp of latitude in the spec, so
  its float32 fold waits for `--fold-builtins`.
- `--fold-builtins`: evaluate builtin calls on literals (`radians(45.)` →
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
  upstream binds every use to the last declaration. So the plugin takes a
  shader whose defines are injected at runtime as it comes.
- Float literals above ~7.9e28 (the .NET `decimal` limit) are accepted.
- Struct fields named like swizzle components (`float q;`, `vec3 rgb;`) are
  accepted and kept under their names; Shader Minifier refuses the declaration.
- Prefix `+`/`-` never merge into `++`/`--` (`-(--a)` prints as `- --a`).

## Results

`npm run metrics` minifies every corpus three ways and, when spglsl is
installed, a fourth. The columns:

- **Shader Minifier (.NET)**: the original, version 1.5.1. The numbers come
  from this port run with only Shader Minifier's own rewrites, which is what
  the goldens pin; on the tom.to shaders that output matches the .NET binary
  byte for byte.
- **shader-minifier-js**: this repository, with the Vite plugin's defaults,
  so the port additions above are on.
- **spglsl (ANGLE)**: ANGLE's shader translator, built to wasm and run
  offline through the `spglsl` package on one shader at a time with its
  minify and mangle options on. The number is the size of the GLSL text it
  emits, externals kept. It gets the same single source as the other columns
  and no link-time or runtime context, so this is a wire-size comparison,
  not the compile ANGLE does in the browser.
- **js vs .NET**, **js vs spglsl**: how much smaller shader-minifier-js's
  output is than that column.

The corpora: tom.to is six GLSL ES 3.00 shaders from tom.to's ink mark, a
WebGL2 particle engine, under `test/tomto`; gl-transitions, three.js,
Babylon.js and PlayCanvas are vendored under `test/corpus`; the Shadertoy
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

| corpus | shaders | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | spglsl (ANGLE) | js vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 6 | 5,381 | 2,438 | 2,378 | 2.5% | 2,484 | 4.3% |
| gl-transitions | 125 | 169,066 | 69,584 | 67,931 | 2.4% | 79,689 | 14.8% |
| three.js | 56 | 1,337,454 | 218,851 | 131,598 | 39.9% | 143,890 | 8.5% |
| Babylon.js | 18 | 276,701 | 106,932 | 57,789 | 46.0% | 59,928 | 3.6% |
| PlayCanvas | 20 | 191,012 | 5 refused | 48,662 | | 60,037 | 18.9% |
| Shadertoy (Shader Minifier tests) | 8 | 99,447 | 44,812 | 44,116 | 1.6% | 2 refused | |

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
| tom.to | 2,378 | 1,591 | 1,093 | 31% |
| gl-transitions | 67,931 | 35,875 | 14,104 | 61% |
| three.js | 131,598 | 43,331 | 12,764 | 71% |
| Babylon.js | 57,789 | 16,070 | 6,717 | 58% |
| PlayCanvas | 48,662 | 17,957 | 5,278 | 71% |

**brotli -q 11, each shader on its own**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | spglsl (ANGLE) | js vs spglsl |
|---|--:|--:|--:|--:|--:|--:|
| tom.to | 2,755 | 1,623 | 1,591 | 2.0% | 1,621 | 1.9% |
| gl-transitions | 67,081 | 36,734 | 35,875 | 2.3% | 39,307 | 8.7% |
| three.js | 269,870 | 68,840 | 43,331 | 37.1% | 46,531 | 6.9% |
| Babylon.js | 67,148 | 30,703 | 16,070 | 47.7% | 17,418 | 7.7% |
| PlayCanvas | 47,336 | 5 refused | 17,957 | | 20,615 | 12.9% |
| Shadertoy (Shader Minifier tests) | 30,115 | 17,372 | 17,008 | 2.1% | 2 refused | |

**brotli -q 11, whole corpus as one blob**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | spglsl (ANGLE) | js vs spglsl |
|---|--:|--:|--:|--:|--:|--:|
| tom.to | 2,167 | 1,114 | 1,093 | 1.9% | 1,132 | 3.4% |
| gl-transitions | 29,088 | 14,401 | 14,104 | 2.1% | 15,188 | 7.1% |
| three.js | 22,926 | 15,201 | 12,764 | 16.0% | 13,713 | 6.9% |
| Babylon.js | 15,744 | 10,166 | 6,717 | 33.9% | 7,192 | 6.6% |
| PlayCanvas | 8,444 | 5 refused | 5,278 | | 5,254 | -0.5% |
| Shadertoy (Shader Minifier tests) | 25,952 | 14,345 | 14,000 | 2.4% | 2 refused | |

**gzip -9**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | spglsl (ANGLE) | js vs spglsl |
|---|--:|--:|--:|--:|--:|--:|
| tom.to | 2,458 | 1,180 | 1,156 | 2.0% | 1,213 | 4.7% |
| gl-transitions | 35,330 | 16,518 | 16,109 | 2.5% | 17,470 | 7.8% |
| three.js | 196,245 | 21,310 | 17,050 | 20.0% | 19,536 | 12.7% |
| Babylon.js | 40,713 | 12,431 | 7,896 | 36.5% | 8,901 | 11.3% |
| PlayCanvas | 24,421 | 5 refused | 7,072 | | 7,276 | 2.8% |
| Shadertoy (Shader Minifier tests) | 29,728 | 16,159 | 15,816 | 2.1% | 2 refused | |

The order of the three minifiers is the same under every codec and unit.
The unit changes the margin: shader-minifier-js's win over Shader Minifier
on three.js is 37.1% per shader and 16.0% as a blob, since the blob already
compresses the repeated chunk text. gzip gives slightly larger margins than
brotli. As blobs the engine corpora compress 17 to 58 fold, mostly one
program against another, which makes them useful for finding bugs and a poor
measure of size.

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
  with each transition's default parameters, and the programs three.js (MIT)
  assembles for its materials, dumped from a real renderer in the harness's
  browser so the chunk expansion and the runtime `#define`s are the ones a
  game ships. `npm run corpus:gl-transitions` and `npm run corpus:three`
  refresh them from the npm packages; the version is recorded next to each.

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
