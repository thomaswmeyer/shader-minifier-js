# A float literal below ~5e-17 is printed as 0.

The output compiles but does not do what the source does.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --no-renaming --format text -o out.frag tiny-literal.frag
```

## Input (`tiny-literal.frag`)

```glsl
precision highp float;
uniform float u;
void main(){gl_FragColor=vec4(max(u,1e-20),1.24e-27,0.,1.);}
```

## Output

```glsl
precision highp float;uniform float u;void main(){gl_FragColor=vec4(max(u,0.),0.,0,1);}
```

## Why this is wrong

`max(u,1e-20)` becomes `max(u,0.)` and `1.24e-27` becomes `0.`. An epsilon guard or a division by a small constant silently turns into a real zero.

## Where it comes from

`Minifier/printer.fs:89` `floatToS`: `str1` is `a.ToString("#.################")`, sixteen fraction digits, and the shorter of `str1` and `str2` wins.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
