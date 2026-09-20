#version 300 es
#define WEBGL2 
#define MATERIALPLUGIN_1
#define BRDF_V_HEIGHT_CORRELATED
#define MS_BRDF_ENERGY_CONSERVATION
#define SPHERICAL_HARMONICS
#define SPECULAR_GLOSSINESS_ENERGY_CONSERVATION
#define MIX_IBL_RADIANCE_WITH_IRRADIANCE
#define LEGACY_SPECULAR_ENERGY_CONSERVATION
#define BASE_DIFFUSE_MODEL 0
#define DIELECTRIC_SPECULAR_MODEL 0
#define CONDUCTOR_SPECULAR_MODEL 0
#define CLEARCOAT_TEXTUREDIRECTUV 0
#define CLEARCOAT_TEXTURE_ROUGHNESSDIRECTUV 0
#define CLEARCOAT_BUMPDIRECTUV 0
#define CLEARCOAT_TINT_TEXTUREDIRECTUV 0
#define IRIDESCENCE_TEXTUREDIRECTUV 0
#define IRIDESCENCE_THICKNESS_TEXTUREDIRECTUV 0
#define ANISOTROPIC_TEXTUREDIRECTUV 0
#define MAINUV1
#define SHEEN_TEXTUREDIRECTUV 0
#define SHEEN_TEXTURE_ROUGHNESSDIRECTUV 0
#define SS_THICKNESSANDMASK_TEXTUREDIRECTUV 0
#define SS_REFRACTIONINTENSITY_TEXTUREDIRECTUV 0
#define SS_TRANSLUCENCYINTENSITY_TEXTUREDIRECTUV 0
#define SS_TRANSLUCENCYCOLOR_TEXTUREDIRECTUV 0
#define DETAILDIRECTUV 0
#define DETAIL_NORMALBLENDMETHOD 0
#define UV1
#define PREPASS_COLOR_INDEX -1
#define PREPASS_IRRADIANCE_LEGACY_INDEX -1
#define PREPASS_IRRADIANCE_INDEX -1
#define PREPASS_ALBEDO_INDEX -1
#define PREPASS_ALBEDO_SQRT_INDEX -1
#define PREPASS_DEPTH_INDEX -1
#define PREPASS_SCREENSPACE_DEPTH_INDEX -1
#define PREPASS_NORMALIZED_VIEW_DEPTH_INDEX -1
#define PREPASS_NORMAL_INDEX -1
#define PREPASS_WORLD_NORMAL_INDEX -1
#define PREPASS_POSITION_INDEX -1
#define PREPASS_LOCAL_POSITION_INDEX -1
#define PREPASS_VELOCITY_INDEX -1
#define PREPASS_VELOCITY_LINEAR_INDEX -1
#define PREPASS_REFLECTIVITY_INDEX -1
#define PREPASS_OBJECT_ID_INDEX -1
#define PREPASS_MESH_BLEND_TAG_INDEX -1
#define SCENE_MRT_COUNT 0
#define VIGNETTEBLENDMODEMULTIPLY
#define TONEMAPPING 0
#define SAMPLER3DGREENDEPTH
#define SAMPLER3DBGRMAP
#define PBR
#define NUM_SAMPLES 0
#define ALBEDO
#define GAMMAALBEDO
#define ALBEDODIRECTUV 1
#define BASE_WEIGHTDIRECTUV 0
#define BASE_DIFFUSE_ROUGHNESSDIRECTUV 0
#define AMBIENTDIRECTUV 0
#define OPACITYDIRECTUV 0
#define ALPHATESTVALUE 0.4
#define SPECULAROVERALPHA
#define RADIANCEOVERALPHA
#define EMISSIVEDIRECTUV 0
#define REFLECTIVITYDIRECTUV 0
#define SPECULARTERM
#define LODBASEDMICROSFURACE
#define MICROSURFACEMAPDIRECTUV 0
#define METALLICWORKFLOW
#define METALLIC_REFLECTANCEDIRECTUV 0
#define REFLECTANCEDIRECTUV 0
#define ENVIRONMENTBRDF
#define NORMAL
#define BUMPDIRECTUV 0
#define NORMALXYSCALE
#define LIGHTMAPDIRECTUV 0
#define RADIANCEOCCLUSION
#define HORIZONOCCLUSION
#define NUM_BONE_INFLUENCERS 0
#define BonesPerMesh 0
#define NUM_MORPH_INFLUENCERS 0
#define USEPHYSICALLIGHTFALLOFF
#define CAMERA_PERSPECTIVE
#define AREALIGHTSUPPORTED
#define TEXTURE_REPETITION_MODE 0
#define DEBUGMODE 0
#define VERTEX_PULLING_USE_INDEX_BUFFER
#define CLUSTLIGHT_SLICES 0
#define CLUSTLIGHT_BATCH 0
#define LIGHT0
#define DIRLIGHT0
#define LIGHT1
#define POINTLIGHT1
#define LIGHT2
#define HEMILIGHT2
#define LIGHTCOUNT 3
#define MAXLIGHTCOUNT 4

#define SHADER_NAME fragment:pbr
#define PBR_FRAGMENT_SHADER
#define CUSTOM_FRAGMENT_EXTENSION

