# Benchmarks

How big shader-minifier-js's output is next to Shader Minifier's and spglsl's,
over seven corpora of shaders that ship on the web. [The README](../README.md) has
the summary; this is the measurement behind it, what each column means, and how
to run it again.

`npm run metrics` regenerates every table here. It minifies every corpus four
ways and, when `npm install --no-save spglsl` has been run, a fifth. The
columns:

- **Shader Minifier (.NET)**: the original, version 1.5.1. The numbers come
  from this port run with only Shader Minifier's own rewrites, which is what
  the goldens pin; on the tom.to shaders that output matches the .NET binary
  byte for byte.
- **shader-minifier-js**: this repository, with the Vite plugin's defaults, so
  the port additions the README lists are on.
- **js +preprocess**: the same, plus `--preprocess`, so every `#if` the
  file can decide is decided. This is the column comparable with spglsl,
  which always evaluates the preprocessor and so emits a shader for one set
  of defines; shader-minifier-js keeps every `#ifdef` by default, which is a
  different product and what a site ships when its defines arrive at
  runtime. Babylon.js and PlayCanvas run their own preprocessor before the
  driver sees the GLSL, so for them the two columns coincide.
- **spglsl (ANGLE)**: ANGLE's shader translator, built to wasm and run
  offline through the `spglsl` package on one shader at a time with its
  minify and mangle options on. The number is the size of the GLSL text it
  emits, externals kept. It gets the same single source as the other columns
  and no link-time or runtime context, so this is a wire-size comparison,
  not the compile ANGLE does in the browser.
- **js vs .NET**, **preprocessed vs spglsl**: how much smaller
  shader-minifier-js's output is than that column, the spglsl one taken from
  the preprocessed column so that like is compared with like.

The corpora: tom.to is six GLSL ES 3.00 shaders from tom.to's ink mark, a
WebGL2 particle engine, under `test/tomto`; gl-transitions, three.js,
Babylon.js, PlayCanvas and CesiumJS are vendored under `test/corpus`, the
last a globe renderer rather than a game engine, captured from a running
scene since a Cesium shader as written is not a whole shader; the Shadertoy
row is the eight Shadertoy shaders in Shader Minifier's own test corpus
under `tests/real`, each wrapped in a Shadertoy header and `main()`.

A minifier that refuses any shader of a corpus gets no total for that
corpus, only the count of refusals, and its comparison cell stays blank; a
total over fewer shaders would read as a smaller size. Five PlayCanvas
shaders declare a function parameter through a macro, which Shader Minifier
itself cannot parse without `--expand-macros`; the port keeps such a
function as text, so its column has a total there. ANGLE rejects two Shadertoy
shaders, one for a byte order mark at the top of the file and one for a
`texture` overload it does not have; WebGL rejects both as well, and the
pixel test skips them for the same reason.

Output bytes, externals kept in all of them; three.js runs with
`--preprocess`:

| corpus | shaders | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | js +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 6 | 5,381 | 2,438 | 2,377 | 2.5% | 2,377 | 2,484 | 4.3% |
| gl-transitions | 125 | 169,066 | 69,437 | 67,540 | 2.7% | 67,474 | 79,689 | 15.3% |
| three.js | 56 | 1,337,454 | 216,862 | 128,805 | 40.6% | 128,805 | 143,890 | 10.5% |
| Babylon.js | 18 | 276,701 | 96,080 | 46,033 | 52.1% | 46,033 | 59,928 | 23.2% |
| PlayCanvas | 20 | 191,012 | 95,794 | 48,217 | 49.7% | 48,217 | 60,037 | 19.7% |
| CesiumJS | 32 | 174,106 | 70,825 | 67,094 | 5.3% | 38,102 | 43,750 | 12.9% |
| Shadertoy (Shader Minifier tests) | 8 | 99,447 | 44,521 | 43,820 | 1.6% | 42,265 | 2 refused |  |

Shaders ship compressed, so the same corpora after compression. Two
variables: the codec (brotli -q 11 is what a CDN serves, gzip -9 what an
older server gives; they differ mainly in window size) and the unit.
Compressing a corpus as one blob lets each shader compress against its
near-twins. The engines never ship that way: three.js assembles its programs
from chunks in the browser, and a shader in a real bundle sits far from any
twin. The per-shader table is the one to judge by; the blob is an upper
bound.

| corpus | minified raw | each alone | as one blob | of the compression, cross-shader |
|---|--:|--:|--:|--:|
| tom.to | 2,377 | 1,593 | 1,090 | 32% |
| gl-transitions | 67,540 | 35,746 | 13,988 | 61% |
| three.js | 128,805 | 42,976 | 12,413 | 71% |
| Babylon.js | 46,033 | 15,277 | 5,941 | 61% |
| PlayCanvas | 48,217 | 17,883 | 5,131 | 71% |
| CesiumJS | 67,094 | 22,594 | 11,172 | 51% |

