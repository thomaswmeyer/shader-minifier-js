#version 300 es
#define WEBGL2 
#define MATERIALPLUGIN_1
#define DETAILDIRECTUV 0
#define DETAIL_NORMALBLENDMETHOD 0
#define MAINUV1
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
#define DIFFUSE
#define DIFFUSEDIRECTUV 1
#define AMBIENTDIRECTUV 0
#define OPACITYDIRECTUV 0
#define EMISSIVE
#define EMISSIVEDIRECTUV 1
#define SPECULARDIRECTUV 0
#define BUMP
#define BUMPDIRECTUV 1
#define PARALLAX
#define FOG
#define SPECULARTERM
#define NORMAL
#define NUM_BONE_INFLUENCERS 0
#define BonesPerMesh 0
#define LIGHTMAPDIRECTUV 0
#define NUM_MORPH_INFLUENCERS 0
#define ALPHABLEND
#define CAMERA_PERSPECTIVE
#define AREALIGHTSUPPORTED
#define VERTEX_PULLING_USE_INDEX_BUFFER
#define CLUSTLIGHT_SLICES 0
#define CLUSTLIGHT_BATCH 0
#define TEXTURE_REPETITION_MODE 0
#define LIGHT0
#define DIRLIGHT0
#define LIGHT1
#define POINTLIGHT1
#define LIGHT2
#define HEMILIGHT2
#define LIGHTCOUNT 3
#define MAXLIGHTCOUNT 4

