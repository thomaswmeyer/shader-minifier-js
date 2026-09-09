// The renamer's ordering primitives (PORTING.md 5.3, 5.4, 5.6).
import { describe, expect, it } from "vitest";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { internals, rename } from "../src/renamer.js";

const { computeListOfNames, computeContextTable, chooseIdent, pairKey } = internals;

const letters = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_"];

describe("computeListOfNames", () => {
  it("puts the most frequent letters first, then all 2-letter names in a..z A..Z _ order", () => {
    const names = computeListOfNames("bbb aa c");
    expect(names.slice(0, 3)).toEqual(["b", "a", "c"]);
    expect(names.length).toBe(53 + 53 * 53);
    expect(names.slice(53, 53 + 4)).toEqual(["aa", "ab", "ac", "ad"]);
    expect(names[53 + 53 * 53 - 1]).toBe("__");
  });

  it("orders equal-count letters in reverse alphabetical order (stable sort then List.rev)", () => {
    // No letters at all: every count is 0, so the single-letter names come out as _ Z..A z..a.
    const names = computeListOfNames("0123 +-*/");
    expect(names.slice(0, 53)).toEqual([...letters].reverse());
  });

  it("breaks ties among used letters the same way", () => {
    // 'z' and 'a' both appear once; 'm' twice.
    const names = computeListOfNames("a z m m");
    expect(names.slice(0, 3)).toEqual(["m", "z", "a"]);
    expect(names[3]).toBe("_");
  });
});

describe("computeContextTable / chooseIdent", () => {
  it("counts adjacent pairs", () => {
    const table = computeContextTable("abab");
    expect(table.get(pairKey(97, 98))).toBe(2);
    expect(table.get(pairKey(98, 97))).toBe(1);
    expect(table.get(pairKey(98, 98))).toBeUndefined();
  });

  it("prefers the candidate whose letters are most often adjacent to the ident's neighbours", () => {
    // The unique id 1001 is always preceded by ' ' and followed by '('; "x(" appears often.
    const id = String.fromCharCode(1001);
    const table = computeContextTable(`x(x(x( ${id}( ${id}( yy`);
    const candidates = [...letters];
    expect(chooseIdent(table, 1001, candidates)).toBe("x");
  });

  it("breaks score ties by ordinal string order and penalises 2-letter names", () => {
    const table = computeContextTable("nothing relevant");
    const candidates = ["zz", "b", "B", "a", ...letters.slice(4)];
    expect(chooseIdent(table, 1001, candidates)).toBe("B");
  });

  it("updates the context table with the chosen name (side effect)", () => {
    const id = String.fromCharCode(1001);
    const table = computeContextTable(` ${id}(`);
    const chosen = chooseIdent(table, 1001, [...letters]);
    expect(table.get(pairKey(32, chosen.charCodeAt(0)))).toBe(1);
    expect(table.get(pairKey(chosen.charCodeAt(0), 40))).toBe(1);
  });

  it("throws like upstream's Seq.take 26 when fewer than 26 candidates remain", () => {
    const table = computeContextTable("abc");
    expect(() => chooseIdent(table, 1001, letters.slice(0, 25))).toThrow(/26/);
    expect(() => chooseIdent(table, 1001, letters.slice(0, 26))).not.toThrow();
  });
});

function minify(src: string, opts: Partial<ReturnType<typeof defaultOptions>> = {}) {
  const options = { ...defaultOptions(), noRemoveUnused: true, ...opts };
  const shader = runParser(options, "test.frag", src);
  const exportedNames = rename(options, [shader]);
  return { shader, exportedNames, text: Printer.print(shader.code) };
}

