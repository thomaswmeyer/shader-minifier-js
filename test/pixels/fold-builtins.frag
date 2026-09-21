#version 300 es
// Builtin calls on literals that --approximate-folds evaluates, mixed into per-pixel math so a
// wrong constant shows up in the image.
precision highp float;
uniform float u;
out vec4 o;
void main(){
  vec2 p = gl_FragCoord.xy / 48.;
  float a = radians(45.) * p.x + degrees(.5) * p.y * .01;
  vec2 n = normalize(vec2(3., 4.)) * p;
  float l = length(vec3(1.)) + dot(vec2(1., 2.), vec2(3., 4.)) * .01;
  float c = clamp(5., 0., 1.) * mix(0., 10., .25) * pow(2., 3.) * .01;
  float m = mod(-1., 3.) + fract(-.5) + step(0., 0.) + sign(-0.) + min(1., 2.) - max(1., 2.);
  float t = 1. / tan(.5 * radians(45.)) + sqrt(2.) + exp(1.) * .1;
  o = vec4(fract(a + n.x + u * .001), fract(n.y + l), fract(c + m + t), 1.);
}
