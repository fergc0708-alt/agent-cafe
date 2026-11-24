// Upgrade intelligence: what other projects' experiments say about an update you are about to take.
// Rules: one independent voice per repository OWNER (an org's 50 repos are one voice); causal (paired) and
// observational evidence are never pooled into one number; every estimate carries its sample size and a 90%
// credible interval; below a minimum sample the answer is "insufficient evidence", not a score.
import { bumpKind, GRADE, normalizePackage, semverParts, type Attribution, type Ecosystem, type Observation } from "./protocol.ts";

export interface Query {
  ecosystem: Ecosystem;
  package: string;
  from: string;
  to: string;
  env?: { runtime: string; runtime_version: string; os?: string } | null;
  /** Only observations made strictly before this time (used by the benchmark: no peeking at the future). */
  before?: string;
  /** Owner asking (their own observations are excluded: the network should tell you what OTHERS saw). */
  excludeOwner?: string;
  /** Independence unit: "owner" for the cross-organization network (default), "repository" for one
   *  organization's private fleet, where each repository is a separate experiment. */
  unit?: "owner" | "repository";
}

export interface Estimate {
  owners: number; // independent units (owners, or repositories in fleet mode) with evidence of this grade
  failures: number; // owners whose outcome was a failure
  mean: number | null; // posterior mean failure probability (null when owners === 0)
  ci90: [number, number] | null;
  prior: { mean: number; strength: number; from: string };
}

export interface Report {
  query: Query;
  match: "exact" | "same_target" | "same_jump" | "none";
  causal: Estimate; // from paired baseline/candidate experiments
  observational: Estimate; // CI status without a baseline (e.g. bot PR status)
  inconclusive: number; // owners with baseline_red / unstable only
  fingerprints: { signature: string; owners: number }[];
  environments: { runtime: string; os: string; owners: number; failures: number }[];
  your_env_tested: boolean | null;
  evidence: { attribution: Attribution; date: string; source?: string; env?: string }[];
  verdict: "known_regression" | "single_report" | "likely_safe" | "mixed" | "insufficient_evidence";
  summary: string;
  /** Some evidence comes from a stratified sample (public seed): raw counts over-represent failures. */
  sampled: boolean;
}

const MIN_CAUSAL = 3;
const MIN_OBSERVATIONAL = 5;

export function repoOf(o: Observation): string {
  if (o.provenance.repository_id) return `repo:${o.provenance.repository_id}`;
  const m = o.provenance.source_url?.match(/github\.com\/([^/]+\/[^/]+)\//i);
  return m ? `gh:${m[1].toLowerCase()}` : `obs:${o.id}`;
}

let UNIT: (o: Observation) => string = (o) => ownerOf(o);

export function ownerOf(o: Observation): string {
  if (o.provenance.owner_login) return `gh:${o.provenance.owner_login.toLowerCase()}`;
  if (o.provenance.owner_id) return `id:${o.provenance.owner_id}`;
  const m = o.provenance.source_url?.match(/github\.com\/([^/]+)\//i);
  return m ? `gh:${m[1].toLowerCase()}` : `obs:${o.id}`;
}

const isFail = (a: Attribution) => a === "regression" || a === "observational_fail";
const isPass = (a: Attribution) => a === "compatible" || a === "observational_pass" || a === "upgrade_fixes";

/** One outcome per owner and grade: an owner with any reproduced regression counts as one failure. */
function collapse(obs: Observation[], grade: "causal" | "observational"): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const o of obs) {
    if (GRADE[o.attribution] !== grade) continue;
    if (!isFail(o.attribution) && !isPass(o.attribution)) continue;
    const k = UNIT(o);
    out.set(k, (out.get(k) ?? false) || isFail(o.attribution));
  }
  return out;
}

/** Sampling weight of each owner's outcome (seed records sampled per stratum carry weight = stratum size / sample). */
function ownerWeights(obs: Observation[], grade: "causal" | "observational"): Map<string, number> {
  const w = new Map<string, number>();
  for (const o of obs) if (GRADE[o.attribution] === grade) w.set(UNIT(o), Math.max(w.get(UNIT(o)) ?? 0, o.weight ?? 1));
  return w;
}

// ---- Beta distribution helpers (Lentz continued fraction for the regularized incomplete beta) ----
function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5, s = 1.000000000190015;
  t -= (x + 0.5) * Math.log(t);
  for (const ci of c) s += ci / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
