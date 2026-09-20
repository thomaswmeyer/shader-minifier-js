// --drop-default-precision and --inline-single-use (PORTING.md 5.2), and the port flags on the
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

describe("--webgl across files", () => {
  it("treats a struct declared in another file as unknown, so the rewrites stay conservative", () => {
    const a = "struct S{float d;};";
    const b = "S pick(S a,S b){if(a.d<b.d)return a;return b;}void main(){S x;x.d=1.;gl_FragColor=vec4(pick(x,x).d);}";
    const out = minifyApi([{ name: "a.frag", content: a }, { name: "b.frag", content: b }], { webgl: true, noRenaming: true, noPiSubstitution: true });
    expect(out.shaders[1].code.length).toBeGreaterThan(0);
    expect(out.format("text")).toContain("if(a.d<b.d)return a;return b;");
  });
});

// The goldens run upstream's flags only. Run every command again with the port flags on, so the
// additions meet the whole corpus and the scope check (PORTING.md 5.2 item 10) sees each rewrite,
// once as the plugin runs and once with upstream's aggressive inlining and moved declarations.
describe("port flags on the upstream corpus", () => {
  const portFlags: Partial<Options> = { expandMacros: true, foldBuiltins: true, dropDefaultPrecision: true, inlineSingleUse: true, noPiSubstitution: true };
  for (const [label, extra] of [["plugin flags", {}], ["plus aggressive inlining and moved declarations", { aggroInlining: true, moveDeclarations: true }]] as const) {
    for (const argv of loadCommands()) {
      const { options, filenames } = Minifier.parseOptionsWithFiles(argv);
      it(`${filenames.join(" ")} [${label}]`, () => {
        const files = filenames.map((f): [string, string] => [f, fs.readFileSync(path.join(repoRoot, f), "utf8")]);
        expect(() => new Minifier({ ...options, ...portFlags, ...extra }, files)).not.toThrow();
      });
    }
  }
});
