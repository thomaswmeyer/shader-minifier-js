// A `#if` around list items, which a Conditional expression cannot stand for: a group of struct
// members, a group of function parameters, or a whole function header. Such a region is kept as
// text the minifier does not see into, like a kept #define body, with everything it names pinned
// (docs/TODO.md section 1, docs/PORTING.md 5.2 item 31).
import { describe, expect, it } from "vitest";
import { minify } from "../src/api.js";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { playcanvasShaders, pluginOptions, threeShaders, upstreamOptions } from "./corpora.js";

const roundTrips = (src: string): void => {
  const first = Printer.print(runParser(defaultOptions(), "t.frag", src).code);
  const second = Printer.print(runParser(defaultOptions(), "t.frag", first).code);
  expect(second).toBe(first);
};

describe("a conditional around struct members", () => {
  const src = `struct T { float a; };
struct M {
  vec3 color;
  #ifdef USE_EXTRA
    float extra; // set at runtime
    T tail;
  #endif
};
struct N { float extra; float other; };
uniform float u;
void main() {
  M m; m.color = vec3(u);
  #ifdef USE_EXTRA
    m.extra = u; m.tail.a = u;
  #endif
  N n; n.extra = u; n.other = u;
  gl_FragColor = vec4(m.color, n.extra + n.other);
}`;

  it("is kept as text on its own lines, comments and indentation gone", () => {
    const out = minify(src, { removeUnused: "declarations" }).code;
    expect(out).toMatch(/struct \w+\{vec3 \w+;\n#ifdef USE_EXTRA\nfloat extra;T tail;\n#endif\n\};/);
  });

  it("pins the fields it declares, in every struct, and the types it names", () => {
    const shader = runParser(defaultOptions(), "t.frag", src);
    expect(shader.pinnedGlobalNames).toEqual(expect.arrayContaining(["extra", "tail", "T"]));
    expect(shader.pinnedFields).toEqual(expect.arrayContaining(["extra", "tail"]));
    expect(shader.forbiddenNames).toEqual(expect.arrayContaining(["extra", "tail", "T"]));
    const out = minify(src, { removeUnused: "declarations" }).code;
    expect(out).toContain("struct T{float a;};"); // named only in the region, and still declared
    expect(out).toMatch(/\.extra=\w+;\w+\.tail\.a=\w+;/);
    expect(out).toContain("float extra;"); // N's field of the same name keeps it too
    expect(out).not.toContain("color"); // the members outside the region are renamed as usual
    expect(out).not.toContain("other");
  });

  it("round-trips", () => roundTrips(src));
});

describe("a conditional around function parameters", () => {
  const src = `uniform sampler2D map;
uniform vec2 size;
float tap(vec2 uv) { return texture2D(map, uv).x; }
float shadow(
  #if defined( PCF )
    sampler2DShadow shadowMap,
  #else
    sampler2D shadowMap,
  #endif
  vec2 uv
) {
  float shadow = 1.0;
  for (int i = 0; i < 2; i++) shadow *= tap(uv + float(i) / size);
  return shadow;
}
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  float shadow = 0.5;
  gl_FragColor = vec4(shadow, uv, 1.);
}`;

  it("keeps the whole function as text, with its directives on their own lines", () => {
    const out = minify(src, { removeUnused: "declarations" }).code;
    expect(out).toContain("float shadow(\n#if defined(PCF)\nsampler2DShadow shadowMap,\n#else\nsampler2D shadowMap,\n#endif\nvec2 uv){float shadow=1.0;for(int i=0;i<2;i++)shadow*=tap(uv+float(i)/size);return shadow;}");
  });

  it("keeps what the text names: the functions it calls and the globals it reads", () => {
    const out = minify(src, { removeUnused: "declarations" }).code;
    expect(out).toContain("float tap(vec2 ");
    expect(out).toContain("uniform vec2 size;");
    expect(out).toMatch(/uniform sampler2D \w+;/); // read by tap alone, so renamed like any other
  });

  it("does not pin a local of another function that shares a name", () => {
    const shader = runParser(defaultOptions(), "t.frag", src);
    expect(shader.pinnedNames).toEqual([]);
    expect(shader.pinnedGlobalNames).toEqual(expect.arrayContaining(["shadow", "uv", "i", "tap", "size"]));
    const out = minify(src).code;
    // main's `uv` and `shadow` are renamed: they are not what the region refers to.
    expect(out).not.toMatch(/vec2 uv=gl_FragCoord/);
    expect(out).not.toMatch(/float shadow=\.5/);
  });

  it("round-trips", () => roundTrips(src));
});

describe("a conditional whose branches each open a function", () => {
  const src = `uniform float u;
#ifdef USE_B
void scatter( const in float a, const in float b, inout vec3 out1 ) {
#else
void scatter( const in float a, inout vec3 out1 ) {
#endif
  #ifdef USE_B
    float f = a * b;
  #else
    float f = a;
  #endif
  out1 += vec3(f);
}
void main() {
  vec3 c = vec3(0.);
  #ifdef USE_B
    scatter(u, 2., c);
  #else
    scatter(u, c);
  #endif
  gl_FragColor = vec4(c, 1.);
}`;

  it("keeps the region and the body as one text, starting on its own line", () => {
    const out = minify(src, { preserveExternals: true }).code;
    expect(out).toContain("uniform float u;\n#ifdef USE_B\nvoid scatter(const in float a,const in float b,inout vec3 out1){\n#else\nvoid scatter(const in float a,inout vec3 out1){\n#endif\n");
    expect(out).toContain("#endif\nout1+=vec3(f);}");
    expect(out).toMatch(/scatter\(u,2\.,\w+\);/);
  });

  it("leaves an ordinary region alone", () => {
    const balanced = "#ifdef A\nfloat f(float x){return x;}\n#else\nfloat f(float x){return 2.*x;}\n#endif\nvoid main(){gl_FragColor=vec4(f(1.));}";
    const shader = runParser(defaultOptions(), "t.frag", balanced);
    expect(shader.code.map((tl) => tl.kind)).toEqual(["TLDirective", "Function", "TLDirective", "Function", "TLDirective", "Function"]);
  });

  it("round-trips", () => roundTrips(src));
});

// The corpus that motivated this: three.js assembles its programs from chunks that put `#if`
// around arguments, struct members and parameters, and injects the defines at runtime, so the
// plugin has to take them as they come.
// A function-like macro standing for a whole parameter (PlayCanvas: `float f(SHADOWMAP_ACCEPT(shadowMap),
// vec3 c)` with `#define SHADOWMAP_ACCEPT(name) sampler2DShadow name`): the function is kept as text,
// like one with a directive among its parameters, so the file no longer needs --expand-macros.
describe("a macro call among the parameters", () => {
  const src = "#define ACCEPT(n) sampler2D n\nuniform sampler2D tex;uniform vec2 uv;float pick(ACCEPT(t), vec2 p){return texture2D(t,p).x;}void main(){gl_FragColor=vec4(pick(tex,uv));}";
  it("keeps the function as written and its callers calling it", () => {
    const out = minify(src, { noRenaming: true }).code;
    expect(out).toContain("float pick(ACCEPT(t),vec2 p){return texture2D(t,p).x;}");
    expect(out).toContain("pick(tex,uv)");
    const renamed = minify(src, {}).code;
    expect(renamed).toContain("float pick(ACCEPT(t),vec2 p){return texture2D(t,p).x;}");
    expect(renamed).toMatch(/pick\(\w+,\w+\)/);
  });
  it("still parses a parameter list with a call that is not a macro of the file as an error, as before", () => {
    expect(() => minify("float pick(OTHER(t), vec2 p){return p.x;}void main(){gl_FragColor=vec4(pick(1.,vec2(0)));}", {})).toThrow();
  });
  it("takes every PlayCanvas shader without --expand-macros", () => {
    for (const s of playcanvasShaders()) expect(() => minify([{ name: s.name, content: s.source }], { ...upstreamOptions(), expandMacros: false })).not.toThrow();
  });
});

describe("every three.js shader parses without --preprocess", () => {
  const options = { ...pluginOptions(), preprocess: false };
  for (const s of threeShaders()) {
    it(s.name, () => {
      const out = minify([{ name: s.name, content: s.source }], options).code;
      // The output is GLSL the parser accepts, and printing it again changes nothing. Compared
      // with float literals normalised: the printer keeps at most 16 fraction digits, so a folded
      // constant like 1/2^32 comes back as a different, shorter literal on the second pass.
      const floats = (t: string): string => t.replace(/(?<![\w.])\d*\.\d+(?:e-?\d+)?|\d+e-?\d+/g, (m) => String(Number(m).toPrecision(7)));
      const again = Printer.print(runParser(options, s.name, out).code);
      expect(floats(again)).toBe(floats(out));
    });
  }
});
