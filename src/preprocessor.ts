// Port of Minifier/preprocessor.fs
// Only evaluates the directives it can decide statically (#if 0/1, #ifdef of a macro defined in the file).

// The stack contains information for each nested #if/#ifdef block
//   Active: condition was true, lines are printed (e.g. #if 1)
//   Inactive: condition was false, delete the text (e.g. #if 0)
//   Unknown: condition could not be evaluated, keep both the directive and the text
type Status = "Active" | "Inactive" | "Unknown";

class Impl {
  // Dict of macro name to value
  private readonly defines = new Map<string, string>();
  private readonly stack: Status[] = [];

  private currentStatus(): Status {
    return this.stack.length === 0 ? "Active" : this.stack[this.stack.length - 1];
  }

  private enterScope(evaluated: Status): void {
    this.stack.push(this.currentStatus() === "Inactive" ? "Inactive" : evaluated);
  }

  private evalCond(str: string): Status {
    switch (str.trim()) {
      case "0": return "Inactive";
      case "1": return "Active";
      default: return "Unknown";
    }
  }

  // Splits "ident rest" where ident is [A-Za-z0-9_]* (may be empty), like parseIdent + parseEndLine.
  private static splitIdent(s: string): [string, string] {
    const m = /^([A-Za-z0-9_]*)(.*)$/s.exec(s)!;
    return [m[1], m[2]];
  }

  private directive(body: string): string {
    // body is the text after '#' and spaces, without the newline
    const kw = /^([A-Za-z]+)(?![A-Za-z0-9_])/.exec(body);
    const keyword = kw ? kw[1] : "";
    const afterKw = kw ? body.slice(kw[0].length).replace(/^[ \t]*/, "") : "";
    switch (keyword) {
      case "line":
        return "";
      case "extension": {
        const [name, behavior] = Impl.splitIdent(afterKw);
        return name === "GL_GOOGLE_include_directive" ? "" : `#extension ${name}${behavior}`;
      }
      case "define": {
        const [name, line] = Impl.splitIdent(afterKw);
        this.defines.set(name, line);
        return `#define ${name}${line}`;
      }
      case "undef": {
        const [name] = Impl.splitIdent(afterKw);
        this.defines.delete(name);
        return `#undef ${name}`;
      }
      case "elif": {
        const oldStatus = this.stack.pop() ?? "Active";
        const cond = this.evalCond(afterKw);
        let newStatus: Status;
        if (oldStatus === "Unknown" || cond === "Unknown") newStatus = "Unknown";
        else if (cond === "Inactive") newStatus = "Inactive";
        else if (oldStatus === "Active") newStatus = "Inactive";
        else newStatus = "Active";
        this.stack.push(newStatus);
        return newStatus === "Unknown" ? "#elif " + afterKw : "";
      }
      case "else": {
        const st = this.stack.pop() ?? "Active";
        switch (st) {
          case "Active": this.stack.push("Inactive"); return "";
          case "Inactive": this.stack.push("Active"); return "";
          default: this.stack.push("Unknown"); return "#else";
        }
      }
      case "endif": {
        const st = this.stack.pop() ?? "Active";
        return st === "Unknown" ? "#endif" : "";
      }
      case "if": {
        const status = this.evalCond(afterKw);
        this.enterScope(status);
        return status === "Unknown" ? "#if " + afterKw : "";
      }
      case "ifdef": case "ifndef": {
        const [ident] = Impl.splitIdent(afterKw);
        this.enterScope(this.defines.has(ident) === (keyword === "ifdef") ? "Active" : "Inactive");
        return "";
      }
      default:
        // It is valid to have '#' alone on a line. This is a no op.
        if (body === "") return "\n";
        // Unknown directive, keep it.
        return this.currentStatus() === "Inactive" ? "" : "#" + body;
    }
  }

  parse(content: string): string {
    const lines = content.split("\n");
    // A trailing newline produces an empty last element which upstream (parseEndLine) would not emit.
    if (lines.length > 0 && lines[lines.length - 1] === "" && content.endsWith("\n")) lines.pop();
    const out: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.startsWith("#")) {
        out.push(this.directive(line.slice(1).replace(/^[ \t]*/, "")));
      } else {
        out.push(this.currentStatus() === "Inactive" ? "" : line);
      }
    }
    return out.join("\n");
  }
}

export function preprocess(_streamName: string, content: string): string {
  return new Impl().parse(content);
}
