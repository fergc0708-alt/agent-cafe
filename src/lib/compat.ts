// Server-side access to the bundled compatibility catalog + executed evidence for the web pages.
// Same engine as the CLI (core/doctor/match.ts), so the site and `cafe doctor` never disagree.
import "server-only";
import catalog from "../../capsules/built/catalog.json";
import evidence from "../../capsules/built/evidence.json";
import type { Capsule } from "@core/capsule/capsule.ts";
import { evaluate, type EvidenceRow, type IndexEntry, type Status } from "@core/doctor/match.ts";

type Ev = { generated_at: string; note: string; ci_jobs: { label: string; repository: string; sha: string; run_id: string; workflow: string }[]; capsules: Record<string, { id: string; rows: EvidenceRow[] }> };
const ev = evidence as unknown as Ev;

export const ENTRIES: IndexEntry[] = (catalog as unknown as { slug: string; id: string; capsule: Capsule }[]).map(({ slug, id, capsule }) => ({
  slug,
  id,
  capsule,
  rows: ev.capsules[slug]?.id === id ? ev.capsules[slug].rows : [],
  superseded_by: [],
  origin: "catalog" as const,
}));
const byId = new Map(ENTRIES.map((e) => [e.id, e]));
for (const e of ENTRIES) for (const old of e.capsule.supersedes ?? []) byId.get(old)?.superseded_by.push(e.id);

export const EVIDENCE_META = {
  generated_at: ev.generated_at,
  note: ev.note,
  jobs: ev.ci_jobs.length,
  run: ev.ci_jobs[0] ?? null,
  verified: ENTRIES.flatMap((e) => e.rows).filter((r) => r.trust === "verified").length,
  claimed: ENTRIES.flatMap((e) => e.rows).filter((r) => r.trust === "claimed").length,
};

export const mm = (v: string) => v.split(".").slice(0, 2).join(".");
const num = (v: string) => v.split(".").map(Number);

/** The version columns that have evidence, per runtime (sorted). */
export function versionColumns(runtime: string): string[] {
  const vs = new Set(ENTRIES.flatMap((e) => e.rows).filter((r) => r.runtime === runtime && !Object.keys(r.conditions).length).map((r) => mm(r.version)));
  return [...vs].sort((a, b) => num(a)[0] - num(b)[0] || num(a)[1] - num(b)[1]);
}

export function cell(e: IndexEntry, runtime: string, version: string): { status: Status; trust: string | null } {
  const v = evaluate(e, { runtime, version, conditions: {}, label: "matrix" });
  return { status: v.exact ? v.status : "untested", trust: v.trust };
}

export function entry(slug: string): IndexEntry | undefined {
  return ENTRIES.find((e) => e.slug === slug);
}

export function bySlugId(id: string): IndexEntry | undefined {
  return byId.get(id);
}

/** Version-scoped breaks (the old code works somewhere and breaks somewhere else). */
export function isUpgradeBreak(e: IndexEntry): boolean {
  const rt = e.rows.filter((r) => r.runtime === e.capsule.runtime);
  return rt.some((r) => r.verdict === "PROBLEM_NOT_REPRODUCED") && rt.some((r) => r.verdict !== "PROBLEM_NOT_REPRODUCED");
}
