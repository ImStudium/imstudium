/**
 * The ImStudium agent plugin — one folder, two harnesses.
 *
 *   plugins/imstudium/                 the plugin root (Claude Code and Codex read the same folder)
 *     .claude-plugin/plugin.json       generated — Claude Code manifest
 *     .codex-plugin/plugin.json        generated — Codex manifest
 *     .mcp.json                        generated — the read-only MCP door (both harnesses)
 *     skills/<name>/                   generated — copied from packages/cli/skills (workflows flattened)
 *     commands/ agents/                hand-written — Claude Code slash commands and the studium-tutor subagent
 *     hooks/                           hand-written — SessionStart briefing; Claude Code and Codex both run
 *                                      hooks/hooks.json and expand ${CLAUDE_PLUGIN_ROOT}
 *   .claude-plugin/marketplace.json    generated — `/plugin marketplace add ImStudium/imstudium`
 *   .agents/plugins/marketplace.json   generated — `codex plugin marketplace add ImStudium/imstudium`
 *   .cursor-plugin/plugin.json         generated — Cursor reads the repo root as its plugin
 *
 * Everything generated here is checked by `bun run docs:check`, so a skill edited in
 * packages/cli/skills can't drift from the copy the plugin ships.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeneratedDoc } from "./index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_SRC = join(ROOT, "packages", "cli", "skills");
export const PLUGIN_DIR = "plugins/imstudium";
export const PLUGIN_SKILLS_DIR = `${PLUGIN_DIR}/skills`;

const cli = JSON.parse(readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf-8")) as {
  version: string;
  homepage: string;
  license: string;
};
const REPO = "https://github.com/ImStudium/imstudium";
const AUTHOR = { name: "Patrick Schröppel", url: "https://github.com/ImStudium" };
const DESCRIPTION =
  "Your Stud.IP studies for coding agents: today and this week, deadlines and Klausuren, new files and news, " +
  "cited explanations from your own slides, exam prep and quizzes — read-only by default, local in ~/Studium.";
const KEYWORDS = ["imstudium", "studip", "stud.ip", "studium", "university", "klausur", "exam-prep", "education", "mcp"];

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** One bundled skill: its folder under packages/cli/skills and the name the plugin ships it under. */
interface SkillSource {
  name: string;
  dir: string;
}

