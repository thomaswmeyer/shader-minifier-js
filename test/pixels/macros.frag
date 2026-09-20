#version 300 es
// Object-like and function-like macros that --expand-macros folds away, including a call whose
// arguments span lines, and a macro kept for size (DMIN) whose body names locals and a global.
precision highp float;
#define SCALE 3.
#define SQ(x) ((x) * (x))
#define ADD(a, b) ((a) + (b))
#define TWICE(a) ADD(a, a)
#define DMIN(id) if (d < dMin) { dMin = d; idObj = id; }
#define KEEP
uniform float u;
out vec4 o;
int idObj;
void main(){
  vec2 p = gl_FragCoord.xy / 48. * SCALE;
  float s = SQ(SQ(p.x)) + TWICE(p.y) + ADD(
    vec2(1., 2.),
    vec2(3., 4.)
  ).y;
  float dMin = 10., d = p.x;
  DMIN(1);
  d = p.y * .5;
  DMIN(2);
#ifdef KEEP
  s += dMin + float(idObj);
#endif
  o = vec4(fract(s * vec3(.1, .2, .3) + u * .001), 1.);
}
