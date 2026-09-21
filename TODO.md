# TODO

What is known to be missing or limited, with the plan for each. `PORTING.md`
section 5.2 records what has been changed and why; this file is what has not.

Terms used throughout: **upstream** is Shader Minifier, the F# original
(.NET). **The port** is shader-minifier-js, this repository. **The plugin**
is shader-minifier-js run with the Vite plugin's default flags, which is what
the size tables measure; **upstream's rewrites** is shader-minifier-js
limited to the rewrites Shader Minifier itself performs, which reproduces
its output.

## 0. CI: running

`.github/workflows/ci.yml` runs on every push to `master` and every pull
request: typecheck, build and the whole suite with Chromium, about eight and
a half minutes, the browser tests included (`REQUIRE_BROWSER` turns a
missing browser into a failure, and the totals match a local full run).
The `test` check is required on `master` through a repository ruleset, and
that applies to pushes too: a commit reaches `master` only once the check
has passed on it. The workflow runs on every branch push for that reason, so
the way to land work without a pull request is to push the branch, wait for
green, then fast-forward `master` to the same commit. Left: splitting the
browser tests into a second job if the run time starts to matter.

## 0b. WebGPU, aimed at TensorFlow.js: measured, and the answer is no

The idea was a WGSL path targeting the compute shaders the TensorFlow.js
WebGPU backend (`@tensorflow/tfjs-backend-webgpu`, 4.22.0) generates for its
kernels, rather than the rendering shaders an engine emits. It was measured
before anything was built, and the answer is not to build it.

**What was measured.** 25 distinct kernels captured from a real run by
hooking `createShaderModule` (WebGPU does run headlessly here), 192,710 bytes
in total, median 7 KB, of which a byte-identical prelude is 36.6% and
functions unreachable from `_start` are about half. Compressed as a set:
6,806 bytes, a 28:1 ratio, so the boilerplate is nearly free already.

| | result |
|---|---|
| Kernel runtime, original vs minified | 1.004x on matMul, 0.996x on softmax: no effect |
| Tint parse over 75 pipelines | 4.6 ms to 2.4 ms after removing 88% of the text |
| Pipeline compile | unchanged; Tint's own dead-code elimination gets there first |
| `nagami-rs` at its safe profile | -83% raw, -10% compressed, outputs bit-exact |
| `miniray` 0.3.1 | rejects all 25: it cannot lex `bitcast<vec4<u32>>` |

So there is no runtime gap, the compile-time gap is about 2 ms across a whole
model's kernels, and on size an existing tool already takes most of it. The
one place real bytes sit is tf.js's own JavaScript bundle, where the kernel
templates keep their comments and indentation, worth about 2.9 KB brotli;
that belongs in tf.js's build, not in a shader minifier.

**Two things worth passing on rather than building on.**

- `nagami-rs` miscompiles at its `aggressive` and `max` profiles. tf.js's
  tiled conv2d kernel, the one with `var<workgroup>` tiles and
  `workgroupBarrier`, computes the wrong answer: relative sum error 1.1,
  while the other eleven kernels stay bit-exact. It compiles cleanly and the
  tool reports validation OK. Bisected with `optBisectLimit` to the pass
  introduced at 3, `function_inlining`. Its `baseline` profile is correct.
  Worth reporting upstream with the reproducer.
- `miniray` returns its input verbatim when it fails to parse, with the error
  in a field a caller is unlikely to check. Silently doing nothing is a bad
  failure mode for a minifier.

The original reasoning is kept below, since it is why the measurement was
worth doing.

The idea as first written:

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
struct bodies (three.js: `getTangentFrame( -vViewPosition, normal,\n#if defined(
USE_NORMALMAP )\n vNormalMapUv\n#elif ...`). The parser used to know a directive
only as a statement or a top-level item, so such a file needed `--preprocess`,
which assumes the file is complete and so cannot serve a shader whose defines
are injected at runtime. Lifting that is what lets the Vite plugin take engine
shaders as they come.

