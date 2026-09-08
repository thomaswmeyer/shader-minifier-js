// Pins the float constant-folding rule chosen in PLAN.md section 5.2.
import { describe, expect, it } from "vitest";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { simplify } from "../src/rewriter.js";

function minify(src: string): string {
  const options = { ...defaultOptions(), noRenaming: true, noPiSubstitution: true };
  const shader = runParser(options, "t.frag", src);
  return Printer.print(simplify(options, shader.code));
}

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
