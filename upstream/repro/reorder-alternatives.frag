precision highp float;
uniform float u;
float g(float x);
#ifdef A
float g(float x){return x*2.;}
#else
float g(float x){return x*3.;}
#endif
void main(){gl_FragColor=vec4(g(u));}
