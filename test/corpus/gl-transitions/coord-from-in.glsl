// gl-transitions 1.71.0: coord-from-in by haiyoucuv, license MIT
// Author: haiyoucuv
// License: MIT

vec4 transition (vec2 uv) {

  vec4 coordTo = getToColor(uv);
  vec4 coordFrom = getFromColor(uv);

  return mix(
    getFromColor(mix(uv, coordTo.rg, progress)),
    getToColor(mix(coordFrom.rg, uv, progress)),
    progress
  );

}