**Done.** Every three.js shader now parses without `--preprocess`, in two
steps of different quality:

| three.js shaders parsing without `--preprocess` | |
|---|--:|
| before | 43 of 56 |
| `Conditional` expression | 45 of 56 |
| opaque regions | 56 of 56 |

1. **A conditional standing where an expression does** is
   `Expr.kind = "Conditional"`: a chain of branches, each with its directive
   line as written and the expression it guards, accepted wherever a primary
   expression is. Uses and effects are the union over branches, the renamer
   walks all of them, inlining and folding never move an expression into or
   out of one, and a call with one among its arguments is not a call site
   for argument inlining. The printer parenthesises the chain only where the
   surrounding operator binds tighter than a call argument, and the parser
   takes the parentheses back, so the output re-parses.
2. **A conditional around list items** is kept as opaque text, the way a
   kept `#define` body is, in the three shapes the corpus has: a group of
   struct members (`StructMember.kind = "MemberVerbatim"`, seven shaders), a
   group of parameters with an `#else` retyping one (the whole function
   becomes a `TLVerbatim`, four shaders), and a region whose branches each
   open a different function header over one body (`#ifdef USE_IRIDESCENCE
   void computeMultiscatteringIridescence(...) {\n#else\nvoid
   computeMultiscattering(...) {\n#endif`, the seven again, hidden behind
   the struct). Every identifier the text names is pinned so the top-level
   declarations and struct fields it refers to keep their names and stay;
   unlike a `#define` body it cannot reach a local of another function, so
   those are left alone. The body of an opaque function is still parsed, to
   find its end and to be sure it is one.

   Measured on the eleven shaders that needed it, the pinning costs 1,145
   bytes raw in 371,685 (0.3%) and 91 bytes brotli in 92,753 (0.1%). Cheap
   enough that the fuller representation, alternatives in the list itself,
   is not worth building for size; it would be worth building only for what
   the text hides from the analysis, which today is a handful of functions
   per shader.

   The whole corpus minified without `--preprocess` is 717,346 bytes against
   131,598 with it (174,341 against 43,331 brotli, each shader alone). That
   is the price of keeping every branch for the compiler, which a shader
   whose defines arrive at runtime pays whatever the minifier does.

3. **What rendering them found.** Parsing was not the only thing standing
   between the plugin and an engine shader. Rendered without `--preprocess`,
   30 of the 56 failed to compile, all from one cause the corpus had never
   exercised because it always ran preprocessed: a name declared in both
   branches of a `#if` (`float fogFactor` under `FOG_EXP2` and under
   `#else`; `vec2 uv`; `vec3 shadowWorldNormal`), or a local declared in one
   branch over a global of the same name (`morphTargetInfluences` under
   `USE_INSTANCING_MORPH`), was read as one flat list: the uses bound to the
   last declaration, the first was removed as unused, the last was inlined
   into a use both shared, and the renamer gave the two different names.
   Fixed by treating every declaration of such a name in a block as one
   variable (`PORTING.md` item 32), which also corrected two upstream
   goldens that had the same bug (`tests/DEVIATIONS.md` item 4). Two
   smaller causes next to it: argument inlining moving `lightProbe`,
   declared under `USE_LIGHT_PROBES`, into a function body compiled whatever
   the define; and the renamer reusing an outer name by shadowing inside a
   loop whose braces are themselves under `#ifdef` (ed-209), where the
   shadowing exists only with the define on.

4. **Tests.** `test/opaque-regions.test.ts` covers the three shapes, their
   pinning, and round-trip idempotence; every three.js shader is minified
   without `--preprocess` and its output re-parsed;
   `test/directive-alternatives.test.ts` covers the declarations in
   alternative branches; and `test/corpus.test.ts` renders each three.js
   shader without `--preprocess` too, so the compiler's preprocessor decides
   the kept `#if`s on the minified output the same way it does on the
   source. All 56 pass.

