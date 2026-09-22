// The scope check that runs after every rewrite pass (docs/PORTING.md 5.2 item 10).
import { describe, expect, it } from "vitest";
import { Analyzer } from "../src/analyzer.js";
import * as Ast from "../src/ast.js";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";

describe("Analyzer.checkScopes", () => {
  const options = defaultOptions();
  const parse = (src: string): Ast.TopLevel[] => {
    const code = runParser(options, "t.frag", src).code;
    new Analyzer().resolve(code);
    return code;
  };

  it("accepts resolved code, shadowing included", () => {
    const code = parse("uniform float a;float f(float a){return a;}void main(){float a=1.;{float a=2.;gl_FragColor=vec4(a);}gl_FragColor+=vec4(f(a));}");
    expect(() => new Analyzer().checkScopes(code)).not.toThrow();
  });

  it("rejects a use whose declaration is not the one its name finds in scope", () => {
    const code = parse("uniform float a;void main(){float a=1.;gl_FragColor=vec4(a);}");
    const tl = code[0];
    if (tl.kind !== "TLDecl") throw new Error("expected a global");
    const globalA = tl.decl[1][0].name;
    // What a rewrite copying `a` from global scope into main would leave behind.
    const capture = (_env: Ast.MapEnv, e: Ast.Expr): Ast.Expr => {
      if (e.kind === "Var" && e.ident.name === "a") e.ident.declaration = globalA.declaration;
      return e;
    };
    Ast.visitor(capture).iterTopLevel(code);
    expect(() => new Analyzer().checkScopes(code)).toThrow(/captured 'a' at 1:58: it referred to the global declared at 1:15 but now names the local declared at 1:35/);
  });

  it("rejects a global read above its own declaration", () => {
    // What a reordering or a declaration squeeze leaves behind: `main` moved above the global it
    // reads. Nothing of that name is in scope at the use, so the capture check cannot see it.
    const code = parse("uniform float a;void main(){gl_FragColor=vec4(a);}");
    expect(() => new Analyzer().checkScopes(code)).not.toThrow();
    const reordered = [code[1], code[0]];
    expect(() => new Analyzer().checkScopes(reordered)).not.toThrow(); // only checked on finished code
    expect(() => new Analyzer().checkScopes(reordered, true)).toThrow(/moved 'a' at 1:47 with no declaration in scope/);
  });
});
