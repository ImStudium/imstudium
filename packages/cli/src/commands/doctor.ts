import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import type { Command } from "commander";
import {
  detectTools,
  findCurrentSemester,
  mathRuntimeStatus,
  ocrRuntimeStatus,
  probeOAuthServer,
  readRouteCatalog,
  SDK_VERSION,
  semesterSlug,
  toImstudiumError,
  toolHints,
  type StudiumWorkspace,
} from "@imstudium/sdk";
import type { DoctorCheck, DoctorOutput, DoctorStatus } from "@imstudium/contract";
import { checkForUpdates, getCliVersion } from "../version.js";
import { getSetupStatus, type SetupStatusReport } from "../setup.js";
import { act, getSdk, output, type Sdk } from "../runtime.js";
import { CLI_ENTRY } from "../entry.js";
import { enrolledIn } from "./semester.js";
import { outputOption, workspaceDir } from "../kit/args.js";
import { berlinDateTime, cell } from "../kit/format.js";

/**
 * `imstudium doctor`: one registry of checks, each `{id, status, detail,
 * fix}`. Checks run in parallel; network checks share a 3 s budget and are
 * skipped with --offline (then nothing leaves the machine). Exit 1 when a
 * check fails.
 */

const NETWORK_BUDGET_MS = 3_000;
const MIN_NODE_MAJOR = 20;
const require = createRequire(import.meta.url);

interface DoctorContext {
  sdk: Sdk;
  offline: boolean;
  workspace: string;
  ws: StudiumWorkspace | null;
  setup: Promise<SetupStatusReport>;
}

type Result = Omit<DoctorCheck, "id" | "title">;

interface CheckDef {
  id: string;
  title: string;
  network?: boolean;
  run: (ctx: DoctorContext) => Promise<Result>;
}

const ok = (detail: string, data?: Record<string, unknown>): Result => ({ status: "ok", detail, fix: null, ...(data ? { data } : {}) });
const warn = (detail: string, fix: string | null, data?: Record<string, unknown>): Result => ({ status: "warn", detail, fix, ...(data ? { data } : {}) });
const failed = (detail: string, fix: string | null, data?: Record<string, unknown>): Result => ({ status: "fail", detail, fix, ...(data ? { data } : {}) });
const skip = (detail: string): Result => ({ status: "skip", detail, fix: null });

function packageVersion(name: string): string | null {
  try {
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return null;
  }
}

