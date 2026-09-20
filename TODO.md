# TODO

What is known to be missing or limited, with the plan for each. `PORTING.md`
section 5.2 records what has been changed and why; this file is what has not.

## 0. Turn the CI workflow on in GitHub

`.github/workflows/ci.yml` is on `master` but nothing has run it yet. Actions
has to be enabled for the repository before it does: **Settings -> Actions ->
General**, allow workflows to run, then push anything (or use **Run workflow**
from the Actions tab) to get the first run.

Worth checking on that first run, because none of it has executed on GitHub's
runners, only here:

- Chromium installs and the semantic tests actually run. They skip themselves
  without a browser, so a green run that reports skips means `REQUIRE_BROWSER`
  did not take effect and the browser step needs looking at.
- The whole suite takes about eight minutes locally, most of it
  `test/corpus.test.ts`. If that is too slow for every push, splitting the
  browser tests into a second job is the obvious change.
- `npm install --no-save spglsl` is allowed to fail, so the ANGLE compile test
  may skip. That is deliberate; a registry hiccup should not fail the build.

Consider also requiring the check on `master` once it is green, since the
goldens are the thing most easily broken by accident.

## 0b. WebGPU, aimed at TensorFlow.js

The idea to try: a WGSL path targeting the compute shaders the TensorFlow.js
WebGPU backend (`@tensorflow/tfjs-backend-webgpu`, 4.22.0 at the time of
writing) generates for its kernels, rather than the rendering shaders an
engine emits.

Why it is a different problem from everything above, and worth stating
plainly before anyone starts:

- **Speed is the point here, not size.** Section 6 established that for
  rendering shaders minification buys bytes and not frames, because the
  driver re-optimises everything anyway. A machine-learning kernel is a hot
  loop that runs over a large tensor, so the arithmetic in it is the work.
  That inverts the whole case and means the pixel-equivalence harness is the
  wrong oracle: the right one compares tensor outputs and wall-clock time.
- **WGSL is a different language,** not a dialect. Rust-like syntax, explicit
  `@group`/`@binding` attributes, struct-based IO, and no preprocessor at
  all. The parser, the printer and the entire preprocessor layer do not
  transfer; renaming, dead-code elimination and inlining transfer in shape
  but not in code, since this syntax tree is built around GLSL's qualifiers
  and precision. That argues for a sibling package sharing the harness and
  the method, not a mode inside this one. Adding a second language to this
  tree is how the HLSL situation happened.
- **Someone is already optimising it.** Chrome compiles WGSL through Tint,
  and the kernels themselves are generated from templates that already
  specialise on shape and dtype. The honest first question is whether there
  is anything left on the table after both, or whether the win is in how the
  kernels are generated rather than in rewriting them afterwards.

**What already exists** (npm, checked 2026-09-20; neither evaluated here):

- `miniray` 0.3.1, a WGSL minifier shipped as a WebAssembly build
  (github.com/HugoDaniel/miniray), last published 2025-12-28.
- `nagami-rs` 2026.10.2, which shrinks WGSL through Naga's IR optimisation
  passes (github.com/ekarad1um/Nagami), published 2026-09-19.
- `vite-plugin-glsl` and `rsbuild-plugin-glsl` both claim to minify WGSL,
  which for a bundler plugin usually means stripping comments and
  whitespace rather than renaming.

Both dedicated tools are young and low-profile, so there is room. But note
what they are: *size* minifiers, the same job this project does for GLSL.
Neither addresses kernel runtime, which is the thing that would matter for
tf.js, and the runtime job is Tint's inside the browser. Before building
anything, the first move is to run tf.js's kernels through `nagami-rs` and
see what it already achieves, since it is the closest existing thing and
riding Naga's IR is a cheaper base than a new front end.

What to measure first, before writing any parser:

1. Capture the WGSL tf.js actually runs. The same trick the engine dumpers
   use works: wrap the WebGPU device's `createShaderModule` and record every
   kernel a model compiles, for a few models the package lists (MobileNet,
   BlazeFace, PoseDetection).
2. Time them. Kernel wall-clock over a realistic input, and compilation
   time, which matters at model load.
