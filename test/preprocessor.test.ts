import * as fs from "node:fs";
import { parse } from "@shaderfrog/glsl-parser";
import { describe, expect, it } from "vitest";
import { spglslShaders } from "../scripts/webgl-compile-page.js";
import { minify } from "../src/api.js";
import { defaultOptions } from "../src/options.js";
import { evalConstantExpression, expandMacros, preprocess } from "../src/preprocessor.js";

describe("--preprocess decides constant #if expressions (PORTING.md 5.2 item 16)", () => {
  const defined = (n: string) => n === "USE_MAP";
  it("evaluates integers, defined() and the C operators", () => {
    expect(evalConstantExpression("( 1 > 0 ) && defined( USE_MAP )", defined)).toBe(1);
    expect(evalConstantExpression("0 > 0 || 1 > 0", defined)).toBe(1);
    expect(evalConstantExpression("! defined( USE_FOG )", defined)).toBe(1);
    expect(evalConstantExpression("defined USE_FOG", defined)).toBe(0);
    expect(evalConstantExpression("2 + 3 * 4 == 14 && 7 / 2 == 3 && 7 % 2 == 1", defined)).toBe(1);
    expect(evalConstantExpression("1 << 3", defined)).toBe(8);
    expect(evalConstantExpression("-1 < 0", defined)).toBe(1);
  });
  it("leaves a bare identifier without a value, a division by zero and malformed text undecided", () => {
    expect(evalConstantExpression("DEF", defined)).toBeNull();
    expect(evalConstantExpression("NUM_LIGHTS > 0", defined, (n) => (n === "NUM_LIGHTS" ? 2 : null))).toBe(1);
    expect(evalConstantExpression("1 / 0", defined)).toBeNull();
    expect(evalConstantExpression("(1", defined)).toBeNull();
    expect(evalConstantExpression("1 2", defined)).toBeNull();
  });
  it("short-circuits around an operand it cannot settle", () => {
    // `defined(X)` answering null means "the compiler knows, this pass does not".
    const unknown = (n: string) => (n === "USE_MAP" ? true : n.startsWith("GL_") ? null : false);
    expect(evalConstantExpression("defined(GL_EXT_frag_depth)", unknown)).toBeNull();
    expect(evalConstantExpression("1 || defined(GL_EXT_frag_depth)", unknown)).toBe(1);
    expect(evalConstantExpression("0 && defined(GL_EXT_frag_depth)", unknown)).toBe(0);
    expect(evalConstantExpression("0 || defined(GL_EXT_frag_depth)", unknown)).toBeNull();
    expect(evalConstantExpression("defined(USE_MAP) && (300 == 300 || defined(GL_EXT_frag_depth))", unknown)).toBe(1);
  });
  it("predefines what the #version line settles, and leaves the rest to the compiler", () => {
    // ESSL 3.00 requires highp in fragment shaders, so the driver always takes the first branch.
    const precision = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";
    expect(preprocess("t", "#version 300 es\n" + precision)).toContain("precision highp float;");
    expect(preprocess("t", "#version 300 es\n" + precision)).not.toContain("mediump");
    // At 1.00 it is the device's answer, so the block stays whole.
    expect(preprocess("t", "#version 100\n" + precision)).toContain("#ifdef GL_FRAGMENT_PRECISION_HIGH");
    // __VERSION__ is knowable; an extension macro is not, and reading it as 0 would pick a branch
    // the driver would not.
    const v = "#version 300 es\n#if __VERSION__ == 300\nA\n#else\nB\n#endif\n";
    expect(preprocess("t", v)).toContain("A");
    expect(preprocess("t", v)).not.toContain("B");
    expect(preprocess("t", "#version 300 es\n#ifdef GL_OES_standard_derivatives\nA\n#endif\n")).toContain("#ifdef GL_OES_standard_derivatives");
  });
  it("keeps an undecidable block balanced when an inactive block encloses it", () => {
    const src = "#version 300 es\n#if 0\n#ifdef GL_EXT_frag_depth\nA\n#endif\n#endif\nB\n";
    expect(preprocess("t", src)).not.toContain("#if");
  });
  it("drops the inactive branch of a block inside an argument list", () => {
    const src = "#define USE_MAP\nvoid main(){f(a,\n#if defined( USE_MAP ) && 1 > 0\n b\n#else\n c\n#endif\n);}";
    expect(preprocess("t", src)).toBe("#define USE_MAP\nvoid main(){f(a,\n\n b\n\n\n\n);}"); // removed lines stay blank
  });
  it("takes one branch of an #if/#elif/#else chain", () => {
    expect(preprocess("t", "#if 1\nint a;\n#elif 1\nint b;\n#else\nint c;\n#endif")).toBe("\nint a;\n\n\n\n\n");
    expect(preprocess("t", "#if 0\nint a;\n#elif 1\nint b;\n#else\nint c;\n#endif")).toBe("\n\n\nint b;\n\n\n");
    expect(preprocess("t", "#if 0\nint a;\n#elif 0\nint b;\n#else\nint c;\n#endif")).toBe("\n\n\n\n\nint c;\n");
  });
  it("keeps everything under an inactive block inactive, whatever its inner branches say", () => {
    expect(preprocess("t", "#if 0\n#if 0\nint a;\n#elif 1\nint b;\n#else\nint c;\n#endif\nint d;\n#endif\nint e;")).toBe("\n\n\n\n\n\n\n\n\n\nint e;");
  });
  it("keeps an undecidable chain, and turns a kept #elif after a dropped #if into #if", () => {
    // DEF's value is not an integer, so nothing about it is decided.
    const def = "#define DEF (1+FOO)\n";
    expect(preprocess("t", def + "#if DEF\nint a;\n#else\nint b;\n#endif")).toBe(def + "#if DEF\nint a;\n#else\nint b;\n#endif");
    expect(preprocess("t", def + "#if 0\nint a;\n#elif DEF\nint b;\n#else\nint c;\n#endif")).toBe(def + "\n\n#if DEF\nint b;\n#else\nint c;\n#endif");
    expect(preprocess("t", def + "#if 1\nint a;\n#elif DEF\nint b;\n#endif")).toBe(def + "\nint a;\n\n\n");
  });
  it("ignores a #define inside an inactive block", () => {
    const src = "#if 0\n#define ENV_WORLDPOS\n#endif\n#ifdef ENV_WORLDPOS\nint a;\n#else\nint b;\n#endif";
    expect(preprocess("t", src)).toBe("\n\n\n\n\n\nint b;\n");
  });
  it("recognises an indented directive", () => {
    expect(preprocess("t", "\t#ifdef NOPE\n\tint a;\n\t#else\n\tint b;\n\t#endif")).toBe("\n\n\n\tint b;\n");
  });
  it("decides a bare identifier from its integer #define, and an undefined one as 0", () => {
    expect(preprocess("t", "#define DEF 1\n#if DEF\nint a;\n#endif")).toBe("#define DEF 1\n\nint a;\n");
    expect(preprocess("t", "#define N 0\n#if N > 0\nint a;\n#else\nint b;\n#endif")).toBe("#define N 0\n\n\n\nint b;\n");
    expect(preprocess("t", "#if UNDEFINED\nint a;\n#endif")).toBe("\n\n");
  });
});

