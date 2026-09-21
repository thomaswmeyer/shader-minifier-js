// Float formatting and paren insertion (PORTING.md 5.2, 5.5).
import { describe, expect, it } from "vitest";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";

describe("floatToS", () => {
  const cases: [number, string][] = [
    [0, "0."],
    [1, "1."],
    [0.5, ".5"],
    [3.3, "3.3"],
    [1234.5, "1234.5"],
    [100000, "1e5"],
    [0.0001, "1e-4"],
    [0.000025, "25e-6"],
    [0.000124, "124e-6"],
    [123456, "123456."],
    [1e308, "1e308"],
    [-0.75, "-.75"],
    // Below 5e-17 the fixed form's 16 fraction digits are all zero; upstream prints `0.` there.
    [1e-16, "1e-16"],
    [1.5e-17, "15e-18"],
    [1e-20, "1e-20"],
    [1.24e-27, "124e-29"],
    [1.1754944e-38, "11754944e-45"],
  ];
  for (const [f, s] of cases) it(`${f} -> ${s}`, () => expect(Printer.floatToS(f)).toBe(s));
});

describe("paren insertion", () => {
  const roundTrip = (expr: string): string => {
    const code = runParser(defaultOptions(), "t.frag", `void f(){x=${expr};}`).code;
    return Printer.print(code).replace(/^void f\(\){x=/, "").replace(/;}$/, "");
  };
  const keep = ["a*(b+c)", "a-(b-c)", "a-(b+c)", "a/(b*c)", "(a?b:c)*d", "a*(b?c:d)", "(a+b)*c"];
  const drop: [string, string][] = [
    ["-(-a)", "- -a"],
    ["-(--a)", "- --a"],
    ["+(++a)", "+ ++a"],
    ["a- -b", "a- -b"],
    ["(a*b)+c", "a*b+c"],
    ["(a+b)+c", "a+b+c"],
    ["a+(b*c)", "a+b*c"],
    ["(-a)*b", "-a*b"],
    ["(a)", "a"],
    ["((a+b))*c", "(a+b)*c"],
  ];
  for (const e of keep) it(`keeps ${e}`, () => expect(roundTrip(e)).toBe(e));
  for (const [e, want] of drop) it(`${e} -> ${want}`, () => expect(roundTrip(e)).toBe(want));
});
