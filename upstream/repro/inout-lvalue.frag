precision highp float;
uniform vec3 u;
vec3 f(inout vec3 x,vec3 y){return y*2.;}
void main(){vec3 v=vec3(0);v=f(v,u);gl_FragColor=vec4(v,1);}