3. Only then ask what a rewrite could change: fewer bounds checks, hoisted
   loop invariants, workgroup sizes, less indexing arithmetic. If Tint
   already does all of it the answer is to stop, and that is a good answer
   cheaply bought.

Section 6's rule applies to any size claim here too: judge it compressed.

## 1. Directives inside expressions (a fuller parser)

Engine shaders put `#if` blocks inside argument lists, parameter lists and
initializers (three.js: `getTangentFrame( -vViewPosition, normal,\n#if defined(
USE_NORMALMAP )\n vNormalMapUv\n#elif ...`). The parser knows a directive only
as a statement or a top-level item, so such a file needs `--preprocess`, which
assumes the file is complete and so cannot serve a shader whose defines are
injected at runtime. Lifting this is the change that would let the Vite plugin
take engine shaders as they come.

Plan, in the order that keeps every step shippable:

1. **Lex directives as tokens.** Today a directive is recognised at statement
   level by `#` at the start of a line. Make the lexer emit a `Directive`
   token for any line starting with `#` (after whitespace), carrying the
   line's text, wherever it appears. Statement and top-level parsing keep
   their current handling by consuming the token there.
2. **A conditional expression node.** Add `Expr.kind = "Conditional"` holding
   `branches: { condition: string | null; exprs: Expr[] }[]` (the last branch
   with `condition: null` for `#else`), produced when a `Directive` token is
   met inside an argument list, an initializer, or an operand position. The
   parser parses each branch's text as the same syntactic category as the
   surrounding position expects: a list of arguments inside a call, one
   expression elsewhere. `#endif` closes it.
3. **Printing.** The printer emits the branches with their directives on
   their own lines, which the text format already does for statement-level
   directives.
4. **Analysis.** The visitor maps every branch. Purity, effects and variable
   uses are the union over branches. Inlining and folding never move an
   expression into or out of a `Conditional`, and a call with a `Conditional`
   among its arguments is not a call site for argument inlining. The scope
   check visits each branch with the same scope.
5. **The same for statements and declarations already works**, since they are
   statements; the remaining gap after 1 to 4 is a directive inside a
   declarator list (`float a,\n#ifdef X\n b,\n#endif\n c;`), which can be
   handled last by splitting the declaration.
6. **Tests:** the three.js corpus without `--preprocess`, the unit cases from
   `test/preprocessor.test.ts` rewritten to reach the parser, and round-trip
   idempotence for the new node.

Until then `--preprocess` is the way; item 16 of `PORTING.md` lists what it
now decides.

## 2. Upstream limits still in place

- **Overload resolution by type.** The analyzer resolves calls by name and
  arity; two overloads with the same arity are "unknown", which keeps
  inlining and `--webgl` conservative around them. The rewriter's best-effort
  `typeOf` could grow into a typer for expressions, at which point call sites
  resolve exactly and `--webgl`'s output check no longer has to pass unknowns.
- **A macro in declaration position.** PlayCanvas writes
  `float f(SHADOWMAP_ACCEPT(shadowMap), vec3 c)`, where the macro expands to
  a whole parameter. The parser cannot represent it, so those five shaders
  need `--expand-macros`; without it they are refused. Section 1's plan
  covers the general case.
- **`#include`.** Not supported; engines resolve it before the shader reaches
  the minifier, so the plugin could too, from the importing file's directory.
- **`precision` inside a function body.** A parse error today; GLSL allows it.
- **Struct types from another file.** In a multi-file run each file is
  analysed alone, so a struct declared in one file is unknown in the next.
  Sharing declarations across files in `Minifier` would fix `--webgl` and the
  swizzle-like field handling for that case.
- **A declaration lost under three flags at once.** Five shaders of the
  upstream corpus (`many_variables`, `ed-209`, `slisesix`, `endeavour`,
  `audio-flight-v2`) emit a use with no declaration when
  `--no-remove-unused`, `--aggressive-inlining` and `--move-declarations` are
  combined. The bug predates the port: it reproduces at the first commit, and
  was invisible until the scope check learned to look for a missing
  declaration on finished code. The minifier now fails instead of emitting
  the broken shader, and `test/port-flags.test.ts` asserts that failure so
  the list shrinks when it is fixed. Minimal reproduction has not been found;
  it seems to need the scale of `many_variables.frag`.
