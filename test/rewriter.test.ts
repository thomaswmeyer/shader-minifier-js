// Pins the float constant-folding rule chosen in PLAN.md section 5.2.
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

// Verified against ANGLE (Chrome): ?: on structs fails in WebGL 1 and 2; void operands in a
// comma sequence fail in ES 3.00 only.
describe("--webgl", () => {
  const structReturn = "struct S{float d;};S pick(S a,S b){if(a.d<b.d)return a;return b;}void main(){S x;x.d=1.;gl_FragColor=vec4(pick(x,x).d);}";
  it("keeps if/return on struct-typed functions", () => {
    expect(minify(structReturn)).toContain("?x:x");
    expect(minify(structReturn, { webgl: true })).toContain("if(a.d<b.d)return a;return b;");
  });
  it("still folds if/return on scalars", () => {
    const src = "uniform float u;float pick(float a,float b){if(a<b)return a;return b;}void main(){gl_FragColor=vec4(pick(u,2.));}";
    expect(minify(src, { webgl: true })).toMatch(/<2\.\?a:2\./);
  });
  it("keeps if/else assignment of structs", () => {
    const src = "struct S{float d;};void main(){S x,y,z;x.d=1.;y.d=2.;if(x.d<y.d)z=x;else z=y;gl_FragColor=vec4(z.d);}";
    expect(minify(src)).toContain("z=x.d<y.d?x:y;");
    expect(minify(src, { webgl: true })).toContain("if(x.d<y.d)z=x;else z=y;");
  });
  it("keeps void calls out of comma sequences", () => {
    const src = "float g;void f(float x){g=x;}void main(){float a=1.;for(int i=0;i<2;i++){f(a);a+=1.;}gl_FragColor=vec4(a+g);}";
    expect(minify(src)).toContain("f(a),a+=1.;");
    expect(minify(src, { webgl: true })).toContain("{f(a);a+=1.;}");
  });
  it("rejects a struct ternary already present in the input", () => {
    const src = "struct S{float d;};S pick(S a,S b){return a.d<b.d?a:b;}void main(){S x;x.d=1.;gl_FragColor=vec4(pick(x,x).d);}";
    expect(() => minify(src)).not.toThrow();
    expect(() => minify(src, { webgl: true })).toThrow(/ternary operator on struct/);
  });
  it("rejects a void call in a sequence already present in the input", () => {
    const src = "float g;void f(float x){g=x;}void main(){float a=1.;for(int i=0;i<2;i++)f(a),a+=1.;gl_FragColor=vec4(a+g);}";
    expect(() => minify(src)).not.toThrow();
    expect(() => minify(src, { webgl: true })).toThrow(/void call in a comma sequence/);
  });
  it("still sequences non-void calls", () => {
    const src = "float g;float f(float x){g=x;return x;}void main(){float a=1.;for(int i=0;i<2;i++){f(a);a+=1.;}gl_FragColor=vec4(a+g);}";
    expect(minify(src, { webgl: true })).toContain("f(a),a+=1.;");
  });
});

describe("float constant folding", () => {
  it("rounds away double artefacts", () => {
    expect(minify("void main(){gl_FragColor=vec4(1.1+2.2);}")).toBe("void main(){gl_FragColor=vec4(3.3);}");
  });
  it("keeps 15 significant digits on full-precision constants", () => {
    expect(minify("void main(){gl_FragColor=vec4(2.*3.141592653589793);}")).toBe(
      "void main(){gl_FragColor=vec4(6.28318530717959);}",
    );
  });
});
