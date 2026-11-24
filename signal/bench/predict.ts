// THE critical benchmark: do other projects' earlier upgrade outcomes predict an unseen project's outcome?
//  - temporal: evidence for a test PR = observations created strictly before it
//  - project holdout: the test PR's own owner is excluded from the network evidence (it may use its OWN history
//    only in the "local" baselines, which is exactly what a team has without any network)
//  - no fixes or later outcomes of the test PR are visible
// Compared against: base rate, semver-major, the repository's own history, package base rate, Mend Merge
// Confidence (public badge) and Dependabot's compatibility score (public badge).
// Usage: node signal/bench/predict.ts <seed observations.json> <prs jsonl...> -- <indicators.json> <out.json> [split ISO date]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildIndex, query, ownerOf } from "../engine.ts";
import { bumpKind, type Observation } from "../protocol.ts";
import { loadPrs, weightsFrom, type PrRecord } from "../seed/build-seed.ts";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const [seedFile, ...prFiles] = args.slice(0, sep);
const [indFile, outFile, split = "2026-10-15"] = args.slice(sep + 1);
const obs: Observation[] = JSON.parse(readFileSync(seedFile, "utf8")).observations;
const prs = loadPrs(prFiles);
const ind: Record<string, { mend?: string; dependabot?: number | null }> = existsSync(indFile) ? JSON.parse(readFileSync(indFile, "utf8")) : {};
const byUrl = new Map(obs.map((o) => [o.provenance.source_url!, o]));
const index = buildIndex(obs);

// Sampling weights: each stratum (package x week x CI status) returned at most 100 of `total` PRs, so a PR
// stands for total/returned PRs. This restores the real failure share and the real mix across strata.
const totalsFiles = (process.env.TOTALS ?? "").split(",").filter(Boolean);
if (!totalsFiles.length) throw new Error("TOTALS=<totals.json,...> is required (stratum sizes); refusing to assume weight 1");
const weight = weightsFrom(totalsFiles);
/** Within a stratum the sample is the NEWEST 100 PRs, so intra-week timing differs between failure and success
 *  samples. Evidence for a test PR is therefore cut at the START of its week: no feature can see that timing. */
const weekStart = (p: PrRecord) => (p.stratum ? p.stratum.split("|").at(-2)! : p.created_at.slice(0, 10));
/** A package-week is COMPLETE when both its failure and success strata were fully returned (total <= 100): no
 *  sampling inside it, so evidence from earlier the same week can be used without timing bias. */
const totalsAll: Record<string, { total: number; returned: number }> = Object.assign({}, ...totalsFiles.map((f) => JSON.parse(readFileSync(f, "utf8"))));
const completeWeek = (p: PrRecord) => {
  if (!p.stratum) return false;
  const [pkg, wk] = p.stratum.split("|");
  return ["failure", "success"].every((st) => { const t = totalsAll[`${pkg}|${wk}|${st}`]; return t && t.total === t.returned; });
};
let EXACT_TIME = false;

const byRepo = new Map<string, PrRecord[]>();
for (const p of prs) (byRepo.get(p.repo) ?? byRepo.set(p.repo, []).get(p.repo)!).push(p);
for (const l of byRepo.values()) l.sort((a, b) => a.created_at.localeCompare(b.created_at));

interface Row { pr: PrRecord; y: number; w: number; f: Record<string, number | null>; covered: number; verdict: string }

