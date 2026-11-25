// Café Signal observation protocol, v1.
// An observation records ONE dependency-update experiment: the candidate (the update) and, when available, a
// baseline run of the same tests on the same runner with only the dependency manifests reverted. Only the fields
// below ever leave the machine; everything is built locally from the run and can be previewed before sharing.

export const PROTOCOL = "cafe-signal/v1";

export type Ecosystem = "npm" | "pypi";
export type RunResult = "pass" | "fail" | "flaky" | "error" | "not_run";

/** What the experiment can say about the update, from the strongest to the weakest claim. */
export type Attribution =
  | "regression" //            baseline passes (twice if retried), candidate fails reproducibly: the update broke it
  | "compatible" //            baseline passes, candidate passes
  | "baseline_red" //          baseline already fails: says nothing about the update
  | "upgrade_fixes" //         baseline fails, candidate passes
  | "unstable" //              a side gave different results on retry: flaky, not attributable
  | "observational_fail" //    candidate fails, no baseline (e.g. public seed: CI status of a bot PR)
  | "observational_pass"; //   candidate passes, no baseline

export interface Change {
  ecosystem: Ecosystem;
  package: string;
  from: string | null; // null = added
  to: string | null; // null = removed
  direct: boolean; // declared in the manifest, not only in the lockfile
}

export interface Environment {
  os: string; // "linux" | "darwin" | "win32"
  arch: string;
  runtime: string; // "node" | "python"
  runtime_version: string; // major.minor
}

export interface Provenance {
  /** "github-oidc": identity verified by the ingestion server; "seed": public data, source_url says where;
   *  "local": produced on this machine, unverified. A verified identity proves WHO ran it, not that the tests are good. */
  kind: "github-oidc" | "seed" | "local";
  owner_login?: string; // independence unit (same namespace for seed and verified records): one owner = one voice
  owner_id?: string;
  repository_id?: string;
  source_url?: string; // only for public data (seed or public repos that chose to share it)
  workflow?: string;
}

export interface Observation {
  protocol: typeof PROTOCOL;
  id: string; // sha256 of the canonical observation without id/provenance
  observed_at: string; // ISO date (day precision)
  changes: Change[]; // the dependency delta of the update (may include transitive bumps)
  primary: { ecosystem: Ecosystem; package: string; from: string; to: string }; // the update the bot proposed
  env: Environment | null;
  baseline: RunResult;
  candidate: RunResult;
  attribution: Attribution;
  phase: "install" | "test" | "unknown";
  /** Normalized error signatures that appear in the candidate and NOT in the baseline (no paths, numbers, names
   *  of local files, URLs or secrets). Empty for passes. */
  fingerprints: string[];
  provenance: Provenance;
  /** Seed only: how many real PRs this sampled record stands for (stratum total / sampled). Never shared. */
  weight?: number;
}

/** Classifies a paired experiment. Retries: each side reports its result after a re-run of a failure. */
export function attribute(baseline: RunResult, candidate: RunResult): Attribution {
  if (baseline === "flaky" || candidate === "flaky") return "unstable";
  if (baseline === "not_run" || baseline === "error") return candidate === "fail" ? "observational_fail" : candidate === "pass" ? "observational_pass" : "unstable";
  if (candidate === "not_run" || candidate === "error") return "unstable";
  if (baseline === "pass") return candidate === "pass" ? "compatible" : "regression";
  return candidate === "pass" ? "upgrade_fixes" : "baseline_red";
}

/** Strength of the causal claim an observation supports about the update. */
export const GRADE: Record<Attribution, "causal" | "observational" | "none"> = {
  regression: "causal",
  compatible: "causal",
  upgrade_fixes: "causal",
  baseline_red: "none",
  unstable: "none",
  observational_fail: "observational",
  observational_pass: "observational",
};

// ---------- normalization ----------

export function normalizeVersion(v: string): string {
  return v.trim().replace(/^[v=^~]+/, "");
}

