// --drop-default-precision and --inline-single-use (docs/PORTING.md 5.2), and the port flags on the
// whole upstream corpus.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Minifier, minify as minifyApi } from "../src/api.js";
import { defaultOptions, type Options } from "../src/options.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { simplify } from "../src/rewriter.js";
import { loadCommands, repoRoot } from "./golden.js";

function minify(src: string, extra: Partial<Options> = {}): string {
  const options = { ...defaultOptions(), noRenaming: true, noPiSubstitution: true, ...extra };
  const shader = runParser(options, "t.frag", src);
  return Printer.print(simplify(options, shader.code));
}

describe("--drop-default-precision", () => {
  const vert = "precision highp float;precision highp int;uniform float u;void main(){gl_Position=vec4(u);}";
  const frag = "precision highp float;precision mediump int;precision lowp sampler2D;uniform sampler2D s;out vec4 o;void main(){o=texture(s,gl_FragCoord.xy);}";
  // A transform-feedback vertex shader: nothing in the code says which stage it is.
  const stageless = "precision highp float;precision mediump int;precision lowp sampler2D;in vec2 p;out vec2 q;void main(){q=p*2.;}";
  it("is off by default", () => {
    expect(minify(vert)).toContain("precision highp float;precision highp int;");
  });
  it("drops a qualifier on a declaration that restates the precision in force", () => {
    const opts = { dropDefaultPrecision: true, inlining: "none" };
    const f = "precision mediump float;uniform highp float a;uniform mediump float b;uniform mediump vec3 c;void main(){gl_FragColor=vec4(a+b+c.x);}";
    // `mediump` says nothing after `precision mediump float;`; `highp` differs, so it stays.
    expect(minifyApi([{ name: "t.frag", content: f }], { ...defaultOptions(), noRenaming: true, noPiSubstitution: true, ...opts }).code)
      .toBe("precision mediump float;uniform highp float a;uniform float b;uniform vec3 c;void main(){gl_FragColor=vec4(a+b+c.x);}");
    // A vector follows float, an integer vector follows int, a sampler is its own; parameters,
    // locals and struct members count as declarations too.
    const v = "in highp vec3 p;out highp vec2 v;out mediump float m;void main(){v=p.xy;m=p.z;gl_Position=vec4(p,1);}";
    expect(minifyApi([{ name: "t.vert", content: v }], { ...defaultOptions(), noRenaming: true, noPiSubstitution: true, ...opts }).code)
      .toBe("in vec3 p;out vec2 v;out mediump float m;void main(){v=p.xy;m=p.z;gl_Position=vec4(p,1);}");
    const s = "precision mediump float;struct S{mediump float a;highp float b;};uniform S s;void main(){gl_FragColor=vec4(s.a+s.b);}";
    expect(minifyApi([{ name: "t.frag", content: s }], { ...defaultOptions(), noRenaming: true, noPiSubstitution: true, ...opts }).code)
      .toContain("struct S{float a;highp float b;};");
  });
  it("accepts a precision statement inside a function body, and leaves that body's qualifiers alone", () => {
    // GLSL allows `precision` in any scope; it sets the default for the declarations after it in
    // that scope, which the pass does not track, so a body that changes precision keeps every
    // qualifier. Nor may a declaration be grouped above the statement, or a variable reused
    // across it, since either would take the other precision.
    const f = "precision highp float;uniform float u;void main(){highp float a=u;precision mediump float;highp float b=a*2.;mediump float c=b;gl_FragColor=vec4(a,b,c,1);}";
    const opts = { dropDefaultPrecision: true, moveDeclarations: true, inlining: "none" as const, inlineSingleUse: false };
    expect(minifyApi([{ name: "t.frag", content: f }], { ...defaultOptions(), noRenaming: true, noPiSubstitution: true, ...opts }).code)
      .toBe("precision highp float;uniform float u;void main(){highp float a=u;precision mediump float;highp float b=a*2.;mediump float c=b;gl_FragColor=vec4(a,b,c,1);}");
    const g = "precision highp float;uniform float u;float f(float x){precision mediump float;return x;}void main(){highp float a=u;gl_FragColor=vec4(f(a));}";
    expect(minifyApi([{ name: "t.frag", content: g }], { ...defaultOptions(), noRenaming: true, noPiSubstitution: true, ...opts }).code)
      .toBe("precision highp float;uniform float u;float f(float x){precision mediump float;return x;}void main(){float a=u;gl_FragColor=vec4(f(a));}");
  });
  it("keeps a qualifier a fragment shader has no default for", () => {
    // A fragment shader has no default float precision, so `mediump float b;` is the only thing
    // saying what b is: dropping it would not compile.
    const f = "uniform mediump float b;void main(){gl_FragColor=vec4(b);}";
    expect(minifyApi([{ name: "t.frag", content: f }], { ...defaultOptions(), noRenaming: true, noPiSubstitution: true, dropDefaultPrecision: true }).code)
      .toBe("uniform mediump float b;void main(){gl_FragColor=vec4(b);}");
  });
  it("drops highp float and int from a vertex shader", () => {
    expect(minify(vert, { dropDefaultPrecision: true })).toBe("uniform float u;void main(){gl_Position=vec4(u);}");
  });
  it("keeps highp float in a fragment shader, drops mediump int and lowp samplers", () => {
    expect(minify(frag, { dropDefaultPrecision: true })).toBe(
      "precision highp float;uniform sampler2D s;out vec4 o;void main(){o=texture(s,gl_FragCoord.xy);}",
    );
  });
  it("keeps float and int statements when the code proves no stage", () => {
    expect(minify(stageless, { dropDefaultPrecision: true })).toBe(
      "precision highp float;precision mediump int;in vec2 p;out vec2 q;void main(){q=p*2.;}",
    );
  });
  it("takes the stage from --stage", () => {
    // mediump int is not the vertex default (highp), so it stays there.
    expect(minify(stageless, { dropDefaultPrecision: true, stage: "vertex" })).toBe("precision mediump int;in vec2 p;out vec2 q;void main(){q=p*2.;}");
    expect(minify(stageless, { dropDefaultPrecision: true, stage: "fragment" })).toBe("precision highp float;in vec2 p;out vec2 q;void main(){q=p*2.;}");
  });
  it("takes the stage from the file extension, and --stage wins over it", () => {
    const opts = { dropDefaultPrecision: true, noRenaming: true };
    const run = (name: string, extra: Partial<Options> = {}): string => minifyApi([{ name, content: stageless }], { ...opts, ...extra }).code;
    expect(run("sim.vert")).toBe("precision mediump int;in vec2 p;out vec2 q;void main(){q=p*2.;}");
    expect(run("sim.vs")).toBe("precision mediump int;in vec2 p;out vec2 q;void main(){q=p*2.;}");
    expect(run("sim.frag")).toBe("precision highp float;in vec2 p;out vec2 q;void main(){q=p*2.;}");
    expect(run("sim.glsl")).toBe("precision highp float;precision mediump int;in vec2 p;out vec2 q;void main(){q=p*2.;}");
    expect(run("sim.vert", { stage: "fragment" })).toBe("precision highp float;in vec2 p;out vec2 q;void main(){q=p*2.;}");
  });
  it("reads the fragment stage off discard and gl_FragCoord", () => {
    const src = "precision highp float;precision mediump int;void main(){if(gl_FragCoord.x<0.)discard;gl_FragColor=vec4(0);}";
    expect(minify(src, { dropDefaultPrecision: true })).toBe("precision highp float;void main(){if(gl_FragCoord.x<0.)discard;gl_FragColor=vec4(0);}");
  });
  it("parses --stage on the command line", () => {
    expect(Minifier.parseOptions(["--stage", "vertex"]).stage).toBe("vertex");
    expect(Minifier.parseOptions(["--stage", "Fragment"]).stage).toBe("fragment");
    expect(() => Minifier.parseOptions(["--stage", "pixel"])).toThrow(/Unrecognized stage 'pixel'/);
  });
  it("treats a shader that names builtins of both stages as stageless", () => {
    const src = "precision mediump int;void main(){gl_Position=gl_FragCoord;}";
    expect(minify(src, { dropDefaultPrecision: true })).toBe(src);
  });
  it("keeps a non-default precision", () => {
    expect(minify("precision mediump float;void main(){gl_Position=vec4(0);}", { dropDefaultPrecision: true }))
      .toBe("precision mediump float;void main(){gl_Position=vec4(0);}");
  });
  it("keeps a statement that restores the default after an override", () => {
    const src = "precision mediump float;uniform float a;precision highp float;uniform float b;void main(){gl_Position=vec4(a+b);}";
    expect(minify(src, { dropDefaultPrecision: true })).toContain("precision highp float;uniform float b;");
  });
  it("reads the stage off gl_PointSize too", () => {
    expect(minify("precision highp float;void main(){gl_PointSize=1.;}", { dropDefaultPrecision: true }))
      .toBe("void main(){gl_PointSize=1.;}");
  });
});

