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

#define LOG_DEPTH
#define OES_texture_float_linear

#define OES_texture_float


#line 0
layout(location = 0) out vec4 out_FragColor;







const float czm_epsilon7 = 0.0000001;


















const vec4 K_HSB2RGB = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);

vec3 czm_HSBToRGB(vec3 hsb)
{
    vec3 p = abs(fract(hsb.xxx + K_HSB2RGB.xyz) * 6.0 - K_HSB2RGB.www);
    return hsb.z * mix(K_HSB2RGB.xxx, clamp(p - K_HSB2RGB.xxx, 0.0, 1.0), hsb.y);
}


















const vec4 K_RGB2HSB = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);

vec3 czm_RGBToHSB(vec3 rgb)
{
    vec4 p = mix(vec4(rgb.bg, K_RGB2HSB.wz), vec4(rgb.gb, K_RGB2HSB.xy), step(rgb.b, rgb.g));
    vec4 q = mix(vec4(p.xyw, rgb.r), vec4(rgb.r, p.yzx), step(p.x, rgb.r));

    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + czm_epsilon7)), d / (q.x + czm_epsilon7), q.x);
}



#line 0
uniform sampler2D colorTexture;
uniform float contrast;
uniform float brightness;

in vec2 v_textureCoordinates;

void main(void)
{
    vec3 sceneColor = texture(colorTexture, v_textureCoordinates).xyz;
    sceneColor = czm_RGBToHSB(sceneColor);
    sceneColor.z += brightness;
    sceneColor = czm_HSBToRGB(sceneColor);

    float factor = (259.0 * (contrast + 255.0)) / (255.0 * (259.0 - contrast));
    sceneColor = factor * (sceneColor - vec3(0.5)) + vec3(0.5);
    out_FragColor = vec4(sceneColor, 1.0);
}