#define CUSTOM_FRAGMENT_BEGIN
precision highp float;
#define FROMLINEARSPACE
layout(std140,column_major) uniform;
uniform Material {vec2 vAlbedoInfos;
vec2 vBaseWeightInfos;
vec2 vBaseDiffuseRoughnessInfos;
vec4 vAmbientInfos;
vec2 vOpacityInfos;
vec2 vEmissiveInfos;
vec2 vLightmapInfos;
vec3 vReflectivityInfos;
vec2 vMicroSurfaceSamplerInfos;
vec3 vBumpInfos;
mat4 albedoMatrix;
mat4 baseWeightMatrix;
mat4 baseDiffuseRoughnessMatrix;
mat4 ambientMatrix;
mat4 opacityMatrix;
mat4 emissiveMatrix;
mat4 lightmapMatrix;
mat4 reflectivityMatrix;
mat4 microSurfaceSamplerMatrix;
mat4 bumpMatrix;
vec2 vTangentSpaceParams;
vec4 vAlbedoColor;
float baseWeight;
float baseDiffuseRoughness;
vec4 vLightingIntensity;
float pointSize;
vec4 vReflectivityColor;
vec3 vEmissiveColor;
vec3 vAmbientColor;
vec2 vDebugMode;
vec4 vMetallicReflectanceFactors;
vec2 vMetallicReflectanceInfos;
mat4 metallicReflectanceMatrix;
vec2 vReflectanceInfos;
mat4 reflectanceMatrix;
vec4 cameraInfo;
vec4 vTextureRepetitionHexTilingParams;
vec2 vReflectionInfos;
mat4 reflectionMatrix;
vec3 vReflectionMicrosurfaceInfos;
vec3 vReflectionPosition;
vec3 vReflectionSize;
vec2 vReflectionFilteringInfo;
vec3 vReflectionDominantDirection;
vec3 vReflectionColor;
vec3 vSphericalL00;
vec3 vSphericalL1_1;
vec3 vSphericalL10;
vec3 vSphericalL11;
vec3 vSphericalL2_2;
vec3 vSphericalL2_1;
vec3 vSphericalL20;
vec3 vSphericalL21;
vec3 vSphericalL22;
vec3 vSphericalX;
vec3 vSphericalY;
vec3 vSphericalZ;
vec3 vSphericalXX_ZZ;
vec3 vSphericalYY_ZZ;
vec3 vSphericalZZ;
vec3 vSphericalXY;
vec3 vSphericalYZ;
vec3 vSphericalZX;
vec2 vClearCoatParams;
vec4 vClearCoatRefractionParams;
vec4 vClearCoatInfos;
mat4 clearCoatMatrix;
mat4 clearCoatRoughnessMatrix;
vec2 vClearCoatBumpInfos;
vec2 vClearCoatTangentSpaceParams;
mat4 clearCoatBumpMatrix;
vec4 vClearCoatTintParams;
float clearCoatColorAtDistance;
vec2 vClearCoatTintInfos;
mat4 clearCoatTintMatrix;
vec4 vIridescenceParams;
vec4 vIridescenceInfos;
mat4 iridescenceMatrix;
mat4 iridescenceThicknessMatrix;
vec3 vAnisotropy;
vec2 vAnisotropyInfos;
mat4 anisotropyMatrix;
vec4 vSheenColor;
float vSheenRoughness;
vec4 vSheenInfos;
mat4 sheenMatrix;
mat4 sheenRoughnessMatrix;
vec4 vRefractionMicrosurfaceInfos;
vec2 vRefractionFilteringInfo;
vec2 vTranslucencyIntensityInfos;
vec4 vRefractionInfos;
mat4 refractionMatrix;
vec2 vThicknessInfos;
vec2 vRefractionIntensityInfos;
mat4 thicknessMatrix;
mat4 refractionIntensityMatrix;
mat4 translucencyIntensityMatrix;
vec2 vThicknessParam;
vec3 vDiffusionDistance;
vec4 vTintColor;
vec3 vSubSurfaceIntensity;
vec3 vRefractionPosition;
vec3 vRefractionSize;
float scatteringDiffusionProfile;
float dispersion;
vec4 vTranslucencyColor;
vec2 vTranslucencyColorInfos;
mat4 translucencyColorMatrix;
vec4 vDetailInfos;
mat4 detailMatrix;
};
layout(std140,column_major) uniform;
uniform Scene {mat4 viewProjection;
mat4 view;
mat4 projection;
vec4 vEyePosition;
mat4 inverseProjection;
};
uniform mat4 world;
uniform float visibility;
#define WORLD_UBO
in vec3 vPositionW;
in vec2 vMainUV1;
in vec3 vNormalW;
uniform Light0
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec4 shadowsInfo;
vec2 depthValues;
} light0;
uniform Light1
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec4 vLightFalloff;
vec4 shadowsInfo;
vec2 depthValues;
} light1;
uniform Light2
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec3 vLightGround;
vec4 shadowsInfo;
vec2 depthValues;
} light2;
#define vAlbedoUV vMainUV1
uniform sampler2D albedoSampler;
uniform sampler2D environmentBrdfSampler;
#define TEXRD(s,uv) texture(s,uv)
#define TEXRD_DEFINED
const float PI=3.1415926535897932384626433832795;
const float TWO_PI=6.283185307179586;
const float HALF_PI=1.5707963267948966;
const float RECIPROCAL_PI=0.3183098861837907;
const float RECIPROCAL_PI2=0.15915494309189535;
const float RECIPROCAL_PI4=0.07957747154594767;
const float HALF_MIN=5.96046448e-08;
const float LinearEncodePowerApprox=2.2;
const float GammaEncodePowerApprox=1.0/LinearEncodePowerApprox;
const vec3 LuminanceEncodeApprox=vec3(0.2126,0.7152,0.0722);
const float Epsilon=0.0000001;
#define saturate(x) clamp(x,0.0,1.0)
#define absEps(x) abs(x)+Epsilon
#define maxEps(x) max(x,Epsilon)
#define saturateEps(x) clamp(x,Epsilon,1.0)
mat3 transposeMat3(mat3 inMatrix) {vec3 i0=inMatrix[0];
vec3 i1=inMatrix[1];
vec3 i2=inMatrix[2];
mat3 outMatrix=mat3(
vec3(i0.x,i1.x,i2.x),
vec3(i0.y,i1.y,i2.y),
vec3(i0.z,i1.z,i2.z)
);
return outMatrix;
}
mat3 inverseMat3(mat3 inMatrix) {float a00=inMatrix[0][0],a01=inMatrix[0][1],a02=inMatrix[0][2];
float a10=inMatrix[1][0],a11=inMatrix[1][1],a12=inMatrix[1][2];
float a20=inMatrix[2][0],a21=inMatrix[2][1],a22=inMatrix[2][2];
float b01=a22*a11-a12*a21;
float b11=-a22*a10+a12*a20;
float b21=a21*a10-a11*a20;
float det=a00*b01+a01*b11+a02*b21;
return mat3(b01,(-a22*a01+a02*a21),(a12*a01-a02*a11),
b11,(a22*a00-a02*a20),(-a12*a00+a02*a10),
b21,(-a21*a00+a01*a20),(a11*a00-a01*a10))/det;
}
float toLinearSpace(float color)
{
return pow(color,LinearEncodePowerApprox);
}
vec3 toLinearSpace(vec3 color)
{
return pow(color,vec3(LinearEncodePowerApprox));
}
vec4 toLinearSpace(vec4 color)
{
return vec4(pow(color.rgb,vec3(LinearEncodePowerApprox)),color.a);
}
float toGammaSpace(float color)
{
return pow(color,GammaEncodePowerApprox);
}
vec3 toGammaSpace(vec3 color)
{
return pow(color,vec3(GammaEncodePowerApprox));
}
vec4 toGammaSpace(vec4 color)
{
return vec4(pow(color.rgb,vec3(GammaEncodePowerApprox)),color.a);
}
float square(float value)
{return value*value;
}
vec3 square(vec3 value)
{return value*value;
}
float pow5(float value) {float sq=value*value;
return sq*sq*value;
}
vec3 double_refract(vec3 I,vec3 N,float eta) {vec3 Tfront=refract(I,N,1.0/eta);
vec3 Nback=normalize(reflect(N,Tfront));
return refract(Tfront,-Nback,eta);
}
float getLuminanceUnclamped(vec3 color)
{return dot(color,LuminanceEncodeApprox);
}
float getLuminance(vec3 color)
{return saturate(getLuminanceUnclamped(color));
}
float getRand(vec2 seed) {return fract(sin(dot(seed.xy ,vec2(12.9898,78.233)))*43758.5453);
}
float dither(vec2 seed,float varianceAmount) {float rand=getRand(seed);
float normVariance=varianceAmount/255.0;
float dither=mix(-normVariance,normVariance,rand);
return dither;
}
const float rgbdMaxRange=255.;
vec4 toRGBD(vec3 color) {float maxRGB=maxEps(max(color.r,max(color.g,color.b)));
float D =max(rgbdMaxRange/maxRGB,1.);
D =saturate(floor(D)/255.);
vec3 rgb=color.rgb*D;
rgb=toGammaSpace(rgb);
return vec4(saturate(rgb),D);
}
vec3 fromRGBD(vec4 rgbd) {rgbd.rgb=toLinearSpace(rgbd.rgb);
return rgbd.rgb/rgbd.a;
}
vec3 parallaxCorrectNormal( vec3 vertexPos,vec3 origVec,vec3 cubeSize,vec3 cubePos ) {vec3 invOrigVec=vec3(1.)/origVec;
vec3 halfSize=cubeSize*0.5;
vec3 intersecAtMaxPlane=(cubePos+halfSize-vertexPos)*invOrigVec;
vec3 intersecAtMinPlane=(cubePos-halfSize-vertexPos)*invOrigVec;
vec3 largestIntersec=max(intersecAtMaxPlane,intersecAtMinPlane);
float distance=min(min(largestIntersec.x,largestIntersec.y),largestIntersec.z);
vec3 intersectPositionWS=vertexPos+origVec*distance;
return intersectPositionWS-cubePos;
}
vec3 equirectangularToCubemapDirection(vec2 uv) {float longitude=uv.x*TWO_PI-PI;
float latitude=HALF_PI-uv.y*PI;
vec3 direction;
direction.x=cos(latitude)*sin(longitude);
direction.y=sin(latitude);
direction.z=cos(latitude)*cos(longitude);
return direction;
}
float sqrtClamped(float value) {return sqrt(max(value,0.));
}
float avg(vec3 value) {return dot(value,vec3(0.333333333));
}
precision highp int;
uint extractBits(uint value,int offset,int width) {return (value>>offset) & ((1u<<width)-1u);
}
int onlyBitPosition(uint value) {return (floatBitsToInt(float(value))>>23)-0x7f;
}
vec3 singleScatterToMultiScatterAlbedo(vec3 rho_ss) {vec3 s=sqrt(max(vec3(1.0)-rho_ss,vec3(0.0)));
return (vec3(1.0)-s)*(vec3(1.0)-vec3(0.139)*s)/(vec3(1.0)+vec3(1.17)*s);
}
vec3 multiScatterToSingleScatterAlbedo(vec3 rho_ms) {vec3 s=4.09712+4.20863*rho_ms-sqrt(9.59217+41.6808*rho_ms+17.7126*rho_ms*rho_ms);
return 1.0-s*s;
}
vec3 multiScatterToSingleScatterAlbedo(vec3 rho_ms,float aniso) {vec3 s=4.09712+4.20863*rho_ms-sqrt(9.59217+41.6808*rho_ms+17.7126*rho_ms*rho_ms);
return (1.0-s*s)/maxEps(1.0-aniso*s*s);
}
float min3(vec3 v) {return min(v.x,min(v.y,v.z));
}
float max3(vec3 v) {return max(v.x,max(v.y,v.z));
}
float uint2float(uint i) {return uintBitsToFloat(0x3F800000u | (i>>9u))-1.0;
}
vec2 plasticSequence(const uint rstate) {return vec2(uint2float(rstate*3242174889u),
uint2float(rstate*2447445414u));
}
bool testLightingForSSS(float diffusionProfile)
{return diffusionProfile<1.;
}
vec3 hemisphereCosSample(vec2 u) {float phi=2.*PI*u.x;
float cosTheta2=1.-u.y;
float cosTheta=sqrt(cosTheta2);
float sinTheta=sqrt(1.-cosTheta2);
return vec3(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
vec3 hemisphereImportanceSampleDggx(vec2 u,float a) {float phi=2.*PI*u.x;
float cosTheta2=(1.-u.y)/(1.+(a+1.)*((a-1.)*u.y));
float cosTheta=sqrt(cosTheta2);
float sinTheta=sqrt(1.-cosTheta2);
return vec3(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
vec3 hemisphereImportanceSampleDggxAnisotropic(vec2 Xi,float alphaTangent,float alphaBitangent)
{alphaTangent=max(alphaTangent,0.0001);
alphaBitangent=max(alphaBitangent,0.0001);
float phi=atan(alphaBitangent/alphaTangent*tan(2.0*3.14159265*Xi.x));
if (Xi.x>0.5) phi+=3.14159265;
float cosPhi=cos(phi);
float sinPhi=sin(phi);
float alpha2=(cosPhi*cosPhi)/(alphaTangent*alphaTangent) +
(sinPhi*sinPhi)/(alphaBitangent*alphaBitangent);
float tanTheta2=Xi.y/(1.0-Xi.y)/alpha2;
float cosTheta=1.0/sqrt(1.0+tanTheta2);
float sinTheta=sqrt(max(0.0,1.0-cosTheta*cosTheta));
return vec3(sinTheta*cosPhi,sinTheta*sinPhi,cosTheta);
}
vec3 hemisphereImportanceSampleDCharlie(vec2 u,float a) {
float phi=2.*PI*u.x;
float sinTheta=pow(u.y,a/(2.*a+1.));
float cosTheta=sqrt(1.-sinTheta*sinTheta);
return vec3(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
#define MINIMUMVARIANCE 0.0005
float convertRoughnessToAverageSlope(float roughness)
{return square(roughness)+MINIMUMVARIANCE;
}
float fresnelGrazingReflectance(float reflectance0) {float reflectance90=saturate(reflectance0*25.0);
return reflectance90;
}
vec2 getAARoughnessFactors(vec3 normalVector) {
return vec2(0.);
}
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_DEFINITIONS
vec4 applyImageProcessing(vec4 result) {
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATSTART
result.rgb=toGammaSpace(result.rgb);
result.rgb=saturate(result.rgb);
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATEND
return result;
}
struct preLightingInfo
{vec3 lightOffset;
float lightDistanceSquared;
float lightDistance;
float attenuation;
vec3 L;
vec3 H;
float NdotV;
float NdotLUnclamped;
float NdotL;
float VdotH;
float LdotV;
float roughness;
float diffuseRoughness;
vec3 surfaceAlbedo;
};
preLightingInfo computePointAndSpotPreLightingInfo(vec4 lightData,vec3 V,vec3 N,vec3 posW) {preLightingInfo result;
result.lightOffset=lightData.xyz-posW;
result.lightDistanceSquared=dot(result.lightOffset,result.lightOffset);
result.lightDistance=sqrt(result.lightDistanceSquared);
result.L=normalize(result.lightOffset);
result.H=normalize(V+result.L);
result.VdotH=saturate(dot(V,result.H));
result.NdotLUnclamped=dot(N,result.L);
result.NdotL=saturateEps(result.NdotLUnclamped);
result.LdotV=0.;
result.roughness=0.;
result.diffuseRoughness=0.;
result.surfaceAlbedo=vec3(0.);
return result;
}
preLightingInfo computeDirectionalPreLightingInfo(vec4 lightData,vec3 V,vec3 N) {preLightingInfo result;
result.lightDistance=length(-lightData.xyz);
result.L=normalize(-lightData.xyz);
result.H=normalize(V+result.L);
result.VdotH=saturate(dot(V,result.H));
result.NdotLUnclamped=dot(N,result.L);
result.NdotL=saturateEps(result.NdotLUnclamped);
result.LdotV=dot(result.L,V);
result.roughness=0.;
result.diffuseRoughness=0.;
result.surfaceAlbedo=vec3(0.);
return result;
}
preLightingInfo computeHemisphericPreLightingInfo(vec4 lightData,vec3 V,vec3 N) {preLightingInfo result;
result.NdotL=dot(N,lightData.xyz)*0.5+0.5;
result.NdotL=saturateEps(result.NdotL);
result.NdotLUnclamped=result.NdotL;
result.L=normalize(lightData.xyz);
result.H=normalize(V+result.L);
result.VdotH=saturate(dot(V,result.H));
result.LdotV=0.;
result.roughness=0.;
result.diffuseRoughness=0.;
result.surfaceAlbedo=vec3(0.);
return result;
}
float computeDistanceLightFalloff_Standard(vec3 lightOffset,float range)
{return max(0.,1.0-length(lightOffset)/range);
}
float computeDistanceLightFalloff_Physical(float lightDistanceSquared)
{return 1.0/maxEps(lightDistanceSquared);
}
float computeDistanceLightFalloff_GLTF(float lightDistanceSquared,float inverseSquaredRange)
{float lightDistanceFalloff=1.0/maxEps(lightDistanceSquared);
float factor=lightDistanceSquared*inverseSquaredRange;
float attenuation=saturate(1.0-factor*factor);
attenuation*=attenuation;
lightDistanceFalloff*=attenuation;
return lightDistanceFalloff;
}
float computeDistanceLightFalloff(vec3 lightOffset,float lightDistanceSquared,float range,float inverseSquaredRange)
{
return computeDistanceLightFalloff_Physical(lightDistanceSquared);
}
float computeDirectionalLightFalloff_Standard(vec3 lightDirection,vec3 directionToLightCenterW,float cosHalfAngle,float exponent)
{float falloff=0.0;
float cosAngle=maxEps(dot(-lightDirection,directionToLightCenterW));
if (cosAngle>=cosHalfAngle)
{falloff=max(0.,pow(cosAngle,exponent));
}
return falloff;
}
float computeDirectionalLightFalloff_IES(vec3 lightDirection,vec3 directionToLightCenterW,sampler2D iesLightSampler)
{float cosAngle=dot(-lightDirection,directionToLightCenterW);
float angle=acos(cosAngle)/PI;
return texture(iesLightSampler,vec2(angle,0.)).r;
}
float computeDirectionalLightFalloff_Physical(vec3 lightDirection,vec3 directionToLightCenterW,float cosHalfAngle)
{const float kMinusLog2ConeAngleIntensityRatio=6.64385618977;
float concentrationKappa=kMinusLog2ConeAngleIntensityRatio/(1.0-cosHalfAngle);
vec4 lightDirectionSpreadSG=vec4(-lightDirection*concentrationKappa,-concentrationKappa);
float falloff=exp2(dot(vec4(directionToLightCenterW,1.0),lightDirectionSpreadSG));
return falloff;
}
float computeDirectionalLightFalloff_GLTF(vec3 lightDirection,vec3 directionToLightCenterW,float lightAngleScale,float lightAngleOffset)
{float cd=dot(-lightDirection,directionToLightCenterW);
float falloff=saturate(cd*lightAngleScale+lightAngleOffset);
falloff*=falloff;
return falloff;
}
float computeDirectionalLightFalloff(vec3 lightDirection,vec3 directionToLightCenterW,float cosHalfAngle,float exponent,float lightAngleScale,float lightAngleOffset)
{
return computeDirectionalLightFalloff_Physical(lightDirection,directionToLightCenterW,cosHalfAngle);
}
#define FRESNEL_MAXIMUM_ON_ROUGH 0.25
#define BRDF_DIFFUSE_MODEL_EON 0
#define BRDF_DIFFUSE_MODEL_BURLEY 1
#define BRDF_DIFFUSE_MODEL_LAMBERT 2
#define BRDF_DIFFUSE_MODEL_LEGACY 3
#define DIELECTRIC_SPECULAR_MODEL_GLTF 0
#define DIELECTRIC_SPECULAR_MODEL_OPENPBR 1
#define CONDUCTOR_SPECULAR_MODEL_GLTF 0
#define CONDUCTOR_SPECULAR_MODEL_OPENPBR 1
vec3 getEnergyConservationFactor(const vec3 specularEnvironmentR0,const vec3 environmentBrdf) {return 1.0+specularEnvironmentR0*(1.0/environmentBrdf.y-1.0);
}
vec3 getBRDFLookup(float NdotV,float perceptualRoughness) {vec2 UV=vec2(NdotV,perceptualRoughness);
vec4 brdfLookup=texture(environmentBrdfSampler,UV);
return brdfLookup.rgb;
}
vec3 getReflectanceFromBRDFLookup(const vec3 specularEnvironmentR0,const vec3 specularEnvironmentR90,const vec3 environmentBrdf) {
vec3 reflectance=(specularEnvironmentR90-specularEnvironmentR0)*environmentBrdf.x+specularEnvironmentR0*environmentBrdf.y;
return reflectance;
}
vec3 getReflectanceFromBRDFLookup(const vec3 specularEnvironmentR0,const vec3 environmentBrdf) {
vec3 reflectance=mix(environmentBrdf.xxx,environmentBrdf.yyy,specularEnvironmentR0);
return reflectance;
}
/* NOT USED
*/
vec3 fresnelSchlickGGX(float VdotH,vec3 reflectance0,vec3 reflectance90)
{return reflectance0+(reflectance90-reflectance0)*pow5(1.0-VdotH);
}
float fresnelSchlickGGX(float VdotH,float reflectance0,float reflectance90)
{return reflectance0+(reflectance90-reflectance0)*pow5(1.0-VdotH);
}
float normalDistributionFunction_TrowbridgeReitzGGX(float NdotH,float alphaG)
{float a2=square(alphaG);
float d=NdotH*NdotH*(a2-1.0)+1.0;
return a2/(PI*d*d);
}
float smithVisibility_GGXCorrelated(float NdotL,float NdotV,float alphaG) {
float a2=alphaG*alphaG;
float GGXV=NdotL*sqrt(NdotV*(NdotV-a2*NdotV)+a2);
float GGXL=NdotV*sqrt(NdotL*(NdotL-a2*NdotL)+a2);
return 0.5/(GGXV+GGXL);
}
float diffuseBRDF_Burley(float NdotL,float NdotV,float VdotH,float roughness) {float diffuseFresnelNV=pow5(saturateEps(1.0-NdotL));
float diffuseFresnelNL=pow5(saturateEps(1.0-NdotV));
float diffuseFresnel90=0.5+2.0*VdotH*VdotH*roughness;
float fresnel =
(1.0+(diffuseFresnel90-1.0)*diffuseFresnelNL) *
(1.0+(diffuseFresnel90-1.0)*diffuseFresnelNV);
return fresnel/PI;
}
const float constant1_FON=0.5-2.0/(3.0*PI);
const float constant2_FON=2.0/3.0-28.0/(15.0*PI);
float E_FON_approx(float mu,float roughness)
{float sigma=roughness;
float mucomp=1.0-mu;
float mucomp2=mucomp*mucomp;
const mat2 Gcoeffs=mat2(0.0571085289,-0.332181442,
0.491881867,0.0714429953);
float GoverPi=dot(Gcoeffs*vec2(mucomp,mucomp2),vec2(1.0,mucomp2));
return (1.0+sigma*GoverPi)/(1.0+constant1_FON*sigma);
}
vec3 diffuseBRDF_EON(vec3 albedo,float roughness,float NdotL,float NdotV,float LdotV)
{vec3 rho=albedo;
float sigma=roughness;
float mu_i=NdotL;
float mu_o=NdotV;
float s=LdotV-mu_i*mu_o;
float sovertF=s>0.0 ? s/max(mu_i,mu_o) : s;
float AF=1.0/(1.0+constant1_FON*sigma);
vec3 f_ss=(rho*RECIPROCAL_PI)*AF*(1.0+sigma*sovertF);
float EFo=E_FON_approx(mu_o,sigma);
float EFi=E_FON_approx(mu_i,sigma);
float avgEF=AF*(1.0+constant2_FON*sigma);
vec3 rho_ms=(rho*rho)*avgEF/(vec3(1.0)-rho*(1.0-avgEF));
const float eps=1.0e-7;
vec3 f_ms=(rho_ms*RECIPROCAL_PI)*max(eps,1.0-EFo)
* max(eps,1.0-EFi)
/ max(eps,1.0-avgEF);
return (f_ss+f_ms);
}
#define CLEARCOATREFLECTANCE90 1.0
struct lightingInfo
{vec3 diffuse;
vec3 specular;
};
float adjustRoughnessFromLightProperties(float roughness,float lightRadius,float lightDistance) {
float lightRoughness=lightRadius/lightDistance;
float totalRoughness=saturate(lightRoughness+roughness);
return totalRoughness;
}
vec3 computeHemisphericDiffuseLighting(preLightingInfo info,vec3 lightColor,vec3 groundColor) {return mix(groundColor,lightColor,info.NdotL);
}
vec3 computeDiffuseLighting(preLightingInfo info,vec3 lightColor) {vec3 diffuseTerm=vec3(1.0/PI);
vec3 clampedAlbedo=clamp(info.surfaceAlbedo,vec3(0.1),vec3(1.0));
diffuseTerm=diffuseBRDF_EON(clampedAlbedo,info.diffuseRoughness,info.NdotL,info.NdotV,info.LdotV);
diffuseTerm/=clampedAlbedo;
return diffuseTerm*info.attenuation*info.NdotL*lightColor;
}
#define inline
vec3 computeProjectionTextureDiffuseLighting(sampler2D projectionLightSampler,mat4 textureProjectionMatrix,vec3 posW){vec4 strq=textureProjectionMatrix*vec4(posW,1.0);
strq/=strq.w;
vec3 textureColor=texture(projectionLightSampler,strq.xy).rgb;
return toLinearSpace(textureColor);
}
vec3 computeSpecularLighting(preLightingInfo info,vec3 N,vec3 reflectance0,vec3 fresnel,float geometricRoughnessFactor,vec3 lightColor) {float NdotH=saturateEps(dot(N,info.H));
float roughness=max(info.roughness,geometricRoughnessFactor);
float alphaG=convertRoughnessToAverageSlope(roughness);
float distribution=normalDistributionFunction_TrowbridgeReitzGGX(NdotH,alphaG);
float smithVisibility=smithVisibility_GGXCorrelated(info.NdotL,info.NdotV,alphaG);
vec3 specTerm=fresnel*distribution*smithVisibility;
return specTerm*info.attenuation*info.NdotL*lightColor;
}
float environmentRadianceOcclusion(float ambientOcclusion,float NdotVUnclamped) {float temp=NdotVUnclamped+ambientOcclusion;
return saturate(square(temp)-1.0+ambientOcclusion);
}
float environmentHorizonOcclusion(vec3 view,vec3 normal,vec3 geometricNormal) {vec3 reflection=reflect(view,normal);
float temp=saturate(1.0+1.1*dot(reflection,geometricNormal));
return square(temp);
}
#define CUSTOM_FRAGMENT_DEFINITIONS
struct albedoOpacityOutParams
{vec3 surfaceAlbedo;
float alpha;
};
#define pbr_inline
albedoOpacityOutParams albedoOpacityBlock(
in vec4 vAlbedoColor
,in vec4 albedoTexture
,in vec2 albedoInfos
,in float baseWeight
)
{albedoOpacityOutParams outParams;
vec3 surfaceAlbedo=vAlbedoColor.rgb;
float alpha=vAlbedoColor.a;
surfaceAlbedo*=toLinearSpace(albedoTexture.rgb);
surfaceAlbedo*=albedoInfos.y;
#define CUSTOM_FRAGMENT_UPDATE_ALBEDO
surfaceAlbedo*=baseWeight;
outParams.surfaceAlbedo=surfaceAlbedo;
outParams.alpha=alpha;
return outParams;
}
struct reflectivityOutParams
{float microSurface;
float roughness;
float diffuseRoughness;
float reflectanceF0;
vec3 reflectanceF90;
vec3 colorReflectanceF0;
vec3 colorReflectanceF90;
vec3 surfaceAlbedo;
float metallic;
float specularWeight;
vec3 dielectricColorF0;
};
#define pbr_inline
reflectivityOutParams reflectivityBlock(
in vec4 reflectivityColor
,in vec3 surfaceAlbedo
,in vec4 metallicReflectanceFactors
,in float baseDiffuseRoughness
)
{reflectivityOutParams outParams;
float microSurface=reflectivityColor.a;
vec3 surfaceReflectivityColor=reflectivityColor.rgb;
vec2 metallicRoughness=surfaceReflectivityColor.rg;
float ior=surfaceReflectivityColor.b;
#define CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS
microSurface=1.0-metallicRoughness.g;
vec3 baseColor=surfaceAlbedo;
outParams.metallic=metallicRoughness.r;
outParams.specularWeight=metallicReflectanceFactors.a;
float dielectricF0=reflectivityColor.a*outParams.specularWeight;
surfaceReflectivityColor=metallicReflectanceFactors.rgb;
outParams.surfaceAlbedo=baseColor.rgb*(vec3(1.0)-vec3(dielectricF0)*surfaceReflectivityColor)*(1.0-outParams.metallic);
{vec3 reflectivityColor=mix(dielectricF0*surfaceReflectivityColor,baseColor.rgb,outParams.metallic);
outParams.reflectanceF0=max(reflectivityColor.r,max(reflectivityColor.g,reflectivityColor.b));
}
outParams.reflectanceF90=vec3(outParams.specularWeight);
float f90Scale=1.0;
outParams.dielectricColorF0=vec3(dielectricF0*surfaceReflectivityColor);
vec3 metallicColorF0=baseColor.rgb;
outParams.colorReflectanceF0=mix(outParams.dielectricColorF0,metallicColorF0,outParams.metallic);
vec3 dielectricColorF90=vec3(outParams.specularWeight*f90Scale);
vec3 conductorColorF90=outParams.reflectanceF90;
outParams.colorReflectanceF90=mix(dielectricColorF90,conductorColorF90,outParams.metallic);
microSurface=saturate(microSurface);
float roughness=1.-microSurface;
float diffuseRoughness=baseDiffuseRoughness;
outParams.microSurface=microSurface;
outParams.roughness=roughness;
outParams.diffuseRoughness=diffuseRoughness;
return outParams;
}
struct ambientOcclusionOutParams
{vec3 ambientOcclusionColor;
};
ambientOcclusionOutParams ambientOcclusionBlock(
)
{ambientOcclusionOutParams outParams;
vec3 ambientOcclusionColor=vec3(1.,1.,1.);
outParams.ambientOcclusionColor=ambientOcclusionColor;
return outParams;
}
struct clearcoatOutParams
{vec3 specularEnvironmentR0;
float conservationFactor;
vec3 clearCoatNormalW;
vec2 clearCoatAARoughnessFactors;
float clearCoatIntensity;
float clearCoatRoughness;
vec3 energyConservationFactorClearCoat;
};
struct iridescenceOutParams
{float iridescenceIntensity;
float iridescenceIOR;
float iridescenceThickness;
vec3 specularEnvironmentR0;
};
struct subSurfaceOutParams
{vec3 specularEnvironmentReflectance;
};
layout(location = 0) out vec4 glFragColor;
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec3 normalW=normalize(vNormalW);
vec3 geometricNormalW=normalW;
vec2 uvOffset=vec2(0.0,0.0);
albedoOpacityOutParams albedoOpacityOut;
vec4 albedoTexture=TEXRD(albedoSampler,vAlbedoUV+uvOffset);
albedoOpacityOut=albedoOpacityBlock(
vAlbedoColor
,albedoTexture
,vAlbedoInfos
,baseWeight
);
vec3 surfaceAlbedo=albedoOpacityOut.surfaceAlbedo;
float alpha=albedoOpacityOut.alpha;
#define CUSTOM_FRAGMENT_UPDATE_ALPHA
#define CUSTOM_FRAGMENT_BEFORE_LIGHTS
ambientOcclusionOutParams aoOut;
aoOut=ambientOcclusionBlock(
);
vec3 baseColor=surfaceAlbedo;
reflectivityOutParams reflectivityOut;
vec4 metallicReflectanceFactors=vMetallicReflectanceFactors;
reflectivityOut=reflectivityBlock(
vReflectivityColor
,surfaceAlbedo
,metallicReflectanceFactors
,baseDiffuseRoughness
);
float microSurface=reflectivityOut.microSurface;
float roughness=reflectivityOut.roughness;
float diffuseRoughness=reflectivityOut.diffuseRoughness;
surfaceAlbedo=reflectivityOut.surfaceAlbedo;
float NdotVUnclamped=dot(normalW,viewDirectionW);
float NdotV=absEps(NdotVUnclamped);
float alphaG=convertRoughnessToAverageSlope(roughness);
vec2 AARoughnessFactors=getAARoughnessFactors(normalW.xyz);
vec3 environmentBrdf=getBRDFLookup(NdotV,roughness);
float ambientMonochrome=getLuminance(aoOut.ambientOcclusionColor);
float seo=environmentRadianceOcclusion(ambientMonochrome,NdotVUnclamped);
float reflectanceF0=reflectivityOut.reflectanceF0;
vec3 specularEnvironmentR0=reflectivityOut.colorReflectanceF0;
vec3 specularEnvironmentR90=reflectivityOut.colorReflectanceF90;
clearcoatOutParams clearcoatOut;
clearcoatOut.specularEnvironmentR0=specularEnvironmentR0;
vec3 baseSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(vec3(reflectanceF0),reflectivityOut.reflectanceF90,environmentBrdf);
vec3 colorSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90,environmentBrdf);
colorSpecularEnvironmentReflectance*=seo;
subSurfaceOutParams subSurfaceOut;
subSurfaceOut.specularEnvironmentReflectance=colorSpecularEnvironmentReflectance;
vec3 diffuseBase=vec3(0.,0.,0.);
vec3 specularBase=vec3(0.,0.,0.);
vec3 coloredFresnel;
preLightingInfo preInfo;
lightingInfo info;
float shadow=1.;
float aggShadow=0.;
float numLights=0.;
vec4 diffuse0=light0.vLightDiffuse;
#define CUSTOM_LIGHT0_COLOR 
preInfo=computeDirectionalPreLightingInfo(light0.vLightData,viewDirectionW,normalW);
preInfo.NdotV=NdotV;
preInfo.attenuation=1.0;
preInfo.roughness=adjustRoughnessFromLightProperties(roughness,light0.vLightSpecular.a,preInfo.lightDistance);
preInfo.diffuseRoughness=diffuseRoughness;
preInfo.surfaceAlbedo=surfaceAlbedo;
info.diffuse=computeDiffuseLighting(preInfo,diffuse0.rgb);
coloredFresnel=fresnelSchlickGGX(preInfo.VdotH,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90);
info.specular=computeSpecularLighting(preInfo,normalW,clearcoatOut.specularEnvironmentR0,coloredFresnel,AARoughnessFactors.x,diffuse0.rgb);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse1=light1.vLightDiffuse;
#define CUSTOM_LIGHT1_COLOR 
preInfo=computePointAndSpotPreLightingInfo(light1.vLightData,viewDirectionW,normalW,vPositionW);
preInfo.NdotV=NdotV;
preInfo.attenuation=computeDistanceLightFalloff(preInfo.lightOffset,preInfo.lightDistanceSquared,light1.vLightFalloff.x,light1.vLightFalloff.y);
preInfo.roughness=adjustRoughnessFromLightProperties(roughness,light1.vLightSpecular.a,preInfo.lightDistance);
preInfo.diffuseRoughness=diffuseRoughness;
preInfo.surfaceAlbedo=surfaceAlbedo;
info.diffuse=computeDiffuseLighting(preInfo,diffuse1.rgb);
coloredFresnel=fresnelSchlickGGX(preInfo.VdotH,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90);
info.specular=computeSpecularLighting(preInfo,normalW,clearcoatOut.specularEnvironmentR0,coloredFresnel,AARoughnessFactors.x,diffuse1.rgb);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse2=light2.vLightDiffuse;
#define CUSTOM_LIGHT2_COLOR 
preInfo=computeHemisphericPreLightingInfo(light2.vLightData,viewDirectionW,normalW);
preInfo.NdotV=NdotV;
preInfo.attenuation=1.0;
preInfo.roughness=roughness;
preInfo.diffuseRoughness=diffuseRoughness;
preInfo.surfaceAlbedo=surfaceAlbedo;
info.diffuse=computeHemisphericDiffuseLighting(preInfo,diffuse2.rgb,light2.vLightGround);
coloredFresnel=fresnelSchlickGGX(preInfo.VdotH,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90);
info.specular=computeSpecularLighting(preInfo,normalW,clearcoatOut.specularEnvironmentR0,coloredFresnel,AARoughnessFactors.x,diffuse2.rgb);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
aggShadow=aggShadow/numLights;
vec3 baseSpecularEnergyConservationFactor=getEnergyConservationFactor(vec3(reflectanceF0),environmentBrdf);
vec3 coloredEnergyConservationFactor=getEnergyConservationFactor(clearcoatOut.specularEnvironmentR0,environmentBrdf);
vec3 finalSpecular=specularBase;
finalSpecular=max(finalSpecular,0.0);
vec3 finalSpecularScaled=finalSpecular*vLightingIntensity.x*vLightingIntensity.w;
finalSpecularScaled*=coloredEnergyConservationFactor;
vec3 finalDiffuse=diffuseBase;
finalDiffuse*=surfaceAlbedo;
finalDiffuse=max(finalDiffuse,0.0);
finalDiffuse*=vLightingIntensity.x;
vec3 finalAmbient=vAmbientColor;
finalAmbient*=surfaceAlbedo.rgb;
vec3 finalEmissive=vEmissiveColor;
finalEmissive*=vLightingIntensity.y;
vec3 ambientOcclusionForDirectDiffuse=aoOut.ambientOcclusionColor;
finalAmbient*=aoOut.ambientOcclusionColor;
finalDiffuse*=ambientOcclusionForDirectDiffuse;
#define CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION
vec4 finalColor=vec4(
finalSpecularScaled +
finalAmbient +
finalDiffuse,
alpha);
finalColor.rgb+=finalEmissive;
#define CUSTOM_FRAGMENT_BEFORE_FOG
finalColor=max(finalColor,0.0);
finalColor=applyImageProcessing(finalColor);
finalColor.a*=visibility;
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
glFragColor=finalColor;
#define CUSTOM_FRAGMENT_MAIN_END
}
