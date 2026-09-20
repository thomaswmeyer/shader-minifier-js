// Identifiers named in a #define that stays in the output are pinned (PORTING.md 5.2 item 11):
// the macro's text is a use the minifier cannot see, so they keep their names and declarations.
import { describe, expect, it } from "vitest";
import { minify } from "../src/api.js";
import { macroBodyIdents, runParser } from "../src/parser.js";
import { defaultOptions } from "../src/options.js";

describe("macroBodyIdents", () => {
  it("separates a function-like macro's parameters from what its body names", () => {
    expect(macroBodyIdents("(a,b) a+b*k.x")).toEqual({ names: ["k"], fields: ["x"] });
  });
  it("treats a space before the parenthesis as an object-like body", () => {
    expect(macroBodyIdents(" (1+N)")).toEqual({ names: ["N"], fields: [] });
  });
  it("skips the letters of numbers and keeps swizzles as fields", () => {
    expect(macroBodyIdents(" p.xy+1e5+0x1F+.5e-3*q")).toEqual({ names: ["p", "q"], fields: ["xy"] });
  });
});

describe("pinned names", () => {
  const dmin = "#define DMIN(id) if(d<dMin){dMin=d;idObj=id;}\n";
  const src = dmin + "uniform float u;int idObj;float scene(vec3 p){float dMin=100.,d;d=length(p)-1.;DMIN(1);d=p.y+u;DMIN(2);return dMin;}void main(){gl_FragColor=vec4(scene(vec3(gl_FragCoord.xy,0)),idObj,0,1);}";

  it("records the identifiers of macro bodies on the shader", () => {
    const shader = runParser(defaultOptions(), "t.frag", src);
    expect(shader.pinnedNames).toEqual(["d", "dMin", "idObj"]);
    expect(shader.forbiddenNames.slice(0, 3).sort()).toEqual(["d", "dMin", "idObj"]);
  });

  it("keeps the names, declarations and assignments a kept macro reads, under renaming", () => {
    const out = minify(src, { preserveExternals: true }).code;
    expect(out).toContain("#define DMIN(id)if(d<dMin){dMin=d;idObj=id;}");
    expect(out).toMatch(/float dMin=1e2,d;|float dMin=100\.;float d;/);
    expect(out).toMatch(/d=length\(\w+\)-1\.;DMIN\(1\);d=\w+\.y\+u;DMIN\(2\);return dMin;/);
    expect(out).toContain("int idObj;");
  });

  it("does not merge a pinned local into a parameter or another local", () => {
    // Without the macro, `d` would be merged into `p` (var reuse) or its first assignment dropped.
    const src2 = "#define USE(x) x*d\nfloat f(float p){float d=p*2.;p=3.;return USE(p);}void main(){gl_FragColor=vec4(f(gl_FragCoord.x));}";
    const out = minify(src2, { noRenaming: true }).code;
    expect(out).toContain("float d=p*2.;");
  });

  it("keeps a function only a kept macro calls, and its name", () => {
    const src3 = "#define H(x) helper(x)\nfloat helper(float x){return x*.5;}void main(){gl_FragColor=vec4(H(gl_FragCoord.x));}";
    const out = minify(src3).code;
    expect(out).toContain("float helper(float x)");
    expect(out).toContain("H(gl_FragCoord.x)");
  });

  it("keeps struct and field names a kept macro spells", () => {
    const src4 = "#define DIST(o) o.dist\n#define MK(x) Hit(x,1)\nstruct Hit{float dist;int id;};void main(){Hit h=MK(gl_FragCoord.x);gl_FragColor=vec4(DIST(h));}";
    const out = minify(src4).code;
    expect(out).toContain("struct Hit{float dist;int ");
    expect(out).toContain("DIST(");
    expect(out).toContain("MK(gl_FragCoord.x)");
  });

  it("does not substitute a global for a pinned parameter", () => {
    const src5 = "#define ACC(x) s+=t*x\nuniform float uT;float f(float t){float s=0.;for(int i=0;i<3;i++)ACC(float(i));return s;}void main(){gl_FragColor=vec4(f(uT));}";
    const out = minify(src5, { noRenaming: true, inlineSingleUse: true }).code;
    expect(out).toContain("float t=uT");
    expect(out).toContain("ACC(float(i))");
  });

  it("pins nothing once --expand-macros has expanded the macro", () => {
    const short = "#define DM(id) idObj=id\nint idObj;void main(){float dMin=1.;DM(2);gl_FragColor=vec4(dMin,idObj,0,1);}";
    const out = minify(short, { expandMacros: true }).code;
    expect(out).not.toContain("DM(");
    expect(out).not.toContain("dMin");
  });

  it("leaves swizzle letters available as generated names", () => {
    // `.xy` in the body is a field use, not a variable: x and y are not forbidden.
    const src6 = "#define R(p) p.xy\nvoid main(){vec2 a=gl_FragCoord.xy,b=a*2.,c=b+a;gl_FragColor=vec4(R(c),R(b));}";
    const shader = runParser(defaultOptions(), "t.frag", src6);
    expect(shader.pinnedNames).toEqual([]);
    expect(shader.pinnedFields).toEqual(["xy"]);
    expect(shader.forbiddenNames).not.toContain("xy");
  });
});
