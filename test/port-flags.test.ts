// --drop-default-precision and --inline-single-use (PORTING.md 5.2).
import { describe, expect, it } from "vitest";
import { defaultOptions, type Options } from "../src/options.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { simplify } from "../src/rewriter.js";

function minify(src: string, extra: Partial<Options> = {}): string {
  const options = { ...defaultOptions(), noRenaming: true, noPiSubstitution: true, ...extra };
  const shader = runParser(options, "t.frag", src);
  return Printer.print(simplify(options, shader.code));
}

describe("--drop-default-precision", () => {
  const vert = "precision highp float;precision highp int;uniform float u;void main(){gl_Position=vec4(u);}";
  const frag = "precision highp float;precision mediump int;precision lowp sampler2D;uniform sampler2D s;out vec4 o;void main(){o=texture(s,vec2(0));}";
  it("is off by default", () => {
    expect(minify(vert)).toContain("precision highp float;precision highp int;");
  });
  it("drops highp float and int from a vertex shader", () => {
    expect(minify(vert, { dropDefaultPrecision: true })).toBe("uniform float u;void main(){gl_Position=vec4(u);}");
  });
  it("keeps highp float in a fragment shader, drops mediump int and lowp samplers", () => {
    expect(minify(frag, { dropDefaultPrecision: true })).toBe(
      "precision highp float;uniform sampler2D s;out vec4 o;void main(){o=texture(s,vec2(0));}",
    );
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
  it("keeps the local for a long uniform name used often", () => {
    const src = "uniform float uSomeLongName;float flow(vec2 p,float t){return sin(p.x+t)+cos(p.y-t)+sin(p.x+t)+cos(p.y*t);}void main(){gl_FragColor=vec4(flow(gl_FragCoord.xy,uSomeLongName));}";
    expect(minify(src, { inlineSingleUse: true })).toContain("float t=uSomeLongName;");
  });
});
