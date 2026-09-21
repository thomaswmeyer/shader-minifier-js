# A function used only from a kept #define is removed, and the names in it renamed

The output does not compile.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --format text -o out.frag define-uses.frag
```

## Input (`define-uses.frag`)

```glsl
precision highp float;
uniform float u;
float helper(float x){return x*2.;}
#define CALL helper(u)
void main(){gl_FragColor=vec4(CALL);}
```

## Output

```glsl
precision highp float;uniform float f;
#define CALL helper(u)
void main(){gl_FragColor=vec4(CALL);}
```

## Why this is wrong

`#define CALL helper(u)` survives verbatim while `helper` is removed as unused and `u` is renamed to `f`. Expanding CALL then names a function and a variable that the output does not declare.

## Where it comes from

`Minifier/rewriter.fs:925` `removeUnusedFunctions` and `isUnused` (line 927) count calls from `n.callSites`, which `Analyzer.findFuncInfos` collects from function bodies. `Minifier/renamer.fs` renames on the same information.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
