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
Each is rendered into a 512×512 offscreen target, with a one-pixel `readPixels`
to force the driver to finish inside the timed window, for five rounds that
alternate the two precisions so thermal throttling moves both columns together.
The page reports the median of each and the raw rounds behind it.

The file is written for the Claude Artifact runtime, which supplies the
`<!doctype>`, `<html>`, `<head>` and `<body>` around it along with a viewport
meta — so serve it wrapped in those if you want to host it yourself.