function features(p: PrRecord): Row {
  const owner = `gh:${p.repo.split("/")[0].toLowerCase()}`;
  const cut = EXACT_TIME ? p.created_at : weekStart(p);
  const r = query(index, { ecosystem: p.ecosystem, package: p.package, from: p.from, to: p.to, before: cut, excludeOwner: owner });
  const own = (byRepo.get(p.repo) ?? []).filter((x) => x.created_at < cut);
  const ownF = own.filter((x) => x.ci === "failure").length;
  const pkgPool = (index.byPackage.get(`${p.ecosystem}:${p.package.toLowerCase()}`) ?? []).filter((o) => o.observed_at < cut && ownerOf(o) !== owner);
  const pkgF = pkgPool.filter((o) => o.attribution === "observational_fail").length;
  const i = ind[`${p.ecosystem}|${p.package}|${p.from}|${p.to}`] ?? {};
  const mendScore = i.mend === undefined ? null : ({ low: 1, neutral: 0.5, high: 0.2, "very high": 0 } as Record<string, number>)[i.mend] ?? null;
  return {
    pr: p, y: p.ci === "failure" ? 1 : 0, w: weight(p),
    covered: r.observational.owners,
    verdict: r.verdict,
    f: {
      network: r.observational.mean ?? r.observational.prior.mean,
      network_exact_only: r.match === "exact" ? r.observational.mean : null,
      own_history: own.length ? (ownF + 0.5) / (own.length + 1) : null,
      own_n: own.length,
      semver_major: bumpKind(p.from, p.to) === "major" ? 1 : 0,
      package_base: pkgPool.length ? (pkgF + 0.5) / (pkgPool.length + 1) : null,
      mend: mendScore,
      dependabot: i.dependabot === undefined || i.dependabot === null ? null : 1 - i.dependabot / 100,
    },
  };
}

// ---------- metrics ----------
/** Weighted ROC AUC: P(score of a failure > score of a pass), pairs weighted by sampling weights, ties = 1/2. */
function auc(rows: { s: number; y: number; w?: number }[]): number | null {
  const all = [...rows].sort((a, b) => a.s - b.s);
  let negBelow = 0, num = 0, P = 0, N = 0;
  for (let i = 0; i < all.length; ) {
    let j = i, tp = 0, tn = 0;
    while (j < all.length && all[j].s === all[i].s) { const w = all[j].w ?? 1; if (all[j].y) tp += w; else tn += w; j++; }
    num += tp * (negBelow + tn / 2);
    negBelow += tn; P += tp; N += tn; i = j;
  }
  return P && N ? num / (P * N) : null;
}
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Bootstrap clustered by OWNER (rows of one owner are resampled together), B = 1000, 90% percentile interval. */
function clusterBoot<T extends { owner: string }>(rows: T[], stat: (s: T[]) => number | null, B = 1000): [number, number] | null {
  const groups = new Map<string, T[]>();
  for (const r of rows) (groups.get(r.owner) ?? groups.set(r.owner, []).get(r.owner)!).push(r);
  const g = [...groups.values()];
  if (g.length < 20) return null;
  const rnd = mulberry32(12345);
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const s: T[] = [];
    for (let i = 0; i < g.length; i++) s.push(...g[Math.floor(rnd() * g.length)]);
    const v = stat(s);
    if (v !== null) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(0.05 * vals.length)], vals[Math.floor(0.95 * vals.length)]];
}
function bootstrapAuc(rows: { s: number; y: number; w?: number; owner?: string }[]): [number, number] | null {
  return clusterBoot(rows.map((r) => ({ ...r, owner: r.owner ?? Math.random().toString() })), (s) => auc(s));
}
function brier(rows: { s: number; y: number; w: number }[]) {
  const W = rows.reduce((a, r) => a + r.w, 0);
  return rows.reduce((a, r) => a + r.w * (r.s - r.y) ** 2, 0) / W;
}
function calibration(rows: { s: number; y: number; w: number }[]) {
  const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  return bins.slice(0, -1).map((lo, i) => {
    const b = rows.filter((r) => r.s >= lo && r.s < bins[i + 1]);
    const W = b.reduce((a, r) => a + r.w, 0);
    return { bin: `${lo.toFixed(1)}-${Math.min(1, bins[i + 1]).toFixed(1)}`, n: b.length, predicted: W ? b.reduce((a, r) => a + r.w * r.s, 0) / W : null, observed: W ? b.reduce((a, r) => a + r.w * r.y, 0) / W : null };
  });
}
function warnings(rows: Row[], warn: (r: Row) => boolean) {
  let tp = 0, fp = 0, fn = 0, n = 0;
  for (const r of rows) {
    const k = warn(r);
    n += r.w;
    if (k && r.y) tp += r.w; else if (k && !r.y) fp += r.w; else if (!k && r.y) fn += r.w;
  }
  return { warned_share: (tp + fp) / n, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, false_warnings_per_100_upgrades: (100 * fp) / n };
}

