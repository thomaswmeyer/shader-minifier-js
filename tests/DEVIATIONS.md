# Golden-file deviations from upstream

The corpus under `tests/` is vendored verbatim from upstream Shader Minifier
(commit in `tests/UPSTREAM`) except for the edits below, which
`scripts/sync-tests.sh` re-applies from `scripts/golden-deviations.patch`
after each re-vendor. Each edit corresponds to a deliberate deviation listed
in `PORTING.md` section 5.2.

1. `tests/unit/decimals.frag` / `.expected` — float literal range. Upstream
   cannot parse literals above ~7.9e28 (.NET `decimal` overflow) and keeps
   `x(1e308)`, `x(3e38)`, `x(1e37)` commented out. The port accepts the full
   double range, so the three lines are uncommented and their expected output
   added.

2. `tests/real/controllable-machinery.frag.expected` — pinned macro names.
   The shader's `#define DMIN(id) if (d < dMin) {...}` names the local `d`,
   so the port never merges that local into another (`PORTING.md` 5.2 item
   11); upstream's expected output reuses the parameter `p` for it in
   `PrBoxDf`. Two lines differ.

3. `tests/unit/preprocess_if.frag.expected` — `--preprocess` decides `#if`
   expressions. Upstream keeps `#if DEF ... #endif` as text even with
   `#define DEF 1` in the file; the port decides it (`PORTING.md` 5.2 item
   16), so the two directive lines are gone from the expected output.

4. `tests/real/controllable-machinery.frag.expected`,
   `tests/real/orchard.frag.expected`, `tests/real/ed-209.frag.expected` — a
   name declared in both branches of a `#if`. Upstream reads a function body
   as one flat list, so `#if ! AA const float naa = 1.; #else const float
   naa = 3.; #endif` binds every use to the second declaration and inlines
   `3.` whatever `AA` is; `orchard`'s `lookat` is the same. The port keeps
   both declarations as one variable (`PORTING.md` 5.2 item 32), so
   `controllable-machinery` keeps `naa` and `orchard` keeps both `lookat`
   initializers, and `ed-209`'s two `vec2 coord` declarations get one name
   instead of two. `ed-209`'s loops around them open under `#ifdef AA` and
   close under another, so the port also stops reusing outer names by
   shadowing inside them, which renames the loop variables.

Not an edit to the corpus, but a flag the runner adds: `test/golden.ts` passes
`--decimal-folds` to every command, because the port folds float operators
at float32 by default (`PORTING.md` 5.2 item 33) and upstream in decimal.
Fourteen goldens would otherwise differ in their constants. `tests/commands.txt`
is unchanged.
