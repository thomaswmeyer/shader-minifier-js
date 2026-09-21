precision highp float;
uniform float uT;
float flow(float t,float uT){float s=0.;for(int i=0;i<2;i++)s+=t*uT;return s;}
void main(){gl_FragColor=vec4(fract(flow(uT,2.)+flow(uT,3.)));}
