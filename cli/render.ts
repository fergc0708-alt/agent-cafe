// Human output for the terminal (and Markdown for CI summaries). Short, actionable, honest about
// what was and was not tested.
import type { Capsule } from "../core/capsule/capsule.ts";
import type { EnvVerdict, Finding, IndexEntry } from "../core/doctor/match.ts";
import type { DiagnoseReport, DoctorReport } from "./doctor.ts";
import type { Fingerprint } from "./fingerprint.ts";

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = c("31"), yellow = c("33"), green = c("32"), dim = c("2"), bold = c("1"), cyan = c("36");

const ICON: Record<EnvVerdict["status"], string> = {
  affected_fix_fails: red("✖"),
  affected_fix_works: red("✖"),
  fix_breaks: red("!"),
  conflicting: yellow("≠"),
  untested: yellow("?"),
  no_evidence: yellow("?"),
  not_affected: green("✓"),
};

export function envLine(fp: Fingerprint): string {
  const rt = fp.runtimes.map((r) => {
    const extra = r.runtime === "python" ? ` ${r.details.kind}${r.details.distutils === "setuptools-shim" ? ", setuptools distutils shim" : ""}` : "";
    return `${r.runtime} ${r.version}${r.source !== "PATH" ? ` (${r.source})` : ""}${extra ? ` (${extra.trim()})` : ""}`;
  });
  const tz = fp.conditions.TZ ? `TZ ${/^(UTC|Etc\/UTC|GMT)$/i.test(fp.conditions.TZ) ? "UTC" : "local (non-UTC)"}` : "TZ unknown";
  return `${fp.os}-${fp.arch} · ${rt.join(" · ")} · ${tz}`;
}

function verdictLine(v: EnvVerdict): string {
  const label = `${v.env.runtime} ${v.env.version.split(".").slice(0, 2).join(".")} (${v.env.label})`;
  return `${ICON[v.status]} ${label}: ${v.summary}`;
}

function finding(f: Finding, verbose = false): string[] {
  const now = f.verdicts.filter((v) => !v.env.label.startsWith("upgrade"));
  const brokenNow = now.some((v) => v.status === "affected_fix_works" || v.status === "affected_fix_fails");
  void 0;
  const tag = f.scope === "code" ? yellow(bold("CODE ISSUE")) : brokenNow ? red(bold("BROKEN NOW")) : f.verdicts.some((v) => v.status.startsWith("affected")) ? yellow(bold("BREAKS ON UPGRADE")) : f.verdicts.some((v) => v.status === "conflicting") ? yellow(bold("ENVIRONMENT-DEPENDENT")) : yellow(bold("UNTESTED"));
  const out = [`${tag}  ${bold(f.title)}${f.origin === "local" ? dim(" [your private capsule]") : ""}`];
  for (const h of f.hits.slice(0, verbose ? 5 : 3)) out.push(dim(`   ${h.file}:${h.line}  `) + h.text);
  for (const v of f.verdicts.filter((v) => v.status !== "not_affected" || verbose)) out.push(`   ${verdictLine(v)}`);
  const ok = f.verdicts.filter((v) => v.status === "not_affected");
  if (ok.length && !verbose) out.push(dim(`   ${green("✓")} not affected on ${ok.map((v) => `${v.env.runtime} ${v.env.version.split(".").slice(0, 2).join(".")}`).join(", ")}`));
  for (const n of f.notes) out.push(dim(`   note: ${n}`));
  out.push(`   ${cyan("→")} ${f.action}`);
  return out;
}

