# shader-minifier-js

A TypeScript port of [Shader Minifier](https://github.com/laurentlb/Shader_Minifier)
(Ctrl-Alt-Test, F#, Apache 2.0): a GLSL/HLSL minifier for size-constrained WebGL
and demoscene shaders. Zero runtime dependencies, Node >= 20, ESM.

The port tracks upstream version 1.5.1 module for module and is validated by
upstream's own golden test corpus: all 96 commands in `tests/commands.txt`
produce byte-identical output. Deliberate deviations are listed in
`PORTING.md` section 5.2 and, where they touch a golden file, `tests/DEVIATIONS.md`.

## CLI

Same flags as upstream, plus the port additions listed below.

```sh
npm run build
node bin/shader-minifier.js --format text -o out.frag in.frag
node bin/shader-minifier.js --help
```

## Library

```ts
import { minify } from "shader-minifier-js";

const { code, exportedNames } = minify(source, { preserveExternals: true, webgl: true });
// or several files, renamed consistently:
const result = minify([{ name: "a.frag", content: a }, { name: "b.vert", content: b }]);
result.format("js"); // any upstream output format: text, indented, c-variables, c-array, js, nasm, rust, json
```

`Minifier`, `parseOptions`, `Ast`, `Printer` and `runParser` are exported for
lower-level use.

## Vite plugin

```ts
// vite.config.ts
import { shaderMinifier } from "shader-minifier-js/vite";

export default { plugins: [shaderMinifier()] };
```

```ts
import frag from "./shader.frag"; // a minified string; `?raw` imports are minified too
```

Files matching `.glsl`, `.frag`, `.vert`, `.vs`, `.fs` are minified at load
time. Defaults are chosen for WebGL: `webgl`, `preserveExternals`,
`noOverloading`, `noPiSubstitution`, `expandMacros` and `foldBuiltins` are on,
so uniform and attribute names are kept, macros and constant builtin calls are
folded away, and the output only uses constructs ANGLE accepts. Every other
upstream flag is available as a camelCased option (`noRenaming`,
`noRenamingList`, `noInlining`, `aggressiveInlining`, `noSequence`,
`noRemoveUnused`, `preprocess`, `moveDeclarations`), `include` overrides the
file pattern, and `options` passes any raw minifier option.

## Port additions

- `--webgl`: skip two upstream rewrites whose output Chrome rejects (`?:` on
  struct values; a void call folded into a comma sequence, an ES 3.00 rule),
  and fail with an error if the output would still contain either.
- `--expand-macros`: expand `#define`s so neither the definitions nor the
  long macro names reach the output (upstream keeps them as feature switches).
  Macros used in `#if` conditions or defined inside `#if` blocks are left alone.
- `--fold-builtins`: evaluate builtin calls on literals (`radians(45.)` →
  `.7853982`, `normalize(vec2(3.,4.))` → `vec2(.6,.8)`) at float32 precision,
  only when the result is shorter.
- `--no-pi-substitution`: keep literals like `3.14159265` instead of
  `acos(-1.)`, which can cost precision under `mediump`.
- Float literals above ~7.9e28 (the .NET `decimal` limit) are accepted.
- Prefix `+`/`-` never merge into `++`/`--` (`-(--a)` prints as `- --a`).

## Development

```sh
npm test                 # goldens, round-trip, re-parse validity, unit tests, vite build
npm run golden [filter]  # golden commands with diffs; --update-golden to regenerate
npm run webgl-page       # writes tests/out/webgl-compile.html; open in Chrome to compile every corpus shader
scripts/sync-tests.sh    # re-vendor tests/ from ../shader-minifier and re-apply tests/DEVIATIONS.md
```

The spglsl corpus test and the WebGL page look for spglsl's shaders in
`../spglsl/project/test/shaders` (or `$SPGLSL_SHADERS`) and skip when absent.
`PORTING.md` has the module map and the porting notes.

## License

Apache-2.0, like upstream; see `LICENSE` and `NOTICE`. The test corpus in
`tests/` is upstream's, under `tests/LICENSE-shader-minifier`.
