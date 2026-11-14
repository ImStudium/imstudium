import { describe, expect, it } from "vitest";
import { checkArgs, READ_ONLY_PATHS } from "./cli-bridge.js";
import { buildProgram } from "@imstudium/cli/program";

describe("MCP CLI door", () => {
  it("lets read-only commands through", () => {
    expect(checkArgs(["context"])).toBeNull();
    expect(checkArgs(["api", "/users/me/courses", "--flat"])).toBeNull();
    expect(checkArgs(["search", "Erwartungswert", "--archive"])).toBeNull();
    expect(checkArgs(["semester"])).toBeNull();
    expect(checkArgs(["courses", "list"])).toBeNull();
    expect(checkArgs(["files", "tree", "stat"])).toBeNull();
  });

  // PATH P-003: the exact cases.
  it.each([
    [["semester", "--json", "start"]],
    [["files", "--quiet", "download", "x"]],
    [["today", "--instance", "https://a.example"]],
    [["api", "/x", "-XPOST"]],
    [["news", "-dfoo"]],
    [["search", "x", "--output=y"]],
    [["stundenplan", "--ics", "f"]],
  ])("blocks %j", (args) => {
    expect(checkArgs(args)).not.toBeNull();
  });

  it.each([[["today", "--json"]], [["search", "x", "--course", "stat"]]])("allows %j", (args) => {
    expect(checkArgs(args)).toBeNull();
  });

  it("refuses writes, logins and unknown commands", () => {
    expect(checkArgs(["api", "/messages", "-X", "POST", "--write"])).toMatch(/not allowed/);
    expect(checkArgs(["news", "--save"])).toMatch(/not allowed/);
    expect(checkArgs(["login"])).toMatch(/Not available/);
    expect(checkArgs(["logout"])).toMatch(/Not available/);
    expect(checkArgs(["setup", "mcp"])).toMatch(/Not available/);
    expect(checkArgs(["config", "set", "instanceOrigin", "https://a.example"])).toMatch(/Not available/);
    expect(checkArgs(["semester", "start"])).toMatch(/terminal/);
    expect(checkArgs(["sync"])).toMatch(/Not available/);
    expect(checkArgs([])).toMatch(/Not available/);
  });

  it("blocks every attached, = and combined form", () => {
    expect(checkArgs(["--instance=https://a.example", "today"])).toMatch(/--instance/);
    expect(checkArgs(["--quiet", "today", "--instance", "https://a.example"])).toMatch(/--instance/);
    expect(checkArgs(["today", "-o", "out"])).toMatch(/--output/);
    expect(checkArgs(["today", "-oout"])).toMatch(/--output/);
    expect(checkArgs(["api", "/x", "--method=POST"])).toMatch(/--method/);
    expect(checkArgs(["api", "/x", "-d", "{}"])).toMatch(/--data/);
    expect(checkArgs(["courseware", "--force"])).toMatch(/--force/);
    expect(checkArgs(["routes", "--method", "GET"])).toMatch(/--method/);
  });

  it("honours option arity: a value is not a subcommand", () => {
    // "start" right after "semester" is the subcommand; "start" as the value
    // of --semester is a value, not a command.
    expect(checkArgs(["semester", "start", "--semester", "x"])).toMatch(/terminal/);
    expect(checkArgs(["courses", "list", "--semester", "start"])).toBeNull();
  });

  it("refuses bad arguments instead of passing them to the CLI", () => {
    expect(checkArgs(["today", "--no-such-flag"])).toMatch(/Refused/);
  });

  it("lets agents read the citation registry but never change it", () => {
    for (const args of [["arbeit"], ["arbeit", "show"], ["arbeit", "check", "manuskript.md"], ["quellen"], ["quellen", "check"], ["quellen", "find", "Schmidt", "2020"], ["zitieren", "mueller2021@12"], ["literatur", "--format", "md"], ["stile", "show", "apa"]]) {
      expect(checkArgs(args), args.join(" ")).toBeNull();
    }
    for (const args of [["arbeit", "new", "Titel"], ["arbeit", "set", "abgabe=2027-03-15"], ["arbeit", "formvorgaben", "set", "rand.links=3"], ["arbeit", "vorlage"], ["arbeit", "hilfsmittel", "add", "X", "--zweck", "y"], ["quellen", "add", "10.5555/x"], ["quellen", "rm", "k"], ["quellen", "import", "a.bib"], ["stile", "add", "apa"]]) {
      expect(checkArgs(args), args.join(" ")).not.toBeNull();
    }
    expect(checkArgs(["quellen", "check", "--save"])).toMatch(/--save/);
    expect(checkArgs(["literatur", "--save", "x.md"])).toMatch(/--save/);
  });

  it("every allowed path exists in the CLI tree", () => {
    const paths = new Set<string>();
    const walk = (c: ReturnType<typeof buildProgram>, prefix: string[]) => {
      for (const s of c.commands as ReturnType<typeof buildProgram>[]) {
        const p = [...prefix, s.name()];
        paths.add(p.join(" "));
        walk(s, p);
      }
    };
    walk(buildProgram(), []);
    for (const p of READ_ONLY_PATHS) expect(paths.has(p), p).toBe(true);
  });
});
