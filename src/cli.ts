// Port of ShaderMinifier/main.fs
import * as fs from "node:fs";
import { Minifier } from "./api.js";
import * as Options from "./options.js";

function readFile(file: string): string {
  return file === "" || file === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(file, "utf8");
}

function printError(e: unknown): void {
  if (e instanceof Options.ParseError) console.error(`Parse error: ${e.message}`);
  else if (e instanceof Options.ArgumentError) console.error(e.message);
  else if (e instanceof Error && (e as NodeJS.ErrnoException).code !== undefined) console.error(`Error: ${e.message}`);
  else console.error(e instanceof Error ? e.stack ?? e.message : String(e));
}

export function minifyFiles(options: Options.Options, filenames: readonly string[]): string {
  const files = filenames.map((f): [string, string] => [f === "" || f === "-" ? "stdin" : f, readFile(f)]);
  return new Minifier(options, files).format();
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const { options, filenames } = Options.initFiles(argv);
    if (options.verbose) console.log(Options.helpTextMessage);
    if (options.version) {
      console.log(Options.helpTextMessage);
      return 0;
    }
    const out = minifyFiles(options, filenames);
    if (options.outputName === "" || options.outputName === "-") process.stdout.write(out);
    else fs.writeFileSync(options.outputName, out);
    return 0;
  } catch (e) {
    printError(e);
    return 1;
  }
}
