import { describe, expect, it } from "vitest";
import { minify } from "../src/api.js";

const body = (expr: string, extra: object = {}): string =>
  minify(`uniform float a;void main(){gl_FragColor=vec4(${expr});}`, { noRenaming: true, noPiSubstitution: true, foldBuiltins: true, ...extra })
    .code.replace(/^.*gl_FragColor=vec4\(/, "").replace(/\);}$/, "");

describe("--fold-builtins", () => {
  const cases: [string, string][] = [
    ["radians(45.)", ".7853982"],
    ["pow(2.,3.)", "8"],
    ["sin(0.)", "0"],
    ["sqrt(4.)", "2"],
    ["sqrt(2.)", "sqrt(2.)"], // 1.4142135 is not shorter
    ["abs(-1.)", "1"],
    ["min(1.,2.)", "1"],
    ["clamp(5.,0.,1.)", "1"],
    ["mix(0.,10.,.25)", "2.5"],
    ["abs(-3)", "3"],
    ["max(3,4)", "4"],
    ["length(vec3(1.))", "1.7320508"],
    ["normalize(vec2(3.,4.))", "vec2(.6,.8)"],
    ["mix(vec2(0.),vec2(2.),.5)", "vec2(1)"],
    ["cross(vec3(1.,0.,0.),vec3(0.,1.,0.))", "vec3(0,0,1)"],
    ["dot(vec2(1.,2.),vec2(3.,4.))", "11"],
  ];
  for (const [expr, want] of cases) it(`${expr} -> ${want}`, () => expect(body(expr)).toBe(want));

  it("folds through operators at float32 precision", () => {
    // step-wise float32 rounding lands within an ulp of 1/tan(pi/8) = 2.41421356
    expect(body("1./tan(.5*radians(45.))")).toMatch(/^2\.414213\d$/);
  });
  it("leaves a fold that would not be shorter", () => {
    expect(body("exp(1.)")).toBe("exp(1.)"); // 2.7182817 is longer
  });
  it("leaves what GLSL calls undefined or implementation-defined alone", () => {
    for (const expr of ["round(.5)", "round(-2.5)", "pow(0.,0.)", "pow(-8.,3.)", "atan(0.,0.)"]) expect(body(expr)).toBe(expr);
    expect(body("round(.6)")).toBe("1");
    expect(body("pow(0.,2.)")).toBe("0");
    expect(body("atan(1.,0.)")).toBe("1.5707964");
  });
  describe("operator folds under the flag are float32-faithful", () => {
    // The GPU's compiler folds with float32 operands and one rounding per operation. Folding
    // in double first and rounding once can land one ulp off; a third of short literal pairs do.
    it("folds like the GPU and prints the shortest float32 digits", () => {
      expect(body("2.*3.141592653589793")).toBe("6.2831855");
      expect(body(".5*.5")).toBe(".25");
      expect(body("3.-1.")).toBe("2");
      expect(body("1./4.")).toBe(".25");
    });
    it("keeps the expression when the faithful literal would be longer", () => {
      // fround(.1)*fround(.05) is .0050000004, one ulp above fround(.005)
      expect(body(".1*.05")).toBe(".1*.05");
      expect(body(".1*.05", { foldBuiltins: false })).toBe(".005");
    });
  });
  it("leaves domain errors, non-literals, and ints where GLSL needs floats", () => {
    expect(body("sqrt(-1.)")).toBe("sqrt(-1.)");
    expect(body("sin(a)")).toBe("sin(a)");
    expect(body("sin(1)")).toBe("sin(1)");
  });
  it("does not fold a user function that shadows a builtin", () => {
    const src = "float radians(float x){return x*2.;}uniform float a;void main(){gl_FragColor=vec4(radians(45.)*a);}";
    const out = minify(src, { noRenaming: true, foldBuiltins: true, noInlining: true }).code;
    expect(out).toContain("radians(45.)");
  });
  it("is off by default", () => {
    expect(body("radians(45.)", { foldBuiltins: false })).toBe("radians(45.)");
  });
});
