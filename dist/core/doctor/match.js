// Environment-aware compatibility engine. Pure (no I/O): used by the CLI, the MCP server, the web
// pages and the CI action, so every surface gives the same answer for the same evidence.
//
// Evidence rows come from executed replays. For an upgrade-break capsule (its "before" uses an API
// a runtime removed) a row's verdict means, in that environment:
//   PROBLEM_NOT_REPRODUCED  the old code works -> not affected
//   PASS (sensitive)        the old code breaks and this fix works
//   FIX_FAILS / FIX_BREAKS  it breaks and this fix does not work there
// Nothing here ranks by votes or popularity. Negative results are kept and shown.
import { parseVersion, satisfies } from "../capsule/capsule.js";
const sensitive = (r) => r.verdict === "PASS" && r.mutation.total > 0 && r.mutation.killed * 2 >= r.mutation.total;
const mm = (v) => parseVersion(v).slice(0, 2).join(".");
const cmpMm = (a, b) => {
    const x = parseVersion(a), y = parseVersion(b);
    return (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0);
};
/** TZ matters only as "UTC or not" for the problems we track; other conditions must match exactly. */
function condClass(k, v) {
    if (v === undefined)
        return undefined;
    if (k === "TZ")
        return /^(UTC|Etc\/UTC|GMT|Etc\/GMT|Z|)$/i.test(v) ? "utc" : "non-utc";
    return v;
}
/**
 * Condition keys that demonstrably change the outcome for THIS capsule: within the same runtime
 * major.minor, rows that differ in that key's value (or its presence) have different verdicts.
 * Only these are enforced when matching; e.g. Python's site setup matters for distutils, not for imp.
 */
