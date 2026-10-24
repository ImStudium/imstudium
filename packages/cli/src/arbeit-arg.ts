import { Option } from "commander";
import { daysUntil, loadQuellen, resolveArbeit, type ArbeitRef, type MetadataOptions, type QuellenFile } from "@imstudium/sdk";
import type { ArbeitShowOutput, ArbeitSummaryJson } from "@imstudium/contract";
import { join } from "node:path";
import { workspaceDir } from "./kit/args.js";
import { getSdk, type Sdk } from "./runtime.js";
import { getCliVersion } from "./version.js";

/**
 * Shared plumbing for the writing commands (arbeit, quellen, zitieren,
 * literatur, stile): which Arbeit a command means, its registry, and the
 * options the metadata services get.
 */

export function arbeitOption(): Option {
  return new Option("--arbeit <name>", "Which Arbeit: slug, title fragment or folder (default: the folder you are in, then the one picked with arbeit use)");
}

export interface ArbeitContext {
  sdk: Sdk;
  workspace: string;
  ref: ArbeitRef;
  quellen: QuellenFile;
}

export async function arbeitContext(opts: { arbeit?: string; output?: string }): Promise<ArbeitContext> {
  const sdk = await getSdk({ silentRefresh: false });
  const workspace = workspaceDir(sdk, opts);
  const ref = await resolveArbeit(workspace, { arbeit: opts.arbeit, cwd: process.cwd() });
  return { sdk, workspace, ref, quellen: await loadQuellen(ref.dir) };
}

/** What the metadata services see: the CLI's name and version, and a contact only when one is configured. */
export function metadataOptions(): MetadataOptions {
  return {
    userAgent: `imstudium/${getCliVersion()} (+https://github.com/ImStudium/imstudium)`,
    ...(process.env.IMSTUDIUM_CONTACT ? { mailto: process.env.IMSTUDIUM_CONTACT } : {}),
    timeoutMs: 10_000,
  };
}

export function quellenCounts(q: QuellenFile): ArbeitSummaryJson["quellen"] {
  const c = { total: q.items.length, verified: 0, problems: 0, unverified: 0 };
  for (const x of q.items) {
    const s = x.check?.status;
    if (s === "verified") c.verified++;
    else if (s === "mismatch" || s === "not-found" || s === "retracted") c.problems++;
    else c.unverified++;
  }
  return c;
}

export function arbeitSummary(ref: ArbeitRef, quellen: QuellenFile, current: string | null): ArbeitSummaryJson {
  const a = ref.arbeit;
  return {
    slug: a.slug,
    title: a.title,
    typ: a.typ,
    dir: ref.dir,
    current: current === ref.dir,
    inWorkspace: ref.inWorkspace,
    abgabe: a.abgabe,
    daysLeft: a.abgabe ? daysUntil(a.abgabe) : null,
    stil: a.stil.id,
    course: a.course?.title ?? null,
    quellen: quellenCounts(quellen),
  };
}

export function arbeitShow(ref: ArbeitRef, quellen: QuellenFile): ArbeitShowOutput {
  return {
    dir: ref.dir,
    arbeit: ref.arbeit,
    daysLeft: ref.arbeit.abgabe ? daysUntil(ref.arbeit.abgabe) : null,
    quellen: quellenCounts(quellen),
    files: { registry: join(ref.dir, "quellen.json"), bib: join(ref.dir, "quellen.bib"), brief: join(ref.dir, "ARBEIT.md") },
  };
}

/** "key=value" pairs; a value may contain "=". */
export function parseAssignments(items: string[]): Array<[string, string]> {
  return items.map((it) => {
    const i = it.indexOf("=");
    return i < 0 ? [it.trim(), ""] : [it.slice(0, i).trim(), it.slice(i + 1).trim()];
  });
}
