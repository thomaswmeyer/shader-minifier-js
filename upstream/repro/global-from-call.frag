precision highp float;
float f(){return 2.;}
float g=f();
void main(){gl_FragColor=vec4(g);}