function betacf(a: number, b: number, x: number): number {
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
export function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (betaCdf(mid, a, b) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Empirical-Bayes estimate: Beta prior centred on the package's (or ecosystem's) failure rate among OTHER
 *  transitions, with a weak strength, updated with owner-level outcomes for this transition. */
function estimate(outcomes: Map<string, boolean>, prior: Estimate["prior"], weights?: Map<string, number>): Estimate {
  const n = outcomes.size, f = [...outcomes.values()].filter(Boolean).length;
  if (!n) return { owners: 0, failures: 0, mean: null, ci90: null, prior };
  // Weighted failure share (corrects stratified sampling), applied to the owner count: n stays the real sample size.
  let fw = f;
  if (weights) {
    let W = 0, F = 0;
    for (const [k, fail] of outcomes) { const w = weights.get(k) ?? 1; W += w; if (fail) F += w; }
    fw = W ? (F / W) * n : f;
  }
  const a = prior.mean * prior.strength + fw, b = (1 - prior.mean) * prior.strength + (n - fw);
  return { owners: n, failures: f, mean: a / (a + b), ci90: [betaQuantile(0.05, a, b), betaQuantile(0.95, a, b)], prior };
}

export interface Index {
  all: Observation[];
  byPackage: Map<string, Observation[]>;
}

export function buildIndex(obs: Observation[]): Index {
  const byPackage = new Map<string, Observation[]>();
  for (const o of obs) {
    const k = `${o.primary.ecosystem}:${normalizePackage(o.primary.ecosystem, o.primary.package)}`;
    (byPackage.get(k) ?? byPackage.set(k, []).get(k)!).push(o);
  }
  return { all: obs, byPackage };
}

function priorFor(pool: Observation[], grade: "causal" | "observational", base: number): Estimate["prior"] {
  const o = collapse(pool, grade);
  const w = ownerWeights(pool, grade);
  // pseudo-count 4: the package history moves the prior, a single transition's evidence quickly dominates it
  if (o.size >= 10) {
    let W = 0, F = 0;
    for (const [k, fail] of o) { const x = w.get(k) ?? 1; W += x; if (fail) F += x; }
    return { mean: Math.min(0.95, Math.max(0.02, F / W)), strength: 4, from: `package history (${o.size} owner-outcomes)` };
  }
  return { mean: base, strength: 2, from: "ecosystem default" };
}

export function query(index: Index, q: Query, opts: { base?: number } = {}): Report {
  UNIT = q.unit === "repository" ? repoOf : ownerOf;
  try {
    return queryInner(index, q, opts);
  } finally {
    UNIT = ownerOf;
  }
}

function queryInner(index: Index, q: Query, opts: { base?: number }): Report {
  const pkg = normalizePackage(q.ecosystem, q.package);
  const usable = (o: Observation) => (!q.before || o.observed_at < q.before) && (!q.excludeOwner || ownerOf(o) !== q.excludeOwner);
  const pool = (index.byPackage.get(`${q.ecosystem}:${pkg}`) ?? []).filter(usable);
  const to = q.to.replace(/^v/, ""), from = q.from.replace(/^v/, "");
  const pre = (v: string) => /[a-z]/i.test(v.replace(/^v/, "").replace(/^\d+!/, "")); // 5.0.0-beta.1, 2.0rc1, 7.1.0-dev
  // Evidence about the same TARGET version is pooled (exact transitions are a subset, not a separate tier that could
  // shadow it). Only when none exists do we fall back to the same jump (same majors and target minor, no prereleases).
  const tiers: [Report["match"], (o: Observation) => boolean][] = [
    ["same_target", (o) => o.primary.to === to],
    ["same_jump", (o) => { if (pre(o.primary.to) !== pre(to)) return false; const a = semverParts(o.primary.from), b = semverParts(o.primary.to), x = semverParts(from), y = semverParts(to); return !!(a && b && x && y && a[0] === x[0] && b[0] === y[0] && bumpKind(from, to) === bumpKind(o.primary.from, o.primary.to) && b[1] === y[1]); }],
  ];
  let match: Report["match"] = "none";
  let hits: Observation[] = [];
  for (const [name, f] of tiers) {
    const h = pool.filter(f);
    if (h.length > 0) { match = name === "same_target" && h.every((o) => o.primary.from === from) ? "exact" : name; hits = h; break; }
  }
  const others = pool.filter((o) => !hits.includes(o));
  const base = opts.base ?? 0.1;
  const causal = estimate(collapse(hits, "causal"), priorFor(others, "causal", base));
  const observational = estimate(collapse(hits, "observational"), priorFor(others, "observational", base), ownerWeights(hits, "observational"));
  const inconclusive = new Set(hits.filter((o) => GRADE[o.attribution] === "none").map(UNIT)).size;

  const fp = new Map<string, Set<string>>();
  for (const o of hits) for (const s of o.fingerprints) (fp.get(s) ?? fp.set(s, new Set()).get(s)!).add(UNIT(o));
  const env = new Map<string, { runtime: string; os: string; owners: Set<string>; fails: Set<string> }>();
  for (const o of hits) {
    if (!o.env) continue;
    const rv = o.env.runtime === "python" ? o.env.runtime_version.split(".").slice(0, 2).join(".") : o.env.runtime_version.split(".")[0];
    const k = `${o.env.runtime} ${rv}|${o.env.os}`;
    const e = env.get(k) ?? env.set(k, { runtime: `${o.env.runtime} ${rv}`, os: o.env.os, owners: new Set(), fails: new Set() }).get(k)!;
    e.owners.add(UNIT(o));
    if (isFail(o.attribution)) e.fails.add(UNIT(o));
  }
  const environments = [...env.values()].map((e) => ({ runtime: e.runtime, os: e.os, owners: e.owners.size, failures: e.fails.size }));
  const qrv = q.env ? (q.env.runtime === "python" ? q.env.runtime_version.split(".").slice(0, 2).join(".") : q.env.runtime_version.split(".")[0]) : "";
  const your_env_tested = q.env ? environments.some((e) => e.runtime === `${q.env!.runtime} ${qrv}`) : null;

  // Verdicts follow the interval, need several independent owners, and never let a handful of (possibly Sybil)
  // owners overrule a large opposite signal: contradictions are reported as "mixed".
  let verdict: Report["verdict"] = "insufficient_evidence";
  const obsHigh = observational.owners >= MIN_OBSERVATIONAL && observational.ci90 && observational.ci90[0] > 0.5;
  const obsLow = observational.owners >= MIN_OBSERVATIONAL && observational.ci90 && observational.ci90[1] < 0.2;
  if (causal.owners >= MIN_CAUSAL && causal.ci90) {
    if (causal.failures >= 2 && causal.ci90[0] > 0.25) verdict = obsLow ? "mixed" : "known_regression";
    else if (causal.failures === 0 && causal.ci90[1] < 0.35) verdict = obsHigh ? "mixed" : "likely_safe";
    else if (causal.failures > 0) verdict = "mixed";
  } else if (causal.failures >= 1) {
    verdict = "single_report"; // one paired regression is shown, never as a conclusion
  } else if (obsHigh) verdict = "mixed";
  else if (obsLow) verdict = "likely_safe";
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const describe = (e: Estimate, what: string, calibrated = true) => (e.owners ? `${what}: ${e.failures} of ${e.owners} owners failed${calibrated ? ` (estimate ${pct(e.mean!)}, 90% interval ${pct(e.ci90![0])}–${pct(e.ci90![1])})` : ""}` : `${what}: none`);
  const summary = [
    match === "none" ? "No other project has reported this update yet." : `Match: ${match.replace("_", " ")}.`,
    describe(causal, "Paired experiments (baseline vs update, same runner)"),
    describe(observational, "CI status only (cannot separate the update from a red main or flaky tests)", false),
    inconclusive ? `${inconclusive} owners inconclusive (baseline already red or flaky).` : "",
  ].filter(Boolean).join(" ");
  return {
    query: q, match, causal, observational, inconclusive,
    fingerprints: [...fp.entries()].map(([signature, s]) => ({ signature, owners: s.size })).sort((a, b) => b.owners - a.owners).slice(0, 5),
    environments, your_env_tested,
    evidence: hits.slice(0, 20).map((o) => ({ attribution: o.attribution, date: o.observed_at.slice(0, 10), ...(o.provenance.source_url ? { source: o.provenance.source_url } : {}), ...(o.env ? { env: `${o.env.runtime} ${o.env.runtime_version} ${o.env.os}` } : {}) })),
    verdict, summary, sampled: hits.some((o) => o.weight !== undefined),
  };
}
