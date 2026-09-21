# Porting notes

How this port relates to upstream Shader Minifier (Ctrl-Alt-Test, F#, Apache
2.0), what was changed on purpose, and where a naive port would silently
diverge. Upstream: `~/projects/shader-minifier` @ `tests/UPSTREAM`
(9653515, 2026-05-06), version 1.5.1.

Terms: **upstream** is Shader Minifier, the F# original (.NET). **The port**
is shader-minifier-js, this repository. **The plugin** is shader-minifier-js
run with the Vite plugin's default flags, the configuration the size
measurements use; **upstream's rewrites** is shader-minifier-js limited to
the rewrites Shader Minifier itself performs, which reproduces its output.

## 1. What is ported

Upstream is 4,182 lines of F# in 12 modules. Pipeline per file:

```
preprocess (opt, --preprocess)
  -> parse (own AST; forward decls dropped + flag reorderFunctions)
  -> reorderFunctions (topological, only if forward decls were seen)
  -> simplify:
       processPragmas (#pragma function inline|noinline)
       iterateSimplifyAndInline pass FIRST  (fixpoint on Printer.print, max 20)
       iterateSimplifyAndInline pass SECOND (adds var-reuse)
       cleanup (strip inlined decls/functions, squeeze + reorder TL decls)
  -> rename (unless --no-renaming; done across all files at once)
  -> format (text | indented | c-variables | c-array | js | nasm | rust | json)
```

Each iterate step: removeUnusedFunctions -> drop anonymous struct TypeDecls ->
Analyzer.resolve -> Analyzer.markWrites -> mark inlinable functions/variables ->
mapTopLevel(simplifyExpr, simplifyStmt) -> drop inlined functions ->
ArgumentInlining.apply -> repeat while printed output changed.

Renamer: (1) rename every identifier to a unique 4-digit id, (2) build the
name list from letter frequency of the printed text, (3) rename again using a
bigram context table with shadowing-based name reuse; multi-file mode keeps
externals consistent across files.

### Module map (1:1 with upstream)

| upstream          | port                        | notes |
|-------------------|-----------------------------|-------|
| ast.fs            | src/ast.ts                  | types, `Ident` class, `VarDecl`/`FunDecl`, `MapEnv` visitor |
| builtin.fs        | src/builtin.ts              | keyword/type/function sets, swizzles |
| options.fs        | src/options.ts, src/cli.ts  | hand-written arg parser replacing Argu; flags match upstream exactly |
| preprocessor.fs   | src/preprocessor.ts         | line-based; evaluates `#if 0/1`, `#ifdef` of known defines; plus `--expand-macros` |
| parse.fs          | src/parser.ts               | recursive descent + precedence climbing replacing FParsec |
| printer.fs        | src/printer.ts              | precedence-based paren insertion, `\0`/`\t` indent encoding, kkp `.sym` writer |
| formatter.fs      | src/formatter.ts            | the 8 output formats |
| analyzer.fs       | src/analyzer.ts             | VarVisitor, Effects, resolve, markWrites, findFuncInfos |
| inlining.fs       | src/inlining.ts             | variable / function / argument inlining marks |
| rewriter.fs       | src/rewriter.ts             | simplifyOperator, simplifyVec, simplifyBlock, var reuse, unused-assignment removal, cleanup; plus `--webgl` guards |
| renamer.fs        | src/renamer.ts              | Env, RenamerVisitor, context-table naming, shadowing |
| api.fs, main.fs   | src/api.ts, src/index.ts    | `Minifier` class, `minify()`, library entry |
| Checker/main.fs   | test/golden.ts              | commands.txt runner |
| —                 | src/fold-builtins.ts        | `--approximate-folds` |
| —                 | src/vite.ts                 | Vite plugin |

## 2. Own parser, not @shaderfrog/glsl-parser

- Every pass pattern-matches on Shader Minifier's AST: operators are
  `FunCall(Op "+", [a; b])`, parentheses are not stored, `i++` is `Op "$++"`,
  declarations are `(Type, DeclElt list)`. The peggy AST is a different shape
  with whitespace, parens and literal tokens preserved. Adapting means
  rewriting every pass, not porting it, and the golden files would stop being
  an oracle.
- Shader Minifier's parser is deliberately lax: unknown text in `//[ ... //]`
  verbatim blocks, `#define`/`#if` directives as statements, `layout(...)`
  kept as an opaque string. glsl-parser is a strict GLSL ES 1.00/3.00 grammar
  and rejects several desktop GLSL inputs in `tests/real`.

glsl-parser is used as an independent re-parse oracle in `test/reparse.test.ts`
(every minified GLSL output must parse). Dev dependency only.

## 3. Tests: the upstream corpus is the oracle

Vendored into `tests/` (Apache 2.0, with upstream's LICENSE and a
`tests/UPSTREAM` file holding the commit hash; `scripts/sync-tests.sh`
re-copies and re-applies `tests/DEVIATIONS.md`).

1. **Golden tests** (`test/golden.test.ts`). `tests/commands.txt` has 88
   commands. The runner ports `Checker/main.fs`: same quote-aware
   `splitArgs`, run in-process with the arg array, read the `-o` target as
   expected, normalise both with `cleanString` (CRLF -> LF, trim, strip
   `\bShader Minifier \d(\.\d+)+`). The banner therefore reads
   `Shader Minifier <numeric version>`. Also writes
   `tests/out/<dir>/<name>.minind.<ext>` like upstream. `--update-golden`
   regenerates.
2. **Round-trip idempotence** (`test/roundtrip.test.ts`): for every
   `tests/unit/*` and `tests/real/*` source, `print(parse(src))` parses again
   and prints identically.
3. **Re-parse validity** (`test/reparse.test.ts`), the port's equivalent of
   upstream's glslang check (`tests/compile.txt`): every minified output
   re-parses with our parser and is accepted by @shaderfrog/glsl-parser.
   `npm run webgl-page` additionally compiles every corpus shader in Chrome.
4. **spglsl corpus** (`test/spglsl-corpus.test.ts`, `../spglsl/project/test/shaders`
   or `$SPGLSL_SHADERS`; skipped when absent): the WebGL 1/2 subset minifies,
   re-parses, and a size table is written against spglsl's `#expected-size`
   annotations.
5. **Unit tests** for the primitives in section 5: float formatting, constant
   folding, name-list ordering, precedence/parens, macro expansion, the Vite
   plugin in a real build.

Excluded: Crinkler compression tests (Windows DLL), the performance test.

## 4. Language and tooling

- TypeScript, ESM, Node >= 20, strict mode. No runtime dependency. Dev:
  vitest, tsx, tsc, @shaderfrog/glsl-parser, vite.
- `bin/shader-minifier` takes upstream's exact flags, so `commands.txt` runs
  verbatim.
- Library API: `minify(files, options)` and the `Minifier` class.
- `src/vite.ts`: a Vite plugin with its own options mirroring the CLI flags
  (not a drop-in for spglsl). Defaults to
  `--webgl --preserve-externals --no-overloading --no-pi-substitution
  --expand-macros --approximate-folds`.