describe("--preprocess reads a define's value past a comment, and in hex", () => {
  const options = { ...defaultOptions(), preprocess: true };
  const active = (src: string): string[] => (preprocess(options, src).match(/int \w;/g) ?? []);
  it("ignores a trailing line or block comment on the value", () => {
    // Engine shaders write `#define NUM_DIR_LIGHTS 1 // count`; the comment is not part of the value.
    expect(active("#define N 1 // one\n#if N\nint a;\n#else\nint b;\n#endif\n")).toEqual(["int a;"]);
    expect(active("#define N 0 // zero\n#if N\nint a;\n#else\nint b;\n#endif\n")).toEqual(["int b;"]);
    expect(active("#define N 1 /* one */\n#if N\nint a;\n#endif\n")).toEqual(["int a;"]);
  });
  it("reads hex, in a define and in the condition", () => {
    expect(active("#define N 0x10\n#if N > 15\nint a;\n#endif\n")).toEqual(["int a;"]);
    expect(active("#if 0x0\nint a;\n#else\nint b;\n#endif\n")).toEqual(["int b;"]);
    expect(evalConstantExpression("0xFF == 255", () => false)).toBe(1);
  });
  it("still leaves a define that is not an integer undecided", () => {
    const fn = "#define F(x) (x*2)\n#if F\nint a;\n#endif\n";
    expect(preprocess(options, fn)).toContain("#if F");
    const str = '#define S "str"\n#if S\nint a;\n#endif\n';
    expect(preprocess(options, str)).toContain("#if S");
  });
});

