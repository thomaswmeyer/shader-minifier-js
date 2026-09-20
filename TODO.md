# TODO

What is known to be missing or limited, with the plan for each. `PORTING.md`
section 5.2 records what has been changed and why; this file is what has not.

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
- **`#include`.** Not supported; engines resolve it before the shader reaches
  the minifier, so the plugin could too, from the importing file's directory.
- **`precision` inside a function body.** A parse error today; GLSL allows it.
- **Struct types from another file.** In a multi-file run each file is
  analysed alone, so a struct declared in one file is unknown in the next.
  Sharing declarations across files in `Minifier` would fix `--webgl` and the
  swizzle-like field handling for that case.
- **A callee pulled ahead of an `#ifdef` region** now follows every global
  declaration (`reorderFunctions`), which is safe unless the global's own
  initializer depends on a macro defined inside the region.
- **HLSL** is kept as upstream has it and is not exercised by any semantic
  test.

## 3. Vertex and fragment pairs in the pixel test

Vertex shaders run alone under transform feedback and fragment shaders get
generated inputs, so a bug that shows only when both halves share real
geometry is not caught. The plan for three.js, which is the corpus that has
real pairs:

- Reuse `scripts/dump-three-shaders.page.js`'s scenes in the harness page.
- Render each scene twice: once as is, once with `material.onBeforeCompile`
  replacing `shader.vertexShader` and `shader.fragmentShader` by the minified
  sources. The uniform names and the struct field names survive minification
  under `--preserve-externals`, so three.js's own uniform upload keeps
  working.
- Compare the two canvases with the same noise allowance as the pixel test.

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

- Vertex and fragment pairs (section 3). Each three.js pair is now *linked*
  after minification (`test/corpus.test.ts`), which is the cheap half; what
  is still missing is rendering the pair and comparing the result.
- Babylon.js (Apache-2.0) and PlayCanvas (MIT) programs, dumped the way the
  three.js ones are; they add uniform blocks and different macro styles.
- A shader whose defines are injected at runtime, once section 1 lands.
- A multi-file run in the pixel test (`tests/real/mouton` is one).
- More seeds where a shader's branches depend on textures rather than
  uniforms, and a larger canvas for shaders with fine detail.
- A CI job with Chromium so the browser tests gate instead of skipping.
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

## 6b. Two `--preprocess` gaps

Both make a condition undecidable that the file actually decides, so the
chunk machinery stays in the output:

- **A comment after a define's value.** `#define N 1 // count` then `#if N`:
  the value is read with `/^\s*(\d+)[uU]?\s*$/`, which a trailing `//`
  comment fails, so `N` has no integer value and the whole conditional is
  kept. Engine shaders comment their defines. Strip a trailing comment when
  reading the value.
- **Hex literals.** `#define N 0x10` is not read as 16, for the same reason.

## 7. Optimizations not done yet

- **Unused varyings.** The one removal below with a plausible runtime effect.
  A varying an engine's vertex shader writes but the
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
- **Redundant precision qualifiers.** `highp` on a declaration where the
  default precision for that type is already `highp`. ANGLE drops these;
  `dropDefaultPrecision` only handles the `precision` statements themselves.

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
