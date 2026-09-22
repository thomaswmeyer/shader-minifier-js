// A shader's own flags: `#pragma shader_minifier <flags>` sets the rewrites for that file, on top
// of the run's flags, and is removed from the output (docs/PORTING.md 5.2 item 35).
import { describe, expect, it } from "vitest";
import { minify } from "../src/api.js";
import { ArgumentError, extractPragmas } from "../src/options.js";
import * as Printer from "../src/printer.js";

const frag = (pragma: string, body = "gl_FragColor=vec4(radians(45.),4.3+3.4,0.,1.);"): string => `${pragma}\nprecision highp float;\nvoid main(){${body}}\n`;

describe("#pragma shader_minifier", () => {
  it("is removed, and each line it stood on stays a line", () => {
    const { source, flags } = extractPragmas("#version 300 es\n  # pragma shader_minifier -O1 --no-inline-single-use\nfloat x;\n#pragma shader_minifier --webgl\n");
    expect(flags).toEqual(["-O1", "--no-inline-single-use", "--webgl"]);
    expect(source).toBe("#version 300 es\n\nfloat x;\n\n");
  });

  it("sets the file's rewrites on top of the run's flags", () => {
    // The run folds approximately; the pragma takes that back for this file, and -O0 in another
    // file brings upstream's decimal arithmetic.
    const run = { approximateFolds: true };
    expect(minify(frag(""), run).code).toContain("vec4(.7853982,4.3+3.4,0,1)");
    expect(minify(frag("#pragma shader_minifier --no-approximate-folds"), run).code).toContain("vec4(radians(45.),4.3+3.4,0,1)");
    expect(minify(frag("#pragma shader_minifier -O0"), run).code).toContain("vec4(radians(45.),7.7,0,1)");
    expect(minify(frag("#pragma shader_minifier -O0"), run).code).not.toContain("pragma");
  });

  it("applies to its own file only in a multi-file run", () => {
    const a = frag("#pragma shader_minifier --no-approximate-folds");
    const b = frag("");
    const { shaders } = minify([{ name: "a.frag", content: a }, { name: "b.frag", content: b }], { approximateFolds: true });
    const [outA, outB] = shaders.map((sh) => Printer.print(sh.code));
    expect(outA).toContain("radians(45.)");
    expect(outB).toContain(".7853982");
  });

  it("keeps line numbers for the errors it reports", () => {
    expect(() => minify("#pragma shader_minifier -O1\nprecision highp float;\nvoid main(){ float x = ; }\n")).toThrow(/Ln: 3/);
  });

  it("may not set what the run decides: output, renaming, cross-file removals", () => {
    expect(() => minify(frag("#pragma shader_minifier --format json"))).toThrow(ArgumentError);
    expect(() => minify(frag("#pragma shader_minifier --format json"))).toThrow(/may only set rewrite flags; 'outputFormat'/);
    expect(() => minify(frag("#pragma shader_minifier --preserve-externals"))).toThrow(/'preserveExternals'/);
    expect(() => minify(frag("#pragma shader_minifier a.frag"))).toThrow(/takes flags only, not 'a.frag'/);
    expect(() => minify(frag("#pragma shader_minifier --bogus"))).toThrow(/Unrecognized argument: '--bogus'/);
    // -O3's cross-file removals are the run's: the pragma means -O2 for this file, without complaint.
    expect(minify(frag("#pragma shader_minifier -O3")).shaders[0]).toBeDefined();
    expect(minify(frag("#pragma shader_minifier -O3")).code).toContain(".7853982");
  });
});
