#version 300 es
precision highp sampler3D;

#define LOG_DEPTH
#define OES_texture_float_linear

#define OES_texture_float


#line 0
uniform vec2 czm_currentFrustum;
uniform mat4 czm_inverseProjection;
uniform vec3 czm_encodedCameraPositionMCLow;
uniform vec3 czm_encodedCameraPositionMCHigh;
#ifdef LOG_DEPTH

out float v_depthFromNearPlusOne;
#ifdef SHADOW_MAP
out vec3 v_logPositionEC;
#endif
#endif

vec4 czm_updatePositionDepth(vec4 coords) {
#if defined(LOG_DEPTH)

#ifdef SHADOW_MAP
    vec3 logPositionEC = (czm_inverseProjection * coords).xyz;
    v_logPositionEC = logPositionEC;
#endif

    
    
    
    
    
    
    
    coords.z = clamp(coords.z / coords.w, -1.0, 1.0) * coords.w;
#endif

    return coords;
}







void czm_vertexLogDepth()
{
#ifdef LOG_DEPTH
    v_depthFromNearPlusOne = (gl_Position.w - czm_currentFrustum.x) + 1.0;
    gl_Position = czm_updatePositionDepth(gl_Position);
#endif
}















void czm_vertexLogDepth(vec4 clipCoords)
{
#ifdef LOG_DEPTH
    v_depthFromNearPlusOne = (clipCoords.w - czm_currentFrustum.x) + 1.0;
    czm_updatePositionDepth(clipCoords);
#endif
}







vec4 czm_columbusViewMorph(vec4 position2D, vec4 position3D, float time)
{
    
    
    
    
    
    
    
    
    vec3 p = position2D.xyz * (1.0 - time) + position3D.xyz * time;
    return vec4(p, 1.0);
}


































vec4 czm_translateRelativeToEye(vec3 high, vec3 low)
{
    vec3 highDifference = high - czm_encodedCameraPositionMCHigh;
    
    
    if (length(highDifference) == 0.0) {  
        highDifference = vec3(0);  
    }
    vec3 lowDifference = low - czm_encodedCameraPositionMCLow;

    return vec4(highDifference + lowDifference, 1.0);
}

uniform float czm_morphTime;









 vec2 czm_decompressTextureCoordinates(float encoded)
 {
    float temp = encoded / 4096.0;
    float xZeroTo4095 = floor(temp);
    float stx = xZeroTo4095 / 4095.0;
    float sty = (encoded - xZeroTo4095 * 4096.0) / 4095.0;
    return vec2(stx, sty);
 }

uniform mat4 czm_modelViewProjectionRelativeToEye;
uniform mat4 czm_modelViewRelativeToEye;





















vec4 czm_computePosition();



#line 0

in vec3 position2DHigh;
in vec3 position2DLow;

in float compressedAttributes;
vec2 st;

in vec3 position3DHigh;
in vec3 position3DLow;

in float batchId;

out vec3 v_positionMC;
out vec3 v_positionEC;
out vec2 v_st;


uniform highp sampler2D batchTexture; 
uniform vec4 batchTextureStep; 
vec2 computeSt(float batchId) 
{ 
    float stepX = batchTextureStep.x; 
    float centerX = batchTextureStep.y; 
    float numberOfAttributes = float(2); 
    return vec2(centerX + (batchId * numberOfAttributes * stepX), 0.5); 
} 

vec4 czm_batchTable_color(float batchId) 
{ 
    vec2 st = computeSt(batchId); 
    st.x += batchTextureStep.x * float(0); 
    vec4 textureValue = texture(batchTexture, st); 
    vec4 value = textureValue; 
    return value; 
} 
vec4 czm_batchTable_pickColor(float batchId) 
{ 
    vec2 st = computeSt(batchId); 
    st.x += batchTextureStep.x * float(1); 
    vec4 textureValue = texture(batchTexture, st); 
    vec4 value = textureValue; 
    return value; 
} 

void czm_non_pick_main()
{
    vec4 p = czm_computePosition();

    v_positionMC = position3DHigh + position3DLow;           
    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;     
    v_st = st;

    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}

out vec4 v_pickColor; 
void czm_non_compressed_main() 
{ 
    czm_non_pick_main(); 
    v_pickColor = czm_batchTable_pickColor(batchId); 
}
void czm_log_depth_main() 
{ 
    st = czm_decompressTextureCoordinates(compressedAttributes);
    czm_non_compressed_main(); 
}
vec4 czm_computePosition()
{
    vec4 p;
    if (czm_morphTime == 1.0)
    {
        p = czm_translateRelativeToEye(position3DHigh, position3DLow);
    }
    else if (czm_morphTime == 0.0)
    {
        p = czm_translateRelativeToEye(position2DHigh.zxy, position2DLow.zxy);
    }
    else
    {
        p = czm_columbusViewMorph(
                czm_translateRelativeToEye(position2DHigh.zxy, position2DLow.zxy),
                czm_translateRelativeToEye(position3DHigh, position3DLow),
                czm_morphTime);
    }
    return p;
}


#line 0


void main()
{
    czm_log_depth_main();
    czm_vertexLogDepth();
}
