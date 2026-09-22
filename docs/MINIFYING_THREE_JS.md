# Minifying a three.js app's shaders

three.js does not ship the shaders it runs. It ships 142 chunks and 18 material
templates, and assembles a program in the browser out of the chunks, a prefix of
`#define`s decided by the material and the lights in the scene, and its own
`#include` and `unroll_loop` passes. The text the driver compiles exists only
once the page has run.

That has two consequences for a minifier. Nothing useful can be done to the
chunk library on disk — 100 of the 142 chunks are fragments rather than whole
shaders, so most of them will not parse on their own. And the programs that do
exist at runtime are enormous, because every chunk a material asks for is
inlined into both stages of every permutation of it.

`npm run three:precompile` captures those assembled programs from a running page
and minifies them with their `#define`s already decided.

## What it measures

The demo scene in `scripts/three/` — a standard-material plane, a textured torus
knot, a physical-material sphere with clearcoat and a normal map, a basic-material
box, a 900-point cloud, fog, a shadow-casting directional light and a point light
— links six programs:

| program | vertex | fragment | minified vertex | minified fragment |
|---|--:|--:|--:|--:|
| 0 | 19,601 | 78,865 | 885 | 4,888 |
| 1 | 19,687 | 78,906 | 1,077 | 5,035 |
| 2 | 19,700 | 78,962 | 987 | 6,209 |
| 3 | 17,773 | 13,484 | 327 | 822 |
| 4 | 7,978 | 8,740 | 426 | 706 |
| 5 | 14,844 | 12,580 | 343 | 328 |

```
raw    371,131 -> 22,044  (94% smaller)
brotli  18,535 ->  3,248  (82% smaller)
```

The raw figure is large because a resolved permutation carries every chunk it
pulled in, most of which the decided `#define`s have already switched off. What
matters for a download is the brotli column, and that one is not an artifact of
repetition: 18.5 KB to 3.2 KB is the port's ordinary engine-shader result,
applied to a shader an engine only produces at runtime.

The set is worth comparing against what three.js ships to build it with:

| | raw | brotli |
|---|--:|--:|
| `ShaderChunk` + `ShaderLib` (three 0.186.0) | 184,789 | 21,785 |
| the six precompiled programs | 22,044 | 3,248 |
| the whole unminified ESM build, for scale | 2,120,848 | 307,692 |

So the shader source is about 7% of a three.js bundle after brotli, and a scene
that only ever needs these six permutations could carry them for 3.2 KB instead
of 21.8 KB. That is the ceiling. Realising it means also dropping the chunk
library from the bundle, which this repository does not do — see
[what is missing](#what-is-missing-for-a-real-build-step).

## Running it

```sh
npm install --no-save three          # only for the bundled demo scene
npm run three:precompile             # capture, minify, measure, verify
npm run three:precompile -- --url http://localhost:5173/ --out build/shaders
```

With no `--url` it serves this repository, opens `scripts/three/demo.html`,
and then verifies itself: it reloads the page, swaps every captured shader for
its minified twin on the way to the driver, and compares the two pictures pixel
by pixel. That check currently reports 0 of 76,800 pixels different.

With `--url` it captures your own page instead. It still measures, but it does
not verify, because verification needs the page to draw the same thing twice.
`--out` writes `programs.json`, a list of `{ vert, frag }` in link order.

It needs Playwright's Chromium; `CHROMIUM_EXECUTABLE` points it at another
binary.

## How the capture works

`scripts/three/inject.js` is installed before any of the page's own script runs
and patches two methods on both `WebGLRenderingContext` and
`WebGL2RenderingContext`:

- `linkProgram`, to record the pair of shader sources going into each program
  (read back with `getAttachedShaders` and `getShaderSource`, so it sees the
  final text whatever produced it);
- `shaderSource`, to substitute a replacement for a source it recognises.

The hook is always installed and holds an empty substitution table until it is
armed, because a renderer takes its context on construction — installing the
hook after that is too late, and a second canvas is needed for the verification
pass so it gets a fresh context rather than the first renderer's.

Capturing at `linkProgram` rather than at `shaderSource` matters: it is after
three.js has resolved its includes, unrolled its loops and prepended its prefix,
so what comes out is exactly the text the driver sees. Nothing in it is
three.js-specific, so the same script captures any WebGL page.

`renderer.compile( scene, camera )` links the main programs, but the
shadow-depth programs are only linked by an actual `render()`, so the demo does
both.

## How the minification is configured

All programs of a run go through one `Minifier`, and each program's two stages
go through it as one unit:

```ts
const options = { ...pluginOptions(), preprocess: true };
const run = new Minifier(options, [["program0.vert", vert], ["program0.frag", frag]]);
```

- `preserveExternals` (from `pluginOptions`) keeps uniform, attribute and
  varying names, because the renderer binds them by name at runtime.
- Both stages in one run means the varyings they share are renamed the same way
  on both sides.
- `preprocess: true` decides every `#if`. This is the one case where that is
  unambiguously right: the `#define`s are already baked into the prefix
  three.js prepended, so there is exactly one branch left and no runtime
  `#define` can change it. For a shader an engine ships with its `#if` chains
  still open, the port's default of keeping them is the correct behaviour, and
  is most of what distinguishes it from the alternatives.

## What is missing for a real build step

What exists is the measurement and the proof that the substitution is
pixel-exact. A build step that shipped the result would need three more things,
none of which is here:

1. **A runtime that installs the table.** The substitution has to happen at
   `gl.shaderSource`, the last moment before compilation. `onBeforeCompile` is
   not an alternative: it runs before `resolveIncludes`, `unrollLoops` and the
   prefix, so a program substituted there would have three.js's prefix prepended
   to a shader that already contains it. The practical shape is a hash of the
   final source text mapped to its minified twin, with a miss falling through to
   the original — correct but unminified — rather than failing.

2. **Permutation coverage.** The capture only sees what the page drew. A
   material that first appears on a click, a light added later, a
   `customProgramCacheKey` that varies: each is a permutation that was never
   captured and will miss. A build step needs the app to exercise its states
   during capture, and needs the miss path above to stay safe when it does not.

3. **Dropping the chunk library.** Until `ShaderChunk` and `ShaderLib` stop
   being bundled, the precompiled programs are 3.2 KB of brotli *added* to the
   21.8 KB already there. Removing them is only sound for an app that provably
   never needs another permutation, which is the same closed-world assumption as
   point 2 and needs a bundler plugin to act on.

Until then this is a measurement tool: it tells you what the shaders in your
three.js app would cost if they were minified, and it proves the minified ones
draw the same picture.

## Related

- [BENCHMARKS.md](BENCHMARKS.md) — the size tables across all seven corpora,
  including the three.js shaders as the engine ships them.
- [The README](../README.md) — the CLI, the library and the Vite plugin.
