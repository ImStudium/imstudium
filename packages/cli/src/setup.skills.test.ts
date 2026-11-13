import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DoctorOutput } from "@imstudium/contract";
import { codexPluginFromToml } from "./agents.js";
import { skillFrontmatterName } from "./setup.js";
import { makeFixture, runCli, type Fixture } from "./test/harness.js";

/** Skill install names and the agent plugin, in a throwaway HOME. */

let fx: Fixture;
let skills: string;
beforeEach(async () => {
  fx = await makeFixture();
  skills = join(fx.home, ".claude", "skills");
  await mkdir(skills, { recursive: true });
});

const skill = (name: string, body = "synthetic") => `---\nname: ${name}\ndescription: test\n---\n\n${body}\n`;

async function claudePlugin(enabled?: boolean): Promise<void> {
  await mkdir(join(fx.home, ".claude", "plugins"), { recursive: true });
  await writeFile(
    join(fx.home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "imstudium@imstudium": [{ scope: "user", installPath: "/synthetic", version: "0.2.0" }] } }),
  );
  if (enabled !== undefined) await writeFile(join(fx.home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "imstudium@imstudium": enabled } }));
}

describe("setup: skill names", () => {
  it("installs workflows under their frontmatter name and removes the folder-name copies 0.2.0 made", async () => {
    // What 0.2.0 left behind, plus a student's own unrelated skill that happens to share a folder name.
    await mkdir(join(skills, "klausur-prep"), { recursive: true });
    await writeFile(join(skills, "klausur-prep", "SKILL.md"), skill("imstudium-klausur-prep", "old copy"));
    await mkdir(join(skills, "semester-refresh"), { recursive: true });
    await writeFile(join(skills, "semester-refresh", "SKILL.md"), skill("my-own-semester-refresh"));

    const r = runCli(fx, ["--json", "setup", "all", "-y", "--agent", "claude-code"]);
    expect(r.status, r.stderr).toBe(0);
    const out = r.json() as { removed: Array<{ path: string }>; plugins: unknown[] };
    for (const name of ["imstudium-klausur-prep", "imstudium-semester-refresh", "imstudium-study-session", "imstudium-agent", "imstudium-cli"]) {
      expect(existsSync(join(skills, name, "SKILL.md")), name).toBe(true);
      expect(skillFrontmatterName(await readFile(join(skills, name, "SKILL.md"), "utf-8"))).toBe(name);
    }
    expect(existsSync(join(skills, "klausur-prep"))).toBe(false);
    expect(out.removed.map((x) => x.path)).toEqual([join(skills, "klausur-prep")]);
    // Not ours: left alone.
    expect(existsSync(join(skills, "semester-refresh", "SKILL.md"))).toBe(true);
    expect(out.plugins).toEqual([]);

    // Nothing is stale afterwards, under the new names.
    const status = runCli(fx, ["--json", "setup", "status"]).json() as { staleSkills: string[] };
    expect(status.staleSkills).toEqual([]);
  });
});

describe("setup and doctor with the imstudium plugin installed", () => {
  it("Claude Code: no standalone copies, nothing reported stale, doctor says the plugin brings the skills", async () => {
    const first = runCli(fx, ["--json", "setup", "all", "-y", "--agent", "claude-code"]);
    expect(first.status, first.stderr).toBe(0);
    expect(existsSync(join(skills, "imstudium-agent"))).toBe(true);

    await claudePlugin();
    const r = runCli(fx, ["--json", "setup", "all", "-y", "--agent", "claude-code"]);
    expect(r.status, r.stderr).toBe(0);
    const out = r.json() as { plugins: Array<{ agent: string; key: string }>; removed: unknown[]; skills: Array<{ path: string }> };
    expect(out.plugins).toEqual([expect.objectContaining({ agent: "claude-code", key: "imstudium@imstudium" })]);
    expect(out.removed.length).toBeGreaterThanOrEqual(8);
    expect(existsSync(join(skills, "imstudium-agent"))).toBe(false);
    expect(existsSync(join(skills, "imstudium-klausur-prep"))).toBe(false);
    expect(out.skills[0]!.path).toMatch(/imstudium@imstudium plugin/);

    const status = runCli(fx, ["--json", "setup", "status"]).json() as { staleSkills: string[]; plugins: unknown[]; upToDate: boolean };
    expect(status.staleSkills).toEqual([]);
    expect(status.upToDate).toBe(true);

    const doctor = DoctorOutput.parse(runCli(fx, ["--json", "doctor", "--offline"]).json());
    expect(doctor.checks.find((c) => c.id === "agents")).toMatchObject({ status: "ok", detail: expect.stringContaining("imstudium plugin in claude-code") });
  });

  it("a plugin switched off in settings.json does not count", async () => {
    await claudePlugin(false);
    runCli(fx, ["--json", "setup", "all", "-y", "--agent", "claude-code"]);
    expect(existsSync(join(skills, "imstudium-agent", "SKILL.md"))).toBe(true);
  });

  it("Codex: [plugins.\"imstudium@…\"] in config.toml", () => {
    expect(codexPluginFromToml('model = "x"\n\n[plugins."imstudium@imstudium"]\nenabled = true\n')).toBe("imstudium@imstudium");
    expect(codexPluginFromToml("[plugins.'imstudium@local']\n")).toBe("imstudium@local");
    expect(codexPluginFromToml('[plugins."imstudium@imstudium"]\nenabled = false\n\n[mcp_servers.x]\n')).toBeNull();
    expect(codexPluginFromToml('[plugins."other@imstudium"]\n[mcp_servers.imstudium]\n')).toBeNull();
  });

  it("Codex end to end: skills skipped for codex when the plugin is in $CODEX_HOME/config.toml", async () => {
    const codex = join(fx.home, ".codex");
    await mkdir(codex, { recursive: true });
    await writeFile(join(codex, "config.toml"), '[plugins."imstudium@imstudium"]\nenabled = true\n');
    const r = runCli(fx, ["--json", "setup", "all", "-y", "--agent", "codex"]);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(codex, "skills", "imstudium-agent"))).toBe(false);
    expect((r.json() as { plugins: Array<{ agent: string }> }).plugins.map((p) => p.agent)).toEqual(["codex"]);
  });
});
