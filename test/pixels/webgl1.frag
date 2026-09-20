// An ES 1.00 fragment shader: varyings, gl_FragColor, texture2D, and the WebGL1 path of the harness.
precision mediump float;
varying vec2 vUv;
varying float vFade;
uniform float u;
uniform sampler2D tex;
#define PI 3.14159265
void main(){
  vec2 p = vUv * 2. - 1.;
  float r = length(p);
  float a = atan(p.y, p.x) / PI;
  vec4 t = texture2D(tex, vUv);
  if (r > .9) { gl_FragColor = vec4(t.rgb * vFade, 1.); return; }
  gl_FragColor = vec4(fract(r * 3. + u * .001), fract(a + .5), t.r * vFade, 1.);
}
