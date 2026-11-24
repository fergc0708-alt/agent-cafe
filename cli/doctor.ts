// `cafe doctor` and `cafe diagnose`: the product's core workflow.
// Everything runs locally against the bundled catalog + evidence (and the project's private
// .cafe/capsules). Nothing about the project is sent anywhere.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { capsuleId, parseVersion, validateCapsule, type Capsule } from "../core/capsule/capsule.ts";
import { buildFinding, evaluate, matchError, type EvidenceRow, type Finding, type Hit, type IndexEntry, type TargetEnv } from "../core/doctor/match.ts";
import { fingerprint, type Fingerprint } from "./fingerprint.ts";

// Works from the source tree (cli/) and from the compiled CLI (dist/cli/).
const BUILT = [new URL("../capsules/built/", import.meta.url), new URL("../../capsules/built/", import.meta.url)].find((u) => existsSync(new URL("index.json", u)))!;

export interface LoadedIndex {
  entries: IndexEntry[];
  byId: Map<string, IndexEntry>;
  bySlug: Map<string, IndexEntry>;
  evidence: { generated_at: string; verified: number; claimed: number; ci_jobs: number; note: string };
}

/** Bundled catalog + evidence, plus private capsules captured in <project>/.cafe/capsules. */
export async function loadIndex(projectDir?: string): Promise<LoadedIndex> {
  const idx = JSON.parse(readFileSync(new URL("index.json", BUILT), "utf8")) as { slug: string; id: string }[];
  const ev = existsSync(new URL("evidence.json", BUILT)) ? JSON.parse(readFileSync(new URL("evidence.json", BUILT), "utf8")) : { capsules: {}, ci_jobs: [], generated_at: "never", note: "" };
  const entries: IndexEntry[] = idx.map(({ slug, id }) => {
    const capsule = JSON.parse(readFileSync(new URL(`${slug}.json`, BUILT), "utf8")) as Capsule;
    const rows = ((ev.capsules[slug]?.id === id ? ev.capsules[slug].rows : []) as EvidenceRow[]).map((r) => ({ ...r }));
    return { id, slug, capsule, rows, superseded_by: [], origin: "catalog" as const };
  });
  const localDir = projectDir ? join(projectDir, ".cafe", "capsules") : "";
  if (localDir && existsSync(localDir)) {
    for (const f of readdirSync(localDir).filter((x) => x.endsWith(".json"))) {
      try {
        const raw = JSON.parse(readFileSync(join(localDir, f), "utf8"));
        const v = validateCapsule(raw.capsule ?? raw);
        if (!v.ok) continue;
        const rows = Array.isArray(raw.local_results) ? (raw.local_results as EvidenceRow[]).map((r) => ({ ...r, trust: "claimed" as const })) : [];
        entries.push({ id: await capsuleId(v.capsule!), slug: f.replace(/\.json$/, ""), capsule: v.capsule!, rows, superseded_by: [], origin: "local" });
      } catch {
        /* ignore unreadable local capsule */
      }
    }
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) for (const old of e.capsule.supersedes ?? []) {
    const o = byId.get(old);
    if (o && o.capsule.author === e.capsule.author) o.superseded_by.push(e.id);
  }
  const all = entries.flatMap((e) => e.rows);
  return {
    entries,
    byId,
    bySlug: new Map(entries.map((e) => [e.slug, e])),
    evidence: { generated_at: ev.generated_at, verified: all.filter((r) => r.trust === "verified").length, claimed: all.filter((r) => r.trust === "claimed").length, ci_jobs: ev.ci_jobs.length, note: ev.note },
  };
}

// ---------------- project scan ----------------

const SKIP = new Set(["node_modules", ".git", ".venv", "venv", "env", "dist", "build", ".next", "__pycache__", "site-packages", "coverage", ".cafe", ".tox", ".mypy_cache", "out", "vendor"]);

