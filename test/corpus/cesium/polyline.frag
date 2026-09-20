#version 300 es

#ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    precision highp int;
#else
    precision mediump float;
    precision mediump int;
    #define highp mediump
#endif
precision highp sampler3D;

#define OES_texture_float_linear

#define OES_texture_float


#line 0
layout(location = 0) out vec4 out_FragColor;







const float czm_epsilon7 = 0.0000001;

uniform float czm_oneOverLog2FarDepthFromNearPlusOne;
uniform float czm_farDepthFromNearPlusOne;
uniform float czm_gamma;

















struct czm_materialInput
{
    float s;
    vec2 st;
    vec3 str;
    vec3 normalEC;
    mat3 tangentToEyeMatrix;
    vec3 positionToEyeEC;
    float height;
    float slope;
    float aspect;
    float waterMask;
};














struct czm_material
{
    vec3 diffuse;
    float specular;
    float shininess;
    vec3 normal;
    vec3 emission;
    float alpha;
};

#ifdef LOG_DEPTH
in float v_depthFromNearPlusOne;

#ifdef POLYGON_OFFSET
uniform vec2 u_polygonOffset;
#endif

#endif
















void czm_writeLogDepth(float depth)
{
#if (defined(LOG_DEPTH) && (__VERSION__ == 300 || defined(GL_EXT_frag_depth)))
    
    
    
    
    if (depth <= 0.9999999 || depth > czm_farDepthFromNearPlusOne) {
        discard;
    }

#ifdef POLYGON_OFFSET
    
    float factor = u_polygonOffset[0];
    float units = u_polygonOffset[1];

#if (__VERSION__ == 300 || defined(GL_OES_standard_derivatives))
    
    if (factor != 0.0) {
        
        float x = dFdx(depth);
        float y = dFdy(depth);
        float m = sqrt(x * x + y * y);

        
        depth += m * factor;
    }
#endif

#endif

    gl_FragDepth = log2(depth) * czm_oneOverLog2FarDepthFromNearPlusOne;

#ifdef POLYGON_OFFSET
    
    gl_FragDepth += czm_epsilon7 * units;
#endif

#endif
}










void czm_writeLogDepth() {
#ifdef LOG_DEPTH
    czm_writeLogDepth(v_depthFromNearPlusOne);
#endif
}

















float czm_readNonPerspective(float value, float oneOverW) {
    return value * oneOverW;
}

vec2 czm_readNonPerspective(vec2 value, float oneOverW) {
    return value * oneOverW;
}

vec3 czm_readNonPerspective(vec3 value, float oneOverW) {
    return value * oneOverW;
}

vec4 czm_readNonPerspective(vec4 value, float oneOverW) {
    return value * oneOverW;
}










vec3 czm_gammaCorrect(vec3 color) {
#ifdef HDR
    color = pow(color, vec3(czm_gamma));
#endif
    return color;
}

vec4 czm_gammaCorrect(vec4 color) {
#ifdef HDR
    color.rgb = pow(color.rgb, vec3(czm_gamma));
#endif
    return color;
}

















czm_material czm_getDefaultMaterial(czm_materialInput materialInput)
{
    czm_material material;
    material.diffuse = vec3(0.0);
    material.specular = 0.0;
    material.shininess = 1.0;
    material.normal = materialInput.normalEC;
    material.emission = vec3(0.0);
    material.alpha = 1.0;
    return material;
}



#line 0
in vec4 v_pickColor;
uniform vec4 color_0;
uniform float glowPower_1;
uniform float taperPower_2;

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);

    vec2 st = materialInput.st;
    float glow = glowPower_1 / abs(st.t - 0.5) - (glowPower_1 / 0.5);

    if (taperPower_2 <= 0.99999) {
        glow *= min(1.0, taperPower_2 / (0.5 - st.s * 0.5) - (taperPower_2 / 0.5));
    }

    vec4 fragColor;
    fragColor.rgb = max(vec3(glow - 1.0 + color_0.rgb), color_0.rgb);
    fragColor.a = clamp(glow, 0.0, 1.0) * color_0.a;
    fragColor = czm_gammaCorrect(fragColor);

    material.emission = fragColor.rgb;
    material.alpha = fragColor.a;

    return material;
}


#ifdef VECTOR_TILE
uniform vec4 u_highlightColor;
#endif

in vec2 v_st;

void main()
{
    czm_materialInput materialInput;

    vec2 st = v_st;
    st.t = czm_readNonPerspective(st.t, gl_FragCoord.w);

    materialInput.s = st.s;
    materialInput.st = st;
    materialInput.str = vec3(st, 0.0);

    czm_material material = czm_getMaterial(materialInput);
    out_FragColor = vec4(material.diffuse + material.emission, material.alpha);
#ifdef VECTOR_TILE
    out_FragColor *= u_highlightColor;
#endif

    czm_writeLogDepth();
}
