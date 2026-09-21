precision highp float;
uniform float u;
const float a=sqrt(2.),b=sqrt(3.),c=sqrt(5.),d=sqrt(7.),e=sqrt(11.);
const float f=a+b,g=c+d,h=e+f,i=g+h,j=h+i,k=i+j,l=j+k,m=k+l,n=l+m;
out vec4 o;
void main(){vec2 p=gl_FragCoord.xy/48.;o=vec4(fract(p.x*a+p.y*b+c*d+e*u),fract(f+g+h+i),fract(j+k+l+m+n),1);}
