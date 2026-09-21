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
uniform mat4 czm_viewportTransformation;
uniform mat4 czm_projection;
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


















float czm_writeNonPerspective(float value, float w) {
    return value * w;
}

vec2 czm_writeNonPerspective(vec2 value, float w) {
    return value * w;
}

vec3 czm_writeNonPerspective(vec3 value, float w) {
    return value * w;
}

vec4 czm_writeNonPerspective(vec4 value, float w) {
    return value * w;
}

uniform mat4 czm_viewportOrthographic;





















vec4 czm_computePosition();

uniform mat4 czm_modelViewRelativeToEye;
uniform float czm_pixelRatio;






const float czm_epsilon6 = 0.000001;







const float czm_epsilon1 = 0.1;






















bool czm_equalsEpsilon(vec4 left, vec4 right, float epsilon) {
    return all(lessThanEqual(abs(left - right), vec4(epsilon)));
}

bool czm_equalsEpsilon(vec3 left, vec3 right, float epsilon) {
    return all(lessThanEqual(abs(left - right), vec3(epsilon)));
}

bool czm_equalsEpsilon(vec2 left, vec2 right, float epsilon) {
    return all(lessThanEqual(abs(left - right), vec2(epsilon)));
}

bool czm_equalsEpsilon(float left, float right, float epsilon) {
    return (abs(left - right) <= epsilon);
}
















const float czm_piOverFour = 0.7853981633974483;


























vec4 czm_eyeToWindowCoordinates(vec4 positionEC)
{
    vec4 q = czm_projection * positionEC;                        
    q.xyz /= q.w;                                                
    q.xyz = (czm_viewportTransformation * vec4(q.xyz, 1.0)).xyz; 
    return q;
}







const float czm_epsilon7 = 0.0000001;



#line 0
vec4 czm_computePrevPosition();
vec4 czm_computeNextPosition();

in vec3 position2DHigh;
in vec3 position2DLow;
in vec3 prevPosition2DHigh;
in vec3 prevPosition2DLow;
in vec3 nextPosition2DHigh;
in vec3 nextPosition2DLow;

in float compressedAttributes;
vec2 st;

#define CLIP_POLYLINE 
void clipLineSegmentToNearPlane(
    vec3 p0,
    vec3 p1,
    out vec4 positionWC,
    out bool clipped,
    out bool culledByNearPlane,
    out vec4 clippedPositionEC)
{
    culledByNearPlane = false;
    clipped = false;

    vec3 p0ToP1 = p1 - p0;
    float magnitude = length(p0ToP1);
    vec3 direction = normalize(p0ToP1);

    
    
    float endPoint0Distance =  czm_currentFrustum.x + p0.z;

    
    
    
    
    
    
    

    
    
    
    float denominator = -direction.z;

    if (endPoint0Distance > 0.0 && abs(denominator) < czm_epsilon7)
    {
        
        
        culledByNearPlane = true;
    }
    else if (endPoint0Distance > 0.0)
    {
        
        

        
        float t = endPoint0Distance / denominator;
        if (t < 0.0 || t > magnitude)
        {
            
            
            
            culledByNearPlane = true;
        }
        else
        {
            
            p0 = p0 + t * direction;

            
            
            p0.z = min(p0.z, -czm_currentFrustum.x);

            clipped = true;
        }
    }

    clippedPositionEC = vec4(p0, 1.0);
    positionWC = czm_eyeToWindowCoordinates(clippedPositionEC);
}

vec4 getPolylineWindowCoordinatesEC(vec4 positionEC, vec4 prevEC, vec4 nextEC, float expandDirection, float width, bool usePrevious, out float angle)
{
    

#ifdef POLYLINE_DASH
    
    vec4 positionWindow = czm_eyeToWindowCoordinates(positionEC);
    vec4 previousWindow = czm_eyeToWindowCoordinates(prevEC);
    vec4 nextWindow = czm_eyeToWindowCoordinates(nextEC);

    
    vec2 lineDir;
    if (usePrevious) {
        lineDir = normalize(positionWindow.xy - previousWindow.xy);
    }
    else {
        lineDir = normalize(nextWindow.xy - positionWindow.xy);
    }
    angle = atan(lineDir.x, lineDir.y) - 1.570796327; 

    
    angle = floor(angle / czm_piOverFour + 0.5) * czm_piOverFour;
#endif

    vec4 clippedPrevWC, clippedPrevEC;
    bool prevSegmentClipped, prevSegmentCulled;
    clipLineSegmentToNearPlane(prevEC.xyz, positionEC.xyz, clippedPrevWC, prevSegmentClipped, prevSegmentCulled, clippedPrevEC);

    vec4 clippedNextWC, clippedNextEC;
    bool nextSegmentClipped, nextSegmentCulled;
    clipLineSegmentToNearPlane(nextEC.xyz, positionEC.xyz, clippedNextWC, nextSegmentClipped, nextSegmentCulled, clippedNextEC);

    bool segmentClipped, segmentCulled;
    vec4 clippedPositionWC, clippedPositionEC;
    clipLineSegmentToNearPlane(positionEC.xyz, usePrevious ? prevEC.xyz : nextEC.xyz, clippedPositionWC, segmentClipped, segmentCulled, clippedPositionEC);

    if (segmentCulled)
    {
        return vec4(0.0, 0.0, 0.0, 1.0);
    }

    vec2 directionToPrevWC = normalize(clippedPrevWC.xy - clippedPositionWC.xy);
    vec2 directionToNextWC = normalize(clippedNextWC.xy - clippedPositionWC.xy);

    
    
    
    if (prevSegmentCulled)
    {
        directionToPrevWC = -directionToNextWC;
    }
    else if (nextSegmentCulled)
    {
        directionToNextWC = -directionToPrevWC;
    }

    vec2 thisSegmentForwardWC, otherSegmentForwardWC;
    if (usePrevious)
    {
        thisSegmentForwardWC = -directionToPrevWC;
        otherSegmentForwardWC = directionToNextWC;
    }
    else
    {
        thisSegmentForwardWC = directionToNextWC;
        otherSegmentForwardWC =  -directionToPrevWC;
    }

    vec2 thisSegmentLeftWC = vec2(-thisSegmentForwardWC.y, thisSegmentForwardWC.x);

    vec2 leftWC = thisSegmentLeftWC;
    float expandWidth = width * 0.5;

    
    
    
    if (!czm_equalsEpsilon(prevEC.xyz - positionEC.xyz, vec3(0.0), czm_epsilon1) && !czm_equalsEpsilon(nextEC.xyz - positionEC.xyz, vec3(0.0), czm_epsilon1))
    {
        vec2 otherSegmentLeftWC = vec2(-otherSegmentForwardWC.y, otherSegmentForwardWC.x);

        vec2 leftSumWC = thisSegmentLeftWC + otherSegmentLeftWC;
        float leftSumLength = length(leftSumWC);
        leftWC = leftSumLength < czm_epsilon6 ? thisSegmentLeftWC : (leftSumWC / leftSumLength);

        
        
        
        
        
        
        vec2 u = -thisSegmentForwardWC;
        vec2 v = leftWC;
        float sinAngle = abs(u.x * v.y - u.y * v.x);
        expandWidth = clamp(expandWidth / sinAngle, 0.0, width * 2.0);
    }

    vec2 offset = leftWC * expandDirection * expandWidth * czm_pixelRatio;
    return vec4(clippedPositionWC.xy + offset, -clippedPositionWC.z, 1.0) * (czm_projection * clippedPositionEC).w;
}

