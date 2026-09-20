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
#define STD_SPECULAR_COLOR
#define STD_OPACITY_DITHER NONE
#define STD_OPACITY_TEXTURE
#define STD_OPACITY_TEXTURE_ALLOCATE
#define LIT_NEEDS_NORMAL
#define LIT_LIGHTING
#define LIT_CLUSTERED_SHADOWS
#define LIT_ADD_AMBIENT
#define LIT_OPACITY_FADES_SPECULAR
#define LIT_FRESNEL_MODEL SCHLICK
#define LIT_NONE_SLICE_MODE SIMPLE
#define LIT_BLEND_TYPE NORMAL
#define LIT_CUBEMAP_PROJECTION NONE
#define LIT_OCCLUDE_SPECULAR AO
#define LIT_REFLECTION_SOURCE NONE
#define LIT_AMBIENT_SOURCE CONSTANT
#define LIGHT_COUNT 1
#define LIT_CLUSTERED_LIGHTS true
#define CLUSTER_MESH_DYNAMIC_LIGHTS true
#define CLUSTER_SHADOWS true
#define SHADOW_KIND_PCF3 true
#define CLUSTER_SHADOW_TYPE_PCF3 true
#define LIGHT0 true
#define LIGHT0TYPE DIRECTIONAL
#define LIGHT0SHADOWTYPE PCF3_32F
#define LIGHT0SHAPE PUNCTUAL
#define LIGHT0FALLOFF LINEAR
#define LIGHT0AFFECT_SPECULARITY true
#define LIGHT0CASTSHADOW true
#define LIGHT0SHADOW_PCF true
#define LIGHT0_SHADOW_SAMPLE_ORTHO true
#define LIGHT0_SHADOW_SAMPLE_SOURCE_ZBUFFER true
#define SHADOW_DIRECTIONAL true
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



	float dAlpha = 1.0;
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
uniform sampler2D texture_opacityMap;
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
uniform float material_opacity;
uniform float material_alphaDitherScale;
uniform vec3 material_diffuse;
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
uniform vec3 material_ambient;
uniform highp usampler2D clusterWorldTexture;
uniform highp sampler2D lightsTexture;
uniform sampler2DShadow shadowAtlasTexture;


		vec3 dAlbedo;
		vec3 dNormalW;
		vec3 dSpecularity = vec3(0.0);
		float dGlossiness = 0.0;
		vec3 dEmission;




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


vec3 sReflection;
vec3 dVertexNormalW;
vec3 dTangentW;
vec3 dBinormalW;
vec3 dViewDirW;
vec3 dReflDirW;
vec3 ccReflDirW;
vec3 dLightDirNormW;
float dAtten;
mat3 dTBN;
vec4 dReflection;
vec3 dDiffuseLight;
vec3 dSpecularLight;
float ccFresnel;
vec3 ccReflection;
vec3 ccSpecularLight;
float ccSpecularityNoFres;
vec3 sSpecularLight;



			#define LIT_CODE_FALLOFF_LINEAR














float square(float x) {
	return x*x;
}
float saturate(float x) {
	return clamp(x, 0.0, 1.0);
}
vec3 saturate(vec3 x) {
	return clamp(x, vec3(0.0), vec3(1.0));
}


vec2 toSpherical(vec3 dir) {
	return vec2(dir.xz == vec2(0.0) ? 0.0 : atan(dir.x, dir.z), asin(dir.y));
}
vec2 toSphericalUv(vec3 dir) {
	const float PI = 3.141592653589793;
	vec2 uv = toSpherical(dir) / vec2(PI * 2.0, PI) + 0.5;
	return vec2(uv.x, 1.0 - uv.y);
}


