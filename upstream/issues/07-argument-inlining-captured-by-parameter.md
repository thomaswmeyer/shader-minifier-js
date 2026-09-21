# Argument inlining moves a global into a body where a parameter has its name

The output compiles but does not do what the source does.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --format text -o out.frag shadow-param.frag
```

## Input (`shadow-param.frag`)

```glsl
precision highp float;
uniform float uT;
float flow(float t,float uT){float s=0.;for(int i=0;i<2;i++)s+=t*uT;return s;}
void main(){gl_FragColor=vec4(fract(flow(uT,2.)+flow(uT,3.)));}
```

## Output

```glsl
precision highp float;uniform float f;float h(float f){float h=f,m=0.;for(int r=0;r<2;r++)m+=h*f;return m;}void main(){gl_FragColor=vec4(fract(h(2.)+h(3.)));}
```

## Why this is wrong

The global passed as the first argument is substituted into the body, where the second parameter is also called `uT` and shadows it. The body then reads the parameter instead of the global and the shader computes a different value.

## Where it comes from

`Minifier/inlining.fs:313`, the branch that logs `inlining expression ... into argument ...`.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
