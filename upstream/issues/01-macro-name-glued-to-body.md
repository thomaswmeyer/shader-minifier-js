# A tab after a macro name is dropped, gluing the name to the body

The output does not compile.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --no-renaming --format text -o out.frag macro-tab.frag
```

## Input (`macro-tab.frag`)

```glsl
precision highp float;
#define RE	vec4(1)
void main(){gl_FragColor=RE;}
```

## Output

```glsl
precision highp float;
#define REvec4(1)
void main(){gl_FragColor=RE;}
```

## Why this is wrong

`#define RE	vec4(1)` becomes `#define REvec4(1)`: the macro RE is no longer defined, and the `RE` in the body refers to nothing.

## Where it comes from

`Minifier/printer.fs` prints a kept directive with `directiveToS` (used at lines 288 and 313); the name and the body are rejoined there.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