describe("--inline-single-use", () => {
  it("inlines a const global used once", () => {
    const src = "const float K=44./84.;uniform float u;void main(){gl_FragColor=vec4(u*K);}";
    expect(minify(src)).toContain("const float K=44./84.;");
    // parenthesised: u*44./84. would evaluate (u*44.)/84., not the same in float
    expect(minify(src, { inlineSingleUse: true })).toBe("uniform float u;void main(){gl_FragColor=vec4(u*(44./84.));}");
  });
  it("parenthesises the inlined expression where precedence needs it", () => {
    const src = "const float K=1.+2.;uniform float u;void main(){gl_FragColor=vec4(u*K);}";
    expect(minify(src, { inlineSingleUse: true })).toBe("uniform float u;void main(){gl_FragColor=vec4(u*3.);}");
    const src2 = "uniform float a,b;const float K=a+b;void main(){gl_FragColor=vec4(2.*K);}";
    expect(minify(src2, { inlineSingleUse: true })).toBe("uniform float a,b;void main(){gl_FragColor=vec4(2.*(a+b));}");
  });
  it("keeps a global used twice, and one used in a loop", () => {
    const twice = "const float K=44./84.;uniform float u;void main(){gl_FragColor=vec4(u*K,K,0,0);}";
    expect(minify(twice, { inlineSingleUse: true })).toContain("const float K=44./84.;");
    const loop = "const float K=44./84.;uniform float u;void main(){float s=0.;for(int i=0;i<4;i++)s+=u*K;gl_FragColor=vec4(s);}";
    expect(minify(loop, { inlineSingleUse: true })).toContain("const float K=44./84.;");
  });
  it("keeps a global that is written or that reads a written global", () => {
    const written = "float K=1.;uniform float u;void f(){K=2.;}void main(){f();gl_FragColor=vec4(u*K);}";
    expect(minify(written, { inlineSingleUse: true })).toContain("float K=1.;");
  });
  it("substitutes a short uniform passed as an always-identical argument", () => {
    const src = "uniform float uT;float flow(vec2 p,float t){return sin(p.x+t*.3)+cos(p.y-t*.24)+sin(p.x+t*.18);}void main(){gl_FragColor=vec4(flow(gl_FragCoord.xy,uT));}";
    expect(minify(src)).toContain("float t=uT;");
    const out = minify(src, { inlineSingleUse: true });
    expect(out).not.toContain("float t=uT;");
    expect(out).toContain("uT*.3");
  });
  it("keeps the local when the body writes the parameter", () => {
    // a uniform is not an l-value; the local copy was what made `n++` legal (spglsl corpus, loop-with-side-effects)
    const src = "uniform int uZero;int f(int n){n++;return n;}void main(){gl_FragColor=vec4(float(f(uZero)));}";
    const out = minify(src, { inlineSingleUse: true });
    expect(out).toContain("int n=uZero;");
    expect(out).not.toContain("uZero++");
  });
  it("keeps the local for a long uniform name used often", () => {
    const src = "uniform float uSomeLongName;float flow(vec2 p,float t){return sin(p.x+t)+cos(p.y-t)+sin(p.x+t)+cos(p.y*t);}void main(){gl_FragColor=vec4(flow(gl_FragCoord.xy,uSomeLongName));}";
    expect(minify(src, { inlineSingleUse: true })).toContain("float t=uSomeLongName;");
  });

  describe("does not move a call into a helper a loop may call", () => {
    const heavy = "uniform float u;const mat2 M=mat2(cos(u),sin(u),-sin(u),cos(u));";
    it("keeps a global whose value calls a function when its use is in a helper", () => {
      const src = heavy + "vec2 rot(vec2 p){return M*p;}void main(){vec2 p=gl_FragCoord.xy;for(int i=0;i<8;i++)p=rot(p);gl_FragColor=vec4(p,0,0);}";
      expect(minify(src, { inlineSingleUse: true })).toContain("const mat2 M=mat2(cos(u),sin(u),-sin(u),cos(u));");
    });
    it("inlines it when the use is in main", () => {
      const src = heavy + "void main(){vec2 p=M*gl_FragCoord.xy;gl_FragColor=vec4(p,0,0);}";
      expect(minify(src, { inlineSingleUse: true })).toBe("uniform float u;void main(){vec2 p=mat2(cos(u),sin(u),-sin(u),cos(u))*gl_FragCoord.xy;gl_FragColor=vec4(p,0,0);}");
    });
    it("inlines a value without calls into a helper", () => {
      const src = "uniform float u;const float K=u*u+1.;float f(float x){return x*K;}void main(){gl_FragColor=vec4(f(gl_FragCoord.x));}";
      expect(minify(src, { inlineSingleUse: true })).toBe("uniform float u;void main(){gl_FragColor=vec4(gl_FragCoord.x*(u*u+1.));}");
    });
  });

  describe("does not let a local or parameter capture a name it inlines", () => {
    it("keeps a global whose value reads a name a local shadows at the use", () => {
      // Inlining K would make (a+b) read the local a.
      const src = "uniform float a,b;const float K=a+b;void main(){float a=2.;for(int i=0;i<2;i++)a+=b;gl_FragColor=vec4(2.*K*a);}";
      expect(minify(src, { inlineSingleUse: true })).toBe(src);
    });
    it("inlines once a later pass has removed the shadowing local", () => {
      const src = "uniform float a,b;const float K=a+b;void main(){float a=2.;a+=b;gl_FragColor=vec4(2.*K*a);}";
      expect(minify(src, { inlineSingleUse: true })).toBe("uniform float a,b;void main(){gl_FragColor=vec4(2.*(a+b)*(2.+b));}");
      expect(minifyApi(src, { inlineSingleUse: true, noPiSubstitution: true }).code).toBe("uniform float f,C;void main(){gl_FragColor=vec4(2.*(f+C)*(2.+C));}");
    });
    it("still inlines when the shadowing local is in a sibling block", () => {
      const src = "uniform float a,b;const float K=a+b;void main(){{float a=2.;for(int i=0;i<2;i++)a+=b;gl_FragColor=vec4(a);}gl_FragColor+=vec4(2.*K);}";
      expect(minify(src, { inlineSingleUse: true })).toBe(
        "uniform float a,b;void main(){{float a=2.;for(int i=0;i<2;i++)a+=b;gl_FragColor=vec4(a);}gl_FragColor+=vec4(2.*(a+b));}",
      );
    });
    it("keeps a local whose value reads a name a later local shadows (upstream's rule inlined it)", () => {
      const src = "uniform float a,b;void main(){float k=a+b;{float a=2.;for(int i=0;i<2;i++)a+=b;gl_FragColor=vec4(k*a);}}";
      expect(minify(src)).toBe(src);
      const src2 = "uniform vec2 t;void main(){float a=1.;float b=t.x*a;float t=0.;t+=b;gl_FragColor=vec4(t);}";
      expect(minify(src2)).toBe("uniform vec2 t;void main(){gl_FragColor=vec4(t.x);}");
    });
    it("keeps a global whose value reads a name a parameter shadows, until the function is inlined", () => {
      const src = "uniform float a,b;const float K=a+b;float f(float a){return a*K;}void main(){gl_FragColor=vec4(f(b));}";
      expect(minify(src, { inlineSingleUse: true })).toBe("uniform float a,b;void main(){gl_FragColor=vec4(b*(a+b));}");
    });
    it("declares the local when the body binds the global's name", () => {
      // Substituting uT for t would make t*uT read the local uT twice.
      const src = "uniform float uT;float flow(float t){float uT=2.;for(int i=0;i<2;i++)uT+=t;return t*uT;}void main(){gl_FragColor=vec4(flow(uT));}";
      expect(minify(src, { inlineSingleUse: true })).toBe(
        "uniform float uT;float flow(){float t=uT,uT=2.;for(int i=0;i<2;i++)uT+=t;return t*uT;}void main(){gl_FragColor=vec4(flow());}",
      );
    });
    it("leaves the argument alone when another parameter carries the global's name", () => {
      // Even upstream's `float t=uT;` local would read the parameter uT here.
      const src = "uniform float uT;float flow(float t,float uT){float s=0.;for(int i=0;i<2;i++)s+=t*uT;return s;}void main(){gl_FragColor=vec4(flow(uT,2.)+flow(uT,3.));}";
      for (const inlineSingleUse of [false, true]) {
        const out = minify(src, { inlineSingleUse });
        expect(out).not.toContain("t=uT");
        expect(out).toContain("flow(uT,2.)+flow(uT,3.)");
      }
    });
    it("drops const from the local an inlined `const in` parameter becomes", () => {
      // upstream: `const mat4 x=m;` in the body, which is an error since m is a uniform
      const src = "uniform mat4 m;vec3 f(const in mat4 x,vec3 p){return (x*vec4(p,1)+x*vec4(1)).xyz;}void main(){gl_FragColor=vec4(f(m,gl_FragCoord.xyz),1)+vec4(f(m,vec3(1)),1);}";
      const out = minify(src);
      expect(out).toContain("mat4 x=m;");
      expect(out).not.toContain("const mat4");
    });
    it("does not move a global declared after the function into its body", () => {
      // upstream: the sampler parameter can only be replaced by the global, which is declared later
      const src = "vec4 look(sampler2D s,vec2 p){return texture2D(s,p*.5);}uniform sampler2D tex;void main(){gl_FragColor=look(tex,gl_FragCoord.xy)+look(tex,gl_FragCoord.yx);}";
      // (cleanup then moves the declaration up, as upstream does; the parameter stays)
      expect(minify(src)).toBe("uniform sampler2D tex;vec4 look(sampler2D s,vec2 p){return texture2D(s,p*.5);}void main(){gl_FragColor=look(tex,gl_FragCoord.xy)+look(tex,gl_FragCoord.yx);}");
      const after = "uniform sampler2D tex;vec4 look(sampler2D s,vec2 p){return texture2D(s,p*.5);}void main(){gl_FragColor=look(tex,gl_FragCoord.xy)+look(tex,gl_FragCoord.yx);}";
      expect(minify(after)).toBe("uniform sampler2D tex;vec4 look(vec2 p){return texture2D(tex,p*.5);}void main(){gl_FragColor=look(gl_FragCoord.xy)+look(gl_FragCoord.yx);}");
    });
    it("substitutes when only the parameter itself carries the global's name", () => {
      const src = "uniform float uT;float flow(float uT){float s=0.;for(int i=0;i<2;i++)s+=uT;return s;}void main(){gl_FragColor=vec4(flow(uT));}";
      expect(minify(src, { inlineSingleUse: true })).toBe(
        "uniform float uT;float flow(){float s=0.;for(int i=0;i<2;i++)s+=uT;return s;}void main(){gl_FragColor=vec4(flow());}",
      );
    });
  });
});

