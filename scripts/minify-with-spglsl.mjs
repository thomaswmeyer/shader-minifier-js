#!/usr/bin/env node
// Minify shaders with spglsl (Google ANGLE compiled to wasm) and print source -> minified
// bytes, for comparison with the port. Needs `npm install --no-save spglsl`.
//   node scripts/minify-with-spglsl.mjs test/tomto/*.vert test/tomto/*.frag
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

let spglsl;
try {
  spglsl = createRequire(import.meta.url)("spglsl");
} catch {
  console.error("spglsl is not installed: npm install --no-save spglsl");
  process.exit(1);
}

let total = 0;
for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, "utf8");
  const r = await spglsl.spglslAngleCompile({
    mainSourceCode: source,
    mainFilePath: file,
    language: /\bgl_Position\b|\bgl_PointSize\b/.test(source) ? "Vertex" : "Fragment",
    compileMode: "Optimize",
    minify: true,
    mangle: true,
  });
  if (!r.valid || typeof r.output !== "string") {
    console.error(`${file}: ${r.infoLog.inspect()}`);
    process.exitCode = 1;
    continue;
  }
  total += r.output.length;
  console.log(`${file} ${source.length} -> ${r.output.length}`);
}
console.log(`total ${total}`);
