import { bumpKind, shape } from "./protocol.js";
export const md = (s) => String(s).replace(/[\\`*_{}[\]()#+!|<>~]/g, (c) => `\\${c}`).replace(/\s+/g, " ").trim();
const code = (s) => "`" + String(s).replace(/`/g, "ˋ").replace(/\s+/g, " ").slice(0, 200) + "`";
/** Changelog/compare links from the npm registry (best effort, 4 s timeout, only github.com URLs kept). */
export async function packageLinks(changes, offline = false) {
    const out = {};
    for (const c of changes.slice(0, 6)) {
        if (c.ecosystem !== "npm")
            continue;
        const npm = `https://www.npmjs.com/package/${c.package}`;
        out[c.package] = { npm };
        if (offline)
            continue;
        try {
            const ctl = AbortSignal.timeout(4000);
            const r = await fetch(`https://registry.npmjs.org/${c.package.replace("/", "%2f")}/${encodeURIComponent(c.to ?? "latest")}`, { signal: ctl, headers: { accept: "application/json" } });
            if (!r.ok)
                continue;
            const j = await r.json();
            const raw = typeof j.repository === "string" ? j.repository : j.repository?.url ?? "";
            const m = String(raw).match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#|$|\/)/);
            if (!m)
                continue;
            const repo = `https://github.com/${m[1]}/${m[2]}`;
            out[c.package] = { npm, repo, releases: `${repo}/releases`, ...(c.from && c.to ? { compare: `${repo}/compare/v${c.from}...v${c.to}` } : {}) };
        }
        catch { /* offline or slow: links are optional */ }
    }
    return out;
}
const HEAD = {
    regression: "❌ The update breaks tests that pass without it",
    regression_on_red: "❌ The update breaks more tests (the base branch was already red)",
    pre_existing: "⚪ Not caused by the update: these tests already fail without it",
    flaky: "🟡 Flaky: identical runs gave different results",
    compatible: "✅ Compatible: the tests pass with the update",
    inconclusive: "❔ Inconclusive: the comparison could not be made reliably",
};
const mins = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1)} min`);
const ch = (c) => `${c.package} ${c.from ?? "(new)"} → ${c.to ?? "(removed)"}`;
export function renderMarkdown(d, links = {}, opts = {}) {
    const msg = (m) => (opts.redact ? shape(m) || "(message hidden)" : m);
    const L = [];
    const n = d.delta.direct.length || d.delta.changes.length;
    const subject = d.delta.primary ? ch(d.delta.primary) : `${n} dependency update${n === 1 ? "" : "s"}`;
    const culprit = d.isolation?.status === "single" ? d.isolation.culprits[0] : d.verdict.startsWith("regression") && d.delta.direct.length === 1 ? d.delta.direct[0] : null;
    const tests = d.newFailures.length ? `${d.newFailures.length} test${d.newFailures.length > 1 ? "s" : ""}` : "the tests";
    const headline = culprit && d.verdict.startsWith("regression")
        ? `❌ ${md(ch(culprit))} breaks ${tests}${d.verdict === "regression_on_red" ? " (the base branch was already red)" : ""}`
        : HEAD[d.verdict];
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    L.push(`## Signal · ${md(subject)}`, "");
    L.push(`### ${headline}`, "");
    if (d.isolation?.status === "single" && d.isolation.confirmed.necessary && n > 1) {
        L.push(`The other ${n - 1} update${n > 2 ? "s" : ""} pass the tests once ${md(culprit.package)} is reverted, so ${n > 2 ? "they" : "it"} can be merged on ${n > 2 ? "their" : "its"} own.`, "");
    }
    L.push(`**Merge:** ${md(d.merge)}  `, `**Next step:** ${md(d.next)}`, "");
    L.push(`**Confidence: ${d.confidence}.** ${d.reasons.map((r) => md(cap(r))).join(". ")}.`, "");
    if (d.isolation && d.isolation.status !== "not_needed") {
        const iso = d.isolation;
        const title = { single: "Responsible update (confirmed both ways)", interaction: "Updates that only fail together", not_direct: "Not caused by the declared updates", inconclusive: "Responsible update: not isolated", not_needed: "" }[iso.status];
        L.push(`#### ${title}`, "");
        if (iso.culprits.length && (iso.status === "single" || iso.status === "interaction"))
            L.push(...iso.culprits.map((c) => `- **${md(ch(c))}**${links[c.package]?.compare ? ` · [changes](${links[c.package].compare}) · [releases](${links[c.package].releases})` : ""}`));
        L.push("", md(iso.reason) + ".", "");
        if (iso.probes.length) {
            L.push("<details><summary>Isolation runs (" + iso.probes.length + ")</summary>", "", "| starting from | applied | result |", "|---|---|---|");
            for (const p of iso.probes)
                L.push(`| ${p.side === "baseline" ? "old dependencies" : "the update"} | ${md(p.apply.join(", ") || "—")} | ${p.outcome.replace("_", " ")}${p.note ? ` (${md(p.note)})` : ""} |`);
            L.push("", "</details>", "");
        }
    }
    if (d.newFailures.length) {
        L.push(`#### Tests that fail only with the update (${d.newFailures.length})`, "");
        for (const f of d.newFailures.slice(0, 10))
            L.push(`- ${code(f.id)}${f.message ? `  \n  ${code(msg(f.message))}` : ""}`);
        if (d.newFailures.length > 10)
            L.push(`- … and ${d.newFailures.length - 10} more`);
        L.push("");
    }
    if (d.preExisting.length) {
        L.push(`#### Already failing without the update (${d.preExisting.length})`, "");
        for (const f of d.preExisting.slice(0, 5))
            L.push(`- ${code(f.id)}`);
        if (d.preExisting.length > 5)
            L.push(`- … and ${d.preExisting.length - 5} more`);
        L.push("");
    }
    if (d.flipped.length)
        L.push(`Results that changed between identical runs: ${d.flipped.slice(0, 5).map(code).join(", ")}`, "");
    const direct = d.delta.direct.length ? d.delta.direct : d.delta.changes.slice(0, 10);
    L.push("#### What the PR changes", "", "| package | from | to | jump | links |", "|---|---|---|---|---|");
    for (const c of direct.slice(0, 15)) {
        const l = links[c.package];
        const linkCell = l ? [l.compare && `[diff](${l.compare})`, l.releases && `[releases](${l.releases})`, l.npm && `[npm](${l.npm})`].filter(Boolean).join(" · ") : "";
        L.push(`| ${code(c.package)} | ${md(c.from ?? "—")} | ${md(c.to ?? "—")} | ${c.from && c.to ? bumpKind(c.from, c.to) : c.to ? "added" : "removed"} | ${linkCell} |`);
    }
    const transitive = d.delta.changes.length - d.delta.direct.length;
    L.push("", `${transitive > 0 ? `Plus ${transitive} transitive change(s) in the lockfile. ` : ""}Files: ${d.delta.files.map(code).join(", ")}.`, "");
    L.push("<details><summary>How Signal tested this</summary>", "");
    L.push("| run | result | failing tests | time |", "|---|---|---|---|");
    for (const r of d.runs) {
        const what = r.attempt === 0 ? `isolation probe (${r.side === "baseline" ? "old deps + some updates" : "update with some reverted"})` : `${r.side === "update" ? "with the update" : "without it (baseline)"}${r.phase === "install" ? ": install" : `, run ${r.attempt}`}`;
        L.push(`| ${what} | ${r.phase === "install" ? (r.ok ? "installed" : "install failed") : r.timedOut ? "timeout" : r.ok ? "pass" : "fail"} | ${r.ok ? "—" : r.failed.length || "?"} | ${mins(r.ms)} |`);
    }
    L.push("", `Commands: install ${code(d.commands.install)}, test ${code(d.commands.test)}${d.commands.detected.length ? ` (detected: ${d.commands.detected.map(md).join("; ")})` : ""}.`);
    L.push(`Base: ${code(d.delta.base)}. Each side ran in its own fresh git worktree with a fresh install; the checkout was not modified. ${d.cost.runs} run(s), ${d.cost.extraRuns} beyond the first test run, ${mins(d.cost.ms)} in total.`, "");
    L.push("**Reproduce locally:** `node <signal>/dist/cli/cafe.js signal diagnose --base " + d.delta.base.replace(/`/g, "") + "` on this branch.", "");
    L.push("**Limits of this run:**", ...d.limits.map((l) => `- ${md(l)}`));
    if (d.integrity !== "ok")
        L.push(`- ⚠️ Integrity: ${d.integrity}`);
    L.push("", "</details>");
    return L.join("\n");
}
export function renderText(d) {
    const L = [HEAD[d.verdict].replace(/^\S+ /, "").toUpperCase(), `confidence ${d.confidence}: ${d.reasons.join("; ")}`, `merge: ${d.merge}`, `next: ${d.next}`];
    if (d.isolation && d.isolation.status !== "not_needed")
        L.push(`isolation: ${d.isolation.status}: ${d.isolation.reason}`);
    if (d.newFailures.length)
        L.push("new failures:", ...d.newFailures.slice(0, 10).map((f) => `  ${f.id}${f.message ? `  — ${f.message}` : ""}`));
    if (d.preExisting.length)
        L.push(`already failing without the update: ${d.preExisting.length}`);
    L.push(`cost: ${d.cost.runs} runs, ${mins(d.cost.ms)}`);
    return L.join("\n");
}
