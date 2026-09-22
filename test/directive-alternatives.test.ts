// A block with preprocessor directives may declare one name in alternative branches, or redeclare
// a global's name in one branch. The compiler keeps one declaration; the minifier has to keep them
// all, as one variable (Analyzer.unifyAlternativeDeclarations, docs/PORTING.md 5.2 item 32). Found by
// rendering the three.js corpus without --preprocess: 30 of its 56 shaders failed to compile.
import { describe, expect, it } from "vitest";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";

// A conditional directive inside a declarator list, at top level and in a block: the declaration
// is split at the directives into one declaration per run of names, which says the same thing.
describe("a directive inside a declarator list", () => {
  const o = { removeUnused: "none" as const, noRenaming: true };
  const src = "uniform float a,\n#ifdef X\nb,\n#endif\nc;\nvoid main(){float d=a,\n#ifdef X\ne=b,\n#endif\nf=c;\n#ifdef X\nf+=e;\n#endif\ngl_FragColor=vec4(d+f);}";
  it("splits the declaration at the directives, at top level and in a block, and reads back the same", () => {
    const out = minify(src, { ...o, inlining: "none", inlineSingleUse: false }).code;
    expect(out).toBe("uniform float a;\n#ifdef X\nuniform float b;\n#endif\nuniform float c;void main(){float d=a;\n#ifdef X\nfloat e=b;\n#endif\nfloat f=c;\n#ifdef X\nf+=e;\n#endif\ngl_FragColor=vec4(d+f);}");
    expect(minify(out, { ...o, inlining: "none", inlineSingleUse: false }).code).toBe(out);
  });
  it("lets a declaration in one region be inlined into a use in another region of the same condition", () => {
    // `e` is inlined into its one use, which sits in the other `#ifdef X` region: right under both
    // settings, since `b` exists exactly when `e` did. The emptied region stays, as upstream leaves
    // an empty region too (`tests/unit/symbols.frag`); dropping it would leave a `#define` kept for
    // a condition that is gone, and the output would minify further on a second pass.
    const out = minify(src, o).code;
    expect(out).toBe("uniform float a;\n#ifdef X\nuniform float b;\n#endif\nuniform float c;void main(){\n#ifdef X\n\n#endif\nfloat f=c;\n#ifdef X\nf+=b;\n#endif\ngl_FragColor=vec4(a+f);}");
  });
  it("never generates a name the shader tests as a macro", () => {
    // Under renaming, `X` would be a fine short name for a uniform; then an application that
    // defines X to switch the branch on would erase the uniform's name.
    const shader = runParser(defaultOptions(), "t.frag", "uniform float a;\n#if defined(X) && Y > 0\nuniform float b;\n#elif !Z\nuniform float c;\n#endif\nvoid main(){gl_FragColor=vec4(a);}");
    for (const n of ["X", "Y", "Z"]) expect(shader.forbiddenNames).toContain(n);
    expect(shader.forbiddenNames).not.toContain("defined");
    const renamed = minify("uniform float a;\n#ifdef X\nuniform float b;\n#endif\nvoid main(){\n#ifdef X\ngl_FragColor=vec4(a+b);\n#else\ngl_FragColor=vec4(a);\n#endif\n}", { removeUnused: "none" }).code;
    expect(renamed.match(/\bX\b/g)!.length).toBe(2); // the two #ifdef lines only
  });
});
import { minify } from "../src/api.js";
import { pluginOptions } from "./corpora.js";

const plugin = (src: string): string => minify(src, { ...pluginOptions(), webgl: false }).code;

