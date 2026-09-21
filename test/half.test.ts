// The fp16 emulation (test/half.ts): its two rounding paths agree with each other and with the
// half floats they claim to produce, and a pixel comparison can see what it does. Skips without a
// browser like the other semantic tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emulateHalf, HALF, halfHelpers } from "./half.js";
import { countDifferingPixels, ShaderRunner, type RenderConfig } from "./pixels.js";

const runner = new ShaderRunner();
let unavailable: string | null = "not opened";
beforeAll(async () => { unavailable = await runner.open(); }, 60000);
afterAll(async () => { await runner.close(); });

/** Round to the nearest half float (ties to even), as IEEE 754 binary16 does; the reference for both GLSL paths. */
export function toHalf(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const a = Math.abs(x);
  if (a >= 65520) return Math.sign(x) * Infinity;
  const e = Math.max(Math.floor(Math.log2(a)), -14);
  const q = 2 ** (e - 10); // the quantum: 10 fraction bits below the leading one, or the subnormal step
  const n = a / q;
  const r = Math.floor(n);
  const frac = n - r;
  const rounded = frac > 0.5 || (frac === 0.5 && r % 2 === 1) ? r + 1 : r;
  return Math.sign(x) * rounded * q;
}

// Values across the fp16 range: normal, near powers of two, ties, subnormal, overflow.
const probes = [1 / 3, 0.1, 2.5, 3.14159265, 1023.9, 1024.1, 2047.5, 2048.5, 65504, 65519, 65520, 70000, 1e-5, 3e-8, 6.103515625e-5, 0.999999, 1.00048828125, 1.00073242, -0.7, -2049];

describe("fp16 rounding", () => {
  it("the reference rounds like binary16", () => {
    expect(toHalf(1 / 3)).toBeCloseTo(0.333251953125, 12);
    expect(toHalf(2049)).toBe(2048); // tie to even
    expect(toHalf(2051)).toBe(2052);
    expect(toHalf(65520)).toBe(Infinity);
    expect(toHalf(3e-8)).toBe(2 ** -24 * 1); // one subnormal step
    expect(toHalf(1e-5)).toBeCloseTo(168 * 2 ** -24, 12);
  });

  for (const version of [1, 2] as const) {
    it(`the ES ${version === 2 ? "3.00" : "1.00"} helper matches the reference on ${probes.length} values`, async (ctx) => {
      if (unavailable !== null) { ctx.skip(); return; }
      // A vertex shader captured through transform feedback, so the exact floats come back. The
      // ES 1.00 helper is arithmetic only, so it compiles under 300 es too.
      const source = `#version 300 es\nprecision highp float;\n${halfHelpers(version)}\nuniform float probes[${probes.length}];\nout float r[${probes.length}];\nout float dummy;\nvoid main(){${probes.map((_, i) => `r[${i}]=${HALF}(probes[${i}]);`).join("")}dummy=${probes.map((_, i) => `r[${i}]`).join("+")};gl_Position=vec4(0);}`;
      // ANGLE captures no array varyings, so each value is read back through its own output instead.
      const flat = source.replace(`out float r[${probes.length}];`, probes.map((_, i) => `out float r${i};`).join("")).replace(/r\[(\d+)\]/g, "r$1");
      const cfg: RenderConfig = { mode: "varyings", version: 2, source: flat, inputs: probes.map((_, i) => ({ name: `r${i}`, type: "float", size: 1, array: false, flat: false })), size: 4, vertices: 1, instances: 1, uniforms: { probes } };
      const res = await runner.run(cfg);
      expect(res.ok, res.ok ? "" : res.error).toBe(true);
      if (!res.ok) return;
      // Interleaved capture: the outputs in order, then dummy and _p (gl_Position).
      const got = res.data.slice(0, probes.length);
      const want = probes.map(toHalf);
      got.forEach((g, i) => {
        if (want[i] === Infinity) expect(g, `probe ${probes[i]}`).toBe(Infinity);
        else if (want[i] === -Infinity) expect(g, `probe ${probes[i]}`).toBe(-Infinity);
        else expect(g, `probe ${probes[i]}`).toBeCloseTo(want[i], 9);
      });
    });
  }
});

describe("the emulated shader", () => {
  const frag = (body: string, version: 1 | 2 = 1): string =>
    version === 2 ? `#version 300 es\nprecision highp float;\nuniform vec2 res;\nout vec4 outColor;\nvoid main(){${body.replace(/gl_FragColor/g, "outColor")}}`
      : `precision highp float;\nuniform vec2 res;\nvoid main(){${body}}`;
  const render = (source: string, version: 1 | 2) => runner.run({ mode: "pixels", version, source, inputs: [], size: 64, vertices: 3, instances: 1, uniforms: { res: [64, 64] } });

  it("wraps intermediates, literals and uniform reads, and leaves constants and lvalues alone", () => {
    const out = emulateHalf("t.frag", "precision highp float;\nuniform float u;\nconst float K = 2.5;\nvarying vec2 uv;\nvoid main(){float x = u * K; x += 1.; gl_FragColor = vec4(x, uv, 1.);}");
    expect(out).toContain(`float x=${HALF}(${HALF}(u)*K);`);
    expect(out).toContain(`x=${HALF}(x+${HALF}(1.));`);
    expect(out).toContain(`gl_FragColor=${HALF}(vec4(x,${HALF}(uv),${HALF}(1.)));`);
    expect(out).toContain("const float K=2.5;");
  });

  for (const version of [1, 2] as const) {
    it(`shows fp16 where it matters and not where it does not (ES ${version === 2 ? "3.00" : "1.00"})`, async (ctx) => {
      if (unavailable !== null) { ctx.skip(); return; }
      // A gradient survives fp16 within a level or two; a high-frequency pattern keyed on the low
      // bits of a coordinate product does not.
      const gentle = frag("gl_FragColor = vec4(gl_FragCoord.xy / res, 0.5, 1.);", version);
      const brittle = frag("float k = fract(dot(gl_FragCoord.xy / res, vec2(37.13, 91.7)) * 100.); gl_FragColor = vec4(k, k, k, 1.);", version);
      for (const [label, source, expectSame] of [["gentle", gentle, true], ["brittle", brittle, false]] as const) {
        const a = await render(source, version);
        const b = await render(emulateHalf("t.frag", source), version);
        expect(a.ok, a.ok ? "" : a.error).toBe(true);
        expect(b.ok, b.ok ? "" : `${b.error}\n${emulateHalf("t.frag", source)}`).toBe(true);
        if (!a.ok || !b.ok) return;
        const bad = countDifferingPixels(a.data, b.data, 2);
        if (expectSame) expect(bad, `${label}: ${bad} pixels moved by more than 2 levels`).toBe(0);
        else expect(bad, `${label}: ${bad} pixels moved by more than 2 levels`).toBeGreaterThan(64 * 64 / 4);
      }
    });
  }
});
