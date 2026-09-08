import { describe, expect, it } from "vitest";
import { loadCommands, runCommand } from "./golden.js";

describe("golden (tests/commands.txt)", () => {
  for (const argv of loadCommands()) {
    const name = argv[argv.indexOf("-o") + 1];
    it(name, () => {
      const r = runCommand(argv);
      expect(r.got).toBe(r.expected);
    });
  }
});
