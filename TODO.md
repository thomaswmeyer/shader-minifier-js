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

- Vertex and fragment pairs (section 3).
- Babylon.js (Apache-2.0) and PlayCanvas (MIT) programs, dumped the way the
  three.js ones are; they add uniform blocks and different macro styles.
- A shader whose defines are injected at runtime, once section 1 lands.
- A multi-file run in the pixel test (`tests/real/mouton` is one).
- More seeds where a shader's branches depend on textures rather than
  uniforms, and a larger canvas for shaders with fine detail.
- A CI job with Chromium so the browser tests gate instead of skipping.
- The upstream candidates of `PORTING.md`, filed upstream with their
  reproducing shaders.

## 6. Size, from `npm run metrics`

- **three.js: now 12.5% below ANGLE**, after `--remove-unused-declarations`
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
