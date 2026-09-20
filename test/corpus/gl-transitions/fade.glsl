// gl-transitions 1.71.0: fade by gre, license MIT
// Author: gre
// License: MIT

vec4 transition (vec2 uv) {
  return mix(
    getFromColor(uv),
    getToColor(uv),
    progress
  );
}
