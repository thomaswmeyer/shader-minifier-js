#version 300 es
in vec2 aCorner; in vec2 iPos; in vec2 iVel; in float iAng; in float iSeed; in vec3 iAux;
uniform vec2 uRes; uniform float uSc;
out vec2 vL; out float vLen; out float vHW; out float vNav; out float vHov; out float vBl;
void main(){
  // iAux.y < 0 withholds this particle from the draw: the flock is allocated
  // for the largest form the mark ever takes, and thins as it shrinks so the
  // ink density per letterform stays put (see wordThin below). The quad is
  // placed wholly outside clip space, so no fragment ever reads its varyings.
  if (iAux.y < 0.) { gl_Position = vec4(2, 2, 2, 1); return; }
  float sc = iAux.y > 0. ? iAux.y : uSc;
  vNav = iAux.x; vHov = iAux.z;
  // How wet the brush is, relative to the hero wordmark's 0.6. The bleed halo
  // and the soft edge below are absolute pixel distances, so without this a
  // wordmark that shrinks as it docks keeps a full-size halo on quarter-size
  // strokes and floods into a smudge. Nav labels are already sampled at the
  // size they're drawn, so they keep their tuned look.
  vBl = iAux.x > .5 ? 1. : clamp(sc / .6, .45, 1.);
  // the capsule runs len along the heading from p1; the quad is padded by
  // the brush width plus the halo on every side
  float len = 4. * sc + length(iVel) * 2.6;
  vec2 dir = vec2(cos(iAng), sin(iAng)), p1 = iPos - dir * len * .5;
  float w = 1.2 * sc * (.8 + .4 * iSeed), pad = w + 4.5;
  float al = (aCorner.y * .5 + .5) * (len + 2. * pad) - pad, pp = aCorner.x * pad;
  vec2 wp = p1 + dir * al + vec2(-dir.y, dir.x) * pp;
  vL = vec2(pp, al); vLen = len; vHW = w;
  gl_Position = vec4(wp.x / uRes.x * 2. - 1., 1. - wp.y / uRes.y * 2., 0, 1);
}