describe("rename", () => {
  it("renames locals and keeps main and builtins", () => {
    const { text } = minify("float foo(float bar){return bar*2.;}void main(){gl_FragColor=vec4(foo(1.));}");
    expect(text).toMatch(/^float ([a-zA-Z_])\(float ([a-zA-Z_])\)\{return \2\*2\.;\}void main\(\)\{gl_FragColor=vec4\(\1\(1\.\)\);\}$/);
  });

  it("renames every unique id back to a real name", () => {
    const { shader } = minify("uniform float u; float f(float a, float b){float c=a+b;return c;} void main(){gl_FragColor=vec4(f(u,1.));}");
    const text = Printer.print(shader.code);
    expect(text).not.toMatch(/[Ϩ- ]/);
    expect(text).toContain("main");
  });

  it("exports externals with their new names (only in the second pass)", () => {
    const { exportedNames } = minify("uniform float time; uniform vec2 resolution; void main(){gl_FragColor=vec4(time,resolution,1.);}");
    const byName = new Map(exportedNames.map((e) => [e.name, e]));
    expect([...byName.keys()].sort()).toEqual(["resolution", "time"]);
    for (const e of exportedNames) {
      expect(e.prefix).toBe("Variable");
      expect(e.newName).toMatch(/^[a-zA-Z_]{1,2}$/);
    }
  });

  it("does not rename externals with --preserve-externals, and exports nothing", () => {
    const { text, exportedNames } = minify("uniform float time; void main(){gl_FragColor=vec4(time);}", { preserveExternals: true });
    expect(text).toContain("uniform float time;");
    expect(exportedNames).toEqual([]);
  });

  it("honours --no-renaming-list", () => {
    const { text } = minify("float keep(float x){return x;} void main(){gl_FragColor=vec4(keep(1.));}", { noRenamingList: ["main", "keep"] });
    expect(text).toMatch(/^float keep\(float [a-zA-Z_]\)/);
  });

  it("does not use forbidden names (macros, if/in/do)", () => {
    const src = "#define ab 1\n" + letters.map((l, i) => `float v${i}=${i}.;`).join("") + "void main(){gl_FragColor=vec4(v0);}";
    const { text, shader } = minify(src, { noRenamingList: ["main"] });
    expect(shader.forbiddenNames).toContain("ab");
    const names = [...text.matchAll(/float ([a-zA-Z_]{1,2})=/g)].map((m) => m[1]);
    expect(names).not.toContain("ab");
    expect(names).not.toContain("in");
    expect(names).not.toContain("if");
    expect(names).not.toContain("do");
  });

  it("introduces overloads for functions with different signatures unless --no-overloading", () => {
    const src = "float f(float x){return x;} float g(vec2 v){return v.x;} void main(){gl_FragColor=vec4(f(1.)+g(vec2(1.)));}";
    const overloaded = minify(src).text;
    const m = /^float ([a-zA-Z_]+)\(float [a-zA-Z_]+\)\{return [a-zA-Z_]+;\}float ([a-zA-Z_]+)\(vec2/.exec(overloaded)!;
    expect(m[1]).toBe(m[2]);
    const separate = minify(src, { noOverloading: true }).text;
    const m2 = /^float ([a-zA-Z_]+)\(float [a-zA-Z_]+\)\{return [a-zA-Z_]+;\}float ([a-zA-Z_]+)\(vec2/.exec(separate)!;
    expect(m2[1]).not.toBe(m2[2]);
  });

  it("reuses names via shadowing when the outer name is unused in the scope", () => {
    const { text } = minify("float g1=1.,g2=2.;float f(){float a=3.;return a;}void main(){gl_FragColor=vec4(g1+g2+f());}");
    // f's local variable can reuse one of the global names since f does not reference them.
    const m = /^float ([a-zA-Z_]+)=1\.,([a-zA-Z_]+)=2\.;float ([a-zA-Z_]+)\(\)\{float ([a-zA-Z_]+)=3\.;/.exec(text)!;
    expect([m[1], m[2]]).toContain(m[4]);
  });

  it("renames struct fields consistently across structs and leaves swizzles alone", () => {
    const { text } = minify("struct S{float foo;vec3 pos;};struct T{float foo;};void main(){S s;T t;s.foo=1.;t.foo=s.pos.xyz.x;gl_FragColor=vec4(s.foo+t.foo);}");
    const m = /^struct ([a-zA-Z_]+)\{float ([a-zA-Z_]+);vec3 ([a-zA-Z_]+);\};struct ([a-zA-Z_]+)\{float ([a-zA-Z_]+);\};/.exec(text)!;
    expect(m[2]).toBe(m[5]);
    expect(text).toContain(".xyz.x");
  });

  it("renames consistently across files in multi-file mode", () => {
    const options = { ...defaultOptions(), noRemoveUnused: true };
    const a = runParser(options, "a.vert", "uniform float time; out vec3 col; void main(){col=vec3(time);}");
    const b = runParser(options, "b.frag", "uniform float time; in vec3 col; out vec4 o; void main(){o=vec4(col,time);}");
    const exportedNames = rename(options, [a, b]);
    const ta = Printer.print(a.code);
    const tb = Printer.print(b.code);
    const time = exportedNames.find((e) => e.name === "time")!.newName;
    const col = exportedNames.find((e) => e.name === "col")!.newName;
    expect(ta).toContain(`uniform float ${time};`);
    expect(tb).toContain(`uniform float ${time};`);
    expect(ta).toContain(`out vec3 ${col};`);
    expect(tb).toContain(`in vec3 ${col};`);
    // Each external is exported once, when first seen.
    expect(exportedNames.filter((e) => e.name === "time").length).toBe(1);
  });
});

describe("exported name sorting (F# Seq.sort on the record: prefix, name, newName)", () => {
  it("sorts by prefix then ordinal name in the formatter", async () => {
    const Formatter = await import("../src/formatter.js");
    const options = { ...defaultOptions(), outputFormat: "js" as const };
    const shader = runParser(options, "x.frag", "void main(){}");
    const out = Formatter.print(options, [shader], [
      { prefix: "HlslFunction", name: "a", newName: "x" },
      { prefix: "Variable", name: "b", newName: "y" },
      { prefix: "Variable", name: "B", newName: "z" },
      { prefix: "Variable", name: "a", newName: "w" },
    ]);
    const lines = out.split("\n").filter((l) => /^var (var|F)_/.test(l));
    expect(lines).toEqual(['var var_B = "z"', 'var var_A = "w"', 'var var_B = "y"', 'var F_A = "x"']);
  });
});
