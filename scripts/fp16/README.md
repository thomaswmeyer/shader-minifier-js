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
chain in `vec4`, and a `sin`/`cos` chain), each an unrolled 64-iteration
dependent loop seeded from `gl_FragCoord` and a uniform so nothing folds away.
Every program is compiled and drawn several times before any timing starts,
because drivers finish specialising a shader on its first real draw. Each pass
then renders into a 512×512 offscreen target enough times to take about 60ms
and reads one pixel back, which is what forces the driver to finish inside the
timed window; both precisions of a workload always do the same number of draws.

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

The file is written for the Claude Artifact runtime, which supplies the
`<!doctype>`, `<html>`, `<head>` and `<body>` around it along with a viewport
meta — so serve it wrapped in those if you want to host it yourself.
