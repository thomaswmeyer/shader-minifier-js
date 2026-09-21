# Function reordering lifts both branches of an #ifdef out, defining the function twice

The output does not compile.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --no-renaming --format text -o out.frag reorder-alternatives.frag
```

## Input (`reorder-alternatives.frag`)

```glsl
precision highp float;
uniform float u;
float g(float x);
#ifdef A
float g(float x){return x*2.;}
#else
float g(float x){return x*3.;}
#endif
void main(){gl_FragColor=vec4(g(u));}
```

## Output

```glsl
precision highp float;uniform float u;
#ifdef A
#else
#endif
float g(float x){return x*2.;}float g(float x){return x*3.;}void main(){gl_FragColor=vec4(g(u));}
```

## Why this is wrong

With a forward declaration present, both `#ifdef A` and `#else` definitions of `g` are pulled out of the region and emitted one after the other, so the output defines `g` twice and the `#ifdef` is left empty.

## Where it comes from

`Minifier/rewriter.fs:993` `reorderFunctions` and `graphReorder` (line 997) run over `findFuncInfos code`, a flat list of every function in the file.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
