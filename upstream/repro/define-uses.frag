precision highp float;
uniform float u;
float helper(float x){return x*2.;}
#define CALL helper(u)
void main(){gl_FragColor=vec4(CALL);}
