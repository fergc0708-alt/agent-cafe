// Converts collected public Renovate PR outcomes (prs*.jsonl) into Café Signal observations.
// These are OBSERVATIONAL: the CI status of a bot PR, with no baseline. They cannot separate the update from a red
// main branch or flaky tests, and the engine never pools them with paired (causal) evidence.
// Usage: node signal/seed/build-seed.ts out.json prs.jsonl [more.jsonl...]
import { readFileSync, writeFileSync } from "node:fs";
import { normalizePackage, normalizeVersion, observationId, PROTOCOL, type Observation } from "../protocol.ts";

export interface PrRecord {
  url: string; repo: string; number: number; title: string; ecosystem: "npm" | "pypi"; package: string; from: string; to: string;
  ci: "failure" | "success"; state: string; merged_at: string | null; created_at: string; closed_at: string | null;
  mc_badge: boolean; multi_update: boolean; security: boolean;
}

export function loadPrs(files: string[]): PrRecord[] {
  const seen = new Map<string, PrRecord>();
  for (const f of files) for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as PrRecord;
    if (!seen.has(r.url)) seen.set(r.url, r);
  }
  return [...seen.values()].filter((r) => !r.multi_update); // grouped updates cannot be attributed to one package
}

export async function toObservation(r: PrRecord): Promise<Observation> {
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
  return { ...draft, id: await observationId({ ...draft, fingerprints: [r.url] }), provenance: { kind: "seed", source_url: r.url } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, ...files] = process.argv.slice(2);
  const prs = loadPrs(files);
  const observations = await Promise.all(prs.map(toObservation));
  writeFileSync(out, JSON.stringify({
    protocol: PROTOCOL,
    source: "Public GitHub pull requests opened by Renovate (search API, `status:` qualifier = combined CI status at collection time). Observational only.",
    collected: new Date().toISOString().slice(0, 10),
    count: observations.length,
    observations,
  }));
  console.log(`${observations.length} observations from ${new Set(prs.map((p) => p.repo)).size} repositories, ${new Set(prs.map((p) => p.repo.split("/")[0])).size} owners`);
}
