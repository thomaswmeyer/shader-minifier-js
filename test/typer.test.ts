// Overload resolution by argument type (docs/PORTING.md 5.2 item 48): among user functions of one name
// and arity, a call binds to the one whose parameters have the arguments' types, when every type
// is known and exactly one overload fits. What the typer knows, and what it refuses, is pinned here.
import { describe, expect, it } from "vitest";
import { minify } from "../src/api.js";
import { Analyzer } from "../src/analyzer.js";
import * as Ast from "../src/ast.js";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";
import { ExprTyper, typeName } from "../src/typer.js";

/** The type the typer gives `expr`, in a shader with the given declarations, as a type name (with `[n]` per array dimension) or null. */
function typeIn(decls: string, expr: string): string | null {
  const code = runParser(defaultOptions(), "t.frag", `${decls}void main(){gl_FragColor=vec4(0);float probe_=float(${expr});}`).code;
  new Analyzer().resolve(code);
  const structs = new Map<string, Ast.StructOrInterfaceBlock>();
  for (const tl of code) if (tl.kind === "TypeDecl" && tl.block.name !== null) structs.set(tl.block.name.name, tl.block);
  const main = code.find((tl) => tl.kind === "Function" && tl.funcType.fName.name === "main");
  if (main === undefined || main.kind !== "Function" || main.body.kind !== "Block") throw new Error("no main");
  const probe = main.body.stmts[1];
  if (probe.kind !== "Decl" || probe.decl[1][0].init === null || probe.decl[1][0].init.kind !== "FunCall") throw new Error("no probe");
  const t = new ExprTyper(structs).typeOf(probe.decl[1][0].init.args[0]);
  return t === null ? null : `${typeName(t)}${"[]".repeat(t.arraySizes.length)}`;
}

describe("the expression typer", () => {
  const decls = "uniform vec3 u;uniform mat4 m;uniform sampler2D t;uniform usampler2D ut;uniform sampler2DShadow st;struct S{vec2 p;float w[2];};uniform S s;uniform float arr[3];uniform ivec2 iv;";
  const cases: [string, string | null][] = [
    ["1.", "float"], ["1", "int"], ["u", "vec3"], ["u.xy", "vec2"], ["u.z", "float"], ["u.zzzz", "vec4"],
    ["u*2.", "vec3"], ["2.*u", "vec3"], ["u+u", "vec3"], ["m*vec4(u,1.)", "vec4"], ["vec4(u,1.)*m", "vec4"], ["m*m", "mat4"], ["m*2.", "mat4"],
    ["u.x<1.", "bool"], ["u.x<1.?u:u*2.", "vec3"], ["-u", "vec3"], ["m[0]", "vec4"], ["u[1]", "float"], ["arr[1]", "float"], ["arr", "float[]"],
    ["s.p", "vec2"], ["s.w", "float[]"], ["s.w[0]", "float"], ["iv.x", "int"], ["iv*2", "ivec2"],
    ["max(u,1.)", "vec3"], ["step(.5,u.xy)", "vec2"], ["mix(u,u,.5)", "vec3"], ["length(u)", "float"], ["dot(u,u)", "float"], ["normalize(u)", "vec3"], ["sin(u.x)", "float"],
    ["texture(t,u.xy)", "vec4"], ["texture(ut,u.xy)", "uvec4"], ["texture(st,u)", "float"], ["gl_FragCoord.xy", "vec2"],
    ["u*iv.x", null], ["m*u", null], ["u.x<1.?u:u.xy", null], ["unknownFn(1.)", null], ["transpose(m)", null],
  ];
  for (const [e, want] of cases) it(`${e} is ${want ?? "unknown"}`, () => expect(typeIn(decls, e)).toBe(want));
});

describe("overload resolution by argument type", () => {
  const o = { noRenaming: true, noPiSubstitution: true };
  it("binds a call to the overload its argument types fit, so the unused one goes and a single-use one inlines", () => {
    const src = "uniform vec2 u;float sq(float x){return x*.5;}vec2 sq(vec2 x){return x*.5;}vec2 sq(vec3 x){return x.xy;}void main(){gl_FragColor=vec4(sq(u.x),sq(u),0,1);}";
    // sq(vec3) is never called; the two calls each bind to one overload and inline as single-use one-liners.
    expect(minify(src, o).code).toBe("uniform vec2 u;void main(){gl_FragColor=vec4(u.x*.5,u*.5,0,1);}");
  });
  it("leaves a call unresolved when an argument's type is unknown or an int would need converting, and keeps every overload", () => {
    const src = "#define M(v) v\nuniform vec2 u;float sq(float x){return x*.5;}float sq(int x){return float(x);}void main(){gl_FragColor=vec4(sq(M(u.x)),0,0,1);}";
    const out = minify(src, { ...o, inlining: "none" }).code;
    expect(out).toContain("float sq(float x)");
    expect(out).toContain("float sq(int x)");
    // `sq(2)` is exact for sq(int); `sq(2.)` for sq(float); an int literal is never read as a float.
    const src2 = "uniform vec2 u;float sq(float x){return x*.5;}float sq(int x){return float(x)*2.;}void main(){gl_FragColor=vec4(sq(2)+sq(2.),0,0,1);}";
    expect(minify(src2, o).code).toBe("uniform vec2 u;void main(){gl_FragColor=vec4(float(2)*2.+1.,0,0,1);}");
  });
  it("never resolves through an alternative: a variable declared in two #if branches, or an overload inside one", () => {
    // Under the other setting `v` is a vec2, and the overload that setting needs must stay.
    const local = "uniform float u;float f(float x){return x*.5;}float f(vec2 x){return x.y;}void main(){\n#ifdef X\nfloat v=u;\n#else\nvec2 v=vec2(u);\n#endif\ngl_FragColor=vec4(f(v));}";
    const out = minify(local, o).code;
    expect(out).toContain("float f(float x)");
    expect(out).toContain("float f(vec2 x)");
    const global = "uniform float u;\n#ifdef X\nfloat g=u;\n#else\nvec2 g=vec2(u);\n#endif\nfloat f(float x){return x*.5;}float f(vec2 x){return x.y;}void main(){gl_FragColor=vec4(f(g));}";
    const out2 = minify(global, o).code;
    expect(out2).toContain("float f(float x)");
    expect(out2).toContain("float f(vec2 x)");
    const fn = "uniform float u;\n#ifdef X\nfloat f(float x){return x*.5;}\n#else\nfloat f(float x){return x*.25;}\n#endif\nfloat f(vec2 x){return x.y;}void main(){gl_FragColor=vec4(f(u));}";
    const out3 = minify(fn, o).code;
    expect(out3).toContain("float f(vec2 x)");
    expect(out3.match(/float f\(float x\)/g)!.length).toBe(2);
  });
  it("types a struct field and an array element for the match", () => {
    const src = "struct S{vec2 p;float w[2];};uniform S s;float f(vec2 v){return v.x;}float f(float x){return x*3.;}void main(){gl_FragColor=vec4(f(s.p),f(s.w[1]),0,1);}";
    expect(minify(src, o).code).toBe("struct S{vec2 p;float w[2];};uniform S s;void main(){gl_FragColor=vec4(s.p.x,s.w[1]*3.,0,1);}");
  });
});
