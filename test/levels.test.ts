// -O0 to -O3: one flag for a coherent group of the port's additions (PORTING.md 5.2 item 34).
import { describe, expect, it } from "vitest";
import { Minifier } from "../src/api.js";
import { defaultOptions, flagsHelp } from "../src/options.js";
import { toMinifierOptions } from "../src/vite.js";

const parse = (...argv: string[]) => Minifier.parseOptions(argv);

describe("optimisation levels", () => {
  it("-O0 is upstream's rewrites only: the defaults with decimal folding", () => {
    expect(parse("-O0")).toEqual({ ...defaultOptions(), decimalFolds: true });
  });
  it("-O2 with the target flags is exactly what the Vite plugin does", () => {
    expect(parse("-O2", "--webgl", "--preserve-externals", "--no-overloading", "--format", "text")).toEqual(toMinifierOptions());
  });
  it("each level adds to the one below", () => {
    const o1 = parse("-O1"), o2 = parse("-O2"), o3 = parse("-O3");
    expect(o1).toEqual({ ...defaultOptions(), noPiSubstitution: true, dropDefaultPrecision: true, inlineSingleUse: true, removeUnused: "declarations" });
    expect(o2).toEqual({ ...o1, expandMacros: true, approximateFolds: true });
    expect(o3).toEqual({ ...o2, removeUnusedVaryings: true, removeUnusedUniforms: true });
  });
  it("applies in order: a later flag overrides the level, a later level resets its group", () => {
    expect(parse("-O2", "--no-approximate-folds").approximateFolds).toBe(false);
    expect(parse("-O2", "--no-approximate-folds").expandMacros).toBe(true);
    expect(parse("--approximate-folds", "-O0").approximateFolds).toBe(false);
    expect(parse("-O1", "--pi-substitution").noPiSubstitution).toBe(false);
    expect(parse("-O3", "--no-remove-unused-uniforms").removeUnusedVaryings).toBe(true);
    expect(parse("-O3", "--no-remove-unused-uniforms").removeUnusedUniforms).toBe(false);
  });
  it("leaves the target flags and upstream's switches alone", () => {
    const o = parse("--webgl", "--preserve-externals", "--aggressive-inlining", "-O0");
    expect(o.webgl).toBe(true);
    expect(o.preserveExternals).toBe(true);
    expect(o.inlining).toBe("aggressive");
  });
  it("is in the help text", () => {
    expect(flagsHelp()).toContain("-O0 | -O1 | -O2 | -O3");
    expect(() => parse("-O4")).toThrow(/Unrecognized argument: '-O4'/);
  });
});
