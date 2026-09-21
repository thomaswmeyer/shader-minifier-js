# A local's initializer is merged into a call that passes it as an inout argument

The output does not compile.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --no-renaming --no-inlining --format text -o out.frag inout-lvalue.frag
```

## Input (`inout-lvalue.frag`)

```glsl
precision highp float;
uniform vec3 u;
vec3 f(inout vec3 x,vec3 y){return y*2.;}
void main(){vec3 v=vec3(0);v=f(v,u);gl_FragColor=vec4(v,1);}
```

## Output

```glsl
precision highp float;uniform vec3 u;vec3 f(inout vec3 x,vec3 y){return y*2.;}void main(){vec3 v=f(vec3(0),u);gl_FragColor=vec4(v,1);}
```

## Why this is wrong

`vec3 v=vec3(0);v=f(v,u);` becomes `vec3 v=f(vec3(0),u);`, passing a constructor to an `inout` parameter. GLSL requires an l-value there, so the output does not compile.

## Where it comes from

`Minifier/rewriter.fs:798`, the branch that logs `merge assignment with preceding local declaration`, and the sibling rule at line 780.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
