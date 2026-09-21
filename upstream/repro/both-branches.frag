precision highp float;
uniform float u;
void main(){
#ifdef AA
float n=1.;
#else
float n=3.;
#endif
gl_FragColor=vec4(n*u);}
