// The pixel harness's node-side helpers (test/pixels.ts), tested without a browser.
import { describe, expect, it } from "vitest";
import { activeSource, comparePixelsWithin, compareVaryings, countDifferingPixels, glslVersion, judgePixels, perturbFloatLiterals, shaderInterface, toEs100 } from "./pixels.js";

describe("perturbFloatLiterals", () => {
  it("moves every float literal to the next float32 and leaves the rest alone", () => {
    expect(perturbFloatLiterals("float a=.5+1.+2.5e-3*3+1e5-p.xy.x+v[2]+0.;"))
      .toBe("float a=0.50000006+1.00000012+0.00250000018*3+100000.008-p.xy.x+v[2]+1.4e-45;");
  });
  it("does not touch directives, integers, swizzles or identifiers", () => {
    const src = "#version 300 es\n#define N 4\nint k=N*2;vec3 c=v.rgb;float x1=x2;";
    expect(perturbFloatLiterals(src)).toBe(src);
  });
  it("moves a negative literal away from zero", () => {
    expect(perturbFloatLiterals("float a=-1.5;")).toBe("float a=-1.50000012;"); // the sign is an operator; 1.5 moves up
  });
});

describe("activeSource", () => {
  it("decides #if, #ifdef, #elif and #else from the file's defines, C style", () => {
    const src = "#define A 1\n#define N 0\n#if A\nint a;\n#else\nint b;\n#endif\n#if N > 0\nint c;\n#elif defined(A) && !defined(B)\nint d;\n#else\nint e;\n#endif\n#ifdef B\nint f;\n#endif\n#ifndef B\nint g;\n#endif";
    expect(activeSource(src).source.match(/int \w;/g)).toEqual(["int a;", "int d;", "int g;"]);
  });
  it("keeps nested blocks inactive under an inactive parent", () => {
    const src = "#if 0\n#if 1\nint a;\n#else\nint b;\n#endif\n#endif\nint c;";
    expect(activeSource(src).source.match(/int \w;/g)).toEqual(["int c;"]);
  });
  it("reports integer defines and treats undefined names as 0", () => {
    const { defines, source } = activeSource("#define N 3\n#define S (1+2)\n#if UNDEFINED\nint a;\n#endif");
    expect(defines.get("N")).toBe(3);
    expect(Number.isNaN(defines.get("S"))).toBe(true);
    expect(source).not.toContain("int a;");
  });
});

describe("shaderInterface", () => {
  it("lists a fragment shader's inputs with type, array size and flat", () => {
    const src = "#version 300 es\nprecision highp float;\nin vec2 vUv;\nflat in int vId;\nin float vW[2];\nuniform float u;\nout vec4 o;\nvoid main(){o=vec4(vUv,vW[0],u);}";
    expect(shaderInterface("t.frag", src, "frag")).toEqual([
      { name: "vUv", type: "vec2", size: 1, array: false, flat: false },
      { name: "vId", type: "int", size: 1, array: false, flat: true },
      { name: "vW", type: "float", size: 2, array: true, flat: false },
    ]);
  });
  it("lists a vertex shader's outputs, sizing arrays by the file's defines and dropping zero-sized ones", () => {
    const src = "#version 300 es\n#define NUM_A 2\n#define NUM_B 0\nin vec3 p;\nout vec3 vN;\n#if NUM_A > 0\nout vec4 vA[NUM_A];\n#endif\n#if NUM_B > 0\nout vec4 vB[NUM_B];\n#endif\nvoid main(){gl_Position=vec4(p,1);}";
    expect(shaderInterface("t.vert", src, "vert")).toEqual([
      { name: "vN", type: "vec3", size: 1, array: false, flat: false },
      { name: "vA", type: "vec4", size: 2, array: true, flat: false },
    ]);
  });
  it("takes ES 1.00 varyings and attributes", () => {
    const src = "varying vec2 vUv;attribute vec3 position;void main(){gl_FragColor=vec4(vUv,0,1);}";
    expect(shaderInterface("t.frag", src, "frag").map((i) => i.name)).toEqual(["vUv", "position"]);
  });
});

describe("pixel and varying comparisons", () => {
  const black = (n: number): number[] => Array(n * 4).fill(0);
  it("allows twice the shader's own one-ulp noise", () => {
    const a = black(4);
    const b = [...a]; b[0] = 9; b[4] = 9; // two pixels differ
    expect(comparePixelsWithin(a, b, 1, 0).same).toBe(false);
    expect(comparePixelsWithin(a, b, 1, 1).same).toBe(true);
    expect(countDifferingPixels(a, b, 1)).toBe(2);
    expect(countDifferingPixels(a, b, 9)).toBe(0);
  });
  it("calls a failing comparison chaotic when the noise exceeds a quarter of the pixels", () => {
    const a = black(8);
    const b = [...a]; for (let i = 0; i < 8; i++) b[i * 4] = 255;
    expect(judgePixels(a, b, 1)).toMatchObject({ same: false, chaotic: false });
    expect(judgePixels(a, b, 3)).toMatchObject({ same: false, chaotic: true });
    expect(judgePixels(a, b, 4)).toMatchObject({ same: true, chaotic: false });
  });
  it("compares varyings with a relative tolerance and lets NaN match NaN", () => {
    expect(compareVaryings([1, 1000, NaN], [1.000001, 1000.001, NaN], 1e-5).same).toBe(true);
    expect(compareVaryings([1, 1000], [1.001, 1000], 1e-5).same).toBe(false);
    expect(compareVaryings([1], [1, 2], 1e-5).summary).toContain("counts differ");
  });
});

describe("source forms", () => {
  it("tells WebGL2 sources from WebGL1 by the version line", () => {
    expect(glslVersion("#version 300 es\nvoid main(){}")).toBe(2);
    expect(glslVersion("precision highp float;void main(){}")).toBe(1);
    expect(glslVersion("#version 130\nvoid main(){}")).toBe(1);
  });
  it("turns a desktop shader into ES 1.00 with a default precision", () => {
    expect(toEs100("#version 130\nvoid main(){}")).toBe("precision highp float;\nvoid main(){}");
    expect(toEs100("precision mediump float;\nvoid main(){}")).toBe("precision mediump float;\nvoid main(){}");
  });
});