**Left.** A directive inside a declarator list (`float a,\n#ifdef X\n
b,\n#endif\n c;`) is still a parse error; splitting the declaration at the
directive is the fix. A chain that spans several arguments (`f(a,\n#ifdef
X\n b, c\n#else\n d\n#endif\n)`) is one too. Neither occurs in the corpora.
The corpus still runs with `--preprocess` in `npm run metrics`, since the
other minifiers see preprocessed input and the sizes should compare; item 16
of `PORTING.md` lists what the flag decides, including the macros the
compiler owns (`GL_`, `__`), which it leaves undecided since CesiumJS.

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
- **`#include`: done in the plugin.** The load hook replaces an `#include
  "file"` line with the file's text, relative to the including file and
  recursively, and registers each file with Vite's watcher (`PORTING.md`
  item 44). The CLI and the library still see the directive as text they
  keep, since they have no file to resolve it against by design; a
  resolver option there is the obvious extension if anyone asks.
- **`precision` inside a function body: done.** It parses as a statement,
  sets nothing the passes track, and gates the block it stands in the way a
  directive does, since a declaration grouped above it or a variable reused
  across it would take the other precision; `--drop-default-precision`
  leaves such a body's qualifiers alone (`PORTING.md` item 43).
- **Struct types from another file.** In a multi-file run each file is
  analysed alone, so a struct declared in one file is unknown in the next.
  Sharing declarations across files in `Minifier` would fix `--webgl` and the
  swizzle-like field handling for that case.