describe("--remove-unused-declarations", () => {
  const flag = { removeUnused: "declarations", inlining: "none" }; // upstream's inlining already removes some unused pure globals; keep it out of the way
  it("removes unused globals, struct types and sampler precision statements, and keeps the used and the external", () => {
    const src = "precision highp float;precision highp sampler2D;precision highp samplerCube;const float A=1.,B=2.;uniform float uUnused;struct L{vec3 c;};struct M{vec3 d;};uniform sampler2D t;void main(){gl_FragColor=vec4(A)+texture2D(t,vec2(0));M m;}";
    expect(minify(src, { inlining: "none" })).toBe(src);
    expect(minify(src, flag)).toBe("precision highp float;precision highp sampler2D;const float A=1.;uniform float uUnused;struct M{vec3 d;};uniform sampler2D t;void main(){gl_FragColor=vec4(A)+texture2D(t,vec2(0));M m;}");
  });
  it("keeps a struct named by another struct, a function signature or a constructor", () => {
    expect(minify("struct S{float a;};struct T{S s;};uniform T u;void main(){gl_FragColor=vec4(u.s.a);}", flag)).toContain("struct S{float a;};struct T{S s;};");
    expect(minify("struct S{float a;};S make(){return S(1.);}void main(){gl_FragColor=vec4(make().a);}", flag)).toContain("struct S{float a;};S make()");
    expect(minify("struct S{float a;};void main(){gl_FragColor=vec4(S(1.).a);}", flag)).toContain("struct S{float a;};");
  });
  it("keeps a global an array size names, in a struct member, a parameter or a global", () => {
    expect(minify("const int N=2;struct S{float a[N];};uniform S u;void main(){gl_FragColor=vec4(u.a[0]);}", flag)).toContain("const int N=2;");
    expect(minify("const int N=2;float f(float a[N]){return a[0];}uniform float q[2];void main(){gl_FragColor=vec4(f(q));}", flag)).toContain("const int N=2;");
    expect(minify("const int N=2;float g[N];void main(){g[0]=1.;gl_FragColor=vec4(g[0]);}", flag)).toContain("const int N=2;");
    // once the array itself goes, its size is unused too
    expect(minify("const int N=2;float h[N];void main(){gl_FragColor=vec4(0);}", flag)).toBe("void main(){gl_FragColor=vec4(0);}");
  });
  it("removes a struct once its only global went", () => {
    expect(minify("struct S{float a;};S s;void main(){gl_FragColor=vec4(0);}", flag)).toBe("void main(){gl_FragColor=vec4(0);}");
  });
  it("keeps a global named in a kept macro body, one whose initializer calls a function, and a sampler type named in a function signature", () => {
    expect(minify("#define K (g*2.)\nfloat g=1.;void main(){gl_FragColor=vec4(K);}", flag)).toContain("float g=1.;");
    expect(minify("float f(){return 1.;}float g=f();void main(){gl_FragColor=vec4(0);}", flag)).toBe("void main(){gl_FragColor=vec4(0);}"); // f is pure
    expect(minify("int c;int f(){return c++;}int g=f();void main(){gl_FragColor=vec4(c);}", flag)).toContain("int g=f();");
    expect(minify("precision highp sampler2D;vec4 tex(sampler2D s){return texture2D(s,vec2(0));}void main(){gl_FragColor=vec4(0);}", { ...flag, removeUnused: "none" })).toContain("precision highp sampler2D;");
  });
  it("does nothing under --no-remove-unused", () => {
    const src = "precision highp samplerCube;const float A=1.;struct L{vec3 c;};void main(){gl_FragColor=vec4(0);}";
    expect(minify(src, { ...flag, removeUnused: "none" })).toBe(src);
  });
});

