#version 300 es
// A forward declaration makes the minifier reorder functions; the alternative definitions
// under #ifdef must stay in their blocks, and what they call must come before them.
precision highp float;
#define TRI
uniform float u;
out vec4 o;
float tri(float x){ return abs(fract(x) - .5); }
float noise(vec2 p);
#ifdef TRI
float noise(vec2 p){ return tri(p.x) + tri(p.y); }
#else
float noise(vec2 p){ return sin(p.x) * sin(p.y); }
#endif
float layer(vec2 p){ return noise(p) + noise(p * 2.) * .5; }
void main(){
  vec2 p = gl_FragCoord.xy / 48. * 3. + u * .001;
  o = vec4(fract(layer(p) * vec3(.3, .5, .7)), 1.);
}
