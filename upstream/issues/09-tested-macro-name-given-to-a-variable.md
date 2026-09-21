# A macro the shader tests but never defines can be handed out as a variable name

The output compiles but does not do what the source does.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --format text -o out.frag tested-macro.frag
```

## Input (`tested-macro.frag`)

```glsl
precision highp float;
uniform float a;
#ifdef X
uniform float b;
#endif
void main(){
#ifdef X
gl_FragColor=vec4(a+b);
#else
gl_FragColor=vec4(a);
#endif
}
```

## Output

```glsl
precision highp float;uniform float f;
#ifdef X
uniform float X;
#endif
void main(){
#ifdef X
gl_FragColor=vec4(f+X);
#else
gl_FragColor=vec4(f);
#endif
}
```

## Why this is wrong

A uniform declared under `#ifdef X` is renamed to `X`, producing `uniform float X;` inside `#ifdef X`. An application that defines X to select that branch turns the declaration into `uniform float ;`.

## Where it comes from

`Minifier/renamer.fs:523` builds `forbiddenNames` from the shader's own `#define`s; a macro that is only tested is never added.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
