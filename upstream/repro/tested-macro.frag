precision highp float;
uniform float a;
#ifdef X
uniform float b;
#endif
void main(){
#ifdef X
gl_FragColor=vec4(a+b);
#else
gl_FragColor=vec4(a);
#endif
}
