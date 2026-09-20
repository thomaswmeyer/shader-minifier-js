#version 300 es
#define WEBGL2 
#define SM_LIGHTTYPE_DIRECTIONALLIGHT
#define SM_FLOAT 1
#define SM_ESM 0
#define SM_DEPTHTEXTURE 0
#define SM_NORMALBIAS 0
#define SM_DIRECTIONINLIGHTDATA 1
#define SM_USEDISTANCE 0
#define SM_SOFTTRANSPARENTSHADOW 0
#define NUM_BONE_INFLUENCERS 0
#define SHADER_NAME fragment:shadowMap
precision highp float;
in float vDepthMetricSM;
uniform vec3 biasAndScaleSM;
uniform vec2 depthValuesSM;
#define CUSTOM_FRAGMENT_DEFINITIONS
layout(location = 0) out vec4 glFragColor;
void main(void)
{
float depthSM=vDepthMetricSM;
glFragColor=vec4(depthSM,1.0,1.0,1.0);
return;
}