#define SHADER_NAME fragment:default
precision highp float;
#define CUSTOM_FRAGMENT_EXTENSION
layout(std140,column_major) uniform;
uniform Material
{vec4 diffuseLeftColor;
vec4 diffuseRightColor;
vec4 opacityParts;
vec4 reflectionLeftColor;
vec4 reflectionRightColor;
vec4 refractionLeftColor;
vec4 refractionRightColor;
vec4 emissiveLeftColor;
vec4 emissiveRightColor;
vec2 vDiffuseInfos;
vec2 vAmbientInfos;
vec2 vOpacityInfos;
vec2 vEmissiveInfos;
vec2 vLightmapInfos;
vec2 vSpecularInfos;
vec3 vBumpInfos;
mat4 diffuseMatrix;
mat4 ambientMatrix;
mat4 opacityMatrix;
mat4 emissiveMatrix;
mat4 lightmapMatrix;
mat4 specularMatrix;
mat4 bumpMatrix;
vec2 vTangentSpaceParams;
float pointSize;
float alphaCutOff;
mat4 refractionMatrix;
vec4 vRefractionInfos;
vec3 vRefractionPosition;
vec3 vRefractionSize;
vec4 vSpecularColor;
vec3 vEmissiveColor;
vec4 vDiffuseColor;
vec3 vAmbientColor;
vec4 cameraInfo;
vec4 vTextureRepetitionHexTilingParams;
vec2 vReflectionInfos;
mat4 reflectionMatrix;
vec3 vReflectionPosition;
vec3 vReflectionSize;
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

#define CUSTOM_FRAGMENT_BEGIN
in vec3 vPositionW;
in vec3 vNormalW;
in vec2 vMainUV1;
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
struct lightingInfo
{vec3 diffuse;
vec3 specular;
};
lightingInfo computeLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec3 diffuseColor,vec3 specularColor,float range,float glossiness) {lightingInfo result;
vec3 lightVectorW;
float attenuation=1.0;
if (lightData.w==0.)
{vec3 direction=lightData.xyz-vPositionW;
attenuation=max(0.,1.0-length(direction)/range);
lightVectorW=normalize(direction);
}
else
{lightVectorW=normalize(-lightData.xyz);
}
float ndl=max(0.,dot(vNormal,lightVectorW));
result.diffuse=ndl*diffuseColor*attenuation;
vec3 angleW=normalize(viewDirectionW+lightVectorW);
float specComp=max(0.,dot(vNormal,angleW));
specComp=pow(specComp,max(1.,glossiness));
result.specular=specComp*specularColor*attenuation;
return result;
}
float getAttenuation(float cosAngle,float exponent) {return max(0.,pow(cosAngle,exponent));
}
float getIESAttenuation(float cosAngle,sampler2D iesLightSampler) {float angle=acos(cosAngle)/PI;
return texture(iesLightSampler,vec2(angle,0.)).r;
}
lightingInfo basicSpotLighting(vec3 viewDirectionW,vec3 lightVectorW,vec3 vNormal,float attenuation,vec3 diffuseColor,vec3 specularColor,float glossiness) {lightingInfo result;
float ndl=max(0.,dot(vNormal,lightVectorW));
result.diffuse=ndl*diffuseColor*attenuation;
vec3 angleW=normalize(viewDirectionW+lightVectorW);
float specComp=max(0.,dot(vNormal,angleW));
specComp=pow(specComp,max(1.,glossiness));
result.specular=specComp*specularColor*attenuation;
return result;
}
lightingInfo computeIESSpotLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec4 lightDirection,vec3 diffuseColor,vec3 specularColor,float range,float glossiness,sampler2D iesLightSampler) {
vec3 direction=lightData.xyz-vPositionW;
vec3 lightVectorW=normalize(direction);
float attenuation=max(0.,1.0-length(direction)/range);
float dotProduct=dot(lightDirection.xyz,-lightVectorW);
float cosAngle=max(0.,dotProduct);
if (cosAngle>=lightDirection.w)
{
attenuation*=getIESAttenuation(dotProduct,iesLightSampler);
return basicSpotLighting(viewDirectionW,lightVectorW,vNormal,attenuation,diffuseColor,specularColor,glossiness);
}
lightingInfo result;
result.diffuse=vec3(0.);
result.specular=vec3(0.);
return result;
}
lightingInfo computeSpotLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec4 lightDirection,vec3 diffuseColor,vec3 specularColor,float range,float glossiness) {vec3 direction=lightData.xyz-vPositionW;
vec3 lightVectorW=normalize(direction);
float attenuation=max(0.,1.0-length(direction)/range);
float cosAngle=max(0.,dot(lightDirection.xyz,-lightVectorW));
if (cosAngle>=lightDirection.w)
{
attenuation*=getAttenuation(cosAngle,lightData.w);
return basicSpotLighting(viewDirectionW,lightVectorW,vNormal,attenuation,diffuseColor,specularColor,glossiness);
}
lightingInfo result;
result.diffuse=vec3(0.);
result.specular=vec3(0.);
return result;
}
lightingInfo computeHemisphericLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec3 diffuseColor,vec3 specularColor,vec3 groundColor,float glossiness) {lightingInfo result;
float ndl=dot(vNormal,lightData.xyz)*0.5+0.5;
result.diffuse=mix(groundColor,diffuseColor,ndl);
vec3 angleW=normalize(viewDirectionW+lightData.xyz);
float specComp=max(0.,dot(vNormal,angleW));
specComp=pow(specComp,max(1.,glossiness));
result.specular=specComp*specularColor;
return result;
}
#define inline
vec3 computeProjectionTextureDiffuseLighting(sampler2D projectionLightSampler,mat4 textureProjectionMatrix,vec3 posW){vec4 strq=textureProjectionMatrix*vec4(posW,1.0);
strq/=strq.w;
vec3 textureColor=texture(projectionLightSampler,strq.xy).rgb;
return textureColor;
}
#define vDiffuseUV vMainUV1
uniform sampler2D diffuseSampler;
#define vEmissiveUV vMainUV1
uniform sampler2D emissiveSampler;
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_DEFINITIONS
vec4 applyImageProcessing(vec4 result) {
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATSTART
result.rgb=toGammaSpace(result.rgb);
result.rgb=saturate(result.rgb);
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATEND
return result;
}
#define TEXRD(s,uv) texture(s,uv)
#define TEXRD_DEFINED
vec3 perturbNormalBase(mat3 cotangentFrame,vec3 normal,float scale)
{
return normalize(cotangentFrame*normal);
}
vec3 perturbNormal(mat3 cotangentFrame,vec3 textureSample,float scale)
{return perturbNormalBase(cotangentFrame,textureSample*2.0-1.0,scale);
}
mat3 cotangent_frame(vec3 normal,vec3 p,vec2 uv,vec2 tangentSpaceParams)
{vec3 dp1=dFdx(p);
vec3 dp2=dFdy(p);
vec2 duv1=dFdx(uv);
vec2 duv2=dFdy(uv);
vec3 dp2perp=cross(dp2,normal);
vec3 dp1perp=cross(normal,dp1);
vec3 tangent=dp2perp*duv1.x+dp1perp*duv2.x;
vec3 bitangent=dp2perp*duv1.y+dp1perp*duv2.y;
tangent*=tangentSpaceParams.x;
bitangent*=tangentSpaceParams.y;
float det=max(dot(tangent,tangent),dot(bitangent,bitangent));
float invmax=det==0.0 ? 0.0 : inversesqrt(det);
return mat3(tangent*invmax,bitangent*invmax,normal);
}
#define vBumpUV vMainUV1
uniform sampler2D bumpSampler;
const float minSamples=4.;
const float maxSamples=15.;
const int iMaxSamples=15;
vec2 parallaxOcclusion(vec3 vViewDirCoT,vec3 vNormalCoT,vec2 texCoord,float parallaxScale) {float parallaxLimit=length(vViewDirCoT.xy)/vViewDirCoT.z;
parallaxLimit*=parallaxScale;
vec2 vOffsetDir=normalize(vViewDirCoT.xy);
vec2 vMaxOffset=vOffsetDir*parallaxLimit;
float numSamples=maxSamples+(dot(vViewDirCoT,vNormalCoT)*(minSamples-maxSamples));
float stepSize=1.0/numSamples;
float currRayHeight=1.0;
vec2 vCurrOffset=vec2(0,0);
vec2 vLastOffset=vec2(0,0);
float lastSampledHeight=1.0;
float currSampledHeight=1.0;
bool keepWorking=true;
for (int i=0;
i<iMaxSamples;
i++)
{currSampledHeight=texture(bumpSampler,texCoord+vCurrOffset).w;
if (!keepWorking)
{}
else if (currSampledHeight>currRayHeight)
{float delta1=currSampledHeight-currRayHeight;
float delta2=(currRayHeight+stepSize)-lastSampledHeight;
float ratio=delta1/(delta1+delta2);
vCurrOffset=(ratio)* vLastOffset+(1.0-ratio)*vCurrOffset;
keepWorking=false;
}
else
{currRayHeight-=stepSize;
vLastOffset=vCurrOffset;
vCurrOffset+=stepSize*vMaxOffset;
lastSampledHeight=currSampledHeight;
}}
return vCurrOffset;
}
vec2 parallaxOffset(vec3 viewDir,float heightScale)
{float height=texture(bumpSampler,vBumpUV).w;
vec2 texCoordOffset=heightScale*viewDir.xy*height;
return -texCoordOffset;
}
#define FOGMODE_NONE 0.
#define FOGMODE_EXP 1.
#define FOGMODE_EXP2 2.
#define FOGMODE_LINEAR 3.
#define E 2.71828
uniform vec4 vFogInfos;
uniform vec3 vFogColor;
in vec3 vFogDistance;
float CalcFogFactor()
{float fogCoeff=1.0;
float fogStart=vFogInfos.y;
float fogEnd=vFogInfos.z;
float fogDensity=vFogInfos.w;
float fogDistance=length(vFogDistance);
if (FOGMODE_LINEAR==vFogInfos.x)
{fogCoeff=(fogEnd-fogDistance)/(fogEnd-fogStart);
}
else if (FOGMODE_EXP==vFogInfos.x)
{fogCoeff=1.0/pow(E,fogDistance*fogDensity);
}
else if (FOGMODE_EXP2==vFogInfos.x)
{fogCoeff=1.0/pow(E,fogDistance*fogDistance*fogDensity*fogDensity);
}
return clamp(fogCoeff,0.0,1.0);
}
#define CUSTOM_FRAGMENT_DEFINITIONS
layout(location = 0) out vec4 glFragColor;
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec4 baseColor=vec4(1.,1.,1.,1.);
vec3 diffuseColor=vDiffuseColor.rgb;
float alpha=vDiffuseColor.a;
vec3 normalW=normalize(vNormalW);
vec2 uvOffset=vec2(0.0,0.0);
float normalScale=vBumpInfos.y;
vec2 TBNUV=gl_FrontFacing ? vBumpUV : -vBumpUV;
mat3 TBN=cotangent_frame(normalW*normalScale,vPositionW,TBNUV,vTangentSpaceParams);
mat3 invTBN=transposeMat3(TBN);
uvOffset=parallaxOffset(invTBN*viewDirectionW,vBumpInfos.z);
normalW=perturbNormal(TBN,TEXRD(bumpSampler,vBumpUV+uvOffset).xyz,vBumpInfos.y);
baseColor=TEXRD(diffuseSampler,vDiffuseUV+uvOffset);
#define CUSTOM_FRAGMENT_UPDATE_ALPHA
baseColor.rgb*=vDiffuseInfos.y;
#define CUSTOM_FRAGMENT_UPDATE_DIFFUSE
vec3 baseAmbientColor=vec3(1.,1.,1.);
#define CUSTOM_FRAGMENT_BEFORE_LIGHTS
float glossiness=vSpecularColor.a;
vec3 specularColor=vSpecularColor.rgb;
vec3 diffuseBase=vec3(0.,0.,0.);
lightingInfo info;
vec3 specularBase=vec3(0.,0.,0.);
float shadow=1.;
float aggShadow=0.;
float numLights=0.;
vec4 diffuse0=light0.vLightDiffuse;
#define CUSTOM_LIGHT0_COLOR 
info=computeLighting(viewDirectionW,normalW,light0.vLightData,diffuse0.rgb,light0.vLightSpecular.rgb,diffuse0.a,glossiness);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse1=light1.vLightDiffuse;
#define CUSTOM_LIGHT1_COLOR 
info=computeLighting(viewDirectionW,normalW,light1.vLightData,diffuse1.rgb,light1.vLightSpecular.rgb,diffuse1.a,glossiness);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse2=light2.vLightDiffuse;
#define CUSTOM_LIGHT2_COLOR 
info=computeHemisphericLighting(viewDirectionW,normalW,light2.vLightData,diffuse2.rgb,light2.vLightSpecular.rgb,light2.vLightGround,glossiness);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
aggShadow=aggShadow/numLights;
vec4 refractionColor=vec4(0.,0.,0.,1.);
vec4 reflectionColor=vec4(0.,0.,0.,1.);
vec3 emissiveColor=vEmissiveColor;
emissiveColor+=TEXRD(emissiveSampler,vEmissiveUV+uvOffset).rgb*vEmissiveInfos.y;
vec3 finalDiffuse=clamp(diffuseBase*diffuseColor+emissiveColor+vAmbientColor,0.0,1.0)*baseColor.rgb;
vec3 finalSpecular=specularBase*specularColor;
vec4 color=vec4(finalDiffuse*baseAmbientColor+finalSpecular+reflectionColor.rgb+refractionColor.rgb,alpha);
#define CUSTOM_FRAGMENT_BEFORE_FOG
color.rgb=max(color.rgb,0.);
float fog=CalcFogFactor();
color.rgb=mix(vFogColor,color.rgb,fog);
color.a*=visibility;
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
glFragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}
