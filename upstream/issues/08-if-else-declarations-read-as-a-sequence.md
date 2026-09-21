# A name declared in both branches of an #if binds to the last declaration alone

The output compiles but does not do what the source does.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --no-renaming --format text -o out.frag both-branches.frag
```

## Input (`both-branches.frag`)

```glsl
precision highp float;
uniform float u;
void main(){
#ifdef AA
float n=1.;
#else
float n=3.;
#endif
gl_FragColor=vec4(n*u);}
```

## Output

```glsl
precision highp float;uniform float u;void main(){
#ifdef AA

#else

#endif
gl_FragColor=vec4(3.*u);}
```

## Why this is wrong

`#ifdef AA float n=1.; #else float n=3.; #endif` is read as one flat list, so both branches are emptied and `n` is inlined as `3.` unconditionally. Under `#define AA` the shader now computes with 3. where the source says 1.

## Where it comes from

Statement lists are folded without regard to `#if`, so two alternative declarations of one name are read as a redeclaration.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