// ---------- logistic regression (local baseline vs local + network) ----------
function fit(X: number[][], y: number[], w: number[], iters = 3000, lr = 0.5, l2 = 1e-3): number[] {
  const d = X[0].length;
  const b = new Array(d).fill(0);
  const W = w.reduce((a, x) => a + x, 0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((a, x, k) => a + x * b[k], 0);
      const p = 1 / (1 + Math.exp(-z));
      for (let k = 0; k < d; k++) g[k] += (w[i] * (p - y[i]) * X[i][k]) / W;
    }
    for (let k = 0; k < d; k++) b[k] -= lr * (g[k] + l2 * b[k]);
  }
  return b;
}
const logit = (p: number) => Math.log(Math.min(0.99, Math.max(0.01, p)) / (1 - Math.min(0.99, Math.max(0.01, p))));
const design = (r: Row, withNet: boolean, base: number) => [1, logit(r.f.own_history ?? base), Math.log1p(r.f.own_n ?? 0), r.f.semver_major ?? 0, ...(withNet ? [logit(r.f.network ?? base)] : [])];

// ---------- run ----------
const rows = prs.filter((p) => byUrl.has(p.url)).map(features);
const train = rows.filter((r) => r.pr.created_at < split);
const test = rows.filter((r) => r.pr.created_at >= split);
const base = train.reduce((a, r) => a + r.w * r.y, 0) / train.reduce((a, r) => a + r.w, 0);

const result: any = {
  split, n_total: rows.length, n_train: train.length, n_test: test.length,
  test_failure_share_sampled: test.filter((r) => r.y).length / test.length,
  test_failure_share_weighted: test.reduce((a, r) => a + r.w * r.y, 0) / test.reduce((a, r) => a + r.w, 0),
  owners: new Set(rows.map((r) => r.pr.repo.split("/")[0])).size, repositories: new Set(rows.map((r) => r.pr.repo)).size,
  coverage: {
    any_other_owner: test.filter((r) => r.covered > 0).length / test.length,
    "5+_other_owners": test.filter((r) => r.covered >= 5).length / test.length,
    exact_transition: test.filter((r) => r.f.network_exact_only !== null).length / test.length,
    mend_badge: test.filter((r) => r.f.mend !== null).length / test.length,
    dependabot_score: test.filter((r) => r.f.dependabot !== null).length / test.length,
    own_history: test.filter((r) => (r.f.own_n ?? 0) > 0).length / test.length,
  },
  auc: {} as Record<string, unknown>,
};
for (const k of ["network", "network_exact_only", "own_history", "semver_major", "package_base", "mend", "dependabot"]) {
  const sub = test.filter((r) => r.f[k] !== null).map((r) => ({ s: r.f[k] as number, y: r.y, w: r.w, owner: r.pr.repo.split("/")[0] }));
  result.auc[k] = { n: sub.length, auc: auc(sub), ci90: bootstrapAuc(sub) };
}
// head-to-head on the SAME rows (only rows where every indicator exists)
const both = test.filter((r) => r.f.mend !== null && r.f.dependabot !== null && r.f.own_history !== null);
result.head_to_head = { n: both.length, ...Object.fromEntries(["network", "own_history", "mend", "dependabot", "semver_major"].map((k) => [k, auc(both.map((r) => ({ s: r.f[k] as number, y: r.y, w: r.w })))])) };

