// Renders bench/out/analysis.json as Markdown (formatting only; every number comes from analyze.mjs).
//   node bench/report.mjs bench/out/analysis.json > bench/RESULTS.md
import { readFileSync } from "node:fs";
const a = JSON.parse(readFileSync(process.argv[2], "utf8"));
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const ci = (m) => (!m || !m.n ? "— (n=0)" : `${m.k}/${m.n} = ${pct(m.p)} [${pct(m.lo)}–${pct(m.hi)}]; upper 95% ${pct(m.upper95)}`);
const L = [];
L.push("# Signal real-PR benchmark: results", "", `Cases: ${a.cases}. Decision (pre-registered rule): **${a.decision.verdict}**.`, "");
for (const w of a.decision.why) L.push(`- ${w}`);
L.push("", "## Reference truth classes", "", "| class | cases |", "|---|---|");
for (const [k, v] of Object.entries(a.classes).sort((x, y) => y[1] - x[1])) L.push(`| ${k} | ${v} |`);
L.push("", "Positives: REG_GREEN, REG_ON_RED, REG_FLAKY_BASE. Negatives: COMPATIBLE, PRE_EXISTING, FIXED, FLAKY_NOT_UPDATE. INDET_*: no reliable reference, counted neither way.", "");
L.push("## Segments", "", "Intervals: Clopper–Pearson exact 95%; \"upper 95%\" is the one-sided bound.", "");
for (const s of a.segments) {
  L.push(`### ${s.name} (${s.n} cases)`, "", "| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |", "|---|---|---|---|---|---|");
  for (const t of ["signal", "lastgreen", "naive_always", "naive_base_ci"]) {
    const m = s[t];
    L.push(`| ${t} | ${m.determinate} (${m.positives} pos / ${m.negatives} neg) | ${ci(m.false_exoneration)} | ${ci(m.false_accusation)} | ${ci(m.abstain_on_positives)} | ${ci(m.coverage)} |`);
  }
  L.push("");
}
const r = a.red_baseline;
L.push("## Red baseline (Signal's differentiating scenario)", "", `Determinate red-baseline cases: ${r.n} (${Object.entries(r.by_class).map(([k, v]) => `${k} ${v}`).join(", ")}).`, "",
  `- Exact verdict agreement: ${ci(r.exact_agreement)}`, `- False exonerations: ${ci(r.false_exoneration)}`, `- False accusations: ${ci(r.false_accusation)}`, `- "Fails differently" detected: ${ci(r.changed_detected)}`, "");
const p = a.per_test;
L.push("## Per-test agreement (secondary)", "", `${p.cases} positives with per-test evidence where Signal accused the update: TP ${p.tp}, FP ${p.fp}, FN ${p.fn}; precision ${ci(p.precision)}; recall ${ci(p.recall)}.`, "");
L.push("## Attribution errors (every one)", "");
if (!a.errors.length) L.push("None.");
else {
  L.push("| case | truth | baseline | Signal | confidence | new failing tests (reference) | Signal's new failures |", "|---|---|---|---|---|---|---|");
  for (const e of a.errors) L.push(`| [${e.id}](${e.url}) | ${e.truth} | ${e.baseline} | ${e.signal} | ${e.confidence ?? "—"} | ${(e.truth_new ?? []).slice(0, 3).join("; ").replace(/\|/g, "¦") || "—"} | ${(e.signal_new ?? []).slice(0, 3).join("; ").replace(/\|/g, "¦") || "—"} |`);
}
L.push("", "## Time", "", `Signal job (minutes): ${JSON.stringify(a.time.signal)}. lastgreen job: ${JSON.stringify(a.time.lastgreen)}.`, "");
console.log(L.join("\n"));