## 5. Porting pitfalls

Principle: replicate .NET/F# behaviour only where a golden test observes it.
Everywhere else use plain JavaScript semantics. Floats are JS doubles with a
shortest-round-trip printer. Sorted iteration is used in the renamer because
it fixes the expected identifier names; other maps stay insertion-ordered.
HLSL support is removed (section 5.2, item 26); WebGL is the focus.

### 5.1 Equality semantics
F# uses structural equality on records/unions and reference identity where it
says so. Every site is ported deliberately:
- `ty1 = ty2` (Type, incl. Ident by `Name`) in squeezeDeclarations,
  groupDeclarations (`Dictionary<Type,_>` key), reuseExistingVarDecl,
  declsCanBeSqueezed -> `typeEquals`.
- `declElt1.sizes = declElt2.sizes`, `semantics` -> `exprListEquals`.
- `Set.contains t unused` on TopLevel, `inl.func = func` -> object identity
  (nodes are the same instances, so it is equivalent).
- `List.contains d.name` on Ident -> compare `.name`.
- `LanguagePrimitives.PhysicalEquality` -> `===`.
- `Printer.exprToS e1 = Printer.exprToS e2` -> string compare.

### 5.2 Numbers
- `Float`: JS double. Upstream's `floatToS` converts decimal -> double before
  formatting, so a shortest-round-trip printer (fixed form vs exponent form,
  pick the shorter, fixed wins ties, fixed limited to 16 fraction digits)
  reproduces all 41 + 30 literals in `decimals.frag` and `float.frag`.
  Under `--decimal-folds`, upstream's arithmetic, constant folds are rounded
  to 15 significant digits so `1.1+2.2` prints `3.3`; an exact .NET-decimal
  emulation passes the same goldens and only differs on 16-digit results
  (e.g. `2.*3.141592653589793`), where both round to the same float32. The
  default rounds at float32 instead (item 33).
- `Int`: JS number with `Number.isSafeInteger` guard on folds (skip the fold
  when unsafe). `/` truncates toward zero, `%` follows the dividend.
  `useInts` int32 range check -> keep float.
- Nonzero floats below ~5e-17: the fixed form's 16 fraction digits are all
  zero there, and upstream lets `0.` win the length contest (the five
  `x(0.);` lines of `decimals.frag.expected`). The port takes the exponent
  form instead (item 39).
- Number lexing: regex `(\d+\.?\d*|\.\d+)([eE][-+]?[0-9]+)?`, then int parse
  first, else float; octal `0[0-7]+`, hex `0[xX]`; suffixes f F LF lf u U l
  L h H.

**Deliberate deviations from upstream:**

1. *Literal range.* Upstream cannot parse float literals above ~7.9e28 (.NET
   decimal overflow; `3e38`, `1e37`, `1e308` are commented out in
   `decimals.frag`). The port accepts the full double range; the golden edit
   is recorded in `tests/DEVIATIONS.md`.
2. *Forbidden names across files.* Upstream builds the renamer's forbidden
   list (macro names, struct names, `if`/`in`/`do`) from the first shader
   only (`renamer.fs`, "TODO: combine from all shaders"). The port takes the
   union over all input files. Invisible to the multi-file goldens.
3. *Pi substitution flag.* Upstream replaces float literals that round to
   pi, tau or pi/2 at 8 decimals with `acos(-1.)`, `2.*acos(-1.)`,
   `acos(0.)`. Under mediump on mobile GPUs this can cost precision.
   `--no-pi-substitution` disables it. Default stays on to match the goldens
   (`pi.frag`, `decimals.frag`); the Vite plugin turns it off. That costs the
   plugin about 50 compressed bytes over all five corpora, measured, and is
   the whole of the 58 bytes by which `InvertedPageCurl` comes out larger
   than upstream's rewrites (`TODO.md` section 6).
4. *Prefix sign spacing.* Upstream only guards binary `+`/`-` against
   merging into `++`/`--` (`printer.fs:142`), so `-(--a)` prints as `---a`,
   which is invalid. The port applies the same guard to prefix `+`/`-`
   (`- --a`). `-(-a)` itself is always folded by the simplifier, so no
   golden observes the difference.
5. *`--webgl`.* Two upstream rewrites produce code ANGLE rejects (verified in
   Chrome, WebGL 1 and 2): `if(c)return a;return b;` -> `return c?a:b;`
   when the type is a struct (`ed-209`), and folding a void call into a comma
   sequence (`endeavour`, ES 3.00 rule). `--webgl` skips both, using the
   declarations of the file to tell struct-typed and void-returning
   expressions apart (unknown counts as unsafe; a call to an overloaded user
   function, which the analyzer leaves unresolved, is typed when every
   overload returns the same type, and void when any does), and fails if the
   output would still contain either. The check is best effort: an operand
   of unknown type passes, since the guards never produce the constructs and
   a miss only moves the error to the browser's compiler. "Struct" means a
   struct the file declares, not merely a type name that is not a builtin:
   Cesium's FXAA pass writes `directionN ? goodSpanN : goodSpanP` over
   `#define FxaaBool bool`, which the looser reading refused. The sequence rule is applied regardless of
   `#version`, because the header is usually prepended at runtime. Default
   off so the goldens stay byte-identical.
6. *`--expand-macros`.* Upstream keeps `#define` verbatim (they are demoscene
   feature switches) and even forbids renaming macro names; spglsl runs
   ANGLE's preprocessor first. On spglsl's `island-not-found` that is the
   whole size gap: 14094 B vs spglsl's 12080 with macros kept, 11607 with
   them expanded. The flag expands object- and function-like macros in file
   order, leaving alone macros defined inside `#if` blocks, macros named in
   conditions, `#`/`##` bodies, and macros whose expansion would grow the
   output; kept macros transitively keep what they reference. Runs of code
   lines between directives are expanded as one text, so a call's arguments
   may span lines (the newlines come back after the expansion). Default off.