- **A callee pulled ahead of an `#ifdef` region** now follows every global
  declaration (`reorderFunctions`), which is safe unless the global's own
  initializer depends on a macro defined inside the region.

## 3. Vertex and fragment pairs in the pixel test: done

The harness has a `program` mode that links a real vertex and fragment shader
and draws them, and `test/corpus.test.ts` runs every three.js pair through it,
twice: under the plugin's defaults and with `--remove-unused-varyings`. It
found its first bug on the day it landed, a varying removed although the
vertex shader read it back.

Its limits, for whoever extends it. The uniforms are generated, near-identity
for matrices, so the geometry is not a real scene; 27 of the 28 pairs draw
between 173 and 524 distinct colours, which is plenty of signal, but
MeshDistanceMaterial draws 2 and can only catch a gross difference. A pair
whose original draws one flat colour is skipped, since comparing two blank
images proves nothing. Rendering three.js's own scenes through
`material.onBeforeCompile`, which was the original plan, would replace the
generated uniforms with real ones and is still the better oracle.

gl-transitions have a fixed pair (the wrapper's vertex shader), so their
fragment-only comparison already is the real pair.

## 4. Other compilers

- **SwiftShader** (through ANGLE, in headless Chromium) is the only executor
  available; it is also what Chrome uses without a GPU.
- **spglsl** is ANGLE compiled to wasm: a second front end for validation
  (`test/angle-compile.test.ts`, opt-in) and the competitor in `npm run
  metrics`. It cannot execute a shader.
- **glslang** exists as a wasm package (`@webgpu/glslang`); it is the Khronos
  reference front end, a genuinely different parser from ANGLE's, and would
  make a cheap third validation oracle for the corpus outputs.
- **Firefox and WebKit** through Playwright would exercise other drivers only
  on a machine with a GPU; headless they also use ANGLE or SwiftShader.
- Nothing here reaches a real GPU driver. Rounding, `mediump` and folding
  differ there; the pixel test proves equivalence under one compiler.

## 5. Test cases to add

- Babylon.js and PlayCanvas are vendored (`npm run corpus:babylon`,
  `npm run corpus:playcanvas`), and their pairs are linked *and* rendered
  along with three.js's (section 3).
- A fourth engine, if one is wanted. Each of the three so far paid for
  itself: Babylon refused to parse at all (interface blocks with an instance
  name, `PORTING.md` item 27) and then exposed a variable-reuse bug that
  emitted a shader naming a variable it never declares (item 28); PlayCanvas
  declares a function parameter through a macro
  (`float f(SHADOWMAP_ACCEPT(shadowMap), ...)`), which only `--expand-macros`
  can take, and needed the harness to learn integer samplers.
- A shader whose defines are injected at runtime, once section 1 lands.
- A multi-file run in the pixel test (`tests/real/mouton` is one).
- More seeds where a shader's branches depend on textures rather than
  uniforms, and a larger canvas for shaders with fine detail.
- The upstream candidates of `PORTING.md`, filed upstream with their
  reproducing shaders.

## 6. Size and speed, from `npm run metrics`

**Execution time does not change.** Ten of the heaviest gl-transitions,
40 draws each at 256x256, median of 7 runs, in headless Chromium (ANGLE on
SwiftShader): 1,265 ms for the sources against 1,246 ms minified, 1.5%, with
individual shaders landing on both sides of the line. The removal pass alone
is 0.8%. Both are noise.

That is the expected result, not a disappointment. The driver's compiler
re-does inlining, folding and dead-code elimination from its own IR, so the
source-level form the minifier produces is largely erased before anything
reaches the hardware, and a declaration nothing reads was never executed in
the first place. Minification buys bytes over the wire, not frames.

Two caveats worth keeping in mind. SwiftShader is a CPU rasterizer, so this
measures one compiler's behaviour, not a GPU's; the effect a real driver
could show and this cannot is register pressure, where aggressive inlining
lengthens live ranges and can lower occupancy, making minified code slightly
*slower*. And unused varyings (section 7) are the one removal that should
show up at runtime, since an interpolator slot and the vertex work feeding it
survive dead-code elimination while both stages still declare the varying.
That case is unmeasured.

**Compile time does improve**, if that matters for startup: over the six
largest three.js fragment shaders, median of 25 compiles each, 8.1 ms for the
sources against 3.2 ms minified, about 60%. `--remove-unused-declarations`
accounts for none of it on its own (3.0 ms without it, inside the noise).


- **three.js: now 8.5% below ANGLE**, after `--remove-unused-declarations`
  (PORTING.md item 21) took out the sampler precision statements, packing
  constants and light structs the chunks left behind; before it ANGLE was
  6.5% ahead. What remains on ANGLE's side: it drops unused uniforms, which
  the minifier keeps because the application looks them up (an opt-in
  `--remove-unused-uniforms` for applications that tolerate a missing
  location, as three.js does, is the candidate), and it drops `highp` on
  declarations where the default precision already says so.
- **InvertedPageCurl grows 58 bytes under the plugin.** Something among
  `--expand-macros`, the float32 folds and the pinned names costs more than
  it saves there; bisect by flag.
- **Two shadertoy shaders spglsl refuses** (ed-209's struct ternary, and one
  more) keep that column's total from comparing; list them per shader.

### Compressed size

`npm run metrics` now reports each corpus compressed as one bundle (brotli
-q 11) beside the raw totals, because that is what a user downloads and
because a minifier optimising raw bytes can in principle lose there. It does
not: the order of source, upstream rewrites, plugin and spglsl is the same
under compression. What changes is the size of the margins, which halve
wherever a corpus repeats itself (three.js: 39.8% raw over upstream's
rewrites, 16.1% compressed; 58-fold compression of the source, since its
programs share their chunks).

Two things follow. Any new size optimisation should be judged on the
compressed column, not the raw one: a rewrite that replaces repeated text
with shorter repeated text may be worth nothing after brotli. And the
optimisations most likely to still pay are the ones that remove *unique*
text rather than repeated text, which is an argument for unused varyings and
uniforms (section 7) over macro extraction or rerolling.

## 7. Optimizations not done yet

- **Unused varyings: done, and small on three.js.**
  `--remove-unused-varyings` (`PORTING.md` item 26) removes a vertex output no
  fragment shader of the run declares and a fragment input nothing reads. It
  is worth 124 bytes over the 28 three.js programs and 3 interpolator slots,
  far less than the first measurement suggested, because most apparently dead
  varyings turned out to be read back by the vertex shader itself. The number
  is small because three.js already emits close to the varyings it needs; an
  engine with a coarser chunk system would pay more. It stays off by default
  and the Vite plugin cannot use it, since the plugin sees one file at a time.

  What is left here: the plugin could use it if it paired a `.vert` and
  `.frag` imported from the same module, which Vite makes awkward but not
  impossible. A varying an engine's vertex shader writes but the
  fragment shader never reads costs an interpolator slot, the vertex work
  that computes it, and the per-fragment interpolation, none of which a
  driver can remove while the declaration matches across the two stages.
  It is also the only one that needs both halves of a program at once: the minifier
  sees one file at a time, so it needs the pair (section 3) or an explicit
  list of varyings to keep. In the plugin the pair is known when a `.vert`
  and a `.frag` are imported together; on the CLI it is the multi-file run.
  Removing a varying means removing its declaration in both shaders and,
  in the vertex shader, the assignments that feed it (and anything that then
  becomes dead), which is `removeUnusedDeclarations` plus a cross-file set
  of names. Worth measuring against three.js, whose chunks write
  `vViewPosition` and friends into every material.
- **Unused uniforms.** What ANGLE still drops and the port keeps, since the
  application looks uniforms up by name. Opt-in only, for applications that
  tolerate a null location (three.js does). Same machinery as the varyings
  once the cross-file name set exists.
- **Redundant precision qualifiers: done, and it does not pay.**
  `--drop-default-precision` now also drops a qualifier on a declaration
  that restates the precision in force, as ANGLE does. Measured over the
  corpora it is worth 42 bytes raw on three.js and *four bytes worse*
  compressed, because what it removes is the repeated word `highp` and the
  compressor was already charging almost nothing for it. It fires rarely
  there for a good reason: three.js emits `out highp vec4 pc_fragColor;`
  before its `precision highp float;` line, and until that line the
  qualifier is the only thing saying what the type is. This is the first
  clean confirmation of the rule in section 6: removing repeated text is
  not worth much after brotli. Kept because it is correct, tested and does
  help a single shader packed on its own, which is the demoscene case.

- **Lossy precision reduction (`highp` to `mediump`) is blocked on the
  harness, not on the rewrite.** It is the only proposal here with a real
  runtime payoff, since `mediump` is fp16 on mobile hardware. The pixel test
  cannot validate it: SwiftShader, and desktop ANGLE generally, implement
  `mediump` as fp32, so a reduced shader renders identically there and the
  test would pass while the shader broke on a phone. The unblock is to
  emulate fp16 in the comparison, which WebGL2 makes possible:
  `unpackHalf2x16(packHalf2x16(vec2(x))).x` rounds a float to half
  precision, so a transform that wraps every `mediump`-typed intermediate in
  it gives a shader that computes what a mobile GPU would. Build that first,
  then the rewrite is a small one.

### Measured and not worth building

Kept here so they are not proposed again. Both were judged on the compressed
column of section 6, which is the point of having it.

- **Function and struct deduplication.** Two functions with identical bodies
  collapse to one. Measured over the three.js corpus, duplicate
  function-body text is 1.4% of the source and 3.4% of the minified output,
  about 2.7 KB in total, so the ceiling is roughly 2% of the corpus raw.
  Those duplicates are literal repeats inside one shader, which is exactly
  what brotli already removes, so the compressed win is near zero. Against
  that: proving two functions identical modulo parameter names, handling
  overloads, and rewriting call sites. Not worth it.
- **Macro extraction** (emitting `#define` for a repeated token sequence)
  is the same shape of idea and fails the same test, more severely: it
  replaces repeated text with repeated text plus a definition.

The rule these two share: an optimisation that removes *repeated* text is
paid for by the compressor already. What still pays is removing *unique*
text, which is why unused varyings and uniforms remain the best items above.

## 8. Flag surface

Adding one flag today touches six places: the `Options` field, the defaults,
the usage table, the argv switch, the plugin's option type and the plugin's
defaults. A descriptor table driving the help text and the parser would cut
that, but the argv switch is ported from upstream and the changes below
would rewrite the surface anyway, so the table is only worth building on top
of whatever this section settles on.


The port's flags grew one per discovery and are all off in the CLI so the
goldens stay byte-identical, which is why reproducing the plugin's output
from the command line takes nine of them. What that should become:

- **`-O0` to `-O3`, or a `--webgl-preset`.** One flag that sets a coherent
  group: `-O0` upstream's rewrites only (what the goldens pin), `-O1` the
  safe port additions, `-O2` the plugin's current defaults, `-O3` the
  lossy ones a shader must be checked for. Individual flags stay, applied
  after the level, so `-O2 --no-fold-builtins` works.
- **Split `--fold-builtins`.** It carries two unrelated things: evaluating
  builtin calls on literals (a size optimization) and doing the operator
  folds at float32 precision instead of upstream's decimal arithmetic (a
  correctness property). The second should be its own flag, or the default,
  since a minifier that shifts a float32 value is wrong for everyone; the
  cost is a handful of recorded golden deviations.
- **Level, not boolean, for inlining and for unused removal.**
  `--inline-single-use` is a middle rung between upstream's default and
  `--aggressive-inlining`, and it also carries a second rewrite (argument
  substitution) the name does not mention. `--no-remove-unused` and
  `--remove-unused-declarations` are three levels (none, functions, all)
  spelled as two booleans that can contradict each other.
- **`--no-pi-substitution` may not need to exist.** Upstream matches a
  literal rounded to eight decimals, so it can move a float32 value. Firing
  only when the literal's float32 value equals float32 pi would be exact,
  and the flag could go.
