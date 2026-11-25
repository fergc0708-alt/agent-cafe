// Pre-registered analysis (frozen with the protocol; see bench/PROTOCOL.md). Deterministic: same inputs, same output.
//   node bench/analyze.mjs <cases.json> <results-dir> <out-dir>
// results-dir holds one folder per artifact: res-<mode>-<case-id>/result.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------- statistics
function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }
function lgamma(z) { // Lanczos
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m; let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}
function ibeta(x, a, b) { // regularized incomplete beta
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
function betaInv(p, a, b) { let lo = 0, hi = 1; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (ibeta(m, a, b) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
/** Clopper-Pearson exact interval, two-sided 95%; plus the one-sided 95% upper bound. */
export function cp(k, n) {
  if (!n) return { k, n, p: null, lo: null, hi: null, upper95: null };
  const lo = k === 0 ? 0 : betaInv(0.025, k, n - k + 1);
  const hi = k === n ? 1 : betaInv(0.975, k + 1, n - k);
  const upper95 = k === n ? 1 : betaInv(0.95, k + 1, n - k);
  return { k, n, p: k / n, lo, hi, upper95 };
}

// ---------------------------------------------------------------- reference truth (PROTOCOL.md §4)
export const POS = ["REG_GREEN", "REG_ON_RED", "REG_FLAKY_BASE"];
export const NEG = ["COMPATIBLE", "PRE_EXISTING", "FIXED", "FLAKY_NOT_UPDATE"];

function side(r) {
  if (!r) return { state: "missing" };
  if (r.env_failure || (r.errors ?? []).some((e) => /^source:/.test(e))) return { state: "env" };
  if (r.install_ok === false) return { state: "install_failed" };
  const runs = r.runs ?? [];
  if (runs.some((x) => x.timed_out) || runs.length < 3) return { state: "incomplete", runs: runs.length };
  const n = runs.length, passes = runs.filter((x) => x.exit === 0).length;
  // per-test evidence only if every run produced a report, and every failing run names at least one failing test
  const perTest = !!r.per_test && runs.every((x) => x.json_ok && Array.isArray(x.tests)) && runs.every((x) => x.exit === 0 || x.tests.some((t) => t.status === "failed"));
  return { state: "ok", n, passes, perTest, runs };
}

export function truth(base, head) {
  const B = side(base), H = side(head);
  const res = (cls, extra = {}) => ({ cls, baseline: B.state === "ok" ? (B.passes === B.n ? "green" : B.passes === 0 ? "red" : "flaky") : "unknown", ...extra });
  if (B.state === "missing" || H.state === "missing") return res("INDET_MISSING");
  if (B.state === "env" || H.state === "env") return res("INDET_ENV");
  if (B.state === "install_failed") return res("INDET_BASE_INSTALL");
  if (H.state === "install_failed") return res("INSTALL_REG");
  if (B.state !== "ok" || H.state !== "ok") return res("INDET_TIMEOUT");
  const bGreen = B.passes === B.n, bRed = B.passes === 0, hGreen = H.passes === H.n, hRed = H.passes === 0;
  if (B.perTest && H.perTest) {
    const stat = (runs) => {
      const m = new Map();
      for (const r of runs) for (const t of r.tests) {
        const e = m.get(t.id) ?? { fail: 0, pass: 0, msgs: new Set() };
        if (t.status === "failed") { e.fail++; e.msgs.add(t.message ?? ""); } else if (t.status === "passed") e.pass++;
        m.set(t.id, e);
      }
      return m;
    };
    const bs = stat(B.runs), hs = stat(H.runs);
    const passedAllBase = (id) => (bs.get(id)?.pass ?? 0) === B.n;
    const newStable = [...hs].filter(([id, e]) => e.fail === H.n && passedAllBase(id)).map(([id]) => id);
    const newFlaky = [...hs].filter(([id, e]) => e.fail > 0 && e.fail < H.n && passedAllBase(id)).map(([id]) => id);
    const persistent = [...hs].filter(([id, e]) => e.fail === H.n && (bs.get(id)?.fail ?? 0) === B.n).map(([id]) => id);
    const changed = persistent.filter((id) => { const a = bs.get(id).msgs, b = hs.get(id).msgs; return a.size === 1 && b.size === 1 && [...a][0] !== [...b][0]; });
    const flakyTests = [...new Set([...[...bs].filter(([, e]) => e.fail > 0 && e.pass > 0).map(([id]) => id), ...[...hs].filter(([, e]) => e.fail > 0 && e.pass > 0).map(([id]) => id)])];
    const detail = { perTest: true, newStable, newFlaky, persistent, changed, flakyTests };
    if (newStable.length) return res(bGreen ? "REG_GREEN" : bRed ? "REG_ON_RED" : "REG_FLAKY_BASE", detail);
    if (newFlaky.length) return res("INDET_FLAKY_NEW", detail);
    if (bGreen && hGreen) return res("COMPATIBLE", detail);
    if (changed.length) return res("CHANGED", detail);
    if (bRed && hRed) return res("PRE_EXISTING", detail);
    if (bRed && hGreen) return res("FIXED", detail);
    if (bGreen && !hGreen) return res("INDET_OTHER", detail); // head fails but no test can be matched to the base
    if (!bGreen || !hGreen) return res("FLAKY_NOT_UPDATE", detail);
    return res("INDET_OTHER", detail);
  }
  const detail = { perTest: false };
  if (bGreen && hGreen) return res("COMPATIBLE", detail);
  if (bGreen && hRed) return res("REG_GREEN", detail);
  if (bRed && hGreen) return res("FIXED", detail);
  if (bGreen) return res("INDET_FLAKY_NEW", detail);
  if (bRed && hRed) return res("INDET_RED_NO_TESTS", detail);
  if (hGreen) return res("FLAKY_NOT_UPDATE", detail);
  return res("INDET_FLAKY", detail);
}

// ---------------------------------------------------------------- tool decisions
export const ACCUSE = "accuse", EXONERATE = "exonerate", ABSTAIN = "abstain";
export function signalDecision(r) {
  const v = r?.signal?.verdict;
  if (!v) return { d: ABSTAIN, v: r ? (r.signal_timed_out ? "timeout" : "no-result") : "missing" };
  if (v === "regression" || v === "regression_on_red") return { d: ACCUSE, v };
  if (v === "pre_existing" || v === "compatible" || v === "flaky") return { d: EXONERATE, v };
  return { d: ABSTAIN, v };
}
export function lastgreenDecision(r) {
  const s = r?.lastgreen?.status;
  if (!s) return { d: ABSTAIN, v: r ? (r.not_applicable ? "n/a" : r.lastgreen_timed_out ? "timeout" : "no-result") : "missing" };
  if (s === "found") return { d: ACCUSE, v: s };
  if (s === "not-in-env" || s === "not-reproduced" || s === "flaky" || s === "green") return { d: EXONERATE, v: s };
  return { d: ABSTAIN, v: s }; // budget, nothing-testable, no-changes, diff, …
}
/** Naive comparators from the frozen CI snapshot (no execution). */
export function naiveAlways(c) { return c.ci_head?.state === "red" ? { d: ACCUSE, v: "ci-red" } : { d: EXONERATE, v: "ci-not-red" }; }
export function naiveBaseCi(c) {
  if (c.ci_head?.state !== "red") return { d: EXONERATE, v: "ci-not-red" };
  return c.ci_base?.state === "red" ? { d: EXONERATE, v: "base-ci-red" } : { d: ACCUSE, v: `base-ci-${c.ci_base?.state ?? "unknown"}` };
}
const EXPECTED = { REG_GREEN: ["regression"], REG_ON_RED: ["regression_on_red"], REG_FLAKY_BASE: ["regression", "regression_on_red"], PRE_EXISTING: ["pre_existing"], COMPATIBLE: ["compatible"], FIXED: ["compatible"], FLAKY_NOT_UPDATE: ["flaky", "pre_existing", "compatible"], CHANGED: ["regression_on_red"] };

// ---------------------------------------------------------------- metrics
function metrics(rows, pick) {
  const pos = rows.filter((r) => POS.includes(r.truth.cls));
  const neg = rows.filter((r) => NEG.includes(r.truth.cls));
  const det = rows.filter((r) => POS.includes(r.truth.cls) || NEG.includes(r.truth.cls) || r.truth.cls === "CHANGED");
  const d = (r) => pick(r).d;
  return {
    determinate: det.length,
    positives: pos.length, negatives: neg.length,
    false_exoneration: cp(pos.filter((r) => d(r) === EXONERATE).length, pos.length),
    false_exoneration_among_conclusive: cp(pos.filter((r) => d(r) === EXONERATE).length, pos.filter((r) => d(r) !== ABSTAIN).length),
    abstain_on_positives: cp(pos.filter((r) => d(r) === ABSTAIN).length, pos.length),
    detected_positives: cp(pos.filter((r) => d(r) === ACCUSE).length, pos.length),
    false_accusation: cp(neg.filter((r) => d(r) === ACCUSE).length, neg.length),
    abstain_on_negatives: cp(neg.filter((r) => d(r) === ABSTAIN).length, neg.length),
    coverage: cp(det.filter((r) => d(r) !== ABSTAIN).length, det.length),
  };
}

export function analyze(cases, results) {
  const get = (mode, id) => results[`res-${mode}-${id}`] ?? null;
  const rows = cases.map((c) => {
    const t = truth(get("ref-base", c.id), get("ref-head", c.id));
    const s = get("signal", c.id), l = get("lastgreen", c.id);
    return {
      id: c.id, repo: c.repo, number: c.number, url: c.url, bot: c.bot, stratum: c.stratum, pm: c.pm, ci_head: c.ci_head?.state, ci_base: c.ci_base?.state,
      truth: t, signal: signalDecision(s), signal_detail: s?.signal ?? null, signal_ms: s?.elapsed_ms ?? null,
      lastgreen: c.pm === "npm" ? lastgreenDecision(l) : { d: ABSTAIN, v: "n/a" }, lastgreen_ms: l?.elapsed_ms ?? null,
      naive_always: naiveAlways(c), naive_base_ci: naiveBaseCi(c),
      expected: EXPECTED[t.cls] ?? null,
    };
  });
  const tools = { signal: (r) => r.signal, lastgreen: (r) => r.lastgreen, naive_always: (r) => r.naive_always, naive_base_ci: (r) => r.naive_base_ci };
  const seg = (name, f) => ({ name, n: rows.filter(f).length, ...Object.fromEntries(Object.entries(tools).map(([k, p]) => [k, metrics(rows.filter(f), p)])) });
  const npm = (r) => r.pm === "npm";
  const segments = [
    seg("all", () => true),
    seg("baseline green", (r) => r.truth.baseline === "green"),
    seg("baseline red", (r) => r.truth.baseline === "red"),
    seg("baseline flaky", (r) => r.truth.baseline === "flaky"),
    seg("stratum CI red", (r) => r.stratum.endsWith(":red")),
    seg("stratum CI green", (r) => r.stratum.endsWith(":green")),
    seg("renovate", (r) => r.bot === "renovate"),
    seg("dependabot", (r) => r.bot === "dependabot"),
    seg("npm only (lastgreen comparable)", npm),
  ];
  // red baseline: category agreement (the scenario that differentiates Signal)
  const redDet = rows.filter((r) => r.truth.baseline === "red" && ["REG_ON_RED", "PRE_EXISTING", "CHANGED", "FIXED"].includes(r.truth.cls));
  const agree = (r) => r.expected?.includes(r.signal.v);
  const red = {
    n: redDet.length,
    by_class: Object.fromEntries(["REG_ON_RED", "PRE_EXISTING", "CHANGED", "FIXED"].map((k) => [k, redDet.filter((r) => r.truth.cls === k).length])),
    exact_agreement: cp(redDet.filter(agree).length, redDet.length),
    false_exoneration: cp(redDet.filter((r) => r.truth.cls === "REG_ON_RED" && r.signal.d === EXONERATE).length, redDet.filter((r) => r.truth.cls === "REG_ON_RED").length),
    false_accusation: cp(redDet.filter((r) => ["PRE_EXISTING", "FIXED"].includes(r.truth.cls) && r.signal.d === ACCUSE).length, redDet.filter((r) => ["PRE_EXISTING", "FIXED"].includes(r.truth.cls)).length),
    changed_detected: cp(redDet.filter((r) => r.truth.cls === "CHANGED" && r.signal.v === "regression_on_red").length, redDet.filter((r) => r.truth.cls === "CHANGED").length),
  };
  const errors = rows.filter((r) => (POS.includes(r.truth.cls) && r.signal.d === EXONERATE) || (NEG.includes(r.truth.cls) && r.signal.d === ACCUSE) || (r.truth.cls === "CHANGED" && r.signal.d === EXONERATE));
  const classes = {};
  for (const r of rows) classes[r.truth.cls] = (classes[r.truth.cls] ?? 0) + 1;
  // per-test agreement on positives with per-test truth (secondary)
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
  const title = (id) => norm(id.split(" > ").slice(1).join(" > ")); // drop the file part, formats differ
  const perTest = rows.filter((r) => POS.includes(r.truth.cls) && r.truth.perTest && r.signal.v?.startsWith("regression"));
  let tp = 0, fp = 0, fn = 0;
  for (const r of perTest) {
    const truthT = r.truth.newStable.map(title), sig = (r.signal_detail?.newFailures ?? []).map(title);
    const hit = (a, set) => set.some((b) => b && a && (b.endsWith(a) || a.endsWith(b)));
    tp += truthT.filter((t) => hit(t, sig)).length; fn += truthT.filter((t) => !hit(t, sig)).length; fp += sig.filter((s) => !hit(s, truthT)).length;
  }
  const decision = decide(segments[0], red, segments.find((s) => s.name.startsWith("npm only")));
  const ms = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? { n: v.length, median_min: +(v[Math.floor(v.length / 2)] / 60000).toFixed(1), p90_min: +(v[Math.floor(v.length * 0.9)] / 60000).toFixed(1), total_min: +(v.reduce((a, b) => a + b, 0) / 60000).toFixed(0) } : null; };
  return {
    cases: rows.length, classes, segments, red_baseline: red, per_test: { cases: perTest.length, tp, fp, fn, precision: cp(tp, tp + fp), recall: cp(tp, tp + fn) },
    time: { signal: ms(rows.map((r) => r.signal_ms)), lastgreen: ms(rows.map((r) => (r.pm === "npm" ? r.lastgreen_ms : null))) },
    errors: errors.map((r) => ({ id: r.id, url: r.url, truth: r.truth.cls, baseline: r.truth.baseline, signal: r.signal.v, confidence: r.signal_detail?.confidence ?? null, truth_new: r.truth.newStable ?? null, signal_new: r.signal_detail?.newFailures ?? null, reasons: r.signal_detail?.reasons ?? null })),
    decision, rows,
  };
}

// ---------------------------------------------------------------- decision rule (PROTOCOL.md §5), frozen
export function decide(all, red, npmSeg) {
  const s = all.signal, why = [];
  const fe = s.false_exoneration, fa = s.false_accusation, cov = s.coverage;
  const kill = [];
  if (s.positives >= 20 && fe.p > 0.05) kill.push(`false exoneration ${pct(fe.p)} > 5%`);
  if (s.negatives >= 20 && fa.p > 0.15) kill.push(`false accusation ${pct(fa.p)} > 15%`);
  if (cov.n && cov.p < 0.25) kill.push(`coverage ${pct(cov.p)} < 25%`);
  if (red.n >= 10 && red.exact_agreement.p < 0.5) kill.push(`red-baseline agreement ${pct(red.exact_agreement.p)} < 50%`);
  if (red.false_exoneration.k >= 2) kill.push(`${red.false_exoneration.k} false exonerations with a red baseline`);
  if (kill.length) return { verdict: "KILL", why: kill };
  const cont = [];
  cont.push([s.positives >= 20 && fe.upper95 <= 0.10, `≥20 confirmed regressions and false-exoneration upper bound ≤ 10% (n=${s.positives}, upper ${pct(fe.upper95)})`]);
  cont.push([s.negatives >= 20 && fa.upper95 <= 0.15, `≥20 confirmed non-regressions and false-accusation upper bound ≤ 15% (n=${s.negatives}, upper ${pct(fa.upper95)})`]);
  cont.push([cov.n > 0 && cov.p >= 0.5, `coverage ≥ 50% (${pct(cov.p)})`]);
  cont.push([red.n >= 10 && red.exact_agreement.lo >= 0.6 && red.false_exoneration.k === 0, `red baseline: ≥10 determinate cases, agreement lower bound ≥ 60%, no false exoneration (n=${red.n}, lower ${pct(red.exact_agreement.lo)})`]);
  const lg = npmSeg.lastgreen.false_exoneration, sg = npmSeg.signal.false_exoneration;
  cont.push([lg.p == null || sg.p == null || sg.p <= lg.p, `not more false exonerations than lastgreen on the shared npm cases (Signal ${pct(sg.p)}, lastgreen ${pct(lg.p)})`]);
  for (const [ok, text] of cont) why.push(`${ok ? "met" : "NOT met"}: ${text}`);
  return { verdict: cont.every(([ok]) => ok) ? "CONTINUE" : "PIVOT", why };
}
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);

// ---------------------------------------------------------------- CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , CASES, DIR, OUTDIR] = process.argv;
  const cases = JSON.parse(readFileSync(CASES, "utf8"));
  const results = {};
  for (const c of cases) for (const m of ["signal", "ref-base", "ref-head", "lastgreen"]) {
    const f = join(DIR, `res-${m}-${c.id}`, "result.json");
    if (existsSync(f)) { try { results[`res-${m}-${c.id}`] = JSON.parse(readFileSync(f, "utf8")); } catch { results[`res-${m}-${c.id}`] = { errors: ["unreadable result"] }; } }
  }
  const a = analyze(cases, results);
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, "analysis.json"), JSON.stringify(a, null, 1));
  console.log(JSON.stringify({ cases: a.cases, classes: a.classes, decision: a.decision, red: a.red_baseline }, null, 1));
}