export function semverParts(v: string): [number, number, number] | null {
  const m = normalizeVersion(v).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** "major" | "minor" | "patch" | "other": the size of the jump, used to group comparable transitions. */
export function bumpKind(from: string, to: string): "major" | "minor" | "patch" | "other" {
  const a = semverParts(from), b = semverParts(to);
  if (!a || !b) return "other";
  // 0.x: a minor bump is breaking by semver convention
  if (a[0] !== b[0] || (a[0] === 0 && a[1] !== b[1])) return "major";
  if (a[1] !== b[1]) return "minor";
  return a[2] !== b[2] ? "patch" : "other";
}

/** Normalizes package names the way the registries do (PyPI: PEP 503). */
export function normalizePackage(eco: Ecosystem, name: string): string {
  const n = name.trim();
  return eco === "pypi" ? n.toLowerCase().replace(/[-_.]+/g, "-") : n.toLowerCase();
}

// ---------- error fingerprints ----------

// Privacy-first signatures: the error TYPE (or code) plus the shape of its message. Every token that could be an
// identifier, a value, a path, a host, a user or a secret becomes a placeholder; only short lowercase English-like
// words survive. "TypeError: chalk.bold is not a function" -> "TypeError: <id> is not a function".
const ERR = /\b([A-Z][A-Za-z]{1,40}(?:Error|Exception)|ERR_[A-Z_]{2,60}|TS\d{4}|E[A-Z]{3,12})\b:?\s*(.{0,300})/;
const WORD = /^[a-z]{1,15}$/;

function shape(msg: string): string {
  const toks = msg.replace(/\x1b\[[0-9;]*m/g, "").split(/\s+/).filter(Boolean).slice(0, 14);
  const out: string[] = [];
  for (const t of toks) {
    const core = t.replace(/^[("'`[{<]+|[)"'`\]}>,;:.!?]+$/g, "");
    const p = WORD.test(core) ? core : "<id>";
    if (!(p === "<id>" && out[out.length - 1] === "<id>")) out.push(p);
  }
  return out.join(" ");
}

export function scrub(line: string): string {
  const m = line.match(ERR);
  if (!m) return "";
  const msg = shape(m[2]);
  return (msg ? `${m[1]}: ${msg}` : m[1]).slice(0, 120).trim();
}

/** Distinct normalized signatures in a log, at most `max`. Raw log text never leaves this function. */
export function signatures(log: string, max = 12): string[] {
  const out = new Set<string>();
  const seenLines = new Set<string>();
  for (const line of log.slice(0, 4 << 20).split(/\r?\n/)) {
    if (line.length > 2000 || seenLines.has(line)) continue;
    seenLines.add(line);
    const s = scrub(line);
    if (s.length >= 6) out.add(s);
    if (out.size >= max * 4) break;
  }
  return [...out].slice(0, max * 4);
}

/** Signatures that the candidate produced and the baseline did not: what the update introduced. */
export function differentialFingerprints(baselineLog: string, candidateLog: string, max = 8): string[] {
  const base = new Set(signatures(baselineLog));
  return signatures(candidateLog).filter((s) => !base.has(s)).slice(0, max);
}

// ---------- sharing ----------

export interface ShareOptions {
  /** Package-name patterns that must never leave the machine (internal packages). Glob with a trailing "*". */
  privatePackages?: string[];
  /** Keep the public source URL (only for public repositories). */
  includeSource?: boolean;
  /** Also share the full dependency delta (transitive bumps). Off by default: only the proposed update leaves. */
  includeChanges?: boolean;
}

const isPrivateName = (name: string, pats: string[]) => pats.some((p) => (p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : name === p));

/** The exact object that would be sent: allow-listed fields only, internal packages redacted. */
export function shareable(o: Observation, opts: ShareOptions = {}): Observation {
  const pats = opts.privatePackages ?? [];
  const changes = o.changes
    .filter((c) => (opts.includeChanges ? true : c.package === o.primary.package))
    .filter((c) => !isPrivateName(c.package, pats))
    .map((c) => ({ ecosystem: c.ecosystem, package: c.package, from: c.from, to: c.to, direct: c.direct === true }));
  if (isPrivateName(o.primary.package, pats)) throw new Error("the updated package matches a private pattern: this observation cannot be shared");
  return {
    protocol: PROTOCOL,
    id: o.id,
    observed_at: o.observed_at.slice(0, 10),
    changes,
    primary: { ...o.primary },
    env: o.env ? { os: o.env.os, arch: o.env.arch, runtime: o.env.runtime, runtime_version: o.env.runtime_version } : null,
    baseline: o.baseline,
    candidate: o.candidate,
    attribution: o.attribution,
    phase: o.phase,
    fingerprints: [...new Set(o.fingerprints.map(scrub).filter(Boolean))].slice(0, 8),
    provenance: { kind: o.provenance.kind, ...(opts.includeSource && o.provenance.source_url ? { source_url: o.provenance.source_url } : {}) },
  };
}

const ATTRS = new Set<Attribution>(["regression", "compatible", "baseline_red", "upgrade_fixes", "unstable", "observational_fail", "observational_pass"]);
const RESULTS = new Set<RunResult>(["pass", "fail", "flaky", "error", "not_run"]);
const NAME = /^(?:@[a-z0-9][\w.-]{0,100}\/)?[a-z0-9][\w.-]{0,100}$/i;
const VER = /^[\w.+!-]{1,64}$/;
const OS = new Set(["linux", "darwin", "win32", "freebsd"]);
const ARCH = new Set(["x64", "arm64", "arm", "ia32", "ppc64", "s390x"]);
const PHASE = new Set(["install", "test", "unknown"]);

/** Server-side validation. Returns a NEW object built only from allow-listed, type-checked fields (extra fields are
 *  dropped); recomputes the attribution from the two results; provenance is never taken from the client. */
export function validate(o: any, now = Date.now()): Omit<Observation, "provenance"> & { provenance: Observation["provenance"] } {
  if (!o || typeof o !== "object" || Array.isArray(o) || o.protocol !== PROTOCOL) throw new Error("not a cafe-signal/v1 observation");
  if (typeof o.id !== "string" || !/^[0-9a-f]{64}$/.test(o.id)) throw new Error("bad id");
  const p = o.primary;
  if (!p || typeof p !== "object" || !["npm", "pypi"].includes(p.ecosystem) || typeof p.package !== "string" || !NAME.test(p.package) || typeof p.from !== "string" || !VER.test(p.from) || typeof p.to !== "string" || !VER.test(p.to)) throw new Error("bad primary update");
  if (p.from === p.to) throw new Error("from and to are the same version");
  if (!RESULTS.has(o.baseline) || !RESULTS.has(o.candidate)) throw new Error("bad run results");
  if (!ATTRS.has(o.attribution)) throw new Error("bad attribution");
  // The server recomputes the attribution from the two results: a client cannot claim "regression" for FAIL/FAIL.
  if (o.attribution !== attribute(o.baseline, o.candidate) && !(o.attribution.startsWith("observational_") && o.baseline === "not_run")) throw new Error("attribution does not follow from baseline/candidate results");
  if (!Array.isArray(o.changes) || o.changes.length > 50) throw new Error("bad changes");
  const changes: Change[] = o.changes.map((c: any) => {
    if (!c || typeof c !== "object" || !["npm", "pypi"].includes(c.ecosystem) || typeof c.package !== "string" || !NAME.test(c.package) || (c.from !== null && (typeof c.from !== "string" || !VER.test(c.from))) || (c.to !== null && (typeof c.to !== "string" || !VER.test(c.to))) || typeof c.direct !== "boolean") throw new Error("bad change entry");
    return { ecosystem: c.ecosystem, package: c.package, from: c.from, to: c.to, direct: c.direct };
  });
  if (!Array.isArray(o.fingerprints) || o.fingerprints.length > 8 || o.fingerprints.some((f: unknown) => typeof f !== "string" || f.length > 120)) throw new Error("bad fingerprints");
  if (o.fingerprints.some((f: string) => f !== scrub(f))) throw new Error("fingerprints must be scrubbed (error type + message shape only)");
  let env: Environment | null = null;
  if (o.env !== null) {
    const e = o.env;
    if (!e || typeof e !== "object" || !OS.has(e.os) || !ARCH.has(e.arch) || !["node", "python"].includes(e.runtime) || typeof e.runtime_version !== "string" || !/^\d{1,3}\.\d{1,3}$/.test(e.runtime_version)) throw new Error("bad env");
    env = { os: e.os, arch: e.arch, runtime: e.runtime, runtime_version: e.runtime_version };
  }
  if (!PHASE.has(o.phase)) throw new Error("bad phase");
  if (typeof o.observed_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.observed_at.slice(0, 10))) throw new Error("bad date");
  const day = o.observed_at.slice(0, 10);
  if (Date.parse(day) > now + 86_400_000) throw new Error("date in the future");
  return {
    protocol: PROTOCOL, id: o.id, observed_at: day, changes, primary: { ecosystem: p.ecosystem, package: p.package, from: p.from, to: p.to },
    env, baseline: o.baseline, candidate: o.candidate, attribution: o.attribution, phase: o.phase, fingerprints: [...o.fingerprints],
    provenance: { kind: "local" },
  };
}

export async function observationId(o: Omit<Observation, "id" | "provenance">): Promise<string> {
  const canon = JSON.stringify({
    p: o.primary, c: [...o.changes].sort((a, b) => a.package.localeCompare(b.package)), e: o.env, b: o.baseline, k: o.candidate, f: [...o.fingerprints].sort(), d: o.observed_at.slice(0, 10),
  });
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