7. *`--approximate-folds`.* Upstream folds operators on literals but not builtin
   calls (`radians(45.)`, `sqrt(2.)`, `normalize(vec2(3.,4.))`); ANGLE's
   `FoldExpressions` does, at float32. The flag evaluates pure builtins whose
   arguments are all literals (component-wise on literal vector constructors,
   plus `length`/`dot`/`distance`/`normalize`/`cross`) at float32 precision,
   printing the shortest float32 round-trip digits, and only when the result
   is shorter (upstream's rule for constant division, so `exp(1.)` stays).
   Inputs GLSL leaves undefined or implementation-defined (`round` at a
   half, `pow` of zero or a negative base, `atan(0.,0.)`) are not folded.
   Under the flag, operators on two literals fold the way the GPU's compiler
   would: float32 operands and one float32 rounding per operation (a double
   holds the exact result of one operation on two float32s), printed with
   the shortest float32 digits and only when the literal is not longer than
   the expression, so `1./tan(.5*radians(45.))` collapses to one literal
   and `.1*.05` stays (its faithful value `.0050000004` is longer). Folding
   in double and rounding once, as upstream does, lands one ulp off the
   GPU's fold for a third of short literal pairs, which is enough to flip
   pixels at a raymarcher's hit threshold (`test/pixels.test.ts`). Known
   interaction: a folded literal can make upstream's inliner copy a long
   literal into several uses (`moutard.frag` grows 7 bytes); net over the
   corpus is -250 bytes. Default off.
8. *`--drop-default-precision`.* GLSL ES stage defaults (ES 3.00 §4.5.4):
   vertex `highp float`/`highp int`, fragment `mediump int` and no float
   default, samplers `lowp` in both. A statement restating the default is a
   no-op; ANGLE drops it, upstream keeps it. The pass runs after cleanup and
   keeps a statement that follows an earlier one for the same type, since
   that one restores the default. The stage is `--stage`, else the file
   extension (`api.ts` passes it to `simplify`), else what the code proves:
   a builtin only one stage has (`gl_Position`, `gl_VertexID`, ...;
   `gl_FragCoord`, `gl_FragColor`, ...) or `discard`. Absence of
   `gl_Position` is not evidence (transform-feedback vertex shaders), so a
   shader that proves neither, or both, only loses the sampler statements,
   which are the default in both stages. Default off.
9. *`--inline-single-use`.* Two cases upstream handles only under
   `--aggressive-inlining`: a never-written global with a pure const init
   referenced exactly once outside loops is inlined into that use; and a
   parameter always passed the same never-written global gets the global
   substituted into the body instead of a `float t=uT;` local, when
   `uses × name length` is no more than the declaration plus one letter per
   use and the body never writes the parameter (a uniform is not an l-value).
   The substitution can leave a single-expression function, which then
   inlines in turn. Both rules apply the function inliner's rule [A]: a
   global is not inlined where a local or parameter at the use has the name
   of something its init reads, and a global is not substituted into a body
   that binds its name to another parameter or a local at a use of the
   parameter (the parameter itself may carry the name: dropping it uncovers
   the global). A global is computed once per invocation; inlined into a
   helper that a loop calls it would be computed on every call, so a value
   that calls a function (constructors aside) is only inlined into an entry
   point (`main`, or anything in `--no-renaming-list`). Default off.
10. *Scope check.* Uses are resolved to declarations by name on every pass,
    so a rewrite that copies an expression into a scope where one of its
    names is shadowed (a capture) is rebound and hidden by the next
    `resolve`. `Analyzer.checkScopes` runs after each pass of
    `iterateSimplifyAndInline`, before that resolve, and throws if a use's
    declaration is not the one its name finds in scope. Var reuse
    (`reuseExistingVarDecl`) updates the declaration of the uses it renames
    so the check holds. Upstream has no such check; running it over the
    corpus found nothing, and it found one capture in upstream's argument
    inlining: with `float flow(float t,float uT)` always called as
    `flow(uT,...)`, the local `float t=uT;` it declares at the top of the
    body reads the parameter `uT`, not the global. `findInlinings` now skips
    an argument whose expression names another parameter of the function.

11. *Pinned names.* A `#define` that stays in the output is text the
    minifier cannot see into. Upstream forbids only the macro's *name* as a
    generated identifier, so `#define DMIN(id) if(d<dMin){dMin=d;idObj=id;}`
    survives while the locals `d` and `dMin` are renamed, merged into other
    locals or their assignments removed as unused (`controllable-machinery`
    under renaming). The parser records the identifiers in every macro body
    (`Shader.pinnedNames`, and `pinnedFields` for the names after a dot);
    every declaration of such a name gets both `Ident.keepName` and
    `Ident.hiddenUses`: never renamed (variables, functions, structs,
    fields), never inlined or removed, never a var-reuse or
    unused-assignment candidate, never substituted by `--inline-single-use`;
    those names join the forbidden list. The two flags are separate because
    the other things that must keep a name (an external struct's fields and
    type name, a swizzle-like field) have no invisible use and stay free to
    be removed when nothing reads them. The golden of `controllable-machinery.frag` keeps a
    `vec3 d` that upstream merges into the parameter (`tests/DEVIATIONS.md`).
12. *Function reordering and conditional regions.* When a forward
    declaration triggers `reorderFunctions`, upstream moves every function
    after all other items, which pulls alternative definitions out of
    `#ifdef ... #else ... #endif` blocks and defines a function twice
    (`frozen-wasteland` with a prototype). The port keeps such a top-level
    region in place, preceded by the functions outside any region that it
    calls, and sorts the rest as upstream does; without regions the layout
    is upstream's.
13. *Preserved names reserved.* Under `--preserve-externals` (and
    `--preserve-all-globals`) upstream marks a kept name as used only when
    the renamer reaches its declaration, so `const float f=...;` may take
    `o` before `out vec4 o;` is seen (redefinition). The port keeps every
    preserved global's name out of the generated list from the start.

14. *`--move-declarations` and earlier uses.* Upstream merges a local
    declaration into the block's first declaration of that type unless its
    initializer names the variable itself (#458). A use of the same name
    earlier in the block, referring to an outer variable, is another case:
    `vec2 t` global, then `... t.xy ...; float t=0.;` in `main` (`ohanami`)
    had `t.xy` rebound to the hoisted local. The port also keeps such a
    declaration in place. Found by the scope check under the port-flag
    corpus sweep with `--aggressive-inlining --move-declarations`.

15. *Captured local inlining.* Upstream's rule [A] (never inline a function
    body where a global it reads is shadowed at the call site) has no
    counterpart for variables: `float b=t.x; float t=0.; t+=b;` inlined `b`
    into `t+=t.x`, where `t` is the new local. After every marking rule,
    `VariableInlining.unmarkCapturedVariables` visits each use of a
    candidate with the scope at that use and unmarks the candidate if a
    name its init reads is bound to a different declaration there. This
    covers upstream's safe and simple inlining, aggressive inlining, and
    `--inline-single-use`. Found by the scope check.

16. *`--preprocess` and constant `#if` expressions.* Upstream decides `#if 0`
    and `#if 1` only, keeping every other `#if` as text. Engine shaders put
    `#if` blocks inside argument and parameter lists (three.js:
    `getTangentFrame( -vViewPosition, normal,\n#if defined( USE_NORMALMAP )`),
    which the parser cannot represent, so under `--preprocess` the port also
    decides a constant expression of integer literals, `defined(X)` and the C
    operators (`evalConstantExpression`), and a bare identifier by its
    `#define`'s integer value (0 when not defined in the file, as `#ifdef`
    already assumes; unknown when the value is not an integer). So `#if DEF`
    with `#define DEF 1` is decided, which changes the `preprocess_if.frag`
    golden (`tests/DEVIATIONS.md`). A directive may also be indented (`\t#ifdef USE_TANGENT`, again
    three.js); upstream only recognises `#` at column 0 and lets the rest
    through as code. And upstream's status stack forgets whether a branch
    was taken: `#if 1 ... #else` activated the else branch, and an `#elif 1`
    inside an inactive block woke its text up. The port tracks the taken
    branch per block, keeps an undecidable later branch as `#if` when the
    block's own `#if` line was dropped, and emits `#endif` only for a block
    that reached the output. Upstream also records a `#define` inside an
    inactive block (`#define ENV_WORLDPOS` under a false condition decided a
    later `#ifdef ENV_WORLDPOS`); the port ignores every non-conditional
    directive there. The three.js programs in `test/corpus/three` needed
    this flag until item 31; `npm run metrics` still uses it for them, so the
    sizes compare with minifiers that see preprocessed input.

    Two further differences come from the GL compiler owning two identifier
    prefixes, `GL_` and `__`. A name in them that the file does not define is
    not absent, it is unknown to this pass: whether `GL_EXT_frag_depth` is
    defined is the device's answer. So the port predefines what the `#version`
    line settles (`__VERSION__`, `GL_ES`, and `GL_FRAGMENT_PRECISION_HIGH`
    from ESSL 3.00, where highp is required in fragment shaders) and leaves a
    condition that reads any other compiler-owned name undecided, rather than
    reading it as 0 the way C reads an undefined macro. Cesium's
    `#ifdef GL_FRAGMENT_PRECISION_HIGH` otherwise took the `#else`, dropping a
    whole shader from `highp` to `mediump`. And since a name may be undecided
    rather than malformed, `evalConstantExpression` short-circuits: `1 || X`
    is 1 and `0 && X` is 0 whatever X is, which is how Cesium guards its
    extension macros (`__VERSION__ == 300 || defined(GL_EXT_frag_depth)`).