#define _DECODE_INCLUDED_
vec3 decodeLinear(vec4 raw) {
	return raw.rgb;
}
float decodeGamma(float raw) {
	return pow(raw, 2.2);
}
vec3 decodeGamma(vec3 raw) {
	return pow(raw, vec3(2.2));
}
vec3 decodeGamma(vec4 raw) {
	return pow(raw.xyz, vec3(2.2));
}
vec3 decodeRGBM(vec4 raw) {
	vec3 color = (8.0 * raw.a) * raw.rgb;
	return color * color;
}
vec3 decodeRGBP(vec4 raw) {
	vec3 color = raw.rgb * (-raw.a * 7.0 + 8.0);
	return color * color;
}
vec3 decodeRGBE(vec4 raw) {
	if (raw.a == 0.0) {
		return vec3(0.0, 0.0, 0.0);
	} else {
		return raw.xyz * pow(2.0, raw.w * 255.0 - 128.0);
	}
}
vec4 passThrough(vec4 raw) {
	return raw;
}
vec3 unpackNormalXYZ(vec4 nmap) {
	return nmap.xyz * 2.0 - 1.0;
}
vec3 unpackNormalXY(vec4 nmap) {
	vec3 normal;
	normal.xy = nmap.wy * 2.0 - 1.0;
	normal.z = sqrt(1.0 - clamp(dot(normal.xy, normal.xy), 0.0, 1.0));
	return normal;
}




	float gammaCorrectInput(float color) {
		return decodeGamma(color);
	}
	vec3 gammaCorrectInput(vec3 color) {
		return decodeGamma(color);
	}
	vec4 gammaCorrectInput(vec4 color) {
		return vec4(decodeGamma(color.xyz), color.w);
	}
	vec3 gammaCorrectOutput(vec3 color) {
		return pow(color + 0.0000001, vec3(1.0 / 2.2));
	}



		float getExposure() { return exposure; }

vec3 toneMap(vec3 color) {
	return color * getExposure();
}



float dBlendModeFogFactor = 1.0;
	float getFogFactor() {
		float depth = gl_FragCoord.z / gl_FragCoord.w;
	float fogFactor = 0.0;
	return clamp(fogFactor, 0.0, 1.0);
}
	vec3 addFog(vec3 color) {
		return color;
	}






void getOpacity() {
	dAlpha = material_opacity;
	dAlpha *= texture2DBias(texture_opacityMap, vUv0, textureBias).a;
}



void getAlbedo() {
	dAlbedo = material_diffuse.rgb;
}


void getNormal() {
	dNormalW = dVertexNormalW;
}




void getEmission() {
	dEmission = material_emissive * material_emissiveIntensity;
}

	void evaluateFrontend() {
			getOpacity();
			litArgs_opacity = dAlpha;
			getAlbedo();
			litArgs_albedo = dAlbedo;
				getNormal();
				litArgs_worldNormal = dNormalW;
			getEmission();
			litArgs_emission = dEmission;
	}



vec3 cubeMapRotate(vec3 refDir) {
	return refDir;
}


vec3 cubeMapProject(vec3 nrdir) {
		return cubeMapRotate(nrdir);
}


vec3 processEnvironment(vec3 color) {
		return color;
}



vec3 combineColor(vec3 albedo, vec3 sheenSpecularity, float clearcoatSpecularity) {
	vec3 ret = vec3(0);
	ret += albedo * dDiffuseLight;
	return ret;
}


void addAmbient(vec3 worldNormal) {
		dDiffuseLight += light_globalAmbient;
}


void getViewDir() {
	dViewDirW = normalize(view_position - vPositionW);
}


	#define LIT_CODE_FALLOFF_LINEAR
	#define LIT_CODE_FALLOFF_SQUARED
	#define LIT_CODE_LIGHTS_POINT
	#define LIT_CODE_LIGHTS_SPOT

float getLightDiffuse(vec3 worldNormal, vec3 viewDir, vec3 lightDirNorm) {
	return max(dot(worldNormal, -lightDirNorm), 0.0);
}


