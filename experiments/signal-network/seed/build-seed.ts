// Converts collected public Renovate PR outcomes (prs*.jsonl) into Café Signal observations.
// These are OBSERVATIONAL: the CI status of a bot PR, with no baseline. They cannot separate the update from a red
// main branch or flaky tests, and the engine never pools them with paired (causal) evidence.
// Usage: node signal/seed/build-seed.ts out.json prs.jsonl [more.jsonl...]
import { readFileSync, writeFileSync } from "node:fs";
import { normalizePackage, normalizeVersion, observationId, PROTOCOL, type Observation } from "../protocol.ts";

export interface PrRecord {
  url: string; repo: string; number: number; title: string; ecosystem: "npm" | "pypi"; package: string; from: string; to: string;
  ci: "failure" | "success"; state: string; merged_at: string | null; created_at: string; closed_at: string | null;
  mc_badge: boolean; multi_update: boolean; security: boolean; stratum?: string;
}

/** Loads PR records: one per URL, grouped updates dropped (cannot be attributed to one package), from == to dropped,
 *  and ONE record per repository and transition (Renovate re-opens PRs for the same update; the earliest counts). */
export function loadPrs(files: string[]): PrRecord[] {
  const seen = new Map<string, PrRecord>();
  for (const f of files) for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as PrRecord;
    if (!seen.has(r.url)) seen.set(r.url, r);
  }
  const byKey = new Map<string, PrRecord>();
  for (const r of [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (r.multi_update || normalizeVersion(r.from) === normalizeVersion(r.to)) continue;
    const k = `${r.repo.toLowerCase()}|${r.ecosystem}|${r.package.toLowerCase()}|${normalizeVersion(r.from)}|${normalizeVersion(r.to)}`;
    if (!byKey.has(k)) byKey.set(k, r);
  }
  return [...byKey.values()];
}

/** Stratum weights (total / returned) from the collector's totals files. Throws if a record has no stratum. */
export function weightsFrom(files: string[]): (r: PrRecord) => number {
  const t: Record<string, { total: number; returned: number }> = {};
  for (const f of files) Object.assign(t, JSON.parse(readFileSync(f, "utf8")));
  return (r) => {
    const s = r.stratum ? t[r.stratum] : undefined;
    if (!s || !s.returned) throw new Error(`no stratum total for ${r.url} (${r.stratum}); weights would silently be 1`);
    return s.total / s.returned;
  };
}

export async function toObservation(r: PrRecord, weight?: number): Promise<Observation> {
  const draft = {
    protocol: PROTOCOL as typeof PROTOCOL,
    observed_at: r.created_at,
    changes: [{ ecosystem: r.ecosystem, package: normalizePackage(r.ecosystem, r.package), from: normalizeVersion(r.from), to: normalizeVersion(r.to), direct: true }],
    primary: { ecosystem: r.ecosystem, package: normalizePackage(r.ecosystem, r.package), from: normalizeVersion(r.from), to: normalizeVersion(r.to) },
    env: null,
    baseline: "not_run" as const,
    candidate: r.ci === "failure" ? ("fail" as const) : ("pass" as const),
    attribution: r.ci === "failure" ? ("observational_fail" as const) : ("observational_pass" as const),
    phase: "unknown" as const,
    fingerprints: [],
  };
  return { ...draft, id: await observationId({ ...draft, fingerprints: [r.url] }), provenance: { kind: "seed", source_url: r.url, owner_login: r.repo.split("/")[0].toLowerCase() }, ...(weight ? { weight } : {}) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, ...rest] = process.argv.slice(2);
  const files = rest.filter((f) => f.endsWith(".jsonl")), totals = rest.filter((f) => f.endsWith(".json"));
  const prs = loadPrs(files);
  const w = totals.length ? weightsFrom(totals) : null;
  const observations = await Promise.all(prs.map((p) => toObservation(p, w ? w(p) : undefined)));
  writeFileSync(out, JSON.stringify({
    protocol: PROTOCOL,
    source: "Public GitHub pull requests opened by Renovate (search API, `status:` qualifier = combined CI status at collection time). Observational only. Sampled per package x week x status (newest 100); `weight` = stratum total / sampled.",
    collected: new Date().toISOString().slice(0, 10),
    count: observations.length,
    observations,
  }));
  console.log(`${observations.length} observations from ${new Set(prs.map((p) => p.repo)).size} repositories, ${new Set(prs.map((p) => p.repo.split("/")[0])).size} owners`);
}
