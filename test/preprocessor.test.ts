import * as fs from "node:fs";
import { parse } from "@shaderfrog/glsl-parser";
import { describe, expect, it } from "vitest";
import { spglslShaders } from "../scripts/webgl-compile-page.js";
import { minify } from "../src/api.js";
import { expandMacros } from "../src/preprocessor.js";

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
    const { code } = minify(src, { noRemoveUnused: true, expandMacros: true });
    expect(code.length).toBeLessThan(12080);
    expect(code).not.toMatch(/SUBMATERIAL|iAnim/);
    expect(() => parse(code, { quiet: true })).not.toThrow();
  });
});
