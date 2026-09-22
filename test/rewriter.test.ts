// The float constant-folding rule (docs/PORTING.md 5.2) and the --webgl guards.
import { describe, expect, it } from "vitest";
import { minify as minifyApi } from "../src/api.js";
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
  it("accepts a ternary whose type is a kept #define for a builtin", () => {
    // Cesium's FXAA pass declares `FxaaBool goodSpanN` and writes
    // `directionN ? goodSpanN : goodSpanP`. `FxaaBool` is not a builtin type name, but it is not
    // a struct either, and the check has to be sure before it refuses a shader ANGLE accepts.
    const src = "#define FxaaBool bool\nuniform float u;void main(){FxaaBool a=u<1.,b=u<2.,c=u<3.;gl_FragColor=vec4((a?b:c)?1.:0.);}";
    expect(() => minify(src, { webgl: true })).not.toThrow();
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
  describe("overloaded user functions the analyzer cannot resolve", () => {
    // The argument is a kept macro's call, whose type nothing can tell, so the call stays unresolved.
    it("are typed when every overload returns the same type", () => {
      const src = "#define M(v) v\nfloat f(float x){return x*2.;}float f(int x){return float(x);}float pick(float c){for(int i=0;i<1;i++){if(c<0.)return f(M(1.));return f(M(2));}return 0.;}void main(){gl_FragColor=vec4(pick(gl_FragCoord.x));}";
      expect(minify(src, { webgl: true })).toContain("return c<0.?f(M(1.)):f(M(2));");
      const seq = "#define M(v) v\nfloat g;float f(float x){g=x;return x;}float f(int x){g=float(x);return 0.;}void main(){float a=1.;for(int i=0;i<2;i++){f(M(a));a+=1.;}gl_FragColor=vec4(a+g);}";
      expect(minify(seq, { webgl: true })).toContain("f(M(a)),a+=1.;");
    });
    it("stay unknown when the overloads disagree, so the rewrites are skipped", () => {
      const src = "struct S{float d;};S f(float x){S s;s.d=x;return s;}float f(int x){return float(x);}void main(){S a;for(int i=0;i<1;i++){if(gl_FragCoord.x<0.)a=f(1.);else a=f(2.);}gl_FragColor=vec4(a.d);}";
      expect(minify(src, { webgl: true })).toContain("if(gl_FragCoord.x<0.)a=f(1.);else a=f(2.);");
      const seq = "float g;void f(float x){g=x;}float f(int x){g=float(x);return 0.;}void main(){float a=1.;for(int i=0;i<2;i++){f(a);a+=1.;}gl_FragColor=vec4(a+g);}";
      expect(minify(seq, { webgl: true })).toContain("{f(a);a+=1.;}");
    });
    it("let the output check see a struct ternary in the input", () => {
      const src = "struct S{float d;};S mk(float d){S s;s.d=d;return s;}S mk(int d){S s;s.d=float(d);return s;}void main(){gl_FragColor=vec4((gl_FragCoord.x<0.?mk(1.):mk(2)).d);}";
      expect(() => minify(src, { webgl: true })).toThrow(/ternary operator on struct/);
    });
  });
});

