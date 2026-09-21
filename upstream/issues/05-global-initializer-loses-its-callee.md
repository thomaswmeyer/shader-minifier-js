# A function called only from a global's initializer is removed as unused

The output does not compile.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --no-renaming --format text -o out.frag global-from-call.frag
```

## Input (`global-from-call.frag`)

```glsl
precision highp float;
float f(){return 2.;}
float g=f();
void main(){gl_FragColor=vec4(g);}
```

## Output

```glsl
precision highp float;float g=f();void main(){gl_FragColor=vec4(g);}
```

## Why this is wrong

`float g=f();` keeps its call while `float f()` is removed, so the output calls a function it does not declare.

## Where it comes from

`Minifier/rewriter.fs:927` `isUnused` asks only `n.callSites` (calls inside function bodies), so a call in a global's initializer is not one.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
