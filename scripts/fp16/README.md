# Shader precision timer

`bench.html` times two byte-identical GLSL workloads — one declared `highp`, one
`mediump` — on whatever GPU opens it, and reports which is faster.

It exists because the half-precision emulation in `test/half.ts` can only answer
half the question. That harness says whether a shader still *looks* right when
every float intermediate is rounded to fp16 (`npm run half`, results in
`docs/TODO.md` section 7). It cannot say whether fp16 is any *faster*, because
nothing here reaches hardware with a separate fp16 path: SwiftShader computes
`mediump` as fp32, and `getShaderPrecisionFormat` reporting 10 mantissa bits is
the figure the spec demands of every implementation, so it proves nothing
either. Only a phone can answer it, so this is a page rather than a test.

Method: three ALU-bound fragment shaders (a scalar multiply-add chain, the same
chain in `vec4`, and a `sin`/`cos` chain), each a dependent loop seeded from
`gl_FragCoord` and a uniform. Every program is compiled and drawn several times
before any timing starts, because drivers finish specialising a shader on its
first real draw. A pass is then *one* draw into a 512×512 offscreen target, its
iteration count set by a uniform so the draw takes about 60ms, followed by
reading one pixel back, which is what forces the driver to finish inside the
timed window; both precisions of a workload always run the same iteration count.

Two things about the shaders are deliberate and were arrived at the hard way.
Sizing the work by *drawing repeatedly* does not survive a tile-based GPU: with
no blend and no depth each full-screen triangle completely covers the last, and
a deferred renderer shades only the final one. An iPhone measured 0.02ms for a
pass that way — sixty draws, fifty-nine discarded. And a loop body of plain
multiply-adds is a chain of affine maps, which an optimiser is entitled to
collapse into a single closed form; every step is wrapped in `fract` or a trig
call so that it cannot. The dynamic loop count also keeps the body from being
unrolled and then folded.

So the page checks its own premise before reporting: doubling a pass's
iteration count has to roughly double its time. When it does not, the work is
being discarded or the clock is too coarse to see it, and the page says that
instead of printing a ratio built on nothing.

Two things keep the result from being noise, because on a phone a single round
scatters far enough to read anywhere between 0.7× and 1.5×:

- **The reported figure is the fastest pass, not the average.** Anything else
  sharing the GPU can only make a pass slower, so over twenty-one rounds the
  minimum is the closest thing to the true cost. Rounds alternate which
  precision goes first, so a clock ramp cannot favour one of them.
- **A control times `highp` against `highp`** — the same program, twice. Its
  ratio is 1.00× by construction, so whatever it reads instead is the noise
  floor, and a workload has to beat that margin before the verdict calls the
  difference real.

The page shows every round's own ratio as a dot strip around the 1.00× line, so
the scatter is visible rather than hidden behind a summary statistic.

A 1.00× result is ambiguous on its own — the GPU may have no fp16 path, or the
qualifier may never have reached it — so the page also probes what precision is
actually being used. For each of `lowp`, `mediump` and `highp` it finds the
smallest 2^-k whose addition to 1.0 still changes it, which is the mantissa
width the hardware really gave that declaration. Ten bits is fp16 and proves
the qualifier arrived; twenty-three means nothing on that path narrowed the
value, so there was no fp16 arithmetic for the timing to find. SwiftShader
measures 23 bits for `mediump`, which is the known-correct answer and what
validates the probe.

The probe deliberately contains no subtraction. Asking the obvious way --
compute `(1.0 + e) - 1.0` and see whether it is zero -- does not survive a real
shader compiler: fast-math is on by default and folds `(a + b) - a` back to
`b`, which answers the question with the input instead of the result. An iPhone
running that version reported every precision as having more mantissa bits than
fp32 has. Instead the sum is widened, scaled by 2^k and taken mod 2, which is
non-linear and cannot be reassociated away: a bit that survived the add makes an
odd integer, one that was rounded off makes an even one. The arithmetic is
checked against a binary16 reference (fp16 gives 10, fp32 gives 23), and the
page refuses to report anything if its own `highp` row comes out below 20 bits,
since that can only mean the measurement is being optimised away rather than
performed.

Two caveats on the probe. A driver is allowed to evaluate at higher precision
than declared, so a wide reading says the arithmetic was wide, not that the
hardware lacks fp16. And a browser's shader translator sits between the source
and the driver: iOS Safari reaches the GPU through ANGLE's Metal backend, so a
wide reading there is a statement about that pipeline, not about the chip.

The file is written for the Claude Artifact runtime, which supplies the
`<!doctype>`, `<html>`, `<head>` and `<body>` around it along with a viewport
meta — so serve it wrapped in those if you want to host it yourself.
