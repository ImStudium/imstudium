import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram, HELP_ORDER } from "./program.js";

const SRC = dirname(fileURLToPath(import.meta.url));

function walk(cmd: Command, path: string[] = []): Array<{ path: string[]; cmd: Command }> {
  return cmd.commands.flatMap((c) => [{ path: [...path, c.name()], cmd: c }, ...walk(c, [...path, c.name()])]);
}

/** Help text at a fixed width, so the snapshot does not depend on the terminal. */
function helpOf(cmd: Command): string {
  cmd.configureOutput({ ...cmd.configureOutput(), getOutHelpWidth: () => 100 });
  return cmd.helpInformation();
}

describe("CLI structure", () => {
  it("cli.ts is only the entry point", async () => {
    const lines = (await readFile(join(SRC, "cli.ts"), "utf-8")).trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(10);
  });

  it("every command action goes through act() (one error path), none calls fail() itself", async () => {
    const dir = join(SRC, "commands");
    for (const f of (await readdir(dir)).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const text = await readFile(join(dir, f), "utf-8");
      for (const m of text.matchAll(/\.action\(\s*/g)) {
        expect(text.slice(m.index! + m[0].length, m.index! + m[0].length + 4), `${f}: .action without act()`).toBe("act(");
      }
      expect(text, `${f} calls fail() directly`).not.toMatch(/\bfail\(/);
    }
  });

  it("building the program has no side effects and every top-level command has a help slot", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names.filter((n) => !(HELP_ORDER as readonly string[]).includes(n))).toEqual([]);
    expect(names).toEqual(HELP_ORDER.filter((n) => names.includes(n)));
  });

  it("shared flags are spelled the same everywhere", () => {
    for (const { path, cmd } of walk(buildProgram())) {
      for (const o of cmd.options) {
        if (o.long === "--limit") expect(o.short, `${path.join(" ")} --limit`).toBe("-n");
        if (o.long === "--output") expect(o.short, `${path.join(" ")} --output`).toBe("-o");
        if (o.long === "--course") expect(o.flags, path.join(" ")).toBe("--course <name>");
        if (o.long === "--since") expect(o.flags, path.join(" ")).toBe("--since <when>");
      }
    }
  });

  it("help for every command matches the snapshot (update with vitest -u when intended)", async () => {
    const program = buildProgram();
    const all = [{ path: [] as string[], cmd: program }, ...walk(program)];
    const text = all.map(({ path, cmd }) => `### imstudium ${path.join(" ")}\n${helpOf(cmd)}`).join("\n");
    await expect(text).toMatchFileSnapshot("./__snapshots__/help.txt");
  });
});