vec4 getPolylineWindowCoordinates(vec4 position, vec4 previous, vec4 next, float expandDirection, float width, bool usePrevious, out float angle)
{
    vec4 positionEC = czm_modelViewRelativeToEye * position;
    vec4 prevEC = czm_modelViewRelativeToEye * previous;
    vec4 nextEC = czm_modelViewRelativeToEye * next;
    return getPolylineWindowCoordinatesEC(positionEC, prevEC, nextEC, expandDirection, width, usePrevious, angle);
}

in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 prevPosition3DHigh;
in vec3 prevPosition3DLow;
in vec3 nextPosition3DHigh;
in vec3 nextPosition3DLow;
in vec2 expandAndWidth;

in float batchId;

out float v_width;
out vec2 v_st;
out float v_polylineAngle;


uniform highp sampler2D batchTexture; 
uniform vec4 batchTextureStep; 
vec2 computeSt(float batchId) 
{ 
    float stepX = batchTextureStep.x; 
    float centerX = batchTextureStep.y; 
    float numberOfAttributes = float(1); 
    return vec2(centerX + (batchId * numberOfAttributes * stepX), 0.5); 
} 

vec4 czm_batchTable_pickColor(float batchId) 
{ 
    vec2 st = computeSt(batchId); 
    st.x += batchTextureStep.x * float(0); 
    vec4 textureValue = texture(batchTexture, st); 
    vec4 value = textureValue; 
    return value; 
} 

void czm_non_pick_main()
{
    float expandDir = expandAndWidth.x;
    float width = abs(expandAndWidth.y) + 0.5;
    bool usePrev = expandAndWidth.y < 0.0;

    vec4 p = czm_computePosition();
    vec4 prev = czm_computePrevPosition();
    vec4 next = czm_computeNextPosition();

    float angle;
    vec4 positionWC = getPolylineWindowCoordinates(p, prev, next, expandDir, width, usePrev, angle);
    gl_Position = czm_viewportOrthographic * positionWC;

    v_width = width;
    v_st.s = st.s;
    v_st.t = czm_writeNonPerspective(st.t, gl_Position.w);
    v_polylineAngle = angle;
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

vec4 czm_computePrevPosition()
{
    vec4 p;
    if (czm_morphTime == 1.0)
    {
        p = czm_translateRelativeToEye(prevPosition3DHigh, prevPosition3DLow);
    }
    else if (czm_morphTime == 0.0)
    {
        p = czm_translateRelativeToEye(prevPosition2DHigh.zxy, prevPosition2DLow.zxy);
    }
    else
    {
        p = czm_columbusViewMorph(
                czm_translateRelativeToEye(prevPosition2DHigh.zxy, prevPosition2DLow.zxy),
                czm_translateRelativeToEye(prevPosition3DHigh, prevPosition3DLow),
                czm_morphTime);
    }
    return p;
}

vec4 czm_computeNextPosition()
{
    vec4 p;
    if (czm_morphTime == 1.0)
    {
        p = czm_translateRelativeToEye(nextPosition3DHigh, nextPosition3DLow);
    }
    else if (czm_morphTime == 0.0)
    {
        p = czm_translateRelativeToEye(nextPosition2DHigh.zxy, nextPosition2DLow.zxy);
    }
    else
    {
        p = czm_columbusViewMorph(
                czm_translateRelativeToEye(nextPosition2DHigh.zxy, nextPosition2DLow.zxy),
                czm_translateRelativeToEye(nextPosition3DHigh, nextPosition3DLow),
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
