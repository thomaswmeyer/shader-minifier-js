#version 300 es
#define COLOR_ATTACHMENT_0
#define outType_0 vec4
#define COLOR_ATTACHMENT_1
#define outType_1 vec4
#define COLOR_ATTACHMENT_2
#define outType_2 vec4
#define COLOR_ATTACHMENT_3
#define outType_3 vec4
#define COLOR_ATTACHMENT_4
#define outType_4 vec4
#define COLOR_ATTACHMENT_5
#define outType_5 vec4

layout(location = 0) out highp outType_0 pcFragColor0;
layout(location = 1) out highp outType_1 pcFragColor1;
layout(location = 2) out highp outType_2 pcFragColor2;
layout(location = 3) out highp outType_3 pcFragColor3;
layout(location = 4) out highp outType_4 pcFragColor4;
layout(location = 5) out highp outType_5 pcFragColor5;
#define gl_FragColor pcFragColor0
#define varying in
#define texture2D texture
#define texture2DBias texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLod textureLod
#define texture2DProjLod textureProjLod
#define textureCubeLod textureLod
#define texture2DGrad textureGrad
#define texture2DProjGrad textureProjGrad
#define textureCubeGrad textureGrad
#define utexture2D texture
#define itexture2D texture
#define texture2DLodEXT texture2DLodEXT_is_no_longer_supported_use_texture2DLod_instead
#define texture2DProjLodEXT texture2DProjLodEXT_is_no_longer_supported_use_texture2DProjLod
#define textureCubeLodEXT textureCubeLodEXT_is_no_longer_supported_use_textureCubeLod_instead
#define texture2DGradEXT texture2DGradEXT_is_no_longer_supported_use_texture2DGrad_instead
#define texture2DProjGradEXT texture2DProjGradEXT_is_no_longer_supported_use_texture2DProjGrad_instead
#define textureCubeGradEXT textureCubeGradEXT_is_no_longer_supported_use_textureCubeGrad_instead
#define textureShadow(res, uv) textureGrad(res, uv, vec2(1, 1), vec2(1, 1))
#define SHADOWMAP_PASS(name) name
#define SHADOWMAP_ACCEPT(name) sampler2DShadow name
#define TEXTURE_PASS(name) name
#define TEXTURE_ACCEPT(name) sampler2D name
#define TEXTURE_ACCEPT_HIGHP(name) highp sampler2D name
#define GL2
#define CAPS_TEXTURE_FLOAT_FILTERABLE
#define CAPS_TEXTURE_FLOAT_RENDERABLE
#define CAPS_MULTI_DRAW
#define PLATFORM_DESKTOP

#define STD_PARALLAX OFFSET
#define STD_OPACITY_DITHER NONE
#define STD_OPACITY_TEXTURE
#define STD_OPACITY_TEXTURE_ALLOCATE
#define SCENE_COLORMAP_GAMMA
#define FOG NONE
#define TONEMAP undefined
#define GAMMA SRGB
#define PERSPECTIVE_DEPTH
#define LIGHT_TYPE DIRECTIONAL
#define SHADOW_TYPE PCF3_32F
#define SHADOW_PASS
#define SHADOWPASS_0_0_PASS


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



	float dAlpha = 1.0;
layout(std140) uniform ub_view {
    mat4 matrix_viewProjection;
};
uniform mat4 matrix_model;
uniform sampler2D texture_opacityMap;
uniform float textureBias;
uniform float material_opacity;
uniform float material_alphaDitherScale;





vec3 litArgs_albedo;
float litArgs_opacity;
vec3 litArgs_emission;
vec3 litArgs_worldNormal;
float litArgs_ao;
vec3 litArgs_lightmap;
vec3 litArgs_lightmapDir;
float litArgs_metalness;
vec3 litArgs_specularity;
float litArgs_specularityFactor;
float litArgs_gloss;
float litArgs_sheen_gloss;
vec3 litArgs_sheen_specularity;
float litArgs_transmission;
float litArgs_thickness;
float litArgs_ior;
float litArgs_dispersion;
float litArgs_iridescence_intensity;
float litArgs_iridescence_thickness;
vec3 litArgs_clearcoat_worldNormal;
float litArgs_clearcoat_specularity;
float litArgs_clearcoat_gloss;



void getOpacity() {
	dAlpha = material_opacity;
	dAlpha *= texture2DBias(texture_opacityMap, vUv0, textureBias).a;
}

	void evaluateFrontend() {
			getOpacity();
			litArgs_opacity = dAlpha;
	}



void main(void) {

	evaluateFrontend();
		float depth = gl_FragCoord.z;
			gl_FragColor = vec4(1.0);

}
