# A generated name can collide with a preserved external declared later

The output does not compile.

Reproduced against Shader Minifier at commit 9653515 (`--version` reports 1.5.1),
built from source with the .NET 8 SDK.

## Command

```sh
shader_minifier --preserve-externals --format text -o out.frag preserved-names.frag
```

## Input (`preserved-names.frag`)

```glsl
precision highp float;
uniform float u;
const float a=sqrt(2.),b=sqrt(3.),c=sqrt(5.),d=sqrt(7.),e=sqrt(11.);
const float f=a+b,g=c+d,h=e+f,i=g+h,j=h+i,k=i+j,l=j+k,m=k+l,n=l+m;
out vec4 o;
void main(){vec2 p=gl_FragCoord.xy/48.;o=vec4(fract(p.x*a+p.y*b+c*d+e*u),fract(f+g+h+i),fract(j+k+l+m+n),1);}
```

## Output

```glsl
precision highp float;uniform float u;const float s=sqrt(2.),f=sqrt(3.),g=sqrt(5.),o=sqrt(7.),v=sqrt(11.),C=s+f,F=g+o,Q=v+C,P=F+Q,O=Q+P,N=P+O,M=O+N,t=N+M,K=M+t;out vec4 o;void main(){vec2 d=gl_FragCoord.xy/48.;o=vec4(fract(d.x*s+d.y*f+g*o+v*u),fract(C+F+Q+P),fract(O+N+M+t+K),1);}
```

## Why this is wrong

A `const float` is renamed to `o` while `out vec4 o;`, declared further down and preserved by the flag, keeps that name. The output declares `o` twice, with different types.

## Where it comes from

`Minifier/renamer.fs:523` takes the forbidden names from the shader, then hands out names as declarations are reached; an external preserved by the flag is marked used only when its own declaration is renamed.

## How this was found

While porting Shader Minifier to TypeScript ([shader-minifier-js]), checking the
port against this project's own test corpus and against shaders taken from
three.js, Babylon.js, PlayCanvas, CesiumJS and gl-transitions, rendered in a
browser and compared pixel by pixel with the originals. The port carries a fix
for this case; the repository records what it changed and why, and the shader
above is reduced from the case that first showed it.

[shader-minifier-js]: https://github.com/thomaswmeyer/shader-minifier-js