describe("reorderFunctions with #ifdef regions", () => {
  // The reordering happens in the Minifier, not in simplify(): go through the API.
  const minify = (src: string, extra: Partial<Options> = {}): string => minifyApi(src, { noRenaming: true, noPiSubstitution: true, ...extra }).code;
  it("keeps alternative definitions in their blocks and puts what they call before them", () => {
    const src = "float tri(float x){return abs(fract(x)-.5);}float noise(vec2 p);\n#ifdef TRI\nfloat noise(vec2 p){return tri(p.x)+tri(p.y);}\n#else\nfloat noise(vec2 p){return sin(p.x)*sin(p.y);}\n#endif\nfloat layer(vec2 p){return noise(p)+noise(p*2.)*.5;}void main(){gl_FragColor=vec4(layer(gl_FragCoord.xy));}";
    expect(minify(src, { inlining: "none" })).toBe(
      "float tri(float x){return abs(fract(x)-.5);}\n#ifdef TRI\nfloat noise(vec2 p){return tri(p.x)+tri(p.y);}\n#else\nfloat noise(vec2 p){return sin(p.x)*sin(p.y);}\n#endif\nfloat layer(vec2 p){return noise(p)+noise(p*2.)*.5;}void main(){gl_FragColor=vec4(layer(gl_FragCoord.xy));}",
    );
  });
  it("pulls a callee defined later in the file ahead of the region that needs it", () => {
    const src = "float g();\n#ifdef A\nfloat g(){return h(1.);}\n#else\nfloat g(){return h(2.);}\n#endif\nfloat h(float x){return x*2.;}void main(){gl_FragColor=vec4(g());}";
    const out = minify(src, { inlining: "none" });
    expect(out.indexOf("float h(")).toBeLessThan(out.indexOf("#ifdef A"));
  });
  it("puts a region before another region that calls into it", () => {
    const src = "float g();float h();\n#ifdef X\nfloat g(){return h()+1.;}\n#else\nfloat g(){return 2.;}\n#endif\n#ifdef Y\nfloat h(){return fract(gl_FragCoord.x);}\n#else\nfloat h(){return 3.;}\n#endif\nvoid main(){gl_FragColor=vec4(g());}";
    const out = minify(src, { inlining: "none" });
    expect(out.indexOf("#ifdef Y")).toBeLessThan(out.indexOf("#ifdef X"));
  });
  it("puts a free function after the region it calls and before the region that calls it", () => {
    const src = "float r1();float mid();float r2();\n#ifdef X\nfloat r1(){return mid()+1.;}\n#endif\nfloat mid(){return r2()+2.;}\n#ifdef Y\nfloat r2(){return fract(gl_FragCoord.x);}\n#endif\nvoid main(){gl_FragColor=vec4(r1());}";
    const out = minify(src, { inlining: "none" });
    expect(out.indexOf("#ifdef Y")).toBeLessThan(out.indexOf("float mid("));
    expect(out.indexOf("float mid(")).toBeLessThan(out.indexOf("#ifdef X"));
  });
  it("places a function kept as text after what it calls and before what calls it", () => {
    // `g` has a conditional in its parameter list, so it is verbatim text (docs/PORTING.md item 31):
    // its callees are known only by name, and so are its callers.
    const src = "float h(float x);float g(\n#ifdef A\nfloat x\n#else\nint x\n#endif\n){return h(float(x));}float h(float x){return x*2.;}float k(){return g(1.);}void main(){gl_FragColor=vec4(k());}";
    const out = minify(src, { inlining: "none" });
    expect(out.indexOf("float h(")).toBeLessThan(out.indexOf("float g("));
    expect(out.indexOf("float g(")).toBeLessThan(out.indexOf("float k("));
  });
  it("leaves a cycle through two regions in file order, since the forward declarations are gone", () => {
    const src = "float p();float q();\n#ifdef X\nfloat p(){return q()+1.;}\n#endif\n#ifdef Y\nfloat q(){return p()+2.;}\n#endif\nvoid main(){gl_FragColor=vec4(p());}";
    const out = minify(src, { inlining: "none" });
    expect(out.indexOf("#ifdef X")).toBeLessThan(out.indexOf("#ifdef Y"));
  });
  it("orders as upstream does when there is no region", () => {
    const src = "float a();float b(){return a()+1.;}float a(){return 2.;}void main(){gl_FragColor=vec4(b());}";
    expect(minify(src, { inlining: "none" })).toBe("float a(){return 2.;}float b(){return a()+1.;}void main(){gl_FragColor=vec4(b());}");
  });
});

