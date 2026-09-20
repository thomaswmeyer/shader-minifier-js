#version 300 es
// A global always passed as the first argument of a function whose second parameter has the
// global's name. Upstream's argument inlining declared `float t=uT;` in that body.
precision highp float;
uniform float uT;
out vec4 o;
float flow(float t, float uT){ float s = 0.; for (int i = 0; i < 2; i++) s += t * uT; return s; }
void main(){ o = vec4(fract((flow(uT, 2.) + flow(uT, 3.)) * vec3(.1, .2, .3)), 1.); }
