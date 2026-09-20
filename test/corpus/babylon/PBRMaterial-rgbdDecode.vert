#version 300 es
#define WEBGL2 
#define SHADER_NAME vertex:postprocess
precision highp float;
in vec2 position;
uniform vec2 scale;
out vec2 vUV;
const vec2 madd=vec2(0.5,0.5);
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vUV=(position*madd+madd)*scale;
gl_Position=vec4(position,0.0,1.0);
#define CUSTOM_VERTEX_MAIN_END
}