17. *Fields of external structs.* Under `--preserve-externals` the name an
    application looks up for a struct uniform includes the field
    (`directionalLights[0].direction` in three.js), so the fields of every
    struct an external declaration uses, transitively, keep their names
    (`pinExternalStructFields`). Upstream renames them, which breaks every
    `getUniformLocation` on such a member.

18. *Argument inlining and declaration order.* An inlined argument moves
    into the function's body, so a global it reads must be declared before
    the function. Upstream does not check: three.js passes
    `uniform sampler2D envMap`, declared after `bilinearCubeUV( sampler2D
    envMap, ...)`, and since a sampler cannot be a local the parameter is
    replaced by the global, used before its declaration. Also fixed: the
    local an inlined `const in` parameter becomes no longer keeps `const`
    (its init is the argument, `const mat4 m = modelMatrix;` is an error).

19. *Tabs after a macro name.* `#define RE_Direct\t\t\tRE_Direct_Lambert`
    (three.js) printed as `#define RE_DirectRE_Direct_Lambert`: the space
    stripping only knew a space as the separator between an object-like
    macro's name and body. A tab counts too.

20. *Struct fields named like swizzles.* Upstream refuses `struct Hexagon {
    float q, r, s; }` because it cannot tell `hex.q` from `p.q`. The port
    keeps such a field under its own name (`Ident.keepName`, and forbidden
    as a generated name), and where a file declares one the rewrites that assume
    a swizzle (canonical field names, combining `v.x, v.y` into `v.xy`,
    dropping a trailing `.xy`) first check that the left side is known not
    to be a struct. A file without such fields is rewritten exactly as
    upstream does. gl-transitions' `hexagonalize` is the reproducing case.