function frontmatterName(skillMd: string): string | null {
  const fm = skillMd.match(/^---\n([\s\S]*?)\n---/);
  const name = fm?.[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  return name ? name.replace(/^["']|["']$/g, "") : null;
}

/** Skills in packages/cli/skills, with `workflows/<x>` flattened to their frontmatter name. */
export function listSkillSources(): SkillSource[] {
  const out: SkillSource[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      let md: string;
      try {
        md = readFileSync(join(path, "SKILL.md"), "utf-8");
      } catch {
        visit(path); // a grouping folder such as workflows/
        continue;
      }
      out.push({ name: frontmatterName(md) ?? entry.name, dir: path });
    }
  };
  visit(SKILLS_SRC);
  const names = out.map((s) => s.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) throw new Error(`Two bundled skills share a name: ${dupes.join(", ")}`);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".DS_Store") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out.sort();
}

function skillDocs(): GeneratedDoc[] {
  return listSkillSources().flatMap((skill) =>
    filesUnder(skill.dir).map((file) => ({
      id: "plugin",
      path: `${PLUGIN_SKILLS_DIR}/${skill.name}/${relative(skill.dir, file)}`,
      render: () => readFileSync(file, "utf-8"),
    })),
  );
}

/** Claude Code: commands/, agents/, skills/, hooks/hooks.json and .mcp.json are discovered from the plugin root. */
function claudeManifest() {
  return {
    name: "imstudium",
    version: cli.version,
    description: DESCRIPTION,
    author: AUTHOR,
    homepage: cli.homepage,
    repository: REPO,
    license: cli.license,
    keywords: KEYWORDS,
  };
}

/** Codex: same folder, its own manifest; the `interface` block is what the plugin directory shows. */
function codexManifest() {
  return {
    name: "imstudium",
    version: cli.version,
    description: DESCRIPTION,
    author: AUTHOR,
    homepage: cli.homepage,
    repository: REPO,
    license: cli.license,
    keywords: KEYWORDS,
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: {
      displayName: "ImStudium",
      shortDescription: "Your Stud.IP courses, dates and slides — agent-ready",
      longDescription:
        "ImStudium mirrors your Stud.IP into a local study workspace and gives Codex one read-only door to it: " +
        "what's on today and this week, open Abgaben and Klausuren, new files and announcements, office hours, " +
        "and cited explanations, exam plans and quizzes built from your own lecture material. " +
        "Needs the imstudium CLI (npm i -g @imstudium/sdk) and one `imstudium login`.",
      developerName: "ImStudium",
      category: "Education",
      capabilities: ["Interactive", "Read"],
      websiteURL: cli.homepage,
      defaultPrompt: [
        "What's on today, and what's due this week?",
        "Help me prepare for my next Klausur.",
        "Explain this week's lecture topic from my slides, with citations.",
      ],
      brandColor: "#1F6FEB",
      screenshots: [],
    },
  };
}

/**
 * The read-only MCP door, shared by both harnesses. `imstudium-mcp` comes with
 * `npm i -g @imstudium/sdk`, next to the `imstudium` command. Codex runs
 * shell commands in a sandbox without network; the MCP server runs outside it,
 * so it is how Codex reaches Stud.IP.
 */
function mcpConfig() {
  return { mcpServers: { imstudium: { command: "imstudium-mcp", args: [] } } };
}

function claudeMarketplace() {
  return {
    name: "imstudium",
    owner: AUTHOR,
    metadata: { description: "ImStudium — Stud.IP for coding agents", version: cli.version },
    plugins: [
      {
        name: "imstudium",
        source: `./${PLUGIN_DIR}`,
        description: DESCRIPTION,
        version: cli.version,
        author: AUTHOR,
        homepage: cli.homepage,
        repository: REPO,
        license: cli.license,
        keywords: KEYWORDS,
        category: "education",
      },
    ],
  };
}

function codexMarketplace() {
  return {
    name: "imstudium",
    interface: { displayName: "ImStudium" },
    plugins: [
      {
        name: "imstudium",
        source: { source: "local", path: `./${PLUGIN_DIR}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Education",
      },
    ],
  };
}

/** Cursor treats the repo root as the plugin and points into the shared folder. */
function cursorManifest() {
  return {
    name: "imstudium",
    displayName: "ImStudium",
    description: DESCRIPTION,
    version: cli.version,
    author: AUTHOR,
    repository: REPO,
    homepage: cli.homepage,
    license: cli.license,
    category: "education",
    keywords: KEYWORDS,
    skills: PLUGIN_SKILLS_DIR,
    rules: "rules",
    mcpServers: `${PLUGIN_DIR}/.mcp.json`,
  };
}

export function pluginDocs(): GeneratedDoc[] {
  return [
    { id: "plugin", path: ".cursor-plugin/plugin.json", render: () => json(cursorManifest()) },
    { id: "plugin", path: `${PLUGIN_DIR}/.claude-plugin/plugin.json`, render: () => json(claudeManifest()) },
    { id: "plugin", path: `${PLUGIN_DIR}/.codex-plugin/plugin.json`, render: () => json(codexManifest()) },
    { id: "plugin", path: `${PLUGIN_DIR}/.mcp.json`, render: () => json(mcpConfig()) },
    { id: "plugin", path: ".claude-plugin/marketplace.json", render: () => json(claudeMarketplace()) },
    { id: "plugin", path: ".agents/plugins/marketplace.json", render: () => json(codexMarketplace()) },
    ...skillDocs(),
  ];
}
