// gl-transitions 1.71.0: x_axis_translation by lizhongjian, license MIT
// Author: lizhongjian
// License: MIT

vec4 transition (vec2 uv) {
  vec2 newUV = uv;
  newUV.x -= progress;
  if(uv.x >= progress)
  {
    return getFromColor(newUV);
  }

  
  return mix(
    getFromColor(uv),
    getToColor(uv),
    progress
  );
}
