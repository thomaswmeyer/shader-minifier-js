#version 300 es
// A single-use global whose value reads globals that a local in main shadows.
// --inline-single-use once inlined K into main, where (a+b) read the local a.
precision highp float;
uniform float u;
const float a = sqrt(2.), b = sqrt(3.);
const float K = a + b;
out vec4 o;
void main(){
  float a = 2.;
  for (int i = 0; i < 2; i++) a += b * u;
  o = vec4(fract(2. * K * a), fract(K), fract(a), 1.);
}