export function scanProject(dir: string, entries: IndexEntry[], limits = { files: 20_000, bytes: 512_000 }): { hits: Map<string, Hit[]>; scanned: number } {
  const rules = entries.filter((e) => e.capsule.detect).map((e) => ({ e, re: new RegExp(e.capsule.detect!.pattern), also: e.capsule.detect!.also ? new RegExp(e.capsule.detect!.also) : null, exts: new Set(e.capsule.detect!.files.map((g) => g.slice(1))) }));
  const exts = new Set(rules.flatMap((r) => [...r.exts]));
  const hits = new Map<string, Hit[]>();
  let scanned = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 12 || scanned >= limits.files) return;
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      if (scanned >= limits.files) return;
      const p = join(d, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP.has(n) && !n.startsWith(".")) walk(p, depth + 1);
        continue;
      }
      const ext = extname(n);
      if (!exts.has(ext) || st.size > limits.bytes) continue;
      scanned++;
      const text = readFileSync(p, "utf8");
      const lines = text.split("\n");
      for (const r of rules) {
        if (!r.exts.has(ext) || (r.also && !r.also.test(text))) continue;
        const list = hits.get(r.e.id) ?? [];
        for (let i = 0; i < lines.length && list.length < 5; i++) {
          const line = lines[i].length > 2000 ? lines[i].slice(0, 2000) : lines[i];
          if (r.re.test(line)) list.push({ file: relative(dir, p), line: i + 1, text: line.trim().slice(0, 160) });
        }
        if (list.length) hits.set(r.e.id, list);
      }
    }
  };
  walk(dir, 0);
  return { hits, scanned };
}

// ---------------- environments to evaluate ----------------

function lowerBound(range: string): string | null {
  const m = range.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? `${m[1]}.${m[2] ?? 0}.${m[3] ?? 0}` : null;
}

export function environments(fp: Fingerprint, index: LoadedIndex, targets: string[], withUpgrades = true): TargetEnv[] {
  const envs: TargetEnv[] = [];
  const seen = new Set<string>();
  const push = (e: TargetEnv) => {
    const k = `${e.runtime}@${parseVersion(e.version).slice(0, 2).join(".")}`;
    if (!seen.has(k)) seen.add(k), envs.push(e);
  };
  // Only runtimes the project actually uses (Bun only with a Bun lockfile); all of them if unknown.
  const uses = (rt: string) => !fp.project.kinds.length || fp.project.kinds.includes(rt) || (rt === "bun" && fp.project.lockfiles.some((l) => l.startsWith("bun.")));
  for (const r of fp.runtimes) if (uses(r.runtime)) push({ runtime: r.runtime, version: r.version, conditions: fp.conditions, label: "installed" });
  for (const [k, v] of Object.entries(fp.project.declared)) {
    const runtime = k.startsWith("node") ? "node" : "python";
    const lb = lowerBound(v);
    if (lb) push({ runtime, version: lb, conditions: fp.conditions, label: `declared ${k.includes("(") ? k.slice(k.indexOf("(") + 1, -1) : runtime === "node" ? "engines" : "requires-python"} ${v}` });
  }
  for (const t of targets) {
    const [runtime, version] = t.split("@");
    if (runtime && version) push({ runtime, version, conditions: fp.conditions, label: "upgrade target" });
  }
  if (withUpgrades && !targets.length) {
    // Default: also check the newest version with VERIFIED evidence for each runtime the project uses.
    for (const runtime of new Set(fp.runtimes.map((r) => r.runtime).filter((r) => uses(r) && (r === "node" || r === "python")))) {
      const vs = index.entries.flatMap((e) => e.rows).filter((r) => r.runtime === runtime && r.trust === "verified").map((r) => r.version);
      const newest = vs.sort((a, b) => (parseVersion(b)[0] ?? 0) - (parseVersion(a)[0] ?? 0) || (parseVersion(b)[1] ?? 0) - (parseVersion(a)[1] ?? 0))[0];
      if (newest) push({ runtime, version: newest, conditions: fp.conditions, label: "upgrade target, newest verified" });
    }
  }
  return envs;
}

// ---------------- doctor ----------------

export interface DoctorReport {
  project: string;
  fingerprint: Fingerprint;
  environments: TargetEnv[];
  scanned_files: number;
  rules: number;
  findings: Finding[];
  clear: { slug: string; hits: number }[];
  evidence: LoadedIndex["evidence"];
}