int getShadowCascadeIndex(vec4 shadowCascadeDistances, int shadowCascadeCount) {
	float depth = 1.0 / gl_FragCoord.w;
	vec4 comparisons = step(shadowCascadeDistances, vec4(depth));
	int cascadeIndex = int(dot(comparisons, vec4(1.0)));
	return min(cascadeIndex, shadowCascadeCount - 1);
}
int ditherShadowCascadeIndex(int cascadeIndex, vec4 shadowCascadeDistances, int shadowCascadeCount, float blendFactor) {

	if (cascadeIndex < shadowCascadeCount - 1) {
		float currentRangeEnd = shadowCascadeDistances[cascadeIndex];
		float transitionStart = blendFactor * currentRangeEnd;
		float depth = 1.0 / gl_FragCoord.w;
		if (depth > transitionStart) {
			float transitionFactor = smoothstep(transitionStart, currentRangeEnd, depth);
			float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
			if (dither < transitionFactor) {
				cascadeIndex += 1;
			}
		}
	}
	return cascadeIndex;
}
vec3 fadeShadow(vec3 shadowCoord, vec4 shadowCascadeDistances) {				  
	float depth = 1.0 / gl_FragCoord.w;
	if (depth > shadowCascadeDistances.w) {
		shadowCoord.z = -9999999.0;
	}
	return shadowCoord;
}


float _getShadowPCF3x3(SHADOWMAP_ACCEPT(shadowMap), vec3 shadowCoord, vec3 shadowParams) {
	float z = shadowCoord.z;
	vec2 uv = shadowCoord.xy * shadowParams.x;
	float shadowMapSizeInv = 1.0 / shadowParams.x;
	vec2 base_uv = floor(uv + 0.5);
	float s = (uv.x + 0.5 - base_uv.x);
	float t = (uv.y + 0.5 - base_uv.y); 
	base_uv -= vec2(0.5);
	base_uv *= shadowMapSizeInv;
	float sum = 0.0;
	float uw0 = (3.0 - 2.0 * s);
	float uw1 = (1.0 + 2.0 * s);
	float u0 = (2.0 - s) / uw0 - 1.0;
	float u1 = s / uw1 + 1.0;
	float vw0 = (3.0 - 2.0 * t);
	float vw1 = (1.0 + 2.0 * t);
	float v0 = (2.0 - t) / vw0 - 1.0;
	float v1 = t / vw1 + 1.0;
	u0 = u0 * shadowMapSizeInv + base_uv.x;
	v0 = v0 * shadowMapSizeInv + base_uv.y;
	u1 = u1 * shadowMapSizeInv + base_uv.x;
	v1 = v1 * shadowMapSizeInv + base_uv.y;
	sum += uw0 * vw0 * textureShadow(shadowMap, vec3(u0, v0, z));
	sum += uw1 * vw0 * textureShadow(shadowMap, vec3(u1, v0, z));
	sum += uw0 * vw1 * textureShadow(shadowMap, vec3(u0, v1, z));
	sum += uw1 * vw1 * textureShadow(shadowMap, vec3(u1, v1, z));
	sum *= 1.0f / 16.0;
	return sum;
}
float getShadowPCF3x3(SHADOWMAP_ACCEPT(shadowMap), vec3 shadowCoord, vec4 shadowParams) {
	return _getShadowPCF3x3(SHADOWMAP_PASS(shadowMap), shadowCoord, shadowParams.xyz);
}
float getShadowSpotPCF3x3(SHADOWMAP_ACCEPT(shadowMap), vec3 shadowCoord, vec4 shadowParams) {
	return _getShadowPCF3x3(SHADOWMAP_PASS(shadowMap), shadowCoord, shadowParams.xyz);
}
float getShadowOmniPCF3x3(samplerCubeShadow shadowMap, vec4 shadowParams, vec3 dir) {

	float shadowZ = length(dir) * shadowParams.w + shadowParams.z;
	float z = 1.0 / float(textureSize(shadowMap, 0));
	vec3 tc = normalize(dir);
	mediump vec4 shadows;
	shadows.x = texture(shadowMap, vec4(tc + vec3( z, z, z), shadowZ));
	shadows.y = texture(shadowMap, vec4(tc + vec3(-z,-z, z), shadowZ));
	shadows.z = texture(shadowMap, vec4(tc + vec3(-z, z,-z), shadowZ));
	shadows.w = texture(shadowMap, vec4(tc + vec3( z,-z,-z), shadowZ));
	return dot(shadows, vec4(0.25));
}
float getShadowOmniPCF3x3(samplerCubeShadow shadowMap, vec3 shadowCoord, vec4 shadowParams, vec3 lightDir) {
	return getShadowOmniPCF3x3(shadowMap, shadowParams, lightDir);
}


