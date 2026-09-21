# Findings to offer upstream

Twelve bugs in [Shader Minifier], the project this one is a port of, each with a
minimal shader, the output upstream actually produces, and a pointer into the F#.
Nothing here has been filed yet.

`PORTING.md` section 5.2 is the full record of where the port deviates and why.
This directory is the subset that looks like a bug rather than a decision, cut
down to something a maintainer can read in a minute and check in two.

## What is here

| | file | what goes wrong |
|---|---|---|
| **The output does not compile** ||
| 01 | `issues/01-macro-name-glued-to-body.md` | a tab after a macro name is dropped: `#define RE\tvec4(1)` becomes `#define REvec4(1)` |
| 02 | `issues/02-kept-define-loses-its-callee.md` | a function used only from a kept `#define` is removed, and the names in it renamed |
| 03 | `issues/03-forward-declared-alternatives-emitted-twice.md` | both branches of an `#ifdef` are lifted out, defining the function twice |
| 04 | `issues/04-generated-name-collides-with-later-external.md` | a generated name takes the name of a preserved external declared further down |
| 05 | `issues/05-global-initializer-loses-its-callee.md` | a function called only from a global's initializer is removed as unused |
| 06 | `issues/06-initializer-merged-into-inout-argument.md` | a local's initializer is merged into a call that passes it as `inout` |
| **The output compiles and computes something else** ||
| 07 | `issues/07-argument-inlining-captured-by-parameter.md` | a global is inlined into a body where a parameter has its name |
| 08 | `issues/08-if-else-declarations-read-as-a-sequence.md` | a name declared in both branches of an `#if` binds to the second alone |
| 09 | `issues/09-tested-macro-name-given-to-a-variable.md` | `uniform float X;` generated inside `#ifdef X` |
| 10 | `issues/10-literals-below-5e-17-print-as-zero.md` | `max(u,1e-20)` becomes `max(u,0.)` |
| 11 | `issues/11-external-struct-fields-renamed.md` | `--preserve-externals` keeps `light` but renames `light.direction` |
| **The file is refused** ||
| 12 | `issues/12-swizzle-like-struct-field-refused.md` | a struct field named `q` is rejected |

## Suggested order

One issue at a time, newest first from the top of that table, and not all at
once: the first six are the ones where a shader that worked stops compiling, and
they stand on their own. The rest are worth filing once those have found an
owner. A patch is easy to offer for most of them, but none is offered unasked;
the reports say where the code is and leave the fix to the people who maintain it.

Three deviations in `PORTING.md` are deliberately **not** here, because they are
choices rather than defects, and upstream may well have made them on purpose:
decimal folding of float operators (item 33), reassociating floating-point
addition (item 38), and resolving overloads by argument type (item 48). Five more
are code shapes that look unsafe but that no input has been made to break from
upstream's own flags (items 14, 15, 18, 40, 42); they stay unfiled until there is
a shader to show.

## Re-checking a report

The outputs in `actual/` were produced by upstream itself. To reproduce them:

```sh
git clone https://github.com/laurentlb/Shader_Minifier.git
cd Shader_Minifier && git checkout $(cat ../tests/UPSTREAM)
dotnet build ShaderMinifier/ShaderMinifier.fsproj -c Release
cd .. && npm run upstream:verify -- Shader_Minifier/artifacts/bin/ShaderMinifier/release/ShaderMinifier.dll
```

The script runs every shader in `repro/` with that report's flags, rewrites
`actual/`, and prints any case whose output has changed since it was recorded,
which is what happens when one of these is fixed. It needs a .NET 8 SDK and is
not part of the test suite: this repository does not depend on upstream building.

[Shader Minifier]: https://github.com/laurentlb/Shader_Minifier
