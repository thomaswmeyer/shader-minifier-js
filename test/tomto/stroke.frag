#version 300 es
precision highp float;
in vec2 vL; in float vLen; in float vHW; in float vNav; in float vHov; in float vBl;
out vec4 frag;
void main(){
  float pp = vL.x, al = vL.y, ay = clamp(al, 0., vLen);
  float d = length(vec2(pp, al - ay)) - vHW;
  // nav-label particles get a somewhat tighter edge and reduced bleed halo, so
  // small text reads crisper than the wordmark's watercolor look; a hovered
  // label's ink runs fuller and darker. Both distances follow the brush (vBl),
  // with the edge held to most of a pixel so small strokes stay antialiased.
  float e = max(.7, vBl);
  float ink = 1. - smoothstep((-1. + vNav * .3) * e, (1.4 - vNav * .4) * e, d);
  float bl = (1. - smoothstep(0., mix(4.5, 3.15, vNav) * vBl, max(d, 0.))) * .16 * (1. - vNav * .35);
  float a = clamp(ink * (1. + vHov * .35) + bl, 0., 1.) * (.9 + vHov * .1);
  if (a <= .002) discard;
  frag = vec4(a);
}