float getFalloffLinear(float lightRadius, vec3 lightDir) {
	float d = length(lightDir);
	return max(((lightRadius - d) / lightRadius), 0.0);
}


float getFalloffWindow(float lightRadius, vec3 lightDir) {
	float sqrDist = dot(lightDir, lightDir);
	float invRadius = 1.0 / lightRadius;
	return square(saturate(1.0 - square(sqrDist * square(invRadius))));
}
float getFalloffInvSquared(float lightRadius, vec3 lightDir) {
	float sqrDist = dot(lightDir, lightDir);
	float falloff = 1.0 / (sqrDist + 1.0);
	float invRadius = 1.0 / lightRadius;
	falloff *= 16.0;
	falloff *= square(saturate(1.0 - square(sqrDist * square(invRadius))));
	return falloff;
}


vec3 evalOmniLight(vec3 lightPosW) {
	return vPositionW - lightPosW;
}


float getSpotEffect(vec3 lightSpotDir, float lightInnerConeAngle, float lightOuterConeAngle, vec3 lightDirNorm) {
	float cosAngle = dot(lightDirNorm, lightSpotDir);
	return smoothstep(lightOuterConeAngle, lightInnerConeAngle, cosAngle);
}


vec2 getCubemapFaceCoordinates(const vec3 dir, out float faceIndex, out vec2 tileOffset)
{
	vec3 vAbs = abs(dir);
	float ma;
	vec2 uv;
	if (vAbs.z >= vAbs.x && vAbs.z >= vAbs.y) {
		faceIndex = dir.z < 0.0 ? 5.0 : 4.0;
		ma = 0.5 / vAbs.z;
		uv = vec2(dir.z < 0.0 ? -dir.x : dir.x, -dir.y);
		tileOffset.x = 2.0;
		tileOffset.y = dir.z < 0.0 ? 1.0 : 0.0;
	} else if(vAbs.y >= vAbs.x) {
		faceIndex = dir.y < 0.0 ? 3.0 : 2.0;
		ma = 0.5 / vAbs.y;
		uv = vec2(dir.x, dir.y < 0.0 ? -dir.z : dir.z);
		tileOffset.x = 1.0;
		tileOffset.y = dir.y < 0.0 ? 1.0 : 0.0;
	} else {
		faceIndex = dir.x < 0.0 ? 1.0 : 0.0;
		ma = 0.5 / vAbs.x;
		uv = vec2(dir.x < 0.0 ? dir.z : -dir.z, -dir.y);
		tileOffset.x = 0.0;
		tileOffset.y = dir.x < 0.0 ? 1.0 : 0.0;
	}
	return uv * ma + 0.5;
}
vec2 getCubemapAtlasCoordinates(const vec3 omniAtlasViewport, float shadowEdgePixels, float shadowTextureResolution, const vec3 dir) {
	float faceIndex;
	vec2 tileOffset;
	vec2 uv = getCubemapFaceCoordinates(dir, faceIndex, tileOffset);
	float atlasFaceSize = omniAtlasViewport.z;
	float tileSize = shadowTextureResolution * atlasFaceSize;
	float offset = shadowEdgePixels / tileSize;
	uv = uv * vec2(1.0 - offset * 2.0) + vec2(offset * 1.0);
	uv *= atlasFaceSize;
	uv += tileOffset * atlasFaceSize;
	uv += omniAtlasViewport.xy;
	return uv;
}