describe("a global whose initializer calls a function", () => {
  it("keeps the callee and stays after it; upstream removes the callee and moves the global above it", () => {
    const src = "float f(){return 1.;}float g=f();void main(){gl_FragColor=vec4(g);}";
    expect(minify(src)).toBe(src);
    expect(minify(src, { removeUnused: "declarations" })).toBe(src);
    expect(minify("float h(){return 2.;}float f(){return 1.;}float g=f();float k=h();void main(){gl_FragColor=vec4(g+k);}")).toBe("float h(){return 2.;}float f(){return 1.;}float g=f(),k=h();void main(){gl_FragColor=vec4(g+k);}");
  });
});

describe("--remove-unused-varyings", () => {
  const vert = "in vec3 position;out vec2 vUv;out vec3 vNormal;out float vUnused;uniform mat4 mvp;void main(){vUv=position.xy;vNormal=normalize(position);vUnused=position.z*2.;gl_Position=mvp*vec4(position,1);}";
  const frag = "in vec2 vUv;in vec3 vNormal;in float vAlsoUnread;out vec4 o;void main(){o=vec4(vUv,vNormal.x,1);}";
  const run = (files: [string, string][], extra: Partial<Options> = {}): string[] => {
    const o = { ...defaultOptions(), noRenaming: true, inlining: "none", ...extra };
    return new Minifier(o, files).shaders.map((s) => Printer.print(s.code));
  };
  it("is off by default", () => {
    const [v, f] = run([["a.vert", vert], ["a.frag", frag]]);
    expect(v).toContain("out float vUnused;");
    expect(f).toContain("in float vAlsoUnread;");
  });
  it("drops a varying no fragment shader reads, with the writes that fed it, and an unread fragment input", () => {
    const [v, f] = run([["a.vert", vert], ["a.frag", frag]], { removeUnusedVaryings: true });
    expect(v).toBe("in vec3 position;out vec2 vUv;out vec3 vNormal;uniform mat4 mvp;void main(){vUv=position.xy;vNormal=normalize(position);gl_Position=mvp*vec4(position,1);}");
    expect(f).toBe("in vec2 vUv;in vec3 vNormal;out vec4 o;void main(){o=vec4(vUv,vNormal.x,1);}");
  });
  it("keeps a varying the vertex shader reads back", () => {
    // three.js writes vDisplacementMapUv and then samples the displacement map with it, in the
    // same shader; the fragment shader never sees it.
    const v2 = "in vec3 position;out vec2 vDisp;uniform sampler2D dmap;void main(){vDisp=position.xy;gl_Position=vec4(position+texture(dmap,vDisp).x,1);}";
    const [v] = run([["a.vert", v2], ["a.frag", frag]], { removeUnusedVaryings: true });
    expect(v).toContain("out vec2 vDisp;");
  });
  it("keeps a varying whose value has an effect", () => {
    const v3 = "in vec3 position;out float vC;int c=0;float bump(){return float(c++);}void main(){vC=bump();gl_Position=vec4(position,1);}";
    const [v] = run([["a.vert", v3], ["a.frag", frag]], { removeUnusedVaryings: true });
    expect(v).toContain("out float vC;");
  });
  it("does nothing without both stages in the run, so transform feedback is safe", () => {
    const [v] = run([["a.vert", vert]], { removeUnusedVaryings: true });
    expect(v).toContain("out float vUnused;");
    const [f] = run([["a.frag", frag]], { removeUnusedVaryings: true });
    expect(f).toContain("in float vAlsoUnread;");
  });
  it("handles ES 1.00 varyings, which both stages spell the same", () => {
    const v1 = "attribute vec3 position;varying vec2 vUv;varying float vGone;void main(){vUv=position.xy;vGone=position.z;gl_Position=vec4(position,1);}";
    const f1 = "varying vec2 vUv;void main(){gl_FragColor=vec4(vUv,0,1);}";
    const [v] = run([["a.vert", v1], ["a.frag", f1]], { removeUnusedVaryings: true });
    expect(v).toBe("attribute vec3 position;varying vec2 vUv;void main(){vUv=position.xy;gl_Position=vec4(position,1);}");
  });
});

