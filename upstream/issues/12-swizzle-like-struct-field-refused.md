# A struct field named like a swizzle component is refused

The file is refused.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --no-renaming --format text -o out.frag swizzle-field.frag
```

## Input (`swizzle-field.frag`)

```glsl
precision highp float;
struct S{float q;};
uniform float u;
void main(){S s;s.q=u;gl_FragColor=vec4(s.q);}
```

## Output

```glsl
REFUSED: System.Exception: Record field name 'q' is not allowed by Shader Minifier,
```

## Why this is wrong

`struct S{float q;};` is rejected with "Record field name 'q' is not allowed by Shader Minifier". The field name is legal GLSL and appears in real shaders.

## Where it comes from

`Minifier/parse.fs:174` raises the exception.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