vec3 _getShadowCoordPerspZbuffer(mat4 shadowMatrix, vec4 shadowParams, vec3 wPos) {
	vec4 projPos = shadowMatrix * vec4(wPos, 1.0);
	projPos.xyz /= projPos.w;
	return projPos.xyz;
}
vec3 getShadowCoordPerspZbufferNormalOffset(mat4 shadowMatrix, vec4 shadowParams, vec3 normal) {
	vec3 wPos = vPositionW + normal * shadowParams.y;
	return _getShadowCoordPerspZbuffer(shadowMatrix, shadowParams, wPos);
}
vec3 normalOffsetPointShadow(vec4 shadowParams, vec3 lightPos, vec3 lightDir, vec3 lightDirNorm, vec3 normal) {
	float distScale = length(lightDir);
	vec3 wPos = vPositionW + normal * shadowParams.y * clamp(1.0 - dot(normal, -lightDirNorm), 0.0, 1.0) * distScale;
	vec3 dir = wPos - lightPos;
	return dir;
}
float getShadowOmniClusteredPCF3(SHADOWMAP_ACCEPT(shadowMap), vec4 shadowParams, vec3 omniAtlasViewport, float shadowEdgePixels, vec3 lightDir) {
	float shadowTextureResolution = shadowParams.x;
	vec2 uv = getCubemapAtlasCoordinates(omniAtlasViewport, shadowEdgePixels, shadowTextureResolution, lightDir);
	float shadowZ = length(lightDir) * shadowParams.w + shadowParams.z;
	vec3 shadowCoord = vec3(uv, shadowZ);
	return getShadowPCF3x3(SHADOWMAP_PASS(shadowMap), shadowCoord, shadowParams);
}
float getShadowSpotClusteredPCF3(SHADOWMAP_ACCEPT(shadowMap), vec3 shadowCoord, vec4 shadowParams) {
	return getShadowSpotPCF3x3(SHADOWMAP_PASS(shadowMap), shadowCoord, shadowParams);
}













