// Port of Minifier/builtin.fs
// source: https://registry.khronos.org/OpenGL/specs/gl/GLSLangSpec.4.60.pdf

export const keywords: ReadonlySet<string> = new Set([
  "if", "else", "break", "continue", "do", "for", "while", "switch", "case", "default",
  "in", "out", "inout", "discard", "return", "lowp", "mediump", "highp", "precision",
  "struct", "layout", "centroid", "flat", "smooth", "noperspective", "patch", "sample", "invariant",
  "precise", "subroutine", "coherent", "volatile", "restrict", "readonly", "writeonly",
  "const", "uniform", "buffer", "shared", "attribute", "varying",
  "template",
]);

export const builtinScalarTypes: ReadonlySet<string> = new Set(["bool", "int", "uint", "float", "double"]);

export const builtinVectorTypes: ReadonlySet<string> = new Set(
  ["", "d", "b", "i", "u"].flatMap((p) => ["2", "3", "4"].map((n) => `${p}vec${n}`)),
);

export const builtinMatrixTypes: ReadonlySet<string> = new Set(
  ["", "d"].flatMap((p) => [
    ...["2", "3", "4"].map((n) => `${p}mat${n}`),
    ...["2", "3", "4"].flatMap((c) => ["2", "3", "4"].map((r) => `${p}mat${c}x${r}`)),
  ]),
);

export const isSamplerType = (name: string): boolean => name.includes("sampler");

export const builtinTypes: ReadonlySet<string> = new Set([
  "void", ...builtinScalarTypes, ...builtinVectorTypes, ...builtinMatrixTypes,
]);

export const assignOps: ReadonlySet<string> = new Set([
  "=", "+=", "-=", "*=", "/=", "%=",
  "<<=", ">>=", "&=", "^=", "|=",
  "++", "--", "$++", "$--",
]);

export const nonAssignOps: ReadonlySet<string> = new Set([
  "*", "/", "%",
  "+", "-",
  "<<", ">>",
  "<", ">", "<=", ">=",
  "==", "!=",
  "&", "^", "|",
  "&&", "^^", "||",
]);

export const augmentableOperators: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%", "<<", ">>", "&", "^", "|"]);

export const castFunctions: ReadonlySet<string> = new Set([...builtinTypes].filter((t) => t !== "void"));

export const trigonometryFunctions: ReadonlySet<string> = new Set([
  "acos", "acosh", "asin", "asinh", "atan", "atanh", "cos", "cosh", "degrees",
  "radians", "sin", "sinh", "tan", "tanh",
]);

export const mathsFunctions: ReadonlySet<string> = new Set([
  "abs", "ceil", "clamp", "dFdx", "dFdy", "exp", "exp2", "floor", "fma",
  "fract", "fwidth", "inversesqrt", "isinf", "isnan", "log", "log2", "max", "min",
  "mix", "mod", "modf", "noise", "pow", "round", "roundEven", "sign", "smoothstep",
  "sqrt", "step", "trunc",
]);

export const vectorFunctions: ReadonlySet<string> = new Set([
  "cross", "distance", "dot", "equal", "faceforward", "length", "normalize",
  "notEqual", "reflect", "refract",
]);

export const textureFunctions: ReadonlySet<string> = new Set(["texture", "textureLod", "texture2D", "texelFetch", "textureLodOffset"]);

export const pureBuiltinFunctions: ReadonlySet<string> = new Set([
  ...trigonometryFunctions, ...mathsFunctions, ...vectorFunctions, ...castFunctions, ...textureFunctions,
]);

export const impureBuiltinFunctions: ReadonlySet<string> = new Set(["atomicCounterIncrement"]);

export const builtinFunctions: ReadonlySet<string> = new Set([...pureBuiltinFunctions, ...impureBuiltinFunctions]);

// Type qualifiers telling that a global variables is an 'external' name
// (it may be referenced from other files).
export const externalQualifiers: ReadonlySet<string> = new Set(["in", "out", "attribute", "varying", "uniform"]);

export function isFieldSwizzle(s: string): boolean {
  const all = (set: string) => [...s].every((c) => set.includes(c));
  return all("rgba") || all("xyzw") || all("stpq");
}

export function swizzleIndex(c: string): number {
  switch (c) {
    case "r": case "x": case "s": return 0;
    case "g": case "y": case "t": return 1;
    case "b": case "z": case "p": return 2;
    case "a": case "w": case "q": return 3;
    default: throw new Error(`not a swizzle (${c}) `);
  }
}