describe("--remove-unused-uniforms", () => {
  const vert = "uniform mat4 mvp;uniform float vertOnly;uniform float both;uniform float deadEverywhere;in vec3 p;out float v;void main(){v=vertOnly*both;gl_Position=mvp*vec4(p,1);}";
  const frag = "uniform float fragOnly;uniform float both;uniform float deadEverywhere;in float v;out vec4 o;void main(){o=vec4(v*fragOnly*both);}";
  const run = (files: [string, string][], extra: Partial<Options> = {}): string[] => {
    const o = { ...defaultOptions(), noRenaming: true, inlining: "none", ...extra };
    return new Minifier(o, files).shaders.map((s) => Printer.print(s.code));
  };
  it("is off by default", () => {
    expect(run([["a.vert", vert], ["a.frag", frag]])[0]).toContain("deadEverywhere");
  });
  it("removes a uniform no shader of the run reads, from every shader that declares it", () => {
    const [v, f] = run([["a.vert", vert], ["a.frag", frag]], { removeUnusedUniforms: true });
    expect(v).toBe("uniform mat4 mvp;uniform float vertOnly,both;in vec3 p;out float v;void main(){v=vertOnly*both;gl_Position=mvp*vec4(p,1);}");
    expect(f).toBe("uniform float fragOnly,both;in float v;out vec4 o;void main(){o=vec4(v*fragOnly*both);}");
  });
  it("keeps a uniform the other stage reads", () => {
    // `fragOnly` is dead in the vertex shader but alive in its partner, so the program needs it.
    const v2 = "uniform float fragOnly;in vec3 p;void main(){gl_Position=vec4(p,1);}";
    const [, f] = run([["a.vert", v2], ["a.frag", frag]], { removeUnusedUniforms: true });
    expect(f).toContain("fragOnly");
  });
  it("removes a uniform block from a stage that reads nothing of it, whole, and keeps it where it is read", () => {
    // The application finds the block by name in the linked program, so while the fragment shader
    // keeps `Material` the program's interface is unchanged (Babylon.js declares its whole Material
    // block in both stages and reads it in one). A block no stage reads goes from both, which is
    // what the flag asks the application to tolerate.
    const v3 = "uniform Material{vec4 diffuse;float alpha;};uniform Light0{vec4 dir;}light0;uniform Dead{vec4 x;};in vec3 p;void main(){gl_Position=vec4(p,1)*light0.dir;}";
    const f3 = "uniform Material{vec4 diffuse;float alpha;};uniform Dead{vec4 x;};out vec4 o;void main(){o=diffuse*alpha;}";
    const [v, f] = run([["a.vert", v3], ["a.frag", f3]], { removeUnusedUniforms: true });
    expect(v).toBe("uniform Light0{vec4 dir;} light0;in vec3 p;void main(){gl_Position=vec4(p,1)*light0.dir;}");
    expect(f).toBe("uniform Material{vec4 diffuse;float alpha;};out vec4 o;void main(){o=diffuse*alpha;}");
  });
  it("never removes a member of a block, since the members are looked up through the block", () => {
    const v4 = "uniform Material{vec4 diffuse;float alpha;};in vec3 p;void main(){gl_Position=vec4(p,1)*alpha;}";
    const [v] = run([["a.vert", v4], ["a.frag", frag]], { removeUnusedUniforms: true });
    expect(v).toContain("uniform Material{vec4 diffuse;float alpha;};");
  });
  it("keeps a block whose members it cannot see into, or that a kept #define names", () => {
    const v5 = "uniform Lights{\n#ifdef TWO\nvec4 b;\n#endif\nvec4 a;};\n#define LIGHT dir\nuniform Sun{vec4 dir;};in vec3 p;void main(){gl_Position=vec4(p,1);}";
    const [v] = run([["a.vert", v5], ["a.frag", frag]], { removeUnusedUniforms: true });
    expect(v).toContain("uniform Lights{");
    expect(v).toContain("uniform Sun{vec4 dir;};");
  });
  it("does nothing without both stages in the run", () => {
    expect(run([["a.vert", vert]], { removeUnusedUniforms: true })[0]).toContain("deadEverywhere");
  });
});