describe("a name declared in both branches of a #if", () => {
  const src = `uniform float fogNear, fogFar, fogDensity, depth;
void main() {
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * depth * depth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, depth );
  #endif
  gl_FragColor = vec4( fogFactor );
}`;

  it("keeps both declarations, inlines neither, and renames them alike", () => {
    const out = plugin(src);
    expect(out).toMatch(/#ifdef FOG_EXP2\nfloat (\w+)=[^;]*exp\([^;]*\);\n#else\nfloat \1=smoothstep\(fogNear,fogFar,depth\);\n#endif\ngl_FragColor=vec4\(\1\);/);
  });

  it("keeps the pair even when nothing reads it: the price of reading them as one variable", () => {
    const unread = src.replace("vec4( fogFactor )", "vec4( depth )");
    expect(plugin(unread)).toMatch(/#ifdef FOG_EXP2\nfloat (\w+)=[^;]*;\n#else\nfloat \1=[^;]*;\n#endif/);
  });
});

describe("a local declared in one branch over a global of the same name", () => {
  it("keeps the uniform's name on the local, so either declaration serves the uses", () => {
    const src = `uniform float scale;
uniform sampler2D tex;
void main() {
  #ifdef PER_INSTANCE
    float scale = texture2D( tex, vec2( 0.0 ) ).r;
  #endif
  gl_FragColor = vec4( gl_FragCoord.xyz * scale, 1.0 );
}`;
    const out = plugin(src);
    expect(out).toContain("#ifdef PER_INSTANCE\nfloat scale=texture2D(tex,vec2(0)).x;\n#endif\n");
    expect(out).toContain("*scale,1);");
  });

  it("neither removes nor inlines a plain global the branch shadows, and renames both alike", () => {
    const src = `float k = 2.0;
void main() {
  #ifdef A
    float k = 3.0;
  #endif
  gl_FragColor = vec4( k );
}`;
    const out = plugin(src);
    expect(out).toMatch(/float (\w+)=2\.;void main\(\)\{\n#ifdef A\nfloat \1=3\.;\n#endif\ngl_FragColor=vec4\(\1\);\}/);
  });
});

describe("a global declared inside a top-level #if region", () => {
  it("is not substituted for a parameter, since the callee's body is compiled whatever the define", () => {
    // Every call passes the same global, so argument inlining would move `probe` into `sh`'s body,
    // outside the region that declares it. three.js: `lightProbe` into getLightProbeIrradiance.
    const src = `#if defined( USE_PROBES )
uniform vec3 probe[ 3 ];
#endif
vec3 sh( vec3 n, vec3 c[ 3 ] ) { return c[ 0 ] + c[ 1 ] * n.x + c[ 2 ] * n.y; }
void main() {
  vec3 irradiance = vec3( 0.1 );
  #if defined( USE_PROBES )
    irradiance += sh( normalize( gl_FragCoord.xyz ), probe );
  #endif
  gl_FragColor = vec4( irradiance, 1.0 );
}`;
    const out = plugin(src);
    expect(out).toMatch(/vec3 \w+\(vec3 \w+,vec3 \w+\[3\]\)/);
    expect(out).toMatch(/#if defined\(USE_PROBES\)\n\w+\+=\w+\(normalize\(gl_FragCoord\.xyz\),probe\);\n#endif/);
  });
});

describe("a block whose braces are under a #if", () => {
  it("does not reuse an outer name by shadowing, since without the define the block is the outer scope", () => {
    // ed-209: the loops exist only under AA, and `coord` is declared inside them or in main.
    const src = `void main() {
  vec2 f = gl_FragCoord.xy;
  vec3 col = vec3( 0.0 );
  #ifdef AA
    for ( float dx = 0.0; dx <= 1.0; dx++ ) { for ( float dy = 0.0; dy <= 1.0; dy++ ) {
      vec2 coord = f + vec2( dx, dy ) * 0.5;
  #else
      vec2 coord = f;
  #endif
      coord += 0.5;
      col += vec3( coord, 0.0 );
  #ifdef AA
    } }
    col /= 4.0;
  #endif
  gl_FragColor = vec4( col, 1.0 );
}`;
    const out = plugin(src);
    const m = /#else\nvec2 (\w+)=(\w+);\n#endif/.exec(out);
    expect(m).not.toBeNull();
    const [, coord, f] = m!;
    expect(coord).not.toBe(f);
    expect(out).toMatch(new RegExp(`vec3 (?!${coord}\\b)\\w+=vec3\\(0\\);`));
    expect(out).toContain(`{vec2 ${coord}=${f}+vec2(`);
  });
});
