#version 300 es
// A global always passed as the same argument, into a body that binds the global's name.
// --inline-single-use once substituted uT for t, so t*uT read the local uT twice.
precision highp float;
uniform float uT;
out vec4 o;
float flow(float t){ float uT = 2.; for (int i = 0; i < 2; i++) uT += t; return t * uT; }
void main(){ o = vec4(fract(flow(uT) * vec3(.1, .2, .3)), 1.); }
