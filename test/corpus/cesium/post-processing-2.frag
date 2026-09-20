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
















const float czm_twoPi = 6.283185307179586;

uniform vec4 czm_viewport;
uniform float czm_pixelRatio;


#line 0
#define USE_STEP_SIZE
#define SAMPLES 8

uniform float delta;
uniform float sigma;
uniform float direction; 

uniform sampler2D colorTexture;

#ifdef USE_STEP_SIZE
uniform float stepSize;
#else
uniform vec2 step;
#endif

in vec2 v_textureCoordinates;




void main()
{
    vec2 st = v_textureCoordinates;
    vec2 dir = vec2(1.0 - direction, direction);

#ifdef USE_STEP_SIZE
    vec2 step = vec2(stepSize * (czm_pixelRatio / czm_viewport.zw));
#else
    vec2 step = step;
#endif

    vec3 g;
    g.x = 1.0 / (sqrt(czm_twoPi) * sigma);
    g.y = exp((-0.5 * delta * delta) / (sigma * sigma));
    g.z = g.y * g.y;

    vec4 result = texture(colorTexture, st) * g.x;
    for (int i = 1; i < SAMPLES; ++i)
    {
        g.xy *= g.yz;

        vec2 offset = float(i) * dir * step;
        result += texture(colorTexture, st - offset) * g.x;
        result += texture(colorTexture, st + offset) * g.x;
    }

    out_FragColor = result;
}