- **A declaration lost under `--move-declarations`: fixed.** Five shaders
  of the upstream corpus emitted a use with no declaration under
  `--no-remove-unused --aggressive-inlining --move-declarations`. The cause
  was small once the trace named the passes: grouping a declaration into an
  earlier line replaces it with an assignment whose target was the
  declaration's own `Ident` object, so when the variable reuse of the next
  pass renamed that assignment it renamed the declaration with it and lost
  track of the later uses (`PORTING.md` item 42). It needed the scale of
  `many_variables` only because a reuse has to happen after the move.
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
- **glslang** exists as a wasm package (`@webgpu/glslang`), the Khronos
  reference front end and a genuinely different parser from ANGLE's. Tried,
  and it is not an oracle for this corpus: the package is built for Vulkan
  (GLSL to SPIR-V), so it rejects `#version 300 es` ("ES shaders for SPIR-V
  require version 310"), uniforms outside a block and `gl_FragColor`, and it
  reports failures without an info log. Feeding it WebGL shaders would mean
  rewriting them into something it accepts, which tests a different shader.
  A glslang built for the OpenGL ES profiles would do; none is on npm.
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
- A shader whose defines are injected at runtime, rendered under both
  settings of a define. The three.js pairs without `--preprocess` (section 1)
  are the first half: the compiler decides the kept `#if`s the same way on
  the output, but only for the defines the dumped shader carries.
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
- **InvertedPageCurl's 58 bytes: explained, and the default is right.**
  Bisected: every one of the 58 bytes is `--no-pi-substitution`. The shader
  writes `3.141592653589793` once, which upstream replaces with `acos(-1.)`
  and the plugin does not. So it is not a regression but the deliberate trade
  of `PORTING.md` item 3, and the measurement says the trade is correct:

  | corpus | raw bytes pi substitution would save | compressed |
  |---|--:|--:|
  | tom.to | 1 | 4 |
  | gl-transitions | 109 | 8 |
  | three.js | 63 | 15 |
  | Babylon.js | 371 | 23 |
  | PlayCanvas | 0 | 0 |

  About 50 bytes compressed across five corpora, because what it removes is a
  repeated literal and the compressor was already charging almost nothing for
  it. Against that sits a precision risk under `mediump` on mobile hardware
  that no oracle here can test, since SwiftShader implements `mediump` as
  fp32. Fifty bytes is not worth an unverifiable risk. Nothing to do.
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

`npm run metrics` reports three compressed views: each shader on its own,
the whole corpus as one blob, and the blob again under gzip -9. The unit
matters more than the codec, and getting it wrong reversed a verdict here
once already.

Cross-shader redundancy is most of the blob's compression: 71% of it for
three.js and PlayCanvas, 61% for gl-transitions, 31% for the six hand-written
tom.to shaders. The engines are near-duplicates of each other, which is what
makes them so compressible as a blob. But none of them ship that way:
three.js sends its chunk library and assembles the programs in the browser.
The blob is a scenario that does not occur.

So judge a size change with each shader compressed on its own, and read the
blob as an optimistic bound. Re-checked under that unit: unused uniforms
*saves* (811 bytes on three.js) where the blob said it cost 53; pi
substitution is still worth only about 45 bytes, so that verdict stands
under every unit and codec.

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
- **Unused uniforms: done.** `--remove-unused-uniforms` (`PORTING.md` item
  30) removes a plain uniform no shader of the run reads, under the same
  both-stages gate as the varyings. Measured over the engine pairs:

  | corpus | raw | each program alone | as one blob |
  |---|--:|--:|--:|
  | three.js | -3,890 (2.9%) | -811 | +53 |
  | PlayCanvas | -1,941 (4.0%) | -258 | +66 |
  | Babylon.js | -25 | -11 | +14 |

  Worth recording how this reads, because the first version of this note got
  it wrong. Measured on the blob it *costs* bytes, and that was written down
  as a third case of the compressed column overturning a raw win. It is not:
  the blob lets 28 near-identical programs compress against each other, and
  each program's dead uniforms are a different subset, so removing them
  desynchronises them. Compress each program on its own, which is nearer how
  a shader sits in a real bundle, and it saves. The lesson is about the unit,
  not the flag.

- **Unused uniforms, the original note.** What ANGLE still drops and the port keeps, since the
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

- **Lossy precision reduction (`highp` to `mediump`): the harness can now
  judge it, and the corpus says most shaders would not survive it.** It is
  the only proposal here with a real runtime payoff, since `mediump` is fp16
  on mobile hardware, and the pixel test could not see it: SwiftShader runs
  `mediump` as fp32. `test/half.ts` now rewrites a shader so every float
  intermediate is rounded to half precision (arithmetic results, builtin
  calls, constructors, literals, reads of float uniforms and varyings;
  `packHalf2x16` in ES 3.00, arithmetic in ES 1.00, the two checked against
  a binary16 reference), and `npm run half` renders every fragment shader as
  written and under the emulation:

  | corpus | fragment shaders | within rounding | visibly different | skipped |
  |---|--:|--:|--:|--:|
  | tom.to | 3 | 3 | 0 | 0 |
  | gl-transitions | 125 | 71 | 54 | 0 |
  | three.js | 28 | 13 | 15 | 0 |
  | Babylon.js | 9 | 7 | 2 | 0 |
  | PlayCanvas | 10 | 5 | 0 | 5 |

  99 of the 170 that ran come out within the pixel test's rounding
  allowance. Of the 71 that do not, 28 are badly off (a tenth to all of
  their pixels moved by more than 8 levels: noise and hash functions,
  `fract` of large products, mosaics) and 43 move a handful of pixels. The
  five skipped are PlayCanvas's parameter-macro shaders, which the parser
  takes only with `--expand-macros`.

  What follows for the rewrite: a blanket `highp` to `mediump` is wrong for
  four shaders in ten, so it cannot be a level; it could only be a per-shader
  opt-in that this harness validates, and the harness is the deliverable.
  Two caveats on the oracle. It rounds what the source types as float, while
  hardware keeps `gl_FragCoord` and texture coordinates in fp32 and may keep
  intermediates wider inside an expression, so a failure here is real and a
  pass is strong evidence rather than proof; and it says nothing about
  speed, which needs a device with native fp16 and a frame timer. Struct
  fields and array elements are read unrounded, and a loop variable stays
  fp32 because ES 1.00 wants constant loop bounds.

- **Shortest float32 digits for every literal: done, and small.** From
  `-O1` every float literal is printed with the fewest digits that read back
  to the same float32, as ANGLE does (`PORTING.md` item 39); `-O0` and
  `--decimal-folds` keep the digits as written. Lossless, since GLSL `float`
  is 32-bit everywhere. Measured with `npm run metrics`, the plugin's output
  before and after:

  | corpus | raw before | raw after | per shader brotli before | after |
  |---|--:|--:|--:|--:|
  | tom.to | 2,378 | 2,377 | 1,591 | 1,590 |
  | gl-transitions | 67,955 | 67,711 | 35,880 | 35,790 |
  | three.js | 131,622 | 131,100 | 43,355 | 43,228 |
  | Babylon.js | 57,789 | 57,715 | 16,070 | 16,049 |
  | PlayCanvas | 48,662 | 48,662 | 17,957 | 17,957 |
  | CesiumJS | 70,639 | 70,571 | 23,005 | 22,965 |
  | Shadertoy (Shader Minifier tests) | 44,221 | 44,203 | 17,050 | 17,045 |

  0.1% to 0.4% raw, 0.03% to 0.3% compressed, every corpus smaller or equal.
  It is unique text this removes, so unlike the repeated-text items below
  the compressor had not already taken it, but a long literal is rare:
  `InvertedPageCurl` gains 1.9%, most shaders a few bytes. The
  ShadowMaterial gap to spglsl named here before is elsewhere (the next
  item). Found on the way: a literal below 5e-17 printed as `0.`, in
  upstream too, which turns an epsilon guard into a real zero; fixed, and
  recorded as `tests/DEVIATIONS.md` item 6.
- **Name reuse against externals: measured, and it did not pay; changed.**
  The renamer let a local take the name of any variable in scope the
  function did not use, kept externals included, so a shadow helper in
  three.js's ShadowMaterial.frag had a parameter called `spotShadowMap` and
  Babylon's materials dozens of locals named after their uniforms
  (`PORTING.md` item 40). The bet was that the compressor already had the
  string. Per shader, plugin output before and after offering only one- and
  two-letter names for reuse:

  | corpus | raw before | raw after | per shader brotli before | after |
  |---|--:|--:|--:|--:|
  | tom.to | 2,377 | 2,377 | 1,590 | 1,593 |
  | gl-transitions | 67,711 | 67,711 | 35,790 | 35,790 |
  | three.js | 131,100 | 129,932 | 43,228 | 43,101 |
  | Babylon.js | 57,715 | 47,117 | 16,049 | 15,529 |
  | PlayCanvas | 48,662 | 48,662 | 17,957 | 17,957 |
  | CesiumJS | 70,571 | 69,143 | 22,965 | 22,860 |

  Babylon.js loses 18% raw and 3.2% compressed, its largest material 27%
  raw; 34 of 257 shaders change, and the five that grow do so by 3 to 10
  bytes from a different draw of short names. It was most of the gap to
  spglsl on Babylon, where the port's lead goes from 3.7% to 21.4% raw and
  from 7.9% to 10.8% per shader compressed, and the whole of the
  ShadowMaterial one named here before. The rule that decided it is the one
  section 6 states: unique text, which a long name in a new place is, is
  what compression does not remove.
- **Unused uniform blocks: done.** `--remove-unused-uniforms` now removes a
  block from every stage that reads nothing of it (`PORTING.md` item 41).
  The two-stage rule plain uniforms use (unread by every shader of the run)
  would have removed nothing: every unread block in the corpora is read by
  the other stage of its program. Removing it from the stage that does not
  read it leaves the program's interface untouched, since the application
  finds the block by name in the linked program, and Babylon.js checks the
  lookup in any case. Measured over the engine pairs, the whole flag before
  and after, with `--remove-unused-varyings` on in both:

  | corpus | pairs | raw | each file alone | each pair alone |
  |---|--:|--:|--:|--:|
  | Babylon.js | 9 | -9,216 (19.6%) | -2,385 (15.4%) | -22 |
  | PlayCanvas | 10 | -2,179 (4.5%) | -635 (3.5%) | -267 |
  | three.js | 28 | -20,520 (3.1%) | -4,722 (2.8%) | -4,782 |

  Babylon's number is its `Material` block, declared whole in both stages
  and read in the fragment shader only. The unit matters again: a pair
  compressed together already had the vertex copy for free against the
  fragment one, so there the gain is 22 bytes; shipped as two strings it is
  15%. The Vite plugin cannot use this, since it sees one file at a time.

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

## 8. Flag surface: done

Adding one flag touched six places: the `Options` field, the defaults, the
usage table, the argv switch, the plugin's option type and the plugin's
defaults. It now touches two: the `Options` field with its default, and one
row of the flag table in `src/options.ts`, which drives the help text, the
parser, the `--no-` form and what a `#pragma shader_minifier` may set; the
plugin maps every setting by the option's own name. What the section asked
for, and what became of each:

- **`-O0` to `-O3`: done** (`PORTING.md` item 34). `-O0` upstream's
  rewrites only, `-O1` the additions that change neither meaning nor
  interface, `-O2` the plugin's rewrites, `-O3` also the removals an
  application must be ready for. Flags after a level override it, a level
  after a flag resets its group, and `--no-<flag>` exists for what a level
  turns on. The target flags stay outside: the plugin is `-O2 --webgl
  --preserve-externals --no-overloading`. `-O3` is where a `mediump`
  reduction would go once it exists (section 7).
- **Split `--approximate-folds`: done.** It carried two unrelated things:
  evaluating builtin calls on literals (a size optimization) and doing the
  operator folds at float32 precision instead of upstream's decimal
  arithmetic (a correctness property). The second is now the default for
  `+`, `-` and `*`, where the spec leaves the GPU one answer;
  `--decimal-folds` restores upstream's arithmetic and the golden runner
  passes it, so the 14 goldens it would change stay byte-identical. Division
  has 2.5 ulp of latitude and stays with the builtins behind
  `--approximate-folds` (`PORTING.md` item 33).
- **Per-shader flags: done** (`PORTING.md` item 35). A shader's own
  `#pragma shader_minifier <flags>` line, and the plugin's `overrides` by
  file pattern, choose the rewrites for one file; the fp16 measurement in
  section 7 is why it matters, since a `mediump` reduction can only ever be
  opted into per shader.
- **Level, not boolean, for inlining and for unused removal: done, with
  one correction** (`PORTING.md` item 36). `--remove-unused
  none|functions|declarations` replaces the two booleans that could
  contradict each other, and `--inlining none|default|aggressive` replaces
  upstream's pair. `--inline-single-use` was described here as a middle rung
  between default and aggressive inlining; it is not. The plugin wants it
  without aggressive inlining, the goldens want aggressive inlining without
  it, and the flag test wants both, so the two are independent axes and it
  stays a switch. Its help text now names both rewrites it carries.
- **`--no-pi-substitution` stays, and needs no refinement.** The idea was to
  fire only when the literal's float32 value equals float32 pi, making the
  substitution exact so the flag could go. Two things killed it. Every
  literal upstream's eight-decimal rule matches already rounds to float32 pi,
  so the refinement would only make substitution fire *more* often, changing
  goldens; and the whole substitution is worth about 50 compressed bytes
  across every corpus (section 6), which does not pay for the `mediump` risk
  it carries.
