#version 300 es
// A transform-feedback vertex shader that never writes gl_Position: --drop-default-precision
// must not take it for a fragment shader.
precision highp float;
precision mediump int;
in vec2 p; in int k;
uniform float u;
out vec2 q; flat out int m;
void main(){ q = p * 2. + u; m = k * 3; }