describe("expandMacros", () => {
  it("expands object-like macros and drops their definitions", () => {
    expect(expandMacros("#define N 4\n#define P (N+1)\nint a=N*P;")).toBe("\n\nint a=4*(4+1);");
  });
  it("expands function-like macros with nested calls and rescans the result", () => {
    const src = "#define SQ(x) ((x)*(x))\n#define TWICE(a,b) (SQ(a)+b)\nfloat f=TWICE(sin(1.,2.),SQ(3.));";
    expect(expandMacros(src)).toBe("\n\nfloat f=(((sin(1.,2.))*(sin(1.,2.)))+((3.)*(3.)));");
  });
  it("leaves a function-like macro name alone when not called", () => {
    expect(expandMacros("#define F(x) x\nint F;")).toBe("\nint F;");
  });
  it("honours #undef and redefinition order", () => {
    expect(expandMacros("#define A 1\nint a=A;\n#undef A\nint b=A;\n#define A 2\nint c=A;")).toBe("\nint a=1;\n\nint b=A;\n\nint c=2;");
  });
  it("keeps macros that conditionals refer to, and macros defined inside conditionals", () => {
    const src = "#define FEATURE 1\n#if FEATURE\n#define K 3\nint k=K;\n#endif\nint f=FEATURE;";
    expect(expandMacros(src)).toBe(src);
  });
  it("keeps # and ## bodies for the compiler", () => {
    const src = "#define CAT(a,b) a##b\nint CAT(x,y);";
    expect(expandMacros(src)).toBe(src);
  });
  it("does not touch comments, numbers, or other directives", () => {
    const src = "#define e 9\nfloat a=1e5; // e\n/* e\n e */ float b=e;\n#pragma e";
    expect(expandMacros(src)).toBe("\nfloat a=1e5; // e\n/* e\n e */ float b=9;\n#pragma e");
  });
  it("joins continuation lines and strips comments from bodies", () => {
    expect(expandMacros("#define V vec2(1., \\\n 2.) // two\nvec2 v=V;")).toBe("\nvec2 v=vec2(1.,   2.);");
  });
  it("keeps a macro whose expansion would grow the output", () => {
    const body = "texture(iChannel0,p*.5+.5).xyz*vec3(1.,.8,.6)";
    const src = `#define T(p) ${body}\nvec3 a=T(x)+T(y)+T(z)+T(w);`;
    expect(expandMacros(src)).toBe(src);
    expect(expandMacros("#define T(p) p\nvec3 a=T(x)+T(y);")).toBe("\nvec3 a=x+y;");
  });
  it("transitively keeps what a kept macro refers to", () => {
    const src = "#define N 4\n#define FEATURE N\n#if FEATURE\nint a=N;\n#endif";
    expect(expandMacros(src)).toBe(src);
  });
  it("does not recurse into a self-referential macro", () => {
    expect(expandMacros("#define x x+1\nint a=x;")).toBe("\nint a=x+1;");
  });
  it("expands a call whose arguments span lines, keeping the line count", () => {
    // Once left unexpanded with its #define removed, so the shader no longer compiled.
    const src = "#define F(a,b) ((a)+(b))\nfloat x=F(1.,\n  2.);\nfloat y=F(\n  3.,\n  4.\n);";
    const out = expandMacros(src);
    expect(out).toBe("\nfloat x=((1.)+(2.))\n;\nfloat y=((3.)+(4.))\n\n\n;");
    expect(out.split("\n").length).toBe(src.split("\n").length);
  });
  it("keeps expanding after a line comment inside a run of code lines", () => {
    expect(expandMacros("#define N 2\nint a=N; // N\nint b=N;")).toBe("\nint a=2; // N\nint b=2;");
  });
  it("expands a macro defined later in the file only after its definition", () => {
    expect(expandMacros("#define A B\nint a=A;\n#define B 1\nint b=A;")).toBe("\nint a=B;\n\nint b=1;");
  });
  it("lets a parameter shadow a macro of the same name", () => {
    expect(expandMacros("#define N 4\n#define F(N) N*2\nint a=F(3)+N;")).toBe("\n\nint a=3*2+4;");
  });
  it("stops mutual recursion like a real preprocessor", () => {
    expect(expandMacros("#define A B\n#define B A\nint a=A;")).toBe("\n\nint a=A;");
  });
  it("keeps commas inside parentheses within one argument", () => {
    expect(expandMacros("#define F(a,b) a+b\nvec2 x=F(vec2(1.,2.),vec2(3.,4.));")).toBe("\nvec2 x=vec2(1.,2.)+vec2(3.,4.);");
  });
  it("expands inside the body of a kept conditional block", () => {
    expect(expandMacros("#define K 3\n#ifdef FOO\nint a=K;\n#endif\nint b=K;")).toBe("\n#ifdef FOO\nint a=3;\n#endif\nint b=3;");
  });
});

describe("--expand-macros on the spglsl corpus", () => {
  const island = `${spglslShaders}/custom/island-not-found.frag`;
  it.skipIf(!fs.existsSync(island))("beats spglsl on island-not-found and stays valid", () => {
    const src = fs.readFileSync(island, "utf8");
    const { code } = minify(src, { removeUnused: "none", expandMacros: true });
    expect(code.length).toBeLessThan(12080);
    expect(code).not.toMatch(/SUBMATERIAL|iAnim/);
    expect(() => parse(code, { quiet: true })).not.toThrow();
  });
});
