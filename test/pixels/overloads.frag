#version 300 es
// Overloaded functions the analyzer cannot resolve: --webgl types them by their agreeing return
// types and folds the if/return and the block into a ternary and a sequence.
precision highp float;
uniform float u;
out vec4 o;
float g;
float f(float x){ g = x; return x * 2.; }
float f(int x){ g = float(x); return float(x); }
float pick(float c){ for (int i = 0; i < 1; i++) { if (c < .5) return f(c); return f(2); } return 0.; }
void main(){
  vec2 p = gl_FragCoord.xy / 48.;
  float a = p.x;
  for (int i = 0; i < 2; i++) { f(a); a += p.y; }
  o = vec4(fract(pick(p.x) + u * .001), fract(a + g), fract(pick(p.y)), 1.);
}