describe("--webgl across files", () => {
  const run = (files: [string, string][]): string => minifyApi(files.map(([name, content]) => ({ name, content })), { webgl: true, noRenaming: true, noPiSubstitution: true, inlining: "none" }).format("text");
  it("knows a struct declared in another file, so the struct rules apply to it", () => {
    const a = "struct S{float d;};";
    const b = "S pick(S a,S b){if(a.d<b.d)return a;return b;}void main(){S x;x.d=1.;gl_FragColor=vec4(pick(x,x).d);}";
    expect(run([["a.frag", a], ["b.frag", b]])).toContain("if(a.d<b.d)return a;return b;");
  });
  it("knows a function declared in another file, so a call to it is not an unknown type", () => {
    // Unknown, the call might yield a struct, which WebGL's ?: rejects, so the if/else would stay.
    // The files are still separate shaders otherwise: `pick` is removed from a.frag as unused there
    // (a run that concatenates its files passes --no-remove-unused, as with upstream), and the
    // effects of a call into another file are unknown, so the lone `pick(u,1.)` stays.
    const a = "uniform float u;float pick(float a,float b){return a<b?a:b;}";
    const b = "float r;void main(){if(u<1.)r=pick(u,2.);else r=pick(u,3.);pick(u,1.);gl_FragColor=vec4(r);}";
    const out = run([["a.frag", a], ["b.frag", b]]);
    expect(out).toContain("r=u<1.?pick(u,2.):pick(u,3.);pick(u,1.);");
  });
});

