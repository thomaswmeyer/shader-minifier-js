precision highp float;
uniform float u;
void main(){gl_FragColor=vec4(max(u,1e-20),1.24e-27,0.,1.);}
