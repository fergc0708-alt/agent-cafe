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
  verdict: "known_regression" | "likely_safe" | "mixed" | "insufficient_evidence";
  summary: string;
}

const MIN_CAUSAL = 2;
const MIN_OBSERVATIONAL = 5;

export function repoOf(o: Observation): string {
  if (o.provenance.repository_id) return `repo:${o.provenance.repository_id}`;
  const m = o.provenance.source_url?.match(/github\.com\/([^/]+\/[^/]+)\//i);
  return m ? `gh:${m[1].toLowerCase()}` : `obs:${o.id}`;
}

let UNIT: (o: Observation) => string = (o) => ownerOf(o);

export function ownerOf(o: Observation): string {
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
function estimate(outcomes: Map<string, boolean>, prior: Estimate["prior"]): Estimate {
  const n = outcomes.size, f = [...outcomes.values()].filter(Boolean).length;
  if (!n) return { owners: 0, failures: 0, mean: null, ci90: null, prior };
  const a = prior.mean * prior.strength + f, b = (1 - prior.mean) * prior.strength + (n - f);
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
  // pseudo-count 4: the package history moves the prior, a single transition's evidence quickly dominates it
  if (o.size >= 10) return { mean: Math.min(0.95, Math.max(0.02, [...o.values()].filter(Boolean).length / o.size)), strength: 4, from: `package history (${o.size} owner-outcomes)` };
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
  const tiers: [Report["match"], (o: Observation) => boolean][] = [
    ["exact", (o) => o.primary.to === to && o.primary.from === from],
    ["same_target", (o) => o.primary.to === to],
    ["same_jump", (o) => { const a = semverParts(o.primary.from), b = semverParts(o.primary.to), x = semverParts(from), y = semverParts(to); return !!(a && b && x && y && a[0] === x[0] && b[0] === y[0] && bumpKind(from, to) === bumpKind(o.primary.from, o.primary.to) && b[1] === y[1]); }],
  ];
  let match: Report["match"] = "none";
  let hits: Observation[] = [];
  for (const [name, f] of tiers) {
    const h = pool.filter(f);
    if (h.length > 0) { match = name; hits = h; break; }
  }
  const others = pool.filter((o) => !hits.includes(o));
  const base = opts.base ?? 0.1;
  const causal = estimate(collapse(hits, "causal"), priorFor(others, "causal", base));
  const observational = estimate(collapse(hits, "observational"), priorFor(others, "observational", base));
  const inconclusive = new Set(hits.filter((o) => GRADE[o.attribution] === "none").map(UNIT)).size;

  const fp = new Map<string, Set<string>>();
  for (const o of hits) for (const s of o.fingerprints) (fp.get(s) ?? fp.set(s, new Set()).get(s)!).add(UNIT(o));
  const env = new Map<string, { runtime: string; os: string; owners: Set<string>; fails: Set<string> }>();
  for (const o of hits) {
    if (!o.env) continue;
    const k = `${o.env.runtime} ${o.env.runtime_version.split(".")[0]}|${o.env.os}`;
    const e = env.get(k) ?? env.set(k, { runtime: `${o.env.runtime} ${o.env.runtime_version.split(".")[0]}`, os: o.env.os, owners: new Set(), fails: new Set() }).get(k)!;
    e.owners.add(UNIT(o));
    if (isFail(o.attribution)) e.fails.add(UNIT(o));
  }
  const environments = [...env.values()].map((e) => ({ runtime: e.runtime, os: e.os, owners: e.owners.size, failures: e.fails.size }));
  const your_env_tested = q.env ? environments.some((e) => e.runtime === `${q.env!.runtime} ${q.env!.runtime_version.split(".")[0]}`) : null;

  let verdict: Report["verdict"] = "insufficient_evidence";
  if (causal.owners >= MIN_CAUSAL) {
    verdict = causal.failures === 0 ? "likely_safe" : causal.failures === causal.owners ? "known_regression" : "mixed";
  } else if (causal.failures >= 1) {
    verdict = "known_regression"; // one reproduced paired regression is worth showing even alone; n is displayed
  } else if (observational.owners >= MIN_OBSERVATIONAL && observational.ci90) {
    verdict = observational.ci90[0] > 0.5 ? "mixed" : observational.ci90[1] < 0.2 ? "likely_safe" : "insufficient_evidence";
  }
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const describe = (e: Estimate, what: string) => (e.owners ? `${what}: ${e.failures} of ${e.owners} owners failed (estimate ${pct(e.mean!)}, 90% interval ${pct(e.ci90![0])}–${pct(e.ci90![1])})` : `${what}: none`);
  const summary = [
    match === "none" ? "No other project has reported this update yet." : `Match: ${match.replace("_", " ")}.`,
    describe(causal, "Paired experiments (baseline vs update, same runner)"),
    describe(observational, "CI status only (cannot separate the update from a red main or flaky tests)"),
    inconclusive ? `${inconclusive} owners inconclusive (baseline already red or flaky).` : "",
  ].filter(Boolean).join(" ");
  return {
    query: q, match, causal, observational, inconclusive,
    fingerprints: [...fp.entries()].map(([signature, s]) => ({ signature, owners: s.size })).sort((a, b) => b.owners - a.owners).slice(0, 5),
    environments, your_env_tested,
    evidence: hits.slice(0, 20).map((o) => ({ attribution: o.attribution, date: o.observed_at.slice(0, 10), ...(o.provenance.source_url ? { source: o.provenance.source_url } : {}), ...(o.env ? { env: `${o.env.runtime} ${o.env.runtime_version} ${o.env.os}` } : {}) })),
    verdict, summary,
  };
}