describe("struct fields named like swizzle components (upstream refuses them)", () => {
  const minify = (src: string, extra: Partial<Options> = {}): string => minifyApi(src, { noPiSubstitution: true, ...extra }).code;
  const hex = "struct H{float q;float r;float s;};H mk(float q,float r){H h;h.q=q;h.r=r;h.s=-q-r;return h;}void main(){vec2 p=gl_FragCoord.st;H h=mk(p.s,p.t);gl_FragColor=vec4(h.q,h.r,h.s,p.rg.x);}";
  it("keeps the fields and their uses, and still canonicalises real swizzles", () => {
    const out = minify(hex);
    expect(out).toMatch(/struct \w+\{float q;float r;float s;\}/);
    expect(out).toMatch(/\w+\.q=\w+;\w+\.r=\w+;\w+\.s=-\w+-\w+;/);
    expect(out).toContain("gl_FragCoord.xy");
    expect(out).toMatch(/\(\w+\.x,\w+\.y\)/); // p.s, p.t as arguments
    expect(out).toMatch(/vec4\(\w+\.q,\w+\.r,\w+\.s,\w+\)/); // p.rg.x -> p.x -> p, upstream's last-argument rule
  });
  it("does not combine struct field reads into a swizzle, but still combines vector reads", () => {
    const src = "struct S{float x;float y;};void main(){S s;s.x=1.;s.y=2.;vec2 v=gl_FragCoord.xy;gl_FragColor=vec4(s.x,s.y,v.x,v.y);}";
    expect(minify(src, { noRenaming: true })).toContain("vec4(s.x,s.y,v)");
  });
  it("leaves a field named x alone under --field-names rgba while vectors switch to rgba", () => {
    const src = "struct S{float x;};void main(){S s;s.x=1.;vec2 v=gl_FragCoord.xy;gl_FragColor=vec4(s.x,v.x,v.y,1);}";
    expect(minify(src, { noRenaming: true, canonicalFieldNames: "rgba" })).toContain("vec4(s.x,v.rg,1)");
    expect(minify(src, { noRenaming: true, canonicalFieldNames: "rgba" })).toContain("gl_FragCoord.rg");
  });
  it("never generates a field's swizzle-like name for anything else", () => {
    const src = hex + "float extra(float a,float b,float c){return a*b+c;}";
    const out = minify(src, { removeUnused: "none" });
    // q, r and s are forbidden as generated names: the three parameters cannot be called that
    expect(out).not.toMatch(/float \w+\(float q,|,float r,|,float s\)/);
  });
});

describe("kept #define spacing", () => {
  it("keeps one space between an object-like macro's name and body, tab or not, and none for an empty body", () => {
    // upstream glued `#define A\t\tvec2(1)` into `#define Avec2(1)`
    const src = "#define A\t\tvec2(1)\n#define B\t// only a comment\n#define C (1)\nvoid main(){gl_FragColor=vec4(A,0,C);}";
    expect(minify(src)).toBe("#define A vec2(1)\n#define B\n#define C (1)\nvoid main(){gl_FragColor=vec4(A,0,C);}");
  });
});

describe("--move-declarations", () => {
  it("does not hoist a local above an earlier use of its name that refers to a global", () => {
    // Upstream merges `float t` into the block's first float declaration, and `t.x` then names it.
    // (Adjacent declarations merge anyway, and that is fine: a declarator's scope starts after it.)
    const opts = { moveDeclarations: true, inlining: "none" };
    const src = "uniform vec2 t;void main(){float a=1.;float b=t.x*a;a+=b;float t=0.;for(int i=0;i<2;i++)t+=b;gl_FragColor=vec4(t,a,0,1);}";
    expect(minify(src, opts)).toBe("uniform vec2 t;void main(){float a=1.,b=t.x*a;a+=b;float t=0.;for(int i=0;i<2;i++)t+=b;gl_FragColor=vec4(t,a,0,1);}");
    const control = "uniform vec2 t;void main(){float a=1.;float b=a*2.;a+=b;float c=0.;for(int i=0;i<2;i++)c+=b;gl_FragColor=vec4(c,a,b,1);}";
    expect(minify(control, opts)).toBe("uniform vec2 t;void main(){float a=1.,b=a*2.,c;a+=b;c=0.;for(int i=0;i<2;i++)c+=b;gl_FragColor=vec4(c,a,b,1);}");
  });
});