21. *Unused declarations.* Upstream removes unused functions and, through
    inlining, some unused constant globals, and keeps everything else. Under
    `--remove-unused-declarations` (the plugin's default) the port also
    removes an unreferenced non-external global (an initializer with an
    effect keeps it), an unreferenced struct type and a `precision`
    statement for a sampler type never declared, repeating until nothing
    changes, since a struct may become unused when its only global goes and
    a function when its only caller was that global's initializer. Names in
    kept macro bodies and in verbatim text count as used. Off by default so
    the goldens stay; three.js shrinks 18% under the plugin with it.

22. *Struct type names across two stages.* GL matches a struct-typed uniform
    or varying between the vertex and the fragment shader by type name as
    well as by variable name. Under `--preserve-externals` the port keeps
    the variable's name and its fields (item 17) but used to rename the
    struct type, and since the two shaders are minified separately each half
    got a different name: eleven of the twenty-eight three.js programs
    failed to link with "Structure names of uniform 'x' differ between
    VERTEX and FRAGMENT". A struct reachable from an external declaration
    now keeps its type name too, and an interface block's members count as
    external, which they did not before (`uniform Blk { L l; };` renamed
    `L`'s fields although the application looks up `l.dir`).
    `test/corpus.test.ts` links every three.js pair.

23. *A define's value past a comment, and in hex.* `--preprocess` read a
    macro's integer value with a pattern that allowed only decimal digits
    and trailing space, so `#define N 1 // count` (how engine shaders write
    them) and `#define N 0x10` both left `#if N` undecided and kept the
    whole conditional. A trailing line or block comment is not part of the
    value, and hex is read in a define and in the condition itself.

24. *A redundant precision qualifier on a declaration.*
    `--drop-default-precision` dropped a `precision T t;` statement that
    restated the stage default; it now also drops a qualifier on a
    declaration that restates the precision in force at that point
    (`mediump vec3 c;` after `precision mediump float;`), as ANGLE does. A
    vector or matrix follows `float` and an integer vector follows `int`;
    `uint`, `bool` and structs are left alone. A fragment shader has no
    default float precision, so a qualifier before the file states one is
    never dropped. Worth 42 bytes on the three.js corpus and nothing after
    compression (`TODO.md` section 7).

25. *HLSL support removed.* Upstream minifies HLSL as well as GLSL, behind
    `--hlsl`. Nothing on the web consumes it: WebGL takes GLSL ES and WebGPU
    takes WGSL, so the mode was unreachable from the Vite plugin except
    through the raw options escape hatch, and no semantic test covered it.
    It was also actively wrong by then: with no `uniform` keyword in HLSL
    every global looks internal to `typeIsExternal`, so
    `--remove-unused-declarations` deleted constant-buffer globals the
    application sets.

    Removed: the flag and option; the HLSL type grammar (storage
    qualifiers, generics); semantics (`: SV_TARGET`) on declarations and
    functions, and so `funIsExternal`, which only semantics could make
    true, and the `HlslFunction` export prefix; struct methods, struct
    inheritance and templates; `[attribute]` blocks; C-style casts and
    `{1,2,3}` vector expressions, neither of which is GLSL; the optional
    semicolons after a struct or block; and the HLSL scoping rule that kept
    a `for` initializer alive after its loop. Eight golden commands and
    their fixtures went with it, leaving 88.

    This is the port's one deliberate *subtraction* from upstream, so a
    future sync has to skip these paths rather than merge them. The
    remaining tests all pass unchanged, which is the evidence that nothing
    removed was reachable from GLSL.

26. *Varyings across the two stages.* Upstream minifies one file at a time
    and never compares the stages. Under `--remove-unused-varyings` the port
    removes a vertex output no fragment shader of the same run declares, with
    the assignments that fed it, and a fragment input the fragment never
    reads. It acts only when both stages are present, which also excludes a
    transform-feedback vertex shader. Two things keep a varying: a value with
    an effect, and a read by the vertex shader itself, which three.js does
    (it writes `vDisplacementMapUv` and then samples the displacement map
    with it). Worth 124 bytes over the 28 three.js programs and 3 of their
    interpolator slots, small because the engine already emits close to the
    varyings it needs. `test/corpus.test.ts` renders every pair with the flag
    on and compares it against the unminified pair.

27. *Interface blocks with an instance name.* `uniform Light0 { vec4 d; }
    light0;` was a parse error: the port only knew the form without an
    instance name, which declares its members as globals. Babylon.js emits
    one block per light, so its whole corpus was refused. Such a block is
    now a declaration whose type is written out, the renamer renames the
    instance like any other global, and the members keep their names because
    the application looks them up as `Light0.d`. Renaming them was also
    broken: the declaration changed but `light0.d` did not, which does not
    compile.

28. *Variable reuse renamed a chain out from under its uses.* An `Ident` is
    shared by every location that names it, which is how the renamer works.
    Reusing a dead local for a later one built the replacement assignment
    around the *declaration's own* `Ident`, so a use position and a
    declaration shared one object; a second reuse of the same variable then
    renamed the declaration while the statements reading it kept the old
    name. Babylon's `hemisphereImportanceSampleDggxAnisotropic` came out
    naming `alpha2`, which it never declares. The assignment now gets a copy
    of the name, and `Analyzer.checkScopes` gained a rule for finished code:
    every use must have a declaration in scope.

29. *Unused uniforms.* `--remove-unused-uniforms` removes a plain
    `uniform T name;` that no shader of the run reads, from every shader
    that declares it. Upstream keeps every uniform, since it minifies one
    file at a time and cannot know. Gated on both stages being present, for
    the same reason as the varyings. A uniform block's members are looked up
    through the block, so a member is never removed on its own; item 41 has
    the block as a whole. Off by default, because an application may treat
    the null location it then gets as an error.

30. *A global initialized by a call.* Desktop GLSL allows `float g = f();`.
    Upstream counts calls only in function bodies, so it removes `f` as
    unused, and its declaration squeezing moves `g` above `f`. The port
    counts calls in global initializers and array sizes for both. No golden
    has such a global.

31. *Conditionals inside expressions and around list items.* Upstream knows
    a directive as a statement or a top-level item only. The port parses a
    `#if`/`#elif`/`#else` chain wherever a primary expression stands
    (`Expr.kind = "Conditional"`, every branch kept, uses and effects the
    union over branches), and keeps a chain around list items as opaque
    text, like a kept `#define` body: a group of struct members
    (`StructMember.kind = "MemberVerbatim"`), a function whose parameter list
    holds a directive, and a region whose branches each open a function
    header over one body (both a `TLVerbatim` of the whole function, whose
    body is still parsed to find its end). What the text names is pinned so
    the top-level declarations and fields it refers to keep their names and
    stay; a local of another function with the same name is not, since the
    text cannot reach it. When forward declarations make the port reorder
    functions, such a function is placed after every function its text names
    and before every caller of a name only it can define. This is what lets
    the Vite plugin take three.js's shaders with their defines injected at
    runtime; `TODO.md` section 1 has the count and the cost. No golden has
    such a directive.

32. *A name declared in both branches of a `#if`.* A block with conditional
    directives may declare one name twice, in alternatives the compiler
    picks one of (three.js: `#ifdef FOG_EXP2\n float fogFactor = ...;\n#else\n
    float fogFactor = ...;\n#endif`), or declare a local of a global's name
    in one branch (`#ifdef USE_INSTANCING_MORPH\n float
    morphTargetInfluences[N];` over the uniform). Upstream reads the block
    as one flat list: every use binds to the last declaration, the others
    look unused, and each rewrite that acts on one of them is wrong under
    the other setting of the define: the first declaration removed as
    unused, the last inlined into a use both share, the two renamed apart.
    The port makes every declaration of such a name in the list one
    variable (`Analyzer.unifyAlternativeDeclarations`): later ones point at
    the first's declaration, none is inlined, a shadowed global or parameter
    counts as having hidden uses, and the renamer gives them one name
    (shadowing in the source stays shadowing). Two neighbours of the same
    bug: a global declared inside a top-level `#if` region is never
    substituted for a parameter, since the callee's body is compiled
    whatever the define (three.js passes `lightProbe`, declared under
    `USE_LIGHT_PROBES`, from a call under the same condition); and a block
    whose braces are under a conditional (ed-209 opens two loops under
    `#ifdef AA` and closes them under another) gets no names reused by
    shadowing, since without the define its declarations belong to the
    enclosing scope. Found by rendering the three.js corpus without
    `--preprocess`: 30 of 56 shaders failed to compile, all from this. Three
    goldens change, two of them because upstream's output was wrong
    (`tests/DEVIATIONS.md` item 4).

33. *Float operators fold at float32 by default.* Upstream folds `a+b`,
    `a-b`, `a*b` on float literals with decimal arithmetic and prints the
    result to 15 digits, so `4.3+3.4` becomes `7.7`. The GPU's compiler
    computes with float32 operands and one float32 rounding, which for these
    three operators is the only answer a conformant implementation may give:
    `7.7000003`, and `7.7` is one ulp off. The port now folds that way by
    default, printing the shortest float32 literal and keeping the
    expression when the literal would be longer (`4.3+3.4` stays, `.5*.5` is
    `.25`); `--decimal-folds` restores upstream's arithmetic. Division has
    2.5 ulp of latitude in the spec, so its float32 fold stays with
    `--approximate-folds`, alongside the builtin calls, and without either flag a
    constant division keeps upstream's rule. The flag was `--fold-builtins`
    until the split; it is named for the property now, the folds the spec
    lets the hardware get a few ulp wrong on, since it no longer carries the
    exact ones. The golden runner passes
    `--decimal-folds`, so the 14 goldens whose constants differ stay
    byte-identical to upstream; `test/fold-builtins.test.ts` pins the
    default.

34. *Optimisation levels.* `-O0` to `-O3` set the port's additions in
    coherent groups (`optimizationLevels` in `src/options.ts`): `-O0`
    upstream's rewrites only, `-O1` the additions that change neither
    meaning nor interface, `-O2` the Vite plugin's rewrites, `-O3` also the
    removals an application must be ready for (unused varyings and
    uniforms). A level applies where it stands among the flags, so a flag
    after it wins and a level after a flag resets its group; `--no-<flag>`
    exists for each flag a level turns on. The plugin's defaults are built
    from level 2 plus the target flags, and the corpus tests' "upstream
    rewrites" variant from level 0, so the two stay what they claim to be
    by construction. Upstream has no levels; its own switches (inlining,
    renaming, sequences, `--move-declarations`) are outside them.

35. *Per-shader flags.* Every flag of upstream's applies to the whole run.
    The port takes `#pragma shader_minifier <flags>` from a shader's own
    text (`Options.extractPragmas`, `applyPragma`): the flags are parsed by
    the command-line parser on top of the run's options, apply to that
    file's parse and rewrites, and the line is replaced by an empty one so
    line numbers hold. A pragma may set the rewrites and the target, not the
    output, the renaming (which is done once over all files) or the two
    cross-file removals, whose setting it ignores; anything else is an
    error naming the field. The Vite plugin also takes `level` and
    `overrides`, a list of settings for the files a pattern matches, merged
    in order over the plugin's own before the pragma. GLSL ignores an
    unknown `#pragma`, so a shader carrying one still compiles unminified.

36. *Settings, not switch pairs, and one flag table.* Upstream's
    `--no-inlining` and `--aggressive-inlining` are one setting,
    `inlining: none | default | aggressive` (`--inlining <level>`), and its
    `--no-remove-unused` with the port's `--remove-unused-declarations` are
    `removeUnused: none | functions | declarations` (`--remove-unused
    <level>`); the old flags set the same setting, so the last one given
    wins and upstream's `aggro && !noInlining` fixup goes. `--inline-single-use`
    stays a switch of its own rather than a rung between default and
    aggressive inlining: the plugin wants it without aggressive, the goldens
    want aggressive without it, and the flag test wants both, so the two are
    not ordered. One table in `src/options.ts` now drives the help text, the
    parser, the `--no-` forms and what a pragma may set; adding a flag is
    one row, and the plugin's mapping is the option's own name, so a new
    row reaches the plugin with no code of its own.

37. *Preprocessor branches are alternatives, in scope and in names.* Item 32
    made the declarations of one name across branches one variable. Cesium's
    shaders showed the rest of the problem: upstream reads an `#if`/`#else`
    region as a plain sequence, so the branches share one scope and are
    renamed one after the other, and `#else vec2 step = step;` resolves its
    initializer to the first branch's local rather than to the global it
    shadows. The environment the AST walk carries (`MapEnv.foldAlternatives`)
    now restarts each branch from the scope the region began in and carries
    every branch's declarations past the `#endif`; the renamer (`renRegion`)
    renames each branch from the names in scope at the region's start, gives
    every branch's copy of a name the same new name, and draws the branches'
    names from one pool. Item 32's unification keeps the first declaration
    alive and its narrow inlining guards stay: only a duplicated name and a
    global passed from inside a region into a function body are kept out of
    inlining, rather than every declaration under a `#if`, which is what
    keeps `orchard`'s second `lookat` in the output at no cost elsewhere.
    `reorderFunctions` also kept only the regions that held a function, which
    silently dropped the `#ifdef GL_FRAGMENT_PRECISION_HIGH` block that picks
    a default precision; a region without a function now stays among the
    declarations. Found by the CesiumJS corpus (`globe`, `globe-2`,
    `post-processing-2`).

38. *No reassociation of arithmetic.* Upstream drops the parentheses in
    `x+(y+z)`, `x+(y-z)`, `x-(y+z)` and `x-(y-z)` by reassociating. IEEE
    addition is not associative and GLSL evaluates in the order written, so
    `high+(low-c)` and `high+low-c` are different numbers. Cesium builds a
    double out of two floats: `czm_translateRelativeToEye` returns
    `high+(low-c)`, and the reassociated form rounds the low word away, which
    moved four of the polyline shader's vertex outputs by 4e-5 relative. The
    port keeps the *commutation* — `x+(y+z)` becomes `y+z+x`, as upstream
    already does for `x*(y*z)`, and that is exact — and declines the rest,
    which is what `x-(...)` loses. Over the whole corpus it costs about 0.1%
    of the raw bytes and nothing the compressed measurement can see. Fifteen
    goldens move; three of them, where an operand has a side effect, are
    fixes.

39. *Float literals are float32.* GLSL `float` is 32-bit on every
    implementation, so the compiler reads `6.283185307179586` and
    `6.2831855` as the same number. From `-O1` the port prints every float
    literal with the fewest digits that read back to the same float32
    (`2.399963229728653` to `2.3999631`, `123456789.` to `123456790.`), as
    ANGLE's minifier does; `-O0` and `--decimal-folds` keep the digits as
    written, as upstream does, so the goldens stay. A `lf` literal is a
    double and is left alone, as is a value outside float32's range. Worth
    0.1% to 0.4% of the raw bytes on every corpus and 0.03% to 0.3% per
    shader after brotli (`TODO.md` section 7 has the table): small, since a
    long literal is rare, but every byte of it is free.

    Next to it, a fix upstream needs too. The printer's fixed form keeps 16
    fraction digits, which below 5e-17 are all zero, and upstream lets that
    `0.` win the length contest: `1e-20` prints as `0.`, and a guard such as
    `max(x,1e-20)` or a division by it is a real zero after minification.
    Such a literal now takes the exponent form (`124e-29`, `8e-46`). The
    five `x(0.);` lines of `decimals.frag.expected` change
    (`tests/DEVIATIONS.md` item 6); the corpora never printed one, Babylon's
    `SMALLEST_ABOVE_ZERO` (`1.1754943508e-38`) being an unused macro.

40. *A kept name is not reused by shadowing.* On entering a function, the
    renamer offers every name in scope that the body does not use as a
    candidate for the function's own declarations, ahead of the fresh names,
    so that a local can shadow an outer variable and take its short name.
    Under `--preserve-externals` the kept externals are in that list too, and
    `chooseIdent` looks at the first 26 candidates only: with the single
    letters taken and only two-letter names left, a long kept name whose
    first and last letters are frequent wins on adjacency, and three.js's
    ShadowMaterial gets a parameter called `spotShadowMap`, Babylon's
    materials dozens of locals called after their uniforms. The bet was that
    the compressor already had the string; measured per shader compressed
    it does not pay. Only a name as short as a generated one (one or two
    letters) is offered for reuse now. Babylon.js: -18.4% raw, -3.2% per
    shader after brotli; CesiumJS -2.0% and -0.5%; three.js -0.9% and
    -0.3%; the others within a few bytes either way (`TODO.md` section 7 has
    the table). No golden changes: the three that keep externals never run
    out of letters. The `Shader Minifier (.NET)` column of the README's
    tables, the port limited to upstream's rewrites with externals kept,
    moves with it, since renaming is not a rewrite a level governs.

41. *Unused uniform blocks.* Under `--remove-unused-uniforms`, a uniform
    block that a stage reads nothing of (no member of a nameless block, nor
    the instance of a named one) goes from that stage, whole. The
    application finds a block by name in the linked program, whichever
    stage declares it, so while the other stage keeps the block nothing the
    application can observe changes; when no stage reads it the block is
    gone, which is the tolerance the flag already asks for, and Babylon.js
    has it (`bindUniformBlock` skips a block whose index comes back
    invalid). Babylon declares its whole `Material` block in both stages and
    reads it in the fragment shader alone: 19.6% of its minified program
    pairs raw, 15.4% with each file compressed on its own, and about nothing
    with a pair compressed together, since the vertex copy compressed
    against the fragment one. PlayCanvas's `ub_view` is the same shape,
    worth 0.6%. A block with a member the minifier cannot see into (a `#if`
    region) stays, and so does one a kept `#define` names. The pixel
    harness binds a buffer to every block the linked program reports, so
    the corpus pairs render with the flag on.

42. *A moved declaration's assignment names a copy.* `--move-declarations`
    groups a declaration into an earlier line of its type and leaves an
    assignment where it stood. Upstream builds that assignment around the
    declaration's own identifier object, which every reference to a
    declaration shares. When `reuseExistingVarDecl` later eliminates the
    moved variable, it renames its uses one by one; the assignment's target
    is the declaration itself, so renaming it renames the declaration, and
    the loop, which matches uses by the declaration's current name, no
    longer recognises the uses after it. The output then reads a variable it
    never declares: `many_variables`, `ed-209`, `slisesix`, `endeavour` and
    `audio-flight-v2` under `--no-remove-unused --aggressive-inlining
    --move-declarations`, invisible to a compiler test until the scope check
    (item 10) looked for it. The assignment's target is a copy of the name
    now, as `reuseExistingVarDecl`'s own output already was (item 9's
    lesson). No golden changes: none combines the flags.

43. *`precision` inside a block.* GLSL allows a precision statement in any
    scope, setting the default for the declarations after it in that scope.
    Upstream knows it only at top level and fails to parse it in a function
    body. The port has a `Precision` statement: printed as written, ignored
    by the analysis and the renamer (builtin types only), and treated by the
    block rewrites like a directive, so no declaration is grouped above it
    and no variable is reused across it, either of which would take the
    other precision. `--drop-default-precision` tracks the precision in
    force at top level only, so a function body that changes it keeps every
    qualifier. Inlining across it is fine: a precision qualifier is a
    minimum, and evaluating at a higher precision is what the spec allows an
    implementation anyway.

44. *`#include` in the Vite plugin.* WebGL has no `#include`; engines that
    write it resolve it before the compiler sees the shader. The plugin's
    load hook does the same before the minifier does: an `#include "file"`
    (or `<file>`) line becomes the file's text, relative to the including
    file, recursively, with a cycle and a missing file reported by file and
    line, and every file read registered with Vite's watcher so a change to
    an include rebuilds its importers. Upstream, the CLI and the library
    keep the directive as text, which the compiler then rejects; only the
    plugin has a file system to resolve against.

45. *Type knowledge across the files of a run.* The rewriter learns the
    structs, interface blocks and function return types it may meet from
    the code it is given; upstream and the port gave it one file at a time,
    so in a multi-file run a call into another file had an unknown type,
    which `--webgl` treats as possibly a struct (no `?:`) and possibly void
    (no comma sequence), and the swizzle-like field rule could not tell a
    field from a swizzle. The rewriter now reads its knowledge from the file
    and the other files' declarations, the file's own winning where a name
    is declared in both (two stages may each declare a `Light`). Nothing
    else crosses files: removals count uses per file and effects are
    resolved per file, as upstream does, so a shader split over several
    files still runs with `--no-remove-unused`.

46. *A directive inside a declarator list.* `float a,\n#ifdef X\n b,\n#endif\n
    c;` is a parse error upstream. The port splits the declaration at the
    directives into one declaration per run of names, the type repeated,
    with the directives between them (`float a; #ifdef X float b; #endif
    float c;`), which declares the same things in the same scope; the
    alternatives machinery (items 32 and 37) then treats the pieces as it
    treats any region. An anonymous struct type or an array type is not
    split, since its type could not be repeated without sharing its nodes.
    Only a declarator list with a directive in it takes this path, so
    nothing else changes.

47. *A tested macro name is never generated.* The renamer's forbidden list
    held the macros the file defines; a macro the file only tests (`#ifdef
    X`, `defined(X)`, `#if Y > 0`) is one the application injects, and a
    generated identifier of the same spelling (`uniform float X;` under
    `#ifdef X`, which upstream produces) is erased by the application's
    `#define X`. Every tested name is forbidden now, from kept directives,
    conditional expressions and the regions kept as text. Only one- and
    two-letter macro names could ever collide, so no golden changes.

48. *Overloads resolved by argument type.* Upstream resolves a call by name
    and arity ("TODO: support type-based disambiguation"), so two overloads
    of one arity, `pow2(float)` and `pow2(vec2)`, leave every call to them
    unresolved: neither is inlined, neither is removed when unused, and
    `--webgl` treats the call as of unknown type. Engine shaders are full of
    them (three.js has 103 such groups, Cesium 23). The port has an
    expression typer (`src/typer.ts`) that gives an argument its type from
    literals, declared variables, swizzles, struct fields, array elements,
    constructors, the operators' promotion rules, the genType builtins,
    `length`/`dot`/`distance`, the texture functions and the `gl_` variables,
    and answers null for anything else. A call among overloads of one arity
    binds to the overload whose parameter types equal the argument types,
    when every argument type is known and exactly one overload fits; an
    `int` argument to a `float` parameter, which ES 3.00 would convert, is
    left unresolved on purpose, since the exact rule is the safe one. Inlining
    and unused-function removal then work per overload: a function is called
    when a call resolves to it, or when a call to its prototype resolves to
    nothing. Function nodes are rebuilt between passes, so an overload is
    matched by its signature, never by identity. Five goldens move
    (`tests/DEVIATIONS.md` item 7); `test/typer.test.ts` pins the typer.

    Alternatives are the hazard, and the corpus found it at once: three.js
    declares `pointShadowMap` as a `samplerCubeShadow` under
    `SHADOWMAP_TYPE_PCF` and a `samplerCube` otherwise, with a `getPointShadow`
    overload in each branch. A variable declared in alternative branches
    (item 32's unified locals, and a global inside a top-level region) has no
    type to the typer, and an overload group with a member inside a region
    is never resolved, since the other setting may need the other member.
    Underneath, the analysis environment merged two branches' functions by
    prototype and kept the last branch's list alone, so a call after the
    `#endif` saw one `getPointShadow` and bound to it as if unique; both
    branches' functions are in scope after the region now. The three.js
    renders without `--preprocess`, under both settings of the defines, are
    what checks all of this.

49. *An initializer is not merged into an lvalue.* Two upstream rules fold a
    local's value into the statement that follows: `float m=14.;m=58.-m;`
    becomes `float m=58.-14.;`, and `m=14.;m=58.-m;` becomes `m=58.-14.;`,
    when the value is pure and used once. Neither asked where the use is.
    PlayCanvas passes a local to an `inout` parameter its callee never
    writes (`getShadowSampleCoord0`), which leaves the call pure, and the
    rule produced `vec3 v=getShadowSampleCoord0(vec3(0),...)`: a constant
    for an `inout` argument, which does not compile. Upstream reaches the
    same line with a non-overloaded callee; the port reached it once item 48
    resolved `saturate` and made the callee pure. Both rules now require
    every use to be a value: not an `out`/`inout` argument, not the target
    of an assignment or `++`, and not an argument of a call whose parameters
    are unknown. The PlayCanvas renders caught it the same hour.

50. *A macro call among the parameters.* PlayCanvas declares a parameter
    through a function-like macro, `float f(SHADOWMAP_ACCEPT(shadowMap),
    vec3 c)` with `#define SHADOWMAP_ACCEPT(name) sampler2DShadow name`,
    which no parser of declarations can read; upstream and the port refused
    the file without `--expand-macros`. The parser now keeps such a function
    as text, as it keeps one with a directive among its parameters (item
    31): a call to a function-like macro the file defines, at the top level
    of the parameter list, makes the whole function opaque, with its names
    pinned. Five PlayCanvas shaders parse without the flag; nothing changes
    for a file that expands its macros.

### Upstream candidates

Several of the deviations above fix bugs that upstream has too, found by the
scope check, the pixel test and the open source corpus rather than by
reading the F#. Offering them upstream would be a kindness to the project the
port is built on; each is a small, self-contained change with a reproducing
shader in this repository:

- argument inlining into a body whose other parameter carries the argument's
  name (item 9, `test/pixels/shadow-param.frag`);
- identifiers named in a kept `#define` being renamed or removed (item 11,
  `controllable-machinery` under renaming);
- function reordering pulling alternative definitions out of `#ifdef`
  blocks (item 12, `frozen-wasteland` with a prototype);
- a generated name colliding with a preserved external declared later
  (item 13, `test/pixels/preserved-names.frag`);
- `--move-declarations` hoisting a declaration above an earlier use of its
  name (item 14, `ohanami`);
- local variable inlining past a later local of a name the value reads
  (item 15, `test/port-flags.test.ts`);
- `--preprocess` taking a branch after one was already taken, recording a
  `#define` inside an inactive block, and missing indented directives (item
  16, every lit three.js material);
- renaming the fields of a struct a uniform uses under `--preserve-externals`
  (item 17, `directionalLights[0].direction`);
- argument inlining moving a global declared after the function into its
  body, and keeping `const` on the local (item 18, three.js `envMap`);
- a tab after a macro name glued to the name (item 19);
- refusing struct fields named like swizzle components (item 20);
- a global initialized by a call losing its callee, or moving above it
  (item 30, `test/port-flags.test.ts`);
- a name declared in both branches of a `#if` bound to the last declaration
  alone, so `controllable-machinery`'s `naa` is inlined as `3.` under
  `#define AA 0` and `orchard` loses one of its two `lookat` values (item
  32, `test/directive-alternatives.test.ts`);
- decimal folding of float operators, which lands one ulp from what the GPU
  computes (`4.3+3.4` to `7.7`; item 33, `test/fold-builtins.test.ts`);
- reading an `#if`/`#else` region as a sequence: alternatives renamed apart,
  a declaration inlined out of its branch, a region without a function
  dropped by `reorderFunctions` (item 37, Cesium's `globe`, `globe-2` and
  `post-processing-2`);
- reassociating floating-point addition to drop parentheses (item 38,
  Cesium's `polyline.vert`);
- printing a literal below 5e-17 as `0.`, so an epsilon guard such as
  `max(x,1e-20)` becomes a real zero (item 39, `decimals.frag`);
- offering a preserved external's name for reuse by shadowing, which names a
  parameter `spotShadowMap` once the letters run out (item 40, three.js
  `ShadowMaterial.frag`, Babylon's materials);
- `--move-declarations` leaving the declaration's own identifier in the
  assignment that replaces it, so a later variable reuse renames the
  declaration and loses its uses (item 42, `many_variables` with
  `--no-remove-unused --aggressive-inlining --move-declarations`);
- a macro name the shader tests but never defines given out as a generated
  identifier (item 47, `test/directive-alternatives.test.ts`);
- resolving a call among overloads of one arity by argument type, which
  removes the unused overload and inlines the single-use one (item 48,
  `buoy`'s `Noise`, `robin`'s `TweetVolume`);
- merging a local's initializer into an `inout` argument of the assignment
  that follows, a constant where an lvalue is needed (item 49, PlayCanvas
  `StandardMaterial-4.frag`, `test/rewriter.test.ts`).

The scope check itself (item 10) would catch regressions of all of these and
is a few dozen lines against upstream's analyzer.

### 5.3 Ordering (F# Map/Set are sorted, JS Map is insertion-ordered)
- `env.funOverloads |> Seq.tryFind` iterates by sorted key: overload reuse
  picks the alphabetically-first function name. Ported with sorted iteration.
- `Map.partition` in shadowVariables, `Map.ofSeq` in json output (sorted keys),
  `Seq.sort exportedNames` (record compare: prefix, name, newName), F# string
  `<` is ordinal.
- `computeListOfNames`: `List.sortBy count |> List.rev` is a stable ascending
  sort then reverse, so equal-count letters come out in *reverse* alphabetical
  order. Replicated exactly; it fixes every renamed identifier.
- `List.distinct`, `List.except` keep first-occurrence order.

### 5.4 Ident identity and mutation
`Ident` is a mutable object: `Rename`, `Declaration`, `ToBeInlined`,
`DoNotInline`, `isVarWrite`, `Loc`. The renamer renames by mutating the shared
instance reached from all use sites; `inlineFn` creates fresh Idents for
non-argument vars precisely because of this. Ported as a class; Idents are
never copied in the visitor. Unique ids from pass 1 are printed as
`String.fromCharCode(1000+n)` and the context table is built on that text
with printable chars 32..127. Because those ids are Unicode letters, the
printer's identifier test is Unicode-aware like `Char.IsLetterOrDigit`; an
ASCII-only test changes the spacing, the bigram table, and every chosen name.

### 5.5 Text/regex
- `mangleToUnicode` uses .NET `\W` (Unicode-aware): JS needs
  `/[^\p{L}\p{N}_]/gu`; `mangleToAscii` is `[^a-zA-Z_0-9]`. Exercised by
  `file name with-weird caractères.frag`.
- Printer indent encoding: `\0` = optional newline, `\t` = indent level;
  `stripIndentation` removes both; formatter splits on `\0`. The ternary
  emits `:` before the newline marker (`printer.fs:122`).
- `keyword` = literal not followed by letter/digit/`_`, then whitespace.
  Comments are whitespace, except `//[`...`//]` which is a verbatim node.
- Parse errors are exceptions (`ParseError`) with position; the rewriter uses
  `failwith` for inlining contradictions. Kept as thrown `Error`s.

### 5.6 Behaviours kept even though they look odd
- `Seq.take 26` in chooseIdent throws if fewer than 26 candidates remain;
  guarded and pinned by a test.
- The fixpoint loop stops after 20 passes with a trace.
- `--aggressive-inlining` is ignored when `--no-inlining` is set.
- `MINIFIER_DEBUG=yes` env: dropped (Windows-only user-store lookup); use `--debug`.
- `Array.Parallel.map` becomes sequential (deterministic anyway).
- The renamer's overload reuse can collide (`renamer.fs:293`, upstream's own
  "bug, may cause conflicts"); `--no-overloading` avoids it, and the Vite
  plugin sets it.