export function renderDoctor(r: DoctorReport, verbose = false): string {
  const out: string[] = [];
  out.push(bold("Agent Café doctor") + dim(` — known runtime breaks, checked against your code and environment`));
  out.push(`Environment: ${envLine(r.fingerprint)}`);
  out.push(`Checking:    ${r.environments.map((e) => `${e.runtime} ${e.version.split(".").slice(0, 2).join(".")} (${e.label})`).join(", ") || "no runtimes found"}`);
  out.push(dim(`Scanned ${r.scanned_files} files against ${r.rules} known breaking changes. Nothing left this machine.`));
  out.push("");
  for (const n of r.not_evaluated) {
    out.push(`${yellow(bold("NOT EVALUATED"))}  ${bold(n.title)}`);
    for (const h of n.hits.slice(0, 3)) out.push(dim(`   ${h.file}:${h.line}  `) + h.text);
    out.push(`   ${cyan("→")} No ${n.runtime} interpreter was found or could be probed, so this was not checked. Install it or pass --${n.runtime === "node" ? "node" : "python"} <path>.`, "");
  }
  if (!r.findings.length && !r.not_evaluated.length) out.push(green("No known break applies to your code in these environments."));
  for (const f of r.findings) out.push(...finding(f, verbose), "");
  const plain = r.clear.filter((c) => !c.conditional);
  if (plain.length) out.push(green(`✓ ${plain.length} other known break${plain.length === 1 ? "" : "s"} found in your code ${plain.length === 1 ? "does" : "do"} not affect these environments: `) + dim(plain.map((c) => c.slug).join(", ")));
  for (const c of r.clear.filter((c) => c.conditional)) out.push(yellow(`≈ ${c.slug}: not affected HERE, but ${c.conditional}. If your deploy/CI environment differs (e.g. a clean virtualenv), check it with --python <path>.`));
  if (r.fingerprint.missing.length) out.push(dim(`Not determined: ${r.fingerprint.missing.join("; ")}.`));
  out.push(dim(`Evidence: ${r.evidence.verified} runs verified on GitHub-hosted CI (${r.evidence.ci_jobs} jobs) + ${r.evidence.claimed} self-reported, built ${r.evidence.generated_at.slice(0, 10)}. Verified = where it ran, not independent review.`));
  out.push(dim("Details: cafe show <name> · Reproduce here: cafe replay <name> · Machine-readable: --json"));
  return out.join("\n");
}

export function renderDiagnose(r: DiagnoseReport): string {
  const out = [bold(r.matches.length ? r.verdict : "No match"), ""];
  if (!r.matches.length) out.push(r.verdict);
  for (const m of r.matches) {
    out.push(`${bold(m.title)} ${dim(`(${m.slug})`)}`);
    out.push(dim(`   why: ${m.match}`));
    for (const v of m.verdicts) out.push(`   ${verdictLine(v)}`);
    for (const n of m.notes) out.push(dim(`   note: ${n}`));
    out.push(`   ${cyan("→")} ${m.action}`, "");
  }
  for (const x of r.rejected) out.push(dim(`ruled out ${x.slug}: ${x.why}`));
  return out.join("\n");
}

function diff(before: string, after: string): string[] {
  const a = before.split("\n"), b = after.split("\n");
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(dim(`  ${a[i]}`)), i++, j++;
    } else if (i < a.length && !b.slice(j).includes(a[i])) out.push(red(`- ${a[i++]}`));
    else if (j < b.length) out.push(green(`+ ${b[j++]}`));
    else out.push(red(`- ${a[i++]}`));
  }
  return out;
}

