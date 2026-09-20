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



#line 0
uniform sampler2D colorTexture;
uniform sampler2D bloomTexture;
uniform bool glowOnly;

in vec2 v_textureCoordinates;

void main(void)
{
    vec4 color = texture(colorTexture, v_textureCoordinates);

#ifdef CZM_SELECTED_FEATURE
    if (czm_selected()) {
        out_FragColor = color;
        return;
    }
#endif

    vec4 bloom = texture(bloomTexture, v_textureCoordinates);
    out_FragColor = glowOnly ? bloom : bloom + color;
}
