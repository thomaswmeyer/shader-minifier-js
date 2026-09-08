// npm run golden [-- --update-golden] [filter]
import { loadCommands, runCommand } from "./golden.js";

const update = process.argv.includes("--update-golden");
const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
let failures = 0;
let total = 0;
for (const argv of loadCommands()) {
  const name = argv[argv.indexOf("-o") + 1];
  if (filter && !name.includes(filter)) continue;
  total++;
  try {
    const r = runCommand(argv, update);
    if (r.ok) console.log(`Success: ${name}`);
    else {
      failures++;
      console.log(`Fail: ${argv.join(" ")}`);
      if (filter) {
        console.log(`--- got (${r.got.length})\n${r.got}\n--- expected (${r.expected.length})\n${r.expected}`);
      }
    }
  } catch (e) {
    failures++;
    console.log(`Error: ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
}
console.log(failures === 0 ? `All good (${total}).` : `${failures}/${total} failures.`);
process.exitCode = failures === 0 ? 0 : 1;