// The goldens run upstream's flags only. Run every command again with the port flags on, so the
// additions meet the whole corpus and the scope check (docs/PORTING.md 5.2 item 10) sees each rewrite,
// once as the plugin runs and once with upstream's aggressive inlining and moved declarations.
describe("port flags on the upstream corpus", () => {
  const portFlags: Partial<Options> = { expandMacros: true, approximateFolds: true, dropDefaultPrecision: true, inlineSingleUse: true, noPiSubstitution: true };
  for (const [label, aggressive] of [["plugin flags", false], ["plus aggressive inlining and moved declarations", true]] as const) {
    for (const argv of loadCommands()) {
      const { options, filenames } = Minifier.parseOptionsWithFiles(argv);
      it(`${filenames.join(" ")} [${label}]`, () => {
        const files = filenames.map((f): [string, string] => [f, fs.readFileSync(path.join(repoRoot, f), "utf8")]);
        // A command's --no-remove-unused and --no-inlining stay: every other command also removes
        // unused declarations, and in the second round inlines aggressively and moves declarations.
        const extra: Partial<Options> = aggressive ? { inlining: options.inlining === "none" ? "none" : "aggressive", moveDeclarations: true } : {};
        // Five of these (`many_variables`, `ed-209`, `slisesix`, `endeavour`, `audio-flight-v2`)
        // used to lose a declaration under --move-declarations: the moved declaration's own Ident
        // stood in the assignment that replaced it, and a later reuse renamed the declaration along
        // with that use (docs/PORTING.md 5.2 item 42). The scope check is what caught it.
        const run = (): Minifier => new Minifier({ ...options, ...portFlags, removeUnused: options.removeUnused === "none" ? "none" : "declarations", ...extra }, files);
        expect(run).not.toThrow();
      });
    }
  }
});
