# --preserve-externals keeps a uniform's name but renames its struct's fields

The output compiles but does not do what the source does.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --preserve-externals --format text -o out.frag external-struct.frag
```

## Input (`external-struct.frag`)

```glsl
precision highp float;
struct L{vec3 direction;};
uniform L light;
void main(){gl_FragColor=vec4(light.direction,1);}
```

## Output

```glsl
precision highp float;struct C{vec3 i;};uniform C light;void main(){gl_FragColor=vec4(light.i,1);}
```

## Why this is wrong

`uniform L light;` keeps `light`, while `struct L{vec3 direction;}` becomes `struct C{vec3 i;}`. An application looking up `light.direction` no longer finds it.

## Where it comes from

`Minifier/renamer.fs`: `DontRename` (line 74) preserves an external's own name, while struct members go through `memberRenames` (lines 30, 71, 109) independently.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
