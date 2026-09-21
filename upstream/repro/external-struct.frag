precision highp float;
struct L{vec3 direction;};
uniform L light;
void main(){gl_FragColor=vec4(light.direction,1);}
