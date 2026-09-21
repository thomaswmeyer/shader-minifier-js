precision highp float;
struct S{float q;};
uniform float u;
void main(){S s;s.q=u;gl_FragColor=vec4(s.q);}
