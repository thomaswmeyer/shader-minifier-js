# Golden-file deviations from upstream

The corpus under `tests/` is vendored verbatim from upstream Shader Minifier
(commit in `tests/UPSTREAM`) except for the edits below, which
`scripts/sync-tests.sh` re-applies from `scripts/golden-deviations.patch`
after each re-vendor. Each edit corresponds to a deliberate deviation listed
in `docs/PORTING.md` section 5.2.

1. `tests/unit/decimals.frag` / `.expected` — float literal range. Upstream
   cannot parse literals above ~7.9e28 (.NET `decimal` overflow) and keeps
   `x(1e308)`, `x(3e38)`, `x(1e37)` commented out. The port accepts the full
   double range, so the three lines are uncommented and their expected output
   added.

2. `tests/real/controllable-machinery.frag.expected` — pinned macro names.
   The shader's `#define DMIN(id) if (d < dMin) {...}` names the local `d`,
   so the port never merges that local into another (`docs/PORTING.md` 5.2 item
   11); upstream's expected output reuses the parameter `p` for it in
   `PrBoxDf`. Two lines differ.

3. `tests/unit/preprocess_if.frag.expected` — `--preprocess` decides `#if`
   expressions. Upstream keeps `#if DEF ... #endif` as text even with
   `#define DEF 1` in the file; the port decides it (`docs/PORTING.md` 5.2 item
   16), so the two directive lines are gone from the expected output.

4. `tests/real/controllable-machinery.frag.expected`,
   `tests/real/orchard.frag.expected`, `tests/real/ed-209.frag.expected` — a
   name declared in both branches of a `#if`. Upstream reads a function body
   as one flat list, so `#if ! AA const float naa = 1.; #else const float
   naa = 3.; #endif` binds every use to the second declaration and inlines
   `3.` whatever `AA` is; `orchard`'s `lookat` is the same. The port keeps
   both declarations as one variable (`docs/PORTING.md` 5.2 item 32), so
   `controllable-machinery` keeps `naa` and `orchard` keeps both `lookat`
   initializers, and `ed-209`'s two `vec2 coord` declarations get one name
   instead of two. `ed-209`'s loops around them open under `#ifdef AA` and
   close under another, so the port also stops reusing outer names by
   shadowing inside them, which renames the loop variables. With the
   branches of a region renamed each from the scope the region began in
   (`docs/PORTING.md` 5.2 item 37), `tests/real/mandelbulb.expected` changes too:
   its branches share names rather than running on from each other.

5. Fifteen goldens under `tests/real` and `tests/unit` — no reassociation of
   floating-point arithmetic (`docs/PORTING.md` 5.2 item 38). Upstream turns
   `x+(y+z)` into `x+y+z` and `x-(y-z)` into `x-y+z`, which is a different
   number when the magnitudes differ enough; the port commutes instead
   (`y+z+x`) and keeps the parentheses under a subtraction. Three of the
   fifteen are corrections where an operand had a side effect and
   reassociating moved it (`g+(--g-++g)` had become `g+--g-++g`). Files:
   `kinder_painter`, `mandelbulb`, `monjori`, `moutard`, `mouton`,
   `ohanami`, `the_real_party_is_in_your_pocket`, `valley_ball`,
   `lunaquatic`, `from-the-seas-to-the-stars` and, under `tests/unit`,
   `arg-inlining`, `operators`, `precedence`, `shadowing`, `simplify`.

6. `tests/unit/decimals.frag.expected` — literals below 5e-17. Upstream's
   fixed form has 16 fraction digits, all zero down there, and it prints
   `1.24e-27` as `0.`; the five `x(0.);` lines at the end are that. The port
   prints the exponent form (`124e-29`, `8e-46`), so an epsilon such as
   `1e-20` survives minification (`docs/PORTING.md` 5.2 item 39).

7. `tests/unit/overload.expected`, `tests/real/kinder_painter.expected`,
   `tests/real/audio-flight-v2.frag.expected`, `tests/real/buoy.frag.expected`,
   `tests/real/robin.frag.expected` — overloads resolved by argument type
   (`docs/PORTING.md` 5.2 item 48). Upstream resolves a call by name and arity
   only, so overloads of one arity are all kept and none is inlined. The
   port types the arguments: `buoy`'s two unused `Noise` overloads and
   `audio-flight-v2`'s `pMod(vec2,float)` go, `robin`'s `TweetVolume` and
   several single-use overloads inline, and the renaming shifts with them.

Not an edit to the corpus, but a flag the runner adds: `test/golden.ts` passes
`--decimal-folds` to every command, because the port folds float operators
at float32 by default (`docs/PORTING.md` 5.2 item 33) and upstream in decimal.
Fourteen goldens would otherwise differ in their constants. `tests/commands.txt`
is unchanged.