export function relevantConditions(rows) {
    const out = new Set();
    const keys = new Set(rows.flatMap((r) => Object.keys(r.conditions)));
    for (const k of keys) {
        const groups = new Map();
        for (const r of rows) {
            const g = `${r.runtime}@${mm(r.version)}`;
            const cls = condClass(k, r.conditions[k]) ?? "(none)";
            const m = groups.get(g) ?? new Map();
            (m.get(cls) ?? m.set(cls, new Set()).get(cls)).add(r.verdict === "PASS" && !sensitive(r) ? "PASS_INSENSITIVE" : r.verdict);
            groups.set(g, m);
        }
        for (const m of groups.values()) {
            const sets = [...m.values()].map((s) => [...s].sort().join());
            if (new Set(sets).size > 1)
                out.add(k);
        }
    }
    return out;
}
export function conditionsCompatible(row, env, relevant) {
    for (const [k, v] of Object.entries(row)) {
        if (relevant && !relevant.has(k))
            continue;
        // A row that records a site setup only speaks for environments known to have the same setup.
        if (k === "SITE" && env.SITE === undefined)
            return false;
        if (k === "SITE" && ((v === "venv-clean" || v === "no-distutils") !== (env.SITE === "venv-clean" || env.SITE === "no-distutils")))
            return false;
        if (k === "SITE")
            continue;
        if (env[k] === undefined)
            continue; // env does not know: the row still informs, but see `exact`
        if (condClass(k, v) !== condClass(k, env[k]))
            return false;
    }
    // A row recorded without a condition the env has (e.g. TZ) only matches if the capsule pins it
    return true;
}
function classify(rows) {
    if (!rows.length)
        return { status: "no_evidence", trust: null };
    const pick = (want) => rows.filter(want);
    const verified = rows.filter((r) => r.trust === "verified");
    // Verified rows win over claims; claims are only used when nothing verified exists here.
    const base = verified.length ? verified : rows;
    const pass = base.filter(sensitive).length;
    const nr = base.filter((r) => r.verdict === "PROBLEM_NOT_REPRODUCED").length;
    const fails = base.filter((r) => r.verdict === "FIX_FAILS").length;
    const breaks = base.filter((r) => r.verdict === "FIX_BREAKS").length;
    const trust = verified.length ? "verified" : "claimed";
    if ((pass && nr) || (pass && fails) || (nr && fails) || (breaks && (pass || fails)))
        return { status: "conflicting", trust };
    if (breaks)
        return { status: "fix_breaks", trust };
    if (fails)
        return { status: "affected_fix_fails", trust };
    if (pass)
        return { status: "affected_fix_works", trust };
    if (nr)
        return { status: "not_affected", trust };
    void pick;
    return { status: "no_evidence", trust };
}
const WORDS = {
    affected_fix_works: "breaks here; the fix works here",
    affected_fix_fails: "breaks here and THIS fix also fails here",
    fix_breaks: "the old code works here, but this FIX BREAKS it (do not apply it here unguarded)",
    not_affected: "not affected here (the old code still works)",
    conflicting: "results disagree in environments that look the same; something not captured (packages, site-packages, locale) changes the outcome",
    untested: "not tested in this environment",
    no_evidence: "no executed evidence yet",
};
export function evaluate(entry, env) {
    const relevant = relevantConditions(entry.rows);
    const all = entry.rows.filter((r) => r.runtime === env.runtime && conditionsCompatible(r.conditions, env.conditions, relevant));
    const same = all.filter((r) => mm(r.version) === mm(env.version));
    if (same.length) {
        const { status, trust } = classify(same);
        const where = [...new Set(same.map((r) => `${r.runtime} ${r.version}${Object.keys(r.conditions).length ? ` [${Object.entries(r.conditions).map(([k, v]) => `${k}=${v}`).join(",")}]` : ""} (${r.trust === "verified" ? "verified: " : "self-reported: "}${r.source})`))];
        return { env, status, exact: true, trust, summary: `${WORDS[status]}${trust === "claimed" ? " (self-reported only, not verified)" : ""}. Seen on ${where.slice(0, 3).join("; ")}${where.length > 3 ? ` and ${where.length - 3} more` : ""}.`, rows: same };
    }
    if (!all.length)
        return { env, status: "no_evidence", exact: false, trust: null, summary: `${WORDS.no_evidence} for ${env.runtime}.`, rows: [] };
    // Untested version: report the nearest tested versions on both sides, never extrapolate silently.
    const versions = [...new Set(all.map((r) => mm(r.version)))].sort(cmpMm);
    const lower = versions.filter((v) => cmpMm(v, env.version) < 0).at(-1);
    const higher = versions.find((v) => cmpMm(v, env.version) > 0);
    const st = (v) => (v ? classify(all.filter((r) => mm(r.version) === v)) : undefined);
    const lo = st(lower), hi = st(higher);
    const tr = (c) => (c?.trust === "claimed" ? " (self-reported)" : "");
    let summary = `${env.runtime} ${mm(env.version)} was not tested.`;
    if (lower)
        summary += ` Nearest older: ${lower} -> ${WORDS[lo.status]}${tr(lo)}.`;
    if (higher)
        summary += ` Nearest newer: ${higher} -> ${WORDS[hi.status]}${tr(hi)}.`;
    if (lo && hi && lo.status === hi.status)
        summary += ` Both neighbours agree, so it is LIKELY the same here (inferred, not tested).`;
    return { env, status: "untested", exact: false, trust: null, summary, rows: [] };
}
const SEVERITY = { affected_fix_fails: 60, fix_breaks: 55, affected_fix_works: 50, conflicting: 40, untested: 20, no_evidence: 10, not_affected: 0 };
const CODE_ISSUE_PENALTY = 40;
export function buildFinding(entry, envs, reason, hits, byId) {
    const verdicts = envs.filter((e) => e.runtime === entry.capsule.runtime || (entry.capsule.runtime === "node" && e.runtime === "bun")).map((e) => evaluate(entry, e));
    // "Now" (installed/declared) matters more than an upgrade target.
    let severity = Math.max(0, ...verdicts.map((v) => SEVERITY[v.status] + (v.env.label.startsWith("upgrade") ? 0 : 15) + (v.trust === "verified" ? 5 : 0)));
    const replacement = entry.superseded_by.map((id) => byId.get(id)).filter(Boolean);
    const notes = [];
    if (entry.capsule.detect?.note)
        notes.push(entry.capsule.detect.note);
    const failing = verdicts.find((v) => v.status === "affected_fix_fails");
    const broken = verdicts.find((v) => v.status === "affected_fix_works" || v.status === "affected_fix_fails");
    const fixBreaks = verdicts.find((v) => v.status === "fix_breaks" || (v.status === "untested" && /FIX BREAKS/.test(v.summary)));
    let action;
    if (broken && fixBreaks)
        action = `Breaks on ${broken.env.runtime} ${mm(broken.env.version)}, but the known fix breaks ${fixBreaks.env.runtime} ${mm(fixBreaks.env.version)} (${fixBreaks.env.label}): you need a version-guarded fix, not this one as-is (cafe show ${entry.slug}).`;
    else if (failing && replacement.length)
        action = `Do not use this fix on ${failing.env.runtime} ${mm(failing.env.version)}; use "${replacement[0].slug}" instead.`;
    else if (failing)
        action = `Known failure: this fix does not work on ${failing.env.runtime} ${mm(failing.env.version)}. Look for another approach.`;
    else if (broken)
        action = `${broken.env.label === "installed" || broken.env.label.startsWith("declared") ? "Broken now" : `Breaks on ${broken.env.runtime} ${mm(broken.env.version)}`}: apply the fix (cafe show ${entry.slug}).`;
    else if (verdicts.some((v) => v.status === "conflicting"))
        action = `Evidence disagrees for your environment: replay it locally before trusting it (cafe replay ${entry.slug}).`;
    else if (verdicts.every((v) => v.status === "not_affected"))
        action = "No action: your environments are not affected.";
    else
        action = `Not tested for your environment: replay it to find out (cafe replay ${entry.slug}).`;
    const rt = entry.rows.filter((r) => r.runtime === entry.capsule.runtime);
    const scope = !rt.length ? "unknown" : rt.some((r) => r.verdict === "PROBLEM_NOT_REPRODUCED") && rt.some((r) => r.verdict !== "PROBLEM_NOT_REPRODUCED") ? "version" : rt.every((r) => r.verdict === "PASS") ? "code" : "unknown";
    if (scope === "code")
        severity -= CODE_ISSUE_PENALTY;
    if (scope === "code" && !failing)
        action = `Present in every tested version (not an upgrade break): fix when convenient (cafe show ${entry.slug}).`;
    const after = entry.capsule.after.files;
    const changed = Object.keys(after).filter((p) => entry.capsule.before.files[p] !== after[p]);
    return {
        slug: entry.slug,
        id: entry.id,
        title: entry.capsule.title,
        origin: entry.origin,
        reason,
        hits,
        verdicts,
        severity,
        action,
        scope,
        fix_summary: `${entry.capsule.problem.description} (changes: ${changed.join(", ")})`,
        claims: entry.capsule.applicability.claims,
        superseded_by: replacement.map((r) => r.slug),
        notes,
    };
}
// ---------------- diagnose: error text -> capsules ----------------
const STOP = new Set("error the a an of to in is not for and on with at by from this that be no has have module object type name file line".split(" "));
function tokens(s) {
    return new Set((s.toLowerCase().match(/[a-z_][a-z0-9_.]{2,}/g) ?? []).filter((t) => !STOP.has(t)));
}
/** Scores capsules against an error message. A symptom_regex match is strong; token overlap is weak. */
export function matchError(index, error) {
    const text = error.slice(0, 20_000);
    const et = tokens(text);
    const out = [];
    for (const entry of index) {
        const p = entry.capsule.problem;
        if (p.symptom_regex && new RegExp(p.symptom_regex).test(text)) {
            out.push({ entry, score: 100, why: `the error matches this capsule's symptom pattern /${p.symptom_regex}/` });
            continue;
        }
        const st = tokens(`${p.symptom}`);
        const shared = [...st].filter((t) => et.has(t));
        // Distinctive identifiers (with a dot or underscore, or quoted names) count double.
        const score = shared.reduce((s, t) => s + (/[._]/.test(t) || text.includes(`'${t}'`) ? 2 : 1), 0);
        if (score >= 3 && shared.length >= 2)
            out.push({ entry, score: Math.min(60, score * 10), why: `shares ${shared.slice(0, 4).join(", ")} with the known symptom "${p.symptom}"` });
    }
    return out.sort((a, b) => b.score - a.score);
}
/** Whether the author's claimed fix range includes a version (claims are claims, shown as such). */
export function claimCovers(capsule, runtime, version) {
    const range = capsule.applicability.claims[runtime];
    return range ? satisfies(version, range) : null;
}
