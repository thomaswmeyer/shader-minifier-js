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

#define NORMALS true
#define UV0 true
#define UV0_UNMODIFIED true
#define UV_TRANSFORMS_COUNT 0
#define SCENE_COLORMAP_GAMMA
#define FOG NONE
#define TONEMAP LINEAR
#define GAMMA SRGB
#define FORWARD_PASS


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
#define VARYING_VNORMALW
varying vec3 vNormalW;
#define VARYING_VUV0
varying vec2 vUv0;


vec3 dPositionW;
mat4 dModelMatrix;

attribute vec4 vertex_position;
layout(std140) uniform ub_view {
    mat4 matrix_view;
    mat4 matrix_viewInverse;
    mat4 matrix_projection;
    mat4 matrix_projectionSkybox;
    mat4 matrix_viewProjection;
    mat3 matrix_view3;
    mat3 cubeMapRotationMatrix;
    vec3 view_position;
    vec4 viewport_size;
    float skyboxIntensity;
    float exposure;
    uint view_index;
    vec3 clusterCellsCountByBoundsSize;
    vec3 clusterBoundsMin;
    vec3 clusterBoundsDelta;
    ivec3 clusterCellsDot;
    ivec3 clusterCellsMax;
    vec2 shadowAtlasParams;
    int clusterMaxCells;
    int numClusteredLights;
    int clusterTextureWidth;
};
uniform mat4 matrix_model;
uniform mat3 matrix_normal;
uniform sampler2D texture_diffuseMap;
uniform float textureBias;
uniform vec3 light0_color;
uniform vec3 light0_direction;
uniform mat4 light0_shadowMatrix;
uniform float light0_shadowIntensity;
uniform vec4 light0_shadowParams;
uniform mat4 light0_shadowMatrixPalette[4];
uniform vec4 light0_shadowCascadeDistances;
uniform int light0_shadowCascadeCount;
uniform float light0_shadowCascadeBlend;
uniform sampler2DShadow light0_shadowMap;
uniform vec3 light_globalAmbient;
uniform vec3 material_diffuse;
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
uniform vec3 material_ambient;
uniform highp usampler2D clusterWorldTexture;
uniform highp sampler2D lightsTexture;
uniform sampler2DShadow shadowAtlasTexture;



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


attribute vec3 vertex_normal;

vec3 getLocalNormal(vec3 vertexNormal) {
	vec3 localNormal = vertex_normal;
	return localNormal;
}
	mat3 getNormalMatrix(mat4 modelMatrix) {
		return matrix_normal;
	}


mat3 dNormalMatrix;
vec3 getNormal() {
	dNormalMatrix = getNormalMatrix(dModelMatrix);
	vec3 localNormal = getLocalNormal(vertex_normal);
	return normalize(dNormalMatrix * localNormal);
}



void main(void) {

	gl_PointSize = 1.0;
	gl_Position = getPosition();
	vPositionW = getWorldPosition();
		vNormalW = getNormal();
		vec2 uv0 = getUv0();
			vUv0 = uv0;


}
