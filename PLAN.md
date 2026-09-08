# shader-minifier-js: port plan

A TypeScript port of Shader Minifier (Ctrl-Alt-Test, F#, Apache 2.0), driven by
its own golden test corpus. Upstream: ~/projects/shader-minifier @ 9653515
(2026-05-06), version 1.5.1.

## 1. What is being ported

Upstream is 4,182 lines of F# in 12 modules. Pipeline per file:

```
preprocess (opt, --preprocess)
  -> parse (FParsec, own AST; forward decls dropped + flag reorderFunctions)
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

### Module map (1:1 with upstream, estimated TS lines)

| upstream          | port                      | lines | notes |
|-------------------|---------------------------|------:|-------|
| ast.fs            | src/ast.ts                |  450  | types, `Ident` class, `VarDecl`/`FunDecl`, `MapEnv` visitor |
| builtin.fs        | src/builtin.ts            |  120  | keyword/type/function sets, swizzles |
| options.fs        | src/options.ts, src/cli.ts|  250  | hand-written arg parser replacing Argu; flags must match upstream exactly |
| preprocessor.fs   | src/preprocessor.ts       |  200  | line-based; only evaluates `#if 0/1`, `#ifdef` of known defines |
| parse.fs          | src/lexer.ts, src/parser.ts | 750 | recursive descent + precedence climbing replacing FParsec |
| printer.fs        | src/printer.ts            |  420  | precedence-based paren insertion, `\0`/`\t` indent encoding, kkp `.sym` writer |
| formatter.fs      | src/formatter.ts          |  220  | the 8 output formats |
| analyzer.fs       | src/analyzer.ts           |  350  | VarVisitor, Effects, resolve, markWrites, findFuncInfos |
| inlining.fs       | src/inlining.ts           |  380  | variable / function / argument inlining marks |
| rewriter.fs       | src/rewriter.ts           | 1150  | simplifyOperator, simplifyVec, simplifyBlock, var reuse, unused-assignment removal, cleanup |
| renamer.fs        | src/renamer.ts            |  580  | Env, RenamerVisitor, context-table naming, shadowing |
| api.fs, main.fs   | src/api.ts, src/index.ts  |  150  | `Minifier` class, library entry |
| Checker/main.fs   | test/golden.test.ts       |  200  | commands.txt runner |

Total ~5,200 lines of TypeScript.

## 2. Decision: own parser, not @shaderfrog/glsl-parser

Rejected as the front end because:

- Every pass (3k lines) pattern-matches on Shader Minifier's AST: operators are
  `FunCall(Op "+", [a; b])`, parentheses are not stored, `i++` is `Op "$++"`,
  declarations are `(Type, DeclElt list)`. The peggy AST is a different shape
  with whitespace, parens and literal tokens preserved. Adapting means
  rewriting every pass, not porting it, and the golden files would stop being
  an oracle.
- Shader Minifier's parser is deliberately lax: unknown text in `//[ ... //]`
  verbatim blocks, `#define`/`#if` directives as statements, HLSL semantics,
  casts, templates, attributes, `layout(...)` kept as an opaque string.
  glsl-parser is a strict GLSL ES 1.00/3.00 grammar and would reject 8 HLSL
  tests and several desktop GLSL inputs in `tests/real`.
- The upstream parser is 415 lines of FParsec. A hand-written recursive
  descent parser is ~750 lines of TS and gives exact control over the quirks
  the expected outputs depend on (comment handling, keyword lookahead, number
  regex, suffixes, forward-declaration skipping, `forbiddenNames`).

glsl-parser is still useful as an independent re-parse oracle in tests
(phase 4): every minified GLSL output must parse. It is a dev dependency only.

## 3. Test strategy: upstream corpus is the oracle

Vendored into `tests/` (Apache 2.0, keep upstream LICENSE and a
`tests/UPSTREAM` file with the commit hash; `scripts/sync-tests.sh` re-copies).

1. **Golden tests** (primary, phase-gated). `tests/commands.txt` has 96
   commands (8 HLSL). Runner ports `Checker/main.fs`: same quote-aware
   `splitArgs`, run in-process with the arg array, read `-o` target as
   expected, normalise both with `cleanString` (CRLF -> LF, trim, strip
   `\bShader Minifier \d(\.\d+)+`). Our banner must therefore read
   `Shader Minifier <numeric version>` so the regex strips it. Also writes
   `tests/out/<dir>/<name>.minind.<ext>` like upstream. `--update-golden`
   flag for regenerating.
2. **Round-trip idempotence** (phase 1 gate, before any pass exists): for
   every `tests/unit/*` and `tests/real/*` source, `print(parse(src))` must
   parse again and print identically.
3. **Compile check of outputs**. Upstream uses glslang.exe (`tests/compile.txt`,
   33 entries, versions 110/130/330 + hlsl) and every `tests/unit/*.frag` via
   `--format text --no-remove-unused`. We port the list and check with:
   (a) re-parse with our parser (always), (b) re-parse with
   @shaderfrog/glsl-parser for ES-compatible files, (c) optional headless
   Chrome WebGL compile using the harness already in spglsl/project/conformance.
4. **spglsl corpus** (`spglsl/project/test/shaders/**`, incl. island-not-found
   1,045 lines): compile-validity through (c) plus a size table vs spglsl's
   output, so we can see the compression win.
5. **Unit tests** for the risky primitives listed in section 5: float
   formatting, decimal folding, name-list ordering, precedence/parens.

Excluded: Crinkler compression tests (Windows DLL), performance test (kept as
an informational timing only).

## 4. Language and tooling

- TypeScript, ESM, Node >= 20, strict mode. No runtime dependency except a
  decimal library (see 5.2). Dev: vitest, tsx, tsc, prettier.
- `bin/shader-minifier` CLI with upstream's exact flags, so `commands.txt`
  runs verbatim.
- Library API: `minify(files: {name, content}[], options): {shaders,
  exportedNames, format(fmt)}`.
- Later (phase 5): a Vite plugin with its own options mirroring the CLI flags
  (not a drop-in for spglsl; decided 2026-09-08). Defaults to
  `--webgl --preserve-externals --no-overloading --no-pi-substitution`.

## 5. Porting pitfalls

Principle (agreed): replicate .NET/F# behaviour only where a golden test
observes it. Everywhere else use plain JavaScript semantics. Floats start as
JS doubles with a shortest-round-trip printer; a decimal library is added only
if a numbers golden test cannot pass without it. Sorted iteration is used in
the renamer because it fixes the expected identifier names; other maps stay
insertion-ordered. HLSL support is kept (small), WebGL is the focus.

The items below are the places where the difference is test-visible or where
a naive port silently diverges.

### 5.1 Equality semantics
F# uses structural equality on records/unions and reference identity where it
says so. Every site must be ported deliberately:
- `ty1 = ty2` (Type, incl. Ident by `Name`) in squeezeDeclarations,
  groupDeclarations (`Dictionary<Type,_>` key), reuseExistingVarDecl,
  declsCanBeSqueezed -> `typeEquals`, `typeKey`.
- `declElt1.sizes = declElt2.sizes`, `semantics` -> `exprListEquals`.
- `Set.contains t unused` on TopLevel, `inl.func = func` -> use object identity
  (upstream relies on structural, identity is equivalent here since nodes are
  the same instances).
- `List.contains d.name` on Ident -> compare `.name`.
- `LanguagePrimitives.PhysicalEquality` -> `===`.
- `Printer.exprToS e1 = Printer.exprToS e2` -> keep string compare.

### 5.2 Numbers
- `Float`: JS double. Verified against every literal in `decimals.frag` and
  `float.frag`: upstream's `floatToS` converts decimal -> double before
  formatting, so a shortest-round-trip printer (fixed form vs exponent form,
  pick the shorter, fixed wins ties, fixed limited to 16 fraction digits)
  reproduces all 41 + 30 cases with zero mismatches. Constant folds are
  rounded to 15 significant digits afterwards so `1.1+2.2` prints `3.3`.
  Verified: an exact .NET-decimal emulation passes the same 96 goldens and
  only differs on 16-digit results (e.g. `2.*3.141592653589793`), where
  both round to the same float32. No decimal dependency.
- `Int`: JS number with `Number.isSafeInteger` guard on folds (skip the fold
  when unsafe). `/` truncates toward zero via `Math.trunc`, `%` follows the
  dividend (JS matches). `useInts` int32 range check -> keep float.

**Deliberate deviation from upstream (agreed):**
1. *Literal range.* Upstream cannot parse float literals above ~7.9e28
   (.NET decimal overflow; `3e38`, `1e37`, `1e308` are commented out in
   `decimals.frag`). The port accepts the full double range. Golden edit:
   uncomment those three lines in `tests/unit/decimals.frag` and add
   `x(3e38);`, `x(1e37);`, `x(1e308);` to the expected file.
The edit is recorded in `tests/DEVIATIONS.md` so `scripts/sync-tests.sh`
can re-apply it after a re-vendor.

Kept as upstream (agreed): nonzero floats below ~5e-17 print as `0.` because
the fixed form wins the length contest. The five `x(0.);` lines in
`decimals.frag.expected` stay.

2. *Forbidden names across files.* Upstream builds the renamer's forbidden
   list (macro names, struct names, `if`/`in`/`do`) from the first shader
   only (`renamer.fs`, "TODO: combine from all shaders"). The port takes the
   union over all input files. Expected to be invisible to the multi-file
   goldens (`inout`, `interface-block-renaming`, `mouton`); verified in
   phase 3.
3. *Pi substitution flag.* Upstream replaces float literals that round to
   pi, tau or pi/2 at 8 decimals with `acos(-1.)`, `2.*acos(-1.)`,
   `acos(0.)` (only fires on literals with 8+ decimals, so the byte win is
   small). Under mediump on mobile GPUs this can cost precision. New flag
   `--no-pi-substitution` disables it. Default stays on to match upstream
   and the goldens (`pi.frag`, `decimals.frag`, `geometry.hlsl`); the WebGL
   build plugin (phase 5) defaults it off.
4. *Prefix sign spacing.* Upstream only guards binary `+`/`-` against
   merging into `++`/`--` (`printer.fs:142`), so `-(--a)` prints as `---a`,
   which is invalid. The port applies the same guard to prefix `+`/`-`
   (`- --a`). `-(-a)` itself is always folded by the simplifier, so no
   golden observes the difference (found by the phase 4 re-parse check).
5. *`--webgl` flag.* Two upstream rewrites produce code ANGLE rejects
   (verified in Chrome, WebGL 1 and 2): `if(c)return a;return b;` ->
   `return c?a:b;` when the type is a struct (`ed-209`), and folding a
   void call into a comma sequence (`endeavour`, ES 3.00 rule). `--webgl`
   skips both, using the declarations of the file to tell struct-typed
   and void-returning expressions apart (unknown counts as unsafe). The
   ES 3.00 sequence rule is applied regardless of `#version`, because the
   header is usually prepended at runtime. Default off so the goldens stay
   byte-identical; the build plugin (phase 5) turns it on.
- Number lexing: regex `(\d+\.?\d*|\.\d+)([eE][-+]?[0-9]+)?`, then int64 parse
  first, else decimal; octal `0[0-7]+`, hex `0[xX]`; suffixes f F LF lf u U l
  L h H. Verify exponent literals against `numbers.frag` golden.

### 5.3 Ordering (F# Map/Set are sorted, JS Map is insertion-ordered)
- `env.funOverloads |> Seq.tryFind` iterates by sorted key: overload reuse
  picks the alphabetically-first function name. Port with sorted iteration.
- `Map.partition` in shadowVariables, `Map.ofSeq` in json output (sorted keys),
  `Seq.sort exportedNames` (record compare: prefix, name, newName), F# string
  `<` is ordinal.
- `computeListOfNames`: `List.sortBy count |> List.rev` is a stable ascending
  sort then reverse, so equal-count letters come out in *reverse* alphabetical
  order. Must replicate exactly; it fixes every renamed identifier.
- `List.distinct`, `List.except` keep first-occurrence order.

### 5.4 Ident identity and mutation
`Ident` is a mutable object: `Rename`, `Declaration`, `ToBeInlined`,
`DoNotInline`, `isVarWrite`, `Loc`. The renamer renames by mutating the shared
instance reached from all use sites; `inlineFn` creates fresh Idents for
non-argument vars precisely because of this. Port as a class; never copy Idents
in the visitor. Unique ids from pass 1 are printed as `String.fromCharCode(1000+n)`
and the context table is built on that text with printable chars 32..127.

### 5.5 Text/regex
- `mangleToUnicode` uses .NET `\W` (Unicode-aware): JS needs
  `/[^\p{L}\p{N}_]/gu`; `mangleToAscii` is `[^a-zA-Z_0-9]`. Exercised by
  `file name with-weird caractères.frag`.
- Printer indent encoding: `\0` = optional newline, `\t` = indent level;
  `stripIndentation` removes both; formatter splits on `\0`.
- `keyword` = literal not followed by letter/digit/`_`, then whitespace.
  Comments are whitespace, except `//[`...`//]` which is a verbatim node.
- Parse errors are exceptions (`ParseError`) with position; rewriter uses
  `failwith` for inlining contradictions. Keep as thrown `Error`s.

### 5.6 Behaviours to keep even though they look odd
- `Seq.take 26` in chooseIdent throws if fewer than 26 candidates remain;
  keep a guard but note it in a test.
- Fixpoint loop stops after 20 passes with a trace.
- `--aggressive-inlining` is ignored when `--no-inlining` is set.
- `MINIFIER_DEBUG=yes` env: dropped (Windows-only user-store lookup); use `--debug`.
- Parallel `Array.Parallel.map` becomes sequential (deterministic anyway).

## 6. Phases and gates

| phase | work | gate |
|------:|------|------|
| 0 | repo scaffold, vendor tests, golden runner, CI `npm test` | runner reports 0/96 passing and lists each command |
| 1 | ast, builtin, options+cli, lexer/parser, preprocessor, printer, formatter | round-trip idempotence on all 140 sources; formats reproduce headers |
| 2 | analyzer, inlining, rewriter (largest; split: simplifyExpr / simplifyBlock / inlining) | all `--no-renaming` golden commands pass (~55) |
| 3 | renamer incl. overloading, shadowing, multi-file | all 96 golden commands pass, incl. HLSL and kkp symbols |
| 4 | compile-validity harness (own re-parse, glsl-parser, Chrome WebGL), spglsl corpus + size table, unit tests for 5.x primitives | every output re-parses; spglsl corpus compiles in WebGL |
| 5 | library API polish, rollup/vite/esbuild plugin, README, sync script | plugin runs in a sample vite project |

Execution: I write phase 0 and phase 1 myself, because the AST and printer are
the contract every other module depends on. Phase 2 and 3 modules are
independent given that contract, so analyzer+inlining, rewriter, and renamer
are ported in parallel by sub-agents each running the golden suite, then
integrated. Phases 4 and 5 follow sequentially.

## 7. Open questions (defaults chosen, change if you disagree)

1. Keep HLSL support? Default yes: ~150 extra parser lines, keeps 8 golden
   tests and parser fidelity. Can be removed later.
2. Numbers: resolved. Doubles, zero runtime dependencies (verified against
   the golden literals).
3. Vendor tests vs reference `../shader-minifier`? Default vendor, so the
   repo is self-contained and CI works.
