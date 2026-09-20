#version 300 es
// Object-like and function-like macros that --expand-macros folds away.
precision highp float;
#define SCALE 3.
#define SQ(x) ((x) * (x))
#define ADD(a, b) ((a) + (b))
#define TWICE(a) ADD(a, a)
uniform float u;
out vec4 o;
void main(){
  vec2 p = gl_FragCoord.xy / 48. * SCALE;
  float s = SQ(SQ(p.x)) + TWICE(p.y) + ADD(vec2(1., 2.), vec2(3., 4.)).y;
  o = vec4(fract(s * vec3(.1, .2, .3) + u * .001), 1.);
}