// A local's initializer merged into the assignment that follows may not land in an lvalue position.
describe("merging a declaration into the assignment that follows", () => {
  it("does not substitute the initializer into an inout argument, even of a callee that never writes it", () => {
    const src = "vec3 f(inout vec3 x,vec3 y){return y*2.;}uniform vec3 u;void main(){vec3 v=vec3(0);v=f(v,u);gl_FragColor=vec4(v,1);}";
    expect(minify(src, { inlining: "none" })).toContain("vec3 v=vec3(0);v=f(v,u);");
    // A value use merges as before.
    expect(minify("vec3 g(vec3 x){return x*2.;}uniform vec3 u;void main(){vec3 v=u;v=g(v);gl_FragColor=vec4(v,1);}", { inlining: "none" })).toContain("vec3 v=g(u);");
  });
});

// Upstream's decimal arithmetic, kept behind --decimal-folds for the goldens; the default rounds
// at float32 (test/fold-builtins.test.ts).
describe("float constant folding with --decimal-folds", () => {
  const decimal = (src: string): string => minify(src, { decimalFolds: true });
  it("rounds away double artefacts", () => {
    expect(decimal("void main(){gl_FragColor=vec4(1.1+2.2);}")).toBe("void main(){gl_FragColor=vec4(3.3);}");
  });
  it("keeps 15 significant digits on full-precision constants", () => {
    expect(decimal("void main(){gl_FragColor=vec4(2.*3.141592653589793);}")).toBe(
      "void main(){gl_FragColor=vec4(6.28318530717959);}",
    );
  });
});

// A `#if`/`#elif`/`#else` chain standing where one expression does. Engine shaders write one
// inside an argument list and leave the choice to the compiler's preprocessor, so all branches
// are kept and none may be assumed taken (docs/TODO.md section 1, first step).
describe("a conditional in an argument position", () => {
  const parse = (src: string): string => Printer.print(runParser(defaultOptions(), "t.frag", src).code);
  const chain = "\n#if defined( X )\nb\n#elif defined( Y )\nc\n#else\nd\n#endif\n";
  const shader = (call: string): string => `precision highp float;uniform float b,c,d;float g(float x,float y){return x+y;}void main(){gl_FragColor=vec4(${call});}`;

  it("round-trips the branches and their directives", () => {
    const src = `precision highp float;\nuniform float b,c,d;\nfloat g(float x,float y){return x+y;}\nvoid main(){gl_FragColor=vec4(g(b,\n#if defined( X )\nb\n#elif defined( Y )\nc\n#else\nd\n#endif\n));}`;
    const out = parse(src);
    expect(out).toContain(chain);
    expect(out).toContain("g(b,");
  });

  it("parenthesises the chain where the surrounding precedence needs it", () => {
    // Whichever branch survives becomes an operand of what surrounds it, so `* 2.` must not bind
    // to the tail of a branch.
    const out = minifyApi(shader("g(b,\n#if defined( X )\nb+c\n#else\nd\n#endif\n)*2."), { noRenaming: true, noPiSubstitution: true }).code;
    expect(out).toContain("*2.");
    expect(out).toMatch(/\(\n#if defined\( X \)/);
  });

  it("renames inside every branch, and counts a use in each", () => {
    const out = minifyApi(shader("g(b,\n#if defined( X )\nb\n#else\nc\n#endif\n)"), { noPiSubstitution: true }).code;
    // b and c are uniforms: renamed, and the uses inside the branches follow their declarations.
    expect(out).not.toContain("uniform float b,c,d;");
    expect(out).toContain("#if defined( X )");
    for (const line of out.split("\n")) if (!line.startsWith("#")) expect(line).not.toMatch(/\bb\b|\bc\b/);
  });

  it("keeps an effect inside the branch that guards it", () => {
    // bump() is inlined into the branch, which is right: the increment happens only when the
    // preprocessor keeps that branch, exactly as the source had it.
    const src = "precision highp float;int n;float bump(){return float(n++);}float g(float x,float y){return x+y;}void main(){gl_FragColor=vec4(g(1.,\n#if defined( X )\nbump()\n#else\n2.\n#endif\n));}";
    const out = minifyApi(src, { noRenaming: true, noPiSubstitution: true }).code;
    expect(out).toMatch(/#if defined\( X \)\nfloat\(n\+\+\)\n#else/);
  });
});