struct ClusterLightData {
	vec3 position;
	int lightIndex;
	vec3 direction;
	uint shape;
	vec3 color;
	float shadowIntensity;
	float range;
	float biasesData;
	float cookieIntensity;
	bool isSpot;
	bool falloffModeLinear;
	bool isDynamic;
	bool isLightmapped;
};
struct ClusterLightSpotData {
	float innerConeAngleCos;
	float outerConeAngleCos;
};
struct ClusterLightAreaData {
	vec3 halfWidth;
	vec3 halfHeight;
};
struct ClusterLightShadowData {
	float shadowBias;
	float shadowNormalBias;
};
mat4 lightProjectionMatrix;
uint clusterLightData_flags;
float clusterLightData_anglesData;
uint clusterLightData_colorBFlagsData;
vec4 sampleLightTextureF(int lightIndex, int index) {
	return texelFetch(lightsTexture, ivec2(index, lightIndex), 0);
}
ClusterLightData decodeClusterLightCore(int lightIndex) {
	ClusterLightData clusterLightData;
	clusterLightData.lightIndex = lightIndex;
	vec4 halfData = sampleLightTextureF(lightIndex, 2);
	clusterLightData_anglesData = halfData.z;
	clusterLightData.biasesData = halfData.w;
	clusterLightData_colorBFlagsData = floatBitsToUint(halfData.y);
	vec2 colorRG = unpackHalf2x16(floatBitsToUint(halfData.x));
	vec2 colorB_flags = unpackHalf2x16(clusterLightData_colorBFlagsData);
	clusterLightData.color = vec3(colorRG, colorB_flags.x) * 100.0;
	vec4 lightPosRange = sampleLightTextureF(lightIndex, 0);
	clusterLightData.position = lightPosRange.xyz;
	clusterLightData.range = lightPosRange.w;
	vec4 lightDir_Flags = sampleLightTextureF(lightIndex, 1);
	clusterLightData.direction = lightDir_Flags.xyz;
	clusterLightData_flags = floatBitsToUint(lightDir_Flags.w);
	clusterLightData.isSpot = (clusterLightData_flags & (1u << 30u)) != 0u;
	clusterLightData.shape = (clusterLightData_flags >> 28u) & 0x3u;
	clusterLightData.falloffModeLinear = (clusterLightData_flags & (1u << 27u)) == 0u;
	clusterLightData.shadowIntensity = float((clusterLightData_flags >> 0u) & 0xFFu) / 255.0;
	clusterLightData.cookieIntensity = float((clusterLightData_flags >> 8u) & 0xFFu) / 255.0;
	clusterLightData.isDynamic = (clusterLightData_flags & (1u << 22u)) != 0u;
	clusterLightData.isLightmapped = (clusterLightData_flags & (1u << 21u)) != 0u;
	return clusterLightData;
}
ClusterLightSpotData decodeClusterLightSpot() {
	uint angleFlags = (clusterLightData_colorBFlagsData >> 16u) & 0xFFFFu;
	vec2 angleValues = unpackHalf2x16(floatBitsToUint(clusterLightData_anglesData));
	float innerVal = angleValues.x;
	float outerVal = angleValues.y;
	float innerIsVersine = float(angleFlags & 1u);
	float outerIsVersine = float((angleFlags >> 1u) & 1u);
	return ClusterLightSpotData(
		mix(innerVal, 1.0 - innerVal, innerIsVersine),
		mix(outerVal, 1.0 - outerVal, outerIsVersine)
	);
}
vec3 decodeClusterLightOmniAtlasViewport(int lightIndex) {
	return sampleLightTextureF(lightIndex, 3).xyz;
}
ClusterLightAreaData decodeClusterLightAreaData(int lightIndex) {
	return ClusterLightAreaData(
		sampleLightTextureF(lightIndex, 7).xyz,
		sampleLightTextureF(lightIndex, 8).xyz
	);
}
mat4 decodeClusterLightProjectionMatrixData(int lightIndex) {
	vec4 m0 = sampleLightTextureF(lightIndex, 3);
	vec4 m1 = sampleLightTextureF(lightIndex, 4);
	vec4 m2 = sampleLightTextureF(lightIndex, 5);
	vec4 m3 = sampleLightTextureF(lightIndex, 6);
	return mat4(m0, m1, m2, m3);
}
ClusterLightShadowData decodeClusterLightShadowData(float biasesData) {
	vec2 biases = unpackHalf2x16(floatBitsToUint(biasesData));
	return ClusterLightShadowData(biases.x, biases.y);
}
vec4 decodeClusterLightCookieData() {
	uint cookieFlags = (clusterLightData_flags >> 23u) & 0x0Fu;
	vec4 mask = vec4(uvec4(cookieFlags) & uvec4(1u, 2u, 4u, 8u));
	return step(1.0, mask);
}
void evaluateLight(
	ClusterLightData light, 
	vec3 worldNormal, 
	vec3 viewDir, 
	vec3 reflectionDir,
	float gloss, 
	vec3 specularity, 
	vec3 geometricNormal, 
	mat3 tbn, 
	vec3 clearcoat_worldNormal,
	float clearcoat_gloss,
	float sheen_gloss,
	float iridescence_intensity
) {
	vec3 cookieAttenuation = vec3(1.0);
	float diffuseAttenuation = 1.0;
	float falloffAttenuation = 1.0;
	vec3 lightDirW = evalOmniLight(light.position);
	vec3 lightDirNormW = normalize(lightDirW);
	{
		if (light.falloffModeLinear)
			falloffAttenuation = getFalloffLinear(light.range, lightDirW);
		else
			falloffAttenuation = getFalloffInvSquared(light.range, lightDirW);
	}
	if (falloffAttenuation > 0.00001) {
		{
			falloffAttenuation *= getLightDiffuse(worldNormal, viewDir, lightDirNormW); 
		}
		if (light.isSpot) {
			ClusterLightSpotData spotData = decodeClusterLightSpot();
			falloffAttenuation *= getSpotEffect(light.direction, spotData.innerConeAngleCos, spotData.outerConeAngleCos, lightDirNormW);
		}
		if (falloffAttenuation > 0.00001) {
			if (light.shadowIntensity > 0.0 || light.cookieIntensity > 0.0) {
				vec3 omniAtlasViewport = vec3(0.0);
				if (light.isSpot) {
					lightProjectionMatrix = decodeClusterLightProjectionMatrixData(light.lightIndex);
				} else {
					omniAtlasViewport = decodeClusterLightOmniAtlasViewport(light.lightIndex);
				}
				float shadowTextureResolution = shadowAtlasParams.x;
				float shadowEdgePixels = shadowAtlasParams.y;
				if (light.shadowIntensity > 0.0) {
					ClusterLightShadowData shadowData = decodeClusterLightShadowData(light.biasesData);
					vec4 shadowParams = vec4(shadowTextureResolution, shadowData.shadowNormalBias, shadowData.shadowBias, 1.0 / light.range);
					if (light.isSpot) {
						vec3 shadowCoord = getShadowCoordPerspZbufferNormalOffset(lightProjectionMatrix, shadowParams, geometricNormal);

							float shadow = getShadowSpotClusteredPCF3(SHADOWMAP_PASS(shadowAtlasTexture), shadowCoord, shadowParams);
						falloffAttenuation *= mix(1.0, shadow, light.shadowIntensity);
					} else {
						vec3 dir = normalOffsetPointShadow(shadowParams, light.position, lightDirW, lightDirNormW, geometricNormal);
							float shadow = getShadowOmniClusteredPCF3(SHADOWMAP_PASS(shadowAtlasTexture), shadowParams, omniAtlasViewport, shadowEdgePixels, dir);
						falloffAttenuation *= mix(1.0, shadow, light.shadowIntensity);
					}
				}
			}
		}
		{
			{
				vec3 punctualDiffuse = falloffAttenuation * light.color * cookieAttenuation;
				dDiffuseLight += punctualDiffuse;
			}

		}
	}
	dAtten = falloffAttenuation;
	dLightDirNormW = lightDirNormW;
}
void evaluateClusterLight(
	int lightIndex, 
	vec3 worldNormal, 
	vec3 viewDir, 
	vec3 reflectionDir, 
	float gloss, 
	vec3 specularity, 
	vec3 geometricNormal, 
	mat3 tbn, 
	vec3 clearcoat_worldNormal,
	float clearcoat_gloss,
	float sheen_gloss,
	float iridescence_intensity
) {
	ClusterLightData clusterLightData = decodeClusterLightCore(lightIndex);
		bool acceptLightMask = clusterLightData.isDynamic;
	if (acceptLightMask)
		evaluateLight(
			clusterLightData, 
			worldNormal, 
			viewDir, 
			reflectionDir, 
			gloss, 
			specularity, 
			geometricNormal, 
			tbn, 
			clearcoat_worldNormal,
			clearcoat_gloss,
			sheen_gloss,
			iridescence_intensity
		);
}
void addClusteredLights(
	vec3 worldNormal, 
	vec3 viewDir, 
	vec3 reflectionDir, 
	float gloss, 
	vec3 specularity, 
	vec3 geometricNormal, 
	mat3 tbn, 
	vec3 clearcoat_worldNormal,
	float clearcoat_gloss,
	float sheen_gloss,
	float iridescence_intensity
) {
	if (numClusteredLights <= 1)
		return;
	ivec3 cellCoords = ivec3(floor((vPositionW - clusterBoundsMin) * clusterCellsCountByBoundsSize));
	if (!(any(lessThan(cellCoords, ivec3(0))) || any(greaterThanEqual(cellCoords, clusterCellsMax)))) {
		int cellIndex = cellCoords.x * clusterCellsDot.x + cellCoords.y * clusterCellsDot.y + cellCoords.z * clusterCellsDot.z;
		int clusterV = cellIndex / clusterTextureWidth;
		int clusterU = cellIndex - clusterV * clusterTextureWidth;
		for (int lightCellIndex = 0; lightCellIndex < clusterMaxCells; lightCellIndex++) {
			uint lightIndex = texelFetch(clusterWorldTexture, ivec2(clusterU + lightCellIndex, clusterV), 0).x;
			if (lightIndex == 0u)
				break;
			evaluateClusterLight(
				int(lightIndex), 
				worldNormal, 
				viewDir, 
				reflectionDir,
				gloss, 
				specularity, 
				geometricNormal, 
				tbn, 
				clearcoat_worldNormal,
				clearcoat_gloss,
				sheen_gloss,
				iridescence_intensity
			); 
		}
	}
}


		vec3 getShadowSampleCoord0(mat4 shadowTransform, vec4 shadowParams, vec3 worldPosition, vec3 lightPos, inout vec3 lightDir, vec3 lightDirNorm, vec3 normal) {
			vec3 surfacePosition = worldPosition;
			vec4 positionInShadowSpace = shadowTransform * vec4(surfacePosition, 1.0);
				positionInShadowSpace.z = saturate(positionInShadowSpace.z) - 0.0001;
			return positionInShadowSpace.xyz;
		}
	float getShadow0(vec3 lightDirW) {
				mat4 shadowMatrix = light0_shadowMatrix;
				vec3 shadowCoord = getShadowSampleCoord0(shadowMatrix, light0_shadowParams, vPositionW, vec3(0.0), lightDirW, dLightDirNormW, dVertexNormalW);
			shadowCoord = fadeShadow(shadowCoord, light0_shadowCascadeDistances);
				return getShadowPCF3x3(SHADOWMAP_PASS(light0_shadowMap), shadowCoord, light0_shadowParams);
	}