const Xtr = train.map((r) => design(r, false, base)), Xtr2 = train.map((r) => design(r, true, base));
const y = train.map((r) => r.y), w = train.map((r) => r.w);
const b1 = fit(Xtr, y, w), b2 = fit(Xtr2, y, w);
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const p1 = test.map((r) => sig(design(r, false, base).reduce((a, x, k) => a + x * b1[k], 0)));
const p2 = test.map((r) => sig(design(r, true, base).reduce((a, x, k) => a + x * b2[k], 0)));
result.models = {
  local_only: { features: "own history + its size + semver major", auc: auc(test.map((r, i) => ({ s: p1[i], y: r.y, w: r.w }))), ci90: bootstrapAuc(test.map((r, i) => ({ s: p1[i], y: r.y, w: r.w, owner: r.pr.repo.split("/")[0] }))), brier: brier(test.map((r, i) => ({ s: p1[i], y: r.y, w: r.w }))) },
  local_plus_network: { features: "+ network estimate (other owners, earlier only)", auc: auc(test.map((r, i) => ({ s: p2[i], y: r.y, w: r.w }))), ci90: bootstrapAuc(test.map((r, i) => ({ s: p2[i], y: r.y, w: r.w, owner: r.pr.repo.split("/")[0] }))), brier: brier(test.map((r, i) => ({ s: p2[i], y: r.y, w: r.w }))), coefficients: b2 },
};
// paired, owner-clustered bootstrap of the AUC gain from adding the network
{
  const rows = test.map((r, i) => ({ owner: r.pr.repo.split("/")[0], a: { s: p1[i], y: r.y, w: r.w }, b: { s: p2[i], y: r.y, w: r.w } }));
  result.models.network_auc_gain_ci90 = clusterBoot(rows, (s) => { const a1 = auc(s.map((x) => x.a)), a2 = auc(s.map((x) => x.b)); return a1 === null || a2 === null ? null : a2 - a1; });
}
result.calibration_network = calibration(test.map((r) => ({ s: r.f.network as number, y: r.y, w: r.w })));
result.brier = { network: brier(test.map((r) => ({ s: r.f.network as number, y: r.y, w: r.w }))), base_rate: brier(test.map((r) => ({ s: base, y: r.y, w: r.w }))) };
result.warnings = {
  network_verdict: warnings(test, (r) => r.verdict === "known_regression" || r.verdict === "mixed"),
  network_estimate_over_50: warnings(test, (r) => (r.f.network as number) > 0.5),
  mend_low: warnings(test.filter((r) => r.f.mend !== null), (r) => r.f.mend === 1),
  dependabot_under_80: warnings(test.filter((r) => r.f.dependabot !== null), (r) => (r.f.dependabot as number) > 0.2),
  own_history_over_50: warnings(test.filter((r) => r.f.own_history !== null), (r) => (r.f.own_history as number) > 0.5),
  semver_major: warnings(test, (r) => r.f.semver_major === 1),
};
// Same-week evidence, only on complete package-weeks (no sampling inside them), exact time cutoff.
{
  EXACT_TIME = true;
  const sub = rows.filter((r) => r.pr.created_at >= split && completeWeek(r.pr)).map((r) => features(r.pr));
  EXACT_TIME = false;
  result.same_week_complete_strata = {
    n: sub.length, failures: sub.filter((r) => r.y).length,
    coverage_any_other_owner_same_target: sub.filter((r) => r.f.network_exact_only !== null || r.covered > 0).length / Math.max(1, sub.length),
    auc: Object.fromEntries(["network", "own_history", "semver_major", "package_base"].map((k) => { const x = sub.filter((r) => r.f[k] !== null).map((r) => ({ s: r.f[k] as number, y: r.y, w: r.w, owner: r.pr.repo.split("/")[0] })); return [k, { n: x.length, auc: auc(x), ci90: bootstrapAuc(x) }]; })),
  };
}
writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ same_week: result.same_week_complete_strata, n_test: result.n_test, coverage: result.coverage, auc: Object.fromEntries(Object.entries(result.auc).map(([k, v]: any) => [k, v.auc?.toFixed(3)])), head_to_head: result.head_to_head, models: { local: result.models.local_only.auc, plus_network: result.models.local_plus_network.auc, gain_ci90: result.models.network_auc_gain_ci90 } }, null, 1));