**brotli -q 11, each shader on its own**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | js +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,755 | 1,620 | 1,593 | 1.7% | 1,593 | 1,621 | 1.7% |
| gl-transitions | 67,081 | 36,674 | 35,746 | 2.5% | 35,633 | 39,307 | 9.3% |
| three.js | 269,870 | 68,561 | 42,976 | 37.3% | 42,976 | 46,531 | 7.6% |
| Babylon.js | 67,148 | 29,953 | 15,277 | 49.0% | 15,277 | 17,418 | 12.3% |
| PlayCanvas | 47,336 | 29,690 | 17,883 | 39.8% | 17,883 | 20,615 | 13.3% |
| CesiumJS | 38,439 | 23,800 | 22,594 | 5.1% | 14,709 | 16,507 | 10.9% |
| Shadertoy (Shader Minifier tests) | 30,115 | 17,330 | 16,955 | 2.2% | 16,414 | 2 refused |  |

**brotli -q 11, whole corpus as one blob**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | js +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,167 | 1,114 | 1,090 | 2.2% | 1,090 | 1,132 | 3.7% |
| gl-transitions | 29,088 | 14,350 | 13,988 | 2.5% | 13,982 | 15,188 | 7.9% |
| three.js | 22,926 | 14,760 | 12,413 | 15.9% | 12,413 | 13,713 | 9.5% |
| Babylon.js | 15,744 | 9,415 | 5,941 | 36.9% | 5,941 | 7,192 | 17.4% |
| PlayCanvas | 8,444 | 6,541 | 5,131 | 21.6% | 5,131 | 5,254 | 2.3% |
| CesiumJS | 17,592 | 11,467 | 11,172 | 2.6% | 6,644 | 7,484 | 11.2% |
| Shadertoy (Shader Minifier tests) | 25,952 | 14,221 | 13,908 | 2.2% | 13,431 | 2 refused |  |

**gzip -9**

| corpus | source | Shader Minifier (.NET) | shader-minifier-js | js vs .NET | js +preprocess | spglsl (ANGLE) | preprocessed vs spglsl |
|---|--:|--:|--:|--:|--:|--:|--:|
| tom.to | 2,458 | 1,179 | 1,158 | 1.8% | 1,158 | 1,213 | 4.5% |
| gl-transitions | 35,330 | 16,460 | 15,978 | 2.9% | 15,950 | 17,470 | 8.7% |
| three.js | 196,245 | 21,300 | 16,797 | 21.1% | 16,797 | 19,536 | 14.0% |
| Babylon.js | 40,713 | 11,772 | 7,050 | 40.1% | 7,050 | 8,901 | 20.8% |
| PlayCanvas | 24,421 | 9,083 | 6,758 | 25.6% | 6,758 | 7,276 | 7.1% |
| CesiumJS | 25,813 | 13,863 | 13,504 | 2.6% | 7,741 | 8,747 | 11.5% |
| Shadertoy (Shader Minifier tests) | 29,728 | 16,042 | 15,701 | 2.1% | 15,158 | 2 refused |  |

The order of the three minifiers is the same under every codec and unit.
The unit changes the margin: shader-minifier-js's win over Shader Minifier
on three.js is 37.3% per shader and 15.9% as a blob, since the blob already
compresses the repeated chunk text. gzip gives slightly larger margins than
brotli. As blobs the engine corpora compress 10 to 58 fold, mostly one
program against another, which makes them useful for finding bugs and a poor
measure of size.

Compared like with like, through the preprocessed column, shader-minifier-js
is smaller than spglsl on every corpus, at every codec and unit. On CesiumJS the difference between the two
shader-minifier-js columns is the point: with every `#if` kept it is 67,094
bytes, with the file's own defines decided 38,102 and the whole of that is
dead preprocessor branches, not rewriting. One caveat about the spglsl
column, which counts against this table rather than against spglsl: the
pixel harness checks shader-minifier-js's output, never spglsl's, so its
number is bytes ANGLE emitted, not bytes verified to render the same.

## Reproducing the comparison by hand

shader-minifier-js, with the Vite plugin's defaults spelled out as flags
(the goldens in `test/tomto/*.expected` are this output):

```sh
npm run build
node bin/shader-minifier.js --format text -O2 --webgl --preserve-externals --no-overloading \
  test/tomto/sim.vert -o /dev/stdout | wc -c
```

spglsl:

```sh
npm install --no-save spglsl
node scripts/minify-with-spglsl.mjs test/tomto/*.vert test/tomto/*.frag
```

Shader Minifier (.NET), from a clone at `../shader-minifier`, built and run
in a .NET 8 SDK container; `--preserve-externals --no-overloading` are the two
flags it shares with the shader-minifier-js command above. On a machine with
the SDK installed, `upstream/README.md` builds it without Docker:

```sh
docker run --rm -v "$PWD/../shader-minifier:/src" -v "$PWD/test/tomto:/glsl" -w /src \
  mcr.microsoft.com/dotnet/sdk:8.0 bash -c '
    dotnet build ShaderMinifier -c Release -nologo -v q &&
    for f in /glsl/*.vert /glsl/*.frag; do
      dotnet artifacts/bin/ShaderMinifier/release/ShaderMinifier.dll \
        --format text --preserve-externals --no-overloading "$f" -o /tmp/out.glsl
      printf "%s %s\n" "$(basename "$f")" "$(wc -c < /tmp/out.glsl)"
    done'
```

A pull that hangs under Docker Desktop on macOS is waiting on the keychain
credential helper; point `DOCKER_CONFIG` at a directory whose `config.json`
is `{}`.