void evaluateLight0(
) {
	vec3 lightColor = light0_color;
		if (all(equal(lightColor, vec3(0.0)))) {
			return;
		}
		dLightDirNormW = light0_direction;
		dAtten = 1.0;
	if (dAtten < 0.00001) {
		return;
	}
		dAtten *= getLightDiffuse(litArgs_worldNormal, vec3(0.0), dLightDirNormW);
			float shadow = getShadow0(vec3(0.0));
		shadow = mix(1.0, shadow, light0_shadowIntensity);
		dAtten *= shadow;
			dDiffuseLight += dAtten * lightColor;
				#define LIGHT0FRESNEL
}




void evaluateBackend() {
		addAmbient(litArgs_worldNormal);
		dDiffuseLight *= material_ambient;


	evaluateLight0(
	);

			addClusteredLights(litArgs_worldNormal, dViewDirW, dReflDirW,
						litArgs_gloss, litArgs_specularity, dVertexNormalW, dTBN, 
						litArgs_clearcoat_worldNormal, litArgs_clearcoat_gloss, litArgs_sheen_gloss, litArgs_iridescence_intensity
			);

	gl_FragColor.rgb = combineColor(litArgs_albedo, litArgs_sheen_specularity, litArgs_clearcoat_specularity);
	gl_FragColor.rgb += litArgs_emission;
	gl_FragColor.rgb = addFog(gl_FragColor.rgb);
	gl_FragColor.rgb = toneMap(gl_FragColor.rgb);
	gl_FragColor.rgb = gammaCorrectOutput(gl_FragColor.rgb);


	gl_FragColor.a = litArgs_opacity;

}




#define SCENE_TEXTURES
void writeSceneTextureDepth(float linearDepth, float alpha) {
}

void main(void) {

	dReflection = vec4(0);
			dVertexNormalW = normalize(vNormalW);
		getViewDir();
	evaluateFrontend();


	evaluateBackend();

}
