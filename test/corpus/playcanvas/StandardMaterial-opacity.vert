#version 300 es

#extension GL_ANGLE_multi_draw : enable
#define attribute in
#define varying out
#define texture2D texture
#define utexture2D texture
#define itexture2D texture
#define GL2
#define VERTEXSHADER
#define TEXTURE_PASS(name) name
#define TEXTURE_ACCEPT(name) sampler2D name
#define TEXTURE_ACCEPT_HIGHP(name) highp sampler2D name
#define CAPS_TEXTURE_FLOAT_FILTERABLE
#define CAPS_TEXTURE_FLOAT_RENDERABLE
#define CAPS_MULTI_DRAW
#define PLATFORM_DESKTOP

#define UV0 true
#define UV0_UNMODIFIED true
#define UV_TRANSFORMS_COUNT 0
#define SCENE_COLORMAP_GAMMA
#define FOG NONE
#define TONEMAP undefined
#define GAMMA SRGB
#define LIGHT_TYPE OMNI
#define SHADOW_TYPE PCF3_32F
#define SHADOW_PASS
#define SHADOWPASS_1_0_PASS


						precision highp float;
						precision highp int;
						precision highp usampler2D;
						precision highp isampler2D;
						precision highp sampler2DShadow;
						precision highp samplerCubeShadow;
						precision highp sampler2DArray;


vec2 getGrabScreenPos(vec4 clipPos) {
	vec2 uv = (clipPos.xy / clipPos.w) * 0.5 + 0.5;
	return uv;
}
vec2 getImageEffectUV(vec2 uv) {
	return uv;
}

								#define SHADER_NAME StandardShader



#define VARYING_VPOSITIONW
varying vec3 vPositionW;
#define VARYING_VUV0
varying vec2 vUv0;


vec3 dPositionW;
mat4 dModelMatrix;

attribute vec4 vertex_position;
layout(std140) uniform ub_view {
    mat4 matrix_viewProjection;
};
uniform mat4 matrix_model;
uniform sampler2D texture_opacityMap;
uniform float textureBias;
uniform float material_opacity;
uniform float material_alphaDitherScale;
uniform vec3 view_position;
uniform float light_radius;



	mat4 getModelMatrix() {
		return matrix_model;
	}
vec3 getLocalPosition(vec3 vertexPosition) {
	vec3 localPos = vertexPosition;
	return localPos;
}

	attribute vec2 vertex_texCoord0;

	vec2 getUv0() {
		return vertex_texCoord0;
	}


vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
	vec3 localPos = getLocalPosition(vertexPosition);
	vec4 posW = modelMatrix * vec4(localPos, 1.0);
	return posW;
}
vec4 getPosition() {
	dModelMatrix = getModelMatrix();
	vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
	dPositionW = posW.xyz;
	vec4 screenPos;
			screenPos = matrix_viewProjection * posW;
	return screenPos;
}
vec3 getWorldPosition() {
	return dPositionW;
}



void main(void) {

	gl_PointSize = 1.0;
	gl_Position = getPosition();
	vPositionW = getWorldPosition();
		vec2 uv0 = getUv0();
			vUv0 = uv0;


}
