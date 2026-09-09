#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInk, uPaperTex; uniform vec2 uCRes;
out vec4 frag;
// the ink's colour, how strongly the paper grain shows in it, and the grain
// tile's size in px
const vec3 INK = vec3(23., 19., 13.) / 255.;
const float GRAIN = .34, TILE = 150.;
void main(){
  float cov = texture(uInk, vUv).r;
  float pa = texture(uPaperTex, vUv * uCRes / TILE).r;
  float a = cov * mix(1. - GRAIN, 1., pa);
  frag = vec4(INK * a, a);
}