function bunVersion(): string | null {
  try {
    const r = spawnSync("bun", ["--version"], { encoding: "utf8", timeout: 1_500 });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

const minor = (v: string) => v.split(".").slice(0, 2).join(".");
const ageHours = (iso: string | number) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

function withBudget<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer within ${ms / 1000} s`)), ms).unref?.()),
  ]);
}

/** The `imstudium` MCP server entries the agents have, from their config files. */
async function mcpEntries(setup: SetupStatusReport): Promise<Array<{ agent: string; file: string; command: string | null }>> {
  const out: Array<{ agent: string; file: string; command: string | null }> = [];
  for (const agent of setup.detected) {
    for (const file of agent.mcpFiles) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      const servers = (raw.mcpServers ?? raw.mcp ?? (raw.mcp_servers as unknown)) as Record<string, { command?: unknown }> | undefined;
      const entry = servers?.imstudium;
      if (!entry) continue;
      const cmd = Array.isArray(entry.command) ? entry.command[0] : entry.command;
      out.push({ agent: agent.id, file, command: typeof cmd === "string" ? cmd : null });
    }
  }
  return out;
}

export const DOCTOR_CHECKS: CheckDef[] = [
  {
    id: "runtime.node",
    title: "Node.js",
    run: async () => {
      const major = Number(process.versions.node.split(".")[0]);
      return major >= MIN_NODE_MAJOR
        ? ok(`Node ${process.versions.node}`)
        : failed(`Node ${process.versions.node} is too old (need ≥ ${MIN_NODE_MAJOR})`, "Install Node 22 LTS or newer: https://nodejs.org");
    },
  },
  {
    id: "versions",
    title: "Versions",
    run: async () => {
      const cli = getCliVersion();
      const versions = { cli, sdk: SDK_VERSION, contract: packageVersion("@imstudium/contract"), mcp: packageVersion("@imstudium/mcp") };
      const drift = Object.entries(versions).filter(([, v]) => v && minor(v) !== minor(cli));
      const detail = Object.entries(versions)
        .map(([k, v]) => `${k} ${v ?? "—"}`)
        .join(" · ");
      return drift.length
        ? warn(`${detail} — ${drift.map(([k]) => k).join(", ")} differ from the CLI`, "npm i -g @imstudium/cli@latest @imstudium/mcp@latest", versions)
        : ok(detail, versions);
    },
  },
  {
    id: "update",
    title: "Update",
    network: true,
    run: async () => {
      const u = await checkForUpdates(CLI_ENTRY, NETWORK_BUDGET_MS);
      if (!u.latest) return warn(`could not reach the npm registry (${u.installMode} install)`, null, { installMode: u.installMode });
      return u.updateAvailable
        ? warn(`${u.current} → ${u.latest} available (${u.installMode} install)`, "imstudium update", { installMode: u.installMode, latest: u.latest })
        : ok(`${u.current} is the latest (${u.installMode} install)`, { installMode: u.installMode, latest: u.latest });
    },
  },
  {
    id: "config",
    title: "Instance",
    run: async ({ sdk }) => {
      const { instanceOrigin, baseUrl } = sdk.config;
      let originOk = true;
      try {
        new URL(instanceOrigin);
      } catch {
        originOk = false;
      }
      if (!originOk) return failed(`instance origin "${instanceOrigin}" is not a URL`, "imstudium config set base-url https://<host>/jsonapi.php/v1");
      if (!baseUrl.startsWith(instanceOrigin)) {
        return warn(`base URL ${baseUrl} is not on ${instanceOrigin}`, "imstudium config set base-url <origin>/jsonapi.php/v1", { instanceOrigin, baseUrl });
      }
      return ok(instanceOrigin, { instanceOrigin, baseUrl });
    },
  },
  {
    id: "session.store",
    title: "Session",
    run: async ({ sdk }) => {
      // Loading first: it moves a session out of the plain file when a keychain can take it.
      const session = await sdk.auth.loadSession();
      const store = await sdk.auth.sessionStore();
      if (!session || store === "none") return failed("not signed in", "imstudium login", { store: "none" });
      const tier = store === "file" ? "a plain 0600 file (weakest tier)" : store === "keychain" ? "the system keychain" : "ImSicheren";
      const expired = session.expiresAt && Date.parse(session.expiresAt) < Date.now() && !session.refreshToken;
      if (expired) return warn(`${session.type} session in ${tier} expired ${berlinDateTime(session.expiresAt)}`, "imstudium login", { store, type: session.type });
      if (store !== "file") return ok(`${session.type} session in ${tier}`, { store, type: session.type });
      if (process.env.IMSTUDIUM_SESSION_STORE === "file") return warn(`${session.type} session stored in ${tier} (IMSTUDIUM_SESSION_STORE=file)`, null, { store, type: session.type });
      return (await sdk.auth.keychainAvailable())
        ? warn(
            `${session.type} session stored in ${tier}: the system keychain refused it`,
            "Unlock the keychain (Linux: start a Secret Service such as gnome-keyring), then run any imstudium command to move it there",
            { store, type: session.type, keychain: "refused" },
          )
        : warn(
            `${session.type} session stored in ${tier}: the keychain module (keytar) does not load`,
            "npm i -g @imstudium/cli rebuilds it, or install ImSicheren; the session moves out of the file on the next command",
            { store, type: session.type, keychain: "missing" },
          );
    },
  },
  {
    id: "session.valid",
    title: "Stud.IP sign-in",
    network: true,
    run: async ({ sdk }) => {
      if (!(await sdk.auth.loadSession())) return skip("no session to check");
      try {
        const me = await sdk.courses.getMe();
        return ok(`Stud.IP accepts the session (user ${me.id.slice(0, 8)}…)`);
      } catch (err) {
        const e = toImstudiumError(err);
        if (e.code === "AUTH_REQUIRED") return failed("Stud.IP rejected the stored session", "imstudium login");
        if (e.code === "NETWORK") return warn(`Stud.IP not reachable: ${e.message}`, null);
        return warn(`${e.code}: ${e.message}`, e.hint ?? null);
      }
    },
  },
  {
    id: "oauth",
    title: "OAuth",
    network: true,
    run: async ({ sdk }) => {
      const probe = await probeOAuthServer(sdk.config.instanceOrigin, sdk.config.oauth?.clientId);
      if (probe.status === "ready") {
        return sdk.config.oauth?.clientId ? ok("ready, client configured") : ok("available (optional: register a client, docs/OAUTH.md)");
      }
      if (probe.status === "no_client") return warn("Stud.IP rejected the configured client id", "Check oauth.clientId (docs/OAUTH.md)");
      return ok(`${probe.status} — browser sign-in is used`);
    },
  },
  {
    id: "routes",
    title: "Route catalog",
    run: async ({ sdk }) => {
      const catalog = await readRouteCatalog().catch(() => null);
      if (!catalog) return warn("no cached /discovery catalog yet", "imstudium routes --refresh");
      const age = ageHours(catalog.fetchedAt);
      const detail = `${catalog.routes.length} routes${catalog.studipVersion ? ` · Stud.IP ${catalog.studipVersion}` : ""} · fetched ${berlinDateTime(catalog.fetchedAt)}`;
      if (catalog.origin && catalog.origin.replace(/\/$/, "") !== sdk.config.instanceOrigin.replace(/\/$/, "")) {
        return warn(`${detail} — for ${catalog.origin}, not ${sdk.config.instanceOrigin}`, "imstudium routes --refresh");
      }
      return age > 30 * 24 ? warn(`${detail} (older than 30 days)`, "imstudium routes --refresh") : ok(detail, { routes: catalog.routes.length });
    },
  },
  {
    id: "workspace",
    title: "Workspace",
    run: async ({ workspace, ws }) => {
      if (!existsSync(workspace)) return failed(`${workspace} does not exist`, "imstudium semester start", { path: workspace });
      if (!ws) return failed(`no studium.json in ${workspace}`, "imstudium semester start", { path: workspace });
      const synced = await stat(join(workspace, "studium.json")).then((s) => s.mtime.toISOString()).catch(() => ws.generatedAt);
      const detail = `${workspace} · ${ws.courses.length} courses · synced ${berlinDateTime(synced)}`;
      const data = { path: workspace, courses: ws.courses.length, lastSync: synced, schemaVersion: ws.schemaVersion };
      if (ws.schemaVersion !== "2") return warn(`${detail} · studium.json v${ws.schemaVersion}`, "imstudium sync", data);
      return ageHours(synced) > 48 ? warn(`${detail} (more than 2 days ago)`, "imstudium sync --extract", data) : ok(detail, data);
    },
  },
  {
    id: "semester",
    title: "Semester",
    run: async ({ sdk, ws, offline }) => {
      if (!ws) return skip("no workspace");
      const local = ws.activeSemester;
      const end = local.end ? Date.parse(local.end) : NaN;
      const ended = Number.isFinite(end) && end < Date.now();
      const data = { workspace: local.slug };
      // Without Stud.IP we can't tell whether you have courses in the next semester yet: semester (status) asks.
      const endedHere = () => warn(`workspace is on ${local.title}, which ended ${berlinDateTime(end)}`, "imstudium semester", data);
      if (offline) return ended ? endedHere() : ok(`workspace on ${local.title} (Stud.IP not asked: --offline)`, data);
      let cur: ReturnType<typeof findCurrentSemester>;
      try {
        cur = findCurrentSemester(await withBudget(sdk.courses.semesters.listAll(), NETWORK_BUDGET_MS, "semesters"));
      } catch {
        return ended ? endedHere() : ok(`workspace on ${local.title} (Stud.IP not reachable)`, data);
      }
      const slug = cur ? semesterSlug(String(cur.attributes?.title)) : null;
      if (!cur || !slug || slug === local.slug) return ended ? endedHere() : ok(`${local.title} — matches Stud.IP`, { ...data, studip: slug });
      const title = String(cur.attributes?.title);
      // Same rule as semester status: roll over once you have courses in the new semester, not before.
      const enrolled = await withBudget(enrolledIn(sdk, cur.id), NETWORK_BUDGET_MS, "courses").catch(() => null);
      if (enrolled === 0) {
        return ok(`${local.title}: no courses in ${title} on Stud.IP yet, so the workspace stays (semester start once you enrol)`, { ...data, studip: slug, enrolled });
      }
      const count = enrolled === null ? "" : ` (${enrolled} course${enrolled === 1 ? "" : "s"} there)`;
      return warn(`workspace on ${local.title}, Stud.IP is in ${title}${count}`, "imstudium semester start", { ...data, studip: slug, enrolled });
    },
  },
  {
    id: "search",
    title: "Search index",
    run: async ({ ws }) => {
      if (!ws) return skip("no workspace");
      const chunks = ws.search?.chunkCount ?? 0;
      return chunks
        ? ok(`${chunks} chunks in ${ws.search?.courseCount ?? "?"} courses`)
        : warn("nothing extracted yet — search and agents only see file names", "imstudium sync --extract");
    },
  },
  {
    id: "ingest",
    title: "Ingest engines",
    run: async () => {
      const tools = await detectTools();
      const detail = `pdf-inspector ${tools.pdfInspector ? "ok" : "missing"} · anydoc ${tools.anydoc ? "ok" : "missing"}`;
      return tools.pdfInspector && tools.anydoc ? ok(detail, { ...tools }) : warn(detail, toolHints(tools)[0] ?? "npm i -g @imstudium/cli@latest", { ...tools });
    },
  },
  {
    id: "ocr",
    title: "On-device OCR",
    run: async () => {
      const s = ocrRuntimeStatus();
      const m = mathRuntimeStatus();
      const data = { platform: s.platform, ready: s.ready, disabled: s.disabled, dir: s.dir, installed: s.installed, math: { ready: m.ready, disabled: m.disabled, reason: m.reason } };
      if (!s.supported) return skip(`no pinned runtime for ${s.platform}; image-only pages stay marked, native text is unaffected`);
      if (s.ready && s.disabled) return skip("installed, switched off by IMSTUDIUM_OCR=off");
      const math = m.ready ? (m.disabled ? " · math off (IMSTUDIUM_MATH=off)" : " · math: formulas as LaTeX") : " · math not installed (optional: imstudium setup ocr --math)";
      if (s.ready) return ok(`${s.model} · PDFium ${s.installed?.pdfium} · ONNX Runtime ${s.installed?.onnxruntime} (offline, on this machine)${math}`, data);
      return warn(`${s.reason ?? "not ready"}: scanned pages and photos stay unread`, s.reason?.startsWith("runs under Node") ? "Run imstudium with Node: npm i -g @imstudium/cli" : "imstudium setup ocr", data);
    },
  },
  {
    id: "agents",
    title: "Agent setup",
    run: async ({ setup }) => {
      const s = await setup;
      const detected = s.detected.map((a) => a.id);
      const viaPlugin = s.detected.filter((a) => a.plugin).map((a) => a.id);
      const rest = detected.filter((id) => !viaPlugin.includes(id));
      const plugin = viaPlugin.length ? `imstudium plugin in ${viaPlugin.join(", ")}` : "";
      const data = { detected, plugin: viaPlugin };
      if (!detected.length) return ok("no coding agent detected (skills are optional)", data);
      if (!rest.length) return ok(`skills come from the ${plugin}`, data);
      const also = plugin ? ` (${plugin})` : "";
      if (!s.manifest) return warn(`detected ${rest.join(", ")}: skills not installed${also}`, "imstudium setup all -y", data);
      if (s.staleSkills.length) return warn(`stale skills: ${s.staleSkills.join(", ")}${also}`, "imstudium setup all -y", { ...data, stale: s.staleSkills });
      if (!s.upToDate) return warn(`setup is from another version or workspace${also}`, "imstudium setup all -y", data);
      return ok(`skills current for ${rest.join(", ")}${also}`, data);
    },
  },
  {
    id: "mcp",
    title: "MCP door",
    run: async ({ setup }) => {
      const entries = await mcpEntries(await setup);
      if (!entries.length) return ok("not configured (opt-in: imstudium setup mcp)", { configured: [] });
      const broken = entries.filter((e) => e.command && isAbsolute(e.command) && !existsSync(e.command));
      const agents = [...new Set(entries.map((e) => e.agent))];
      if (broken.length) {
        return failed(`MCP command missing for ${broken.map((b) => `${b.agent} (${b.command})`).join(", ")}`, "imstudium setup mcp --force", { configured: agents });
      }
      return ok(`configured for ${agents.join(", ")}`, { configured: agents });
    },
  },
];

const MARK: Record<DoctorStatus, string> = { ok: "✓", warn: "!", fail: "✗", skip: "–" };

export async function runDoctor(sdk: Sdk, options: { offline: boolean; workspace: string }): Promise<DoctorOutput> {
  const ws = await sdk.studium.loadWorkspace(options.workspace);
  const ctx: DoctorContext = { sdk, offline: options.offline, workspace: options.workspace, ws, setup: getSetupStatus(options.workspace) };
  const checks = await Promise.all(
    DOCTOR_CHECKS.map(async (c): Promise<DoctorCheck> => {
      if (c.network && options.offline) return { id: c.id, title: c.title, ...skip("skipped (--offline)") };
      try {
        const run = c.run(ctx);
        const result = c.network ? await withBudget(run, NETWORK_BUDGET_MS + 500, c.title) : await run;
        return { id: c.id, title: c.title, ...result };
      } catch (err) {
        const e = toImstudiumError(err);
        return { id: c.id, title: c.title, status: c.network ? "warn" : "fail", detail: e.message, fix: e.hint ?? null };
      }
    }),
  );
  const count = (s: DoctorStatus) => checks.filter((c) => c.status === s).length;
  const versions = (checks.find((c) => c.id === "versions")?.data ?? {}) as Record<string, string | null>;
  return {
    ok: count("fail") === 0,
    offline: options.offline,
    versions: {
      cli: getCliVersion(),
      sdk: SDK_VERSION,
      contract: versions.contract ?? packageVersion("@imstudium/contract") ?? "—",
      mcp: versions.mcp ?? null,
      node: process.versions.node,
      bun: options.offline ? null : bunVersion(),
    },
    summary: { ok: count("ok"), warn: count("warn"), fail: count("fail"), skip: count("skip") },
    checks,
  };
}

export function renderDoctor(report: DoctorOutput): string {
  const width = Math.max(...report.checks.map((c) => c.title.length));
  const lines = [`imstudium doctor · CLI ${report.versions.cli} · Node ${report.versions.node}${report.offline ? " · offline" : ""}`, ""];
  for (const c of report.checks) {
    lines.push(`  ${MARK[c.status]} ${cell(c.title, width)}  ${c.detail}`);
    if (c.fix && (c.status === "warn" || c.status === "fail")) lines.push(`    ${" ".repeat(width)}  → ${c.fix}`);
  }
  const s = report.summary;
  lines.push("", `${s.ok} ok · ${s.warn} warning${s.warn === 1 ? "" : "s"} · ${s.fail} problem${s.fail === 1 ? "" : "s"}${s.skip ? ` · ${s.skip} skipped` : ""}`);
  return lines.join("\n");
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check install, session, workspace, ingest engines, agent setup and the MCP door — each with a fix")
    .option("--offline", "No network: skip the npm, OAuth, Stud.IP and semester checks")
    .addOption(outputOption())
    .action(
      act(async (opts: { offline?: boolean; output?: string }) => {
        // No silent re-login while diagnosing: a stale session must show up as stale.
        const sdk = await getSdk({ silentRefresh: false });
        const report = await runDoctor(sdk, { offline: !!opts.offline, workspace: workspaceDir(sdk, opts) });
        output(report, renderDoctor(report));
        if (!report.ok) process.exitCode = 1;
      }),
    );
}

