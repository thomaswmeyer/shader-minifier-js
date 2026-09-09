#version 300 es
in vec2 iPos; in vec2 iVel; in float iAng; in vec2 iHome; in float iSeed; in vec3 iAux;
uniform float uT, uSeek, uAmp, uBrz, uAct, uJit, uDtn, uFleeR, uFleeF;
uniform vec2 uPtr, uGust;
out vec2 vPos; out vec2 vVel; out float vAng;
// the rest state (P.SEEK, P.REST_AMP): nav particles never leave it
const float SEEK_N = .011, AMP_N = .013, DAMP = .9;
// nav stroke scale is size/44; the breeze is tuned against the hero's 84px
const float NAV_BRZ = 44. / 84.;
float h(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float flow(vec2 p, float t){ return sin(p.x*.006 + t*.30) + cos(p.y*.006 - t*.24) + .5*sin((p.x+p.y)*.004 + t*.18); }
void main(){
  vec2 pos = iPos, vel = iVel;
  vel += (iHome - pos) * mix(uSeek, SEEK_N, iAux.x) * (1. + iAux.z * 13.) * uDtn;
  float a = flow(pos, uT) * 3.14159265;
  vec2 fd = vec2(cos(a), sin(a));
  // breeze scales with glyph size: word particles use the instance factor,
  // nav particles derive theirs from their stroke scale
  vel += fd * mix(uAmp * uBrz, AMP_N * iAux.y * NAV_BRZ, iAux.x) * uDtn;
  if (uAct > .5 && iAux.x < .5) {
    vec2 dv = pos - uPtr; float d2 = dot(dv, dv);
    if (d2 < uFleeR * uFleeR && d2 > .01) {
      float d = sqrt(d2), f = 1. - d / uFleeR; f = f * f * uFleeF;
      vec2 n = dv / d;
      // pushed straight out and swirled sideways in equal measure
      vel += (n + vec2(-n.y, n.x)) * f * uDtn;
    }
  }
  vel += (uGust + (vec2(h(iSeed*13.1), h(iSeed*7.7)) * 2. - 1.) * uJit) * (1. - iAux.x);
  // hovered nav particles damp harder than the rest state, but deliberately a
  // touch under the critical point for the boosted seek: a visible overshoot
  // on hover reads as "these are particles", then settles without ringing
  vel *= pow(DAMP - iAux.z * .12, uDtn);
  pos += vel * uDtn;
  float s = length(vel);
  vec2 vd = s > 1e-4 ? vel / s : fd;
  vec2 dir = mix(fd, vd, clamp((s - .05) / .35, 0., 1.));
  float tg = atan(dir.y, dir.x);
  vAng = iAng + atan(sin(tg - iAng), cos(tg - iAng)) * min(.15 * uDtn, 1.);
  vPos = pos; vVel = vel;
  gl_Position = vec4(0);
}