export function renderShow(e: IndexEntry, verdicts: EnvVerdict[]): string {
  const cap: Capsule = e.capsule;
  const out = [bold(cap.title), dim(`${e.slug} · ${e.id.slice(0, 12)} · ${cap.runtime} · by ${cap.author}${e.origin === "local" ? " · private, never shared" : ""}`), ""];
  out.push(`${bold("Symptom")}  ${cap.problem.symptom}`, cap.problem.description, "");
  out.push(bold("Fix"));
  for (const p of Object.keys(cap.after.files)) {
    if (cap.before.files[p] === cap.after.files[p]) continue;
    out.push(cyan(`--- ${p}`), ...diff(cap.before.files[p] ?? "", cap.after.files[p]));
  }
  out.push("", `${bold("Check")} ${dim(cap.check.run.join(" "))} — fails on the broken code, passes on the fix`);
  out.push(`${bold("Proves")} ${cap.limitations.proves}`, `${bold("Does not prove")} ${cap.limitations.does_not_prove}`, "");
  out.push(bold("Where it was executed"));
  const byEnv = new Map<string, string[]>();
  for (const r of e.rows) {
    const k = `${r.runtime} ${r.version.split(".").slice(0, 2).join(".")}${Object.keys(r.conditions).length ? ` [${Object.entries(r.conditions).map(([k, v]) => `${k}=${v}`).join(",")}]` : ""}`;
    const v = r.verdict === "PASS" ? `breaks, fix works (${r.mutation.killed}/${r.mutation.total} mutants caught)` : r.verdict === "PROBLEM_NOT_REPRODUCED" ? "not affected" : r.verdict === "FIX_FAILS" ? "breaks, FIX FAILS" : r.verdict === "FIX_BREAKS" ? "works, but the FIX BREAKS it" : r.verdict.toLowerCase();
    byEnv.set(k, [...(byEnv.get(k) ?? []), `${r.trust === "verified" ? green("verified CI") : dim("self-reported")}: ${v}`]);
  }
  if (!byEnv.size) out.push(dim("   never executed by a runner yet"));
  for (const [k, vs] of [...byEnv.entries()].sort()) out.push(`   ${k.padEnd(28)} ${[...new Set(vs)].join(" · ")}`);
  if (verdicts.length) out.push("", bold("For your environment"), ...verdicts.map((v) => `   ${verdictLine(v)}`));
  out.push("", dim(`Claims by the author: ${Object.entries(cap.applicability.claims).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}. Claims are not evidence.`));
  if (cap.problem.refs.length) out.push(dim(`Upstream references (cited, not machine-verified): ${cap.problem.refs.join(" ")}`));
  return out.join("\n");
}

export function markdownDoctor(r: DoctorReport): string {
  const out = ["## Agent Café doctor", "", `**Environment:** ${envLine(r.fingerprint)}  `, `**Checked:** ${r.environments.map((e) => `${e.runtime} ${e.version.split(".").slice(0, 2).join(".")} (${e.label})`).join(", ")}  `, `Scanned ${r.scanned_files} files against ${r.rules} known breaking changes.`, ""];
  for (const n of r.not_evaluated) out.push(`### ❔ Not evaluated (no ${n.runtime} found): ${n.title}`, ...n.hits.slice(0, 3).map((h) => `- \`${h.file}:${h.line}\``), "");
  if (!r.findings.length && !r.not_evaluated.length) out.push("✅ No known break applies to this code in the checked environments.");
  if (r.fingerprint.missing.length) out.push("", `Not determined: ${r.fingerprint.missing.join("; ")}.`);
  for (const f of r.findings) {
    out.push(`### ${f.scope === "code" ? "ℹ️ Code issue (all versions)" : f.verdicts.some((v) => !v.env.label.startsWith("upgrade") && v.status.startsWith("affected")) ? "❌ Broken now" : "⚠️ Breaks on upgrade / untested"}: ${f.title}`);
    for (const h of f.hits.slice(0, 3)) out.push(`- \`${h.file}:${h.line}\` \`${h.text.replace(/`/g, "'")}\``);
    out.push("", "| environment | result |", "|---|---|");
    for (const v of f.verdicts) out.push(`| ${v.env.runtime} ${v.env.version.split(".").slice(0, 2).join(".")} (${v.env.label}) | ${v.status === "not_affected" ? "✅" : v.status.startsWith("affected") ? "❌" : "❔"} ${v.summary.replace(/\|/g, "/")} |`);
    out.push("", `**Action:** ${f.action}`, "");
  }
  for (const c of r.clear.filter((c) => c.conditional)) out.push(`> ⚠️ \`${c.slug}\`: not affected in this job's environment, but ${c.conditional}. A different deploy environment may break.`, "");
  out.push(`<sub>Evidence: ${r.evidence.verified} runs verified on GitHub-hosted CI + ${r.evidence.claimed} self-reported. "Verified" proves where a check ran, not that it was independently reviewed. Untested environments are reported as untested, never as passing.</sub>`);
  return out.join("\n");
}