export async function doctor(projectDir: string, targets: string[] = [], bins: Record<string, string> = {}): Promise<DoctorReport> {
  const index = await loadIndex(projectDir);
  const fp = await fingerprint(projectDir, bins);
  const envs = environments(fp, index, targets);
  const { hits, scanned } = scanProject(projectDir, index.entries);
  const findings: Finding[] = [];
  const clear: DoctorReport["clear"] = [];
  for (const [id, h] of hits) {
    const entry = index.byId.get(id)!;
    const f = buildFinding(entry, envs, `your code uses the affected API (${h.length}${h.length === 5 ? "+" : ""} place${h.length === 1 ? "" : "s"})`, h, index.byId);
    if (!f.verdicts.length) continue;
    if (f.verdicts.every((v) => v.status === "not_affected")) clear.push({ slug: f.slug, hits: h.length });
    else findings.push(f);
  }
  findings.sort((a, b) => b.severity - a.severity);
  return { project: projectDir, fingerprint: fp, environments: envs, scanned_files: scanned, rules: index.entries.filter((e) => e.capsule.detect).length, findings, clear, evidence: index.evidence };
}

// ---------------- diagnose ----------------

export interface DiagnoseReport {
  error_excerpt: string;
  environments: TargetEnv[];
  matches: (Finding & { match: string; score: number })[];
  rejected: { slug: string; why: string }[];
  verdict: string;
}

export async function diagnose(projectDir: string, error: string, targets: string[] = [], bins: Record<string, string> = {}): Promise<DiagnoseReport> {
  const index = await loadIndex(projectDir);
  const fp = await fingerprint(projectDir, bins);
  const envs = environments(fp, index, targets, false);
  const matches: DiagnoseReport["matches"] = [];
  const rejected: DiagnoseReport["rejected"] = [];
  for (const m of matchError(index.entries, error).slice(0, 8)) {
    const f = buildFinding(m.entry, envs, m.why, [], index.byId);
    // The error text is itself evidence that SOME runtime hits this. If the default one is not affected,
    // say where it does break instead of ruling the capsule out (the failing process may use another).
    if (f.verdicts.length && f.verdicts.every((v) => v.status === "not_affected")) {
      const rt = m.entry.capsule.runtime;
      const broken = [...new Set(m.entry.rows.filter((r) => r.runtime === rt && (r.verdict === "PASS" || r.verdict === "FIX_FAILS")).map((r) => r.version.split(".").slice(0, 2).join(".")))];
      if (!broken.length) {
        rejected.push({ slug: m.entry.slug, why: `looks similar, but no tested ${rt} version is affected by it, so it is probably not your cause` });
        continue;
      }
      matches.push({ ...f, action: `If the failing process runs ${rt} ${broken.join(" or ")}: apply the fix (cafe show ${m.entry.slug}). Your default runtime is not affected.`, match: `${m.why}. Your default ${f.verdicts.map((v) => `${v.env.runtime} ${v.env.version}`).join(", ")} is NOT affected, but it breaks on ${rt} ${broken.join(", ")}: if the failing process runs one of those, this is it (pass --${rt === "node" ? "node" : "python"} <path> to check that interpreter)`, score: Math.round(m.score * 0.6) });
      continue;
    }
    if (!f.verdicts.length) {
      rejected.push({ slug: m.entry.slug, why: `it is about ${m.entry.capsule.runtime}, which is not in your environment` });
      continue;
    }
    matches.push({ ...f, match: m.why, score: m.score });
  }
  matches.sort((a, b) => b.score - a.score || b.severity - a.severity);
  const verdict = matches.length
    ? matches[0].score >= 100
      ? `Known problem: ${matches[0].title}`
      : `Possible match (weak, by keywords): ${matches[0].title}`
    : "No known capsule matches this error in your environment. Nothing to recommend; debug it normally.";
  return { error_excerpt: error.slice(0, 300), environments: envs, matches: matches.slice(0, 3), rejected: rejected.slice(0, 3), verdict };
}

export { evaluate };
