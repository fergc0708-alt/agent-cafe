// Café Signal observation protocol, v1.
// An observation records ONE dependency-update experiment: the candidate (the update) and, when available, a
// baseline run of the same tests on the same runner with only the dependency manifests reverted. Only the fields
// below ever leave the machine; everything is built locally from the run and can be previewed before sharing.
export const PROTOCOL = "cafe-signal/v1";
/** Classifies a paired experiment. Retries: each side reports its result after a re-run of a failure. */
export function attribute(baseline, candidate) {
    if (baseline === "flaky" || candidate === "flaky")
        return "unstable";
    if (baseline === "not_run" || baseline === "error")
        return candidate === "fail" ? "observational_fail" : candidate === "pass" ? "observational_pass" : "unstable";
    if (candidate === "not_run" || candidate === "error")
        return "unstable";
    if (baseline === "pass")
        return candidate === "pass" ? "compatible" : "regression";
    return candidate === "pass" ? "upgrade_fixes" : "baseline_red";
}
/** Strength of the causal claim an observation supports about the update. */
export const GRADE = {
    regression: "causal",
    compatible: "causal",
    upgrade_fixes: "causal",
    baseline_red: "none",
    unstable: "none",
    observational_fail: "observational",
    observational_pass: "observational",
};
// ---------- normalization ----------
export function normalizeVersion(v) {
    return v.trim().replace(/^[v=^~]+/, "");
}
export function semverParts(v) {
    const m = normalizeVersion(v).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}
/** "major" | "minor" | "patch" | "other": the size of the jump, used to group comparable transitions. */
export function bumpKind(from, to) {
    const a = semverParts(from), b = semverParts(to);
    if (!a || !b)
        return "other";
    // 0.x: a minor bump is breaking by semver convention
    if (a[0] !== b[0] || (a[0] === 0 && a[1] !== b[1]))
        return "major";
    if (a[1] !== b[1])
        return "minor";
    return a[2] !== b[2] ? "patch" : "other";
}
/** Normalizes package names the way the registries do (PyPI: PEP 503). */
export function normalizePackage(eco, name) {
    const n = name.trim();
    return eco === "pypi" ? n.toLowerCase().replace(/[-_.]+/g, "-") : n.toLowerCase();
}
// ---------- error fingerprints ----------
const SCRUB = [
    [/\x1b\[[0-9;]*m/g, ""], // ANSI colors
    [/[A-Za-z0-9+/_-]{32,}={0,2}/g, "<blob>"], // tokens, hashes, base64
    [/\b(?:https?|file|git|ssh):\/\/\S+/g, "<url>"],
    [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>"],
    [/(?:[A-Za-z]:)?(?:[\\/][\w@.+~-]+){2,}[\\/]?/g, "<path>"], // absolute or nested paths
    [/\b[\w-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|pyi|json|toml|yaml|yml|lock|cfg|txt|md)\b/g, "<file>"],
    [/0x[0-9a-fA-F]+/g, "<hex>"],
    [/\b\d+(?:\.\d+)*\b/g, "<n>"],
    [/(["'`]).{0,80}?\1/g, "<str>"],
    [/\s+/g, " "],
];
/** Error-signature lines (exception types, Node error codes, compiler/test-runner failures). */
const SIGNATURE = /\b(?:[A-Z][A-Za-z]+(?:Error|Exception|Warning)|ERR_[A-Z_]+|TS\d{4}|E\d{3,4}|AssertionError|ModuleNotFoundError|ImportError|SyntaxError|TypeError|ReferenceError|Cannot find module|No matching distribution|ResolutionImpossible|ERESOLVE|failed to (?:build|compile)|Segmentation fault|panicked)\b/;
export function scrub(line) {
    let s = line;
    for (const [re, r] of SCRUB)
        s = s.replace(re, r);
    return s.trim().slice(0, 160);
}
/** Distinct normalized signatures in a log, at most `max`. Raw log text never leaves this function. */
export function signatures(log, max = 12) {
    const out = new Set();
    for (const line of log.split(/\r?\n/)) {
        if (line.length > 2000 || !SIGNATURE.test(line))
            continue;
        const s = scrub(line);
        if (s.length >= 8)
            out.add(s);
        if (out.size >= max * 4)
            break;
    }
    return [...out].slice(0, max * 4);
}
/** Signatures that the candidate produced and the baseline did not: what the update introduced. */
export function differentialFingerprints(baselineLog, candidateLog, max = 8) {
    const base = new Set(signatures(baselineLog));
    return signatures(candidateLog).filter((s) => !base.has(s)).slice(0, max);
}
const isPrivateName = (name, pats) => pats.some((p) => (p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : name === p));
/** The exact object that would be sent: allow-listed fields only, internal packages redacted. */
export function shareable(o, opts = {}) {
    const pats = opts.privatePackages ?? [];
    const changes = o.changes.filter((c) => !isPrivateName(c.package, pats)).map((c) => ({ ecosystem: c.ecosystem, package: c.package, from: c.from, to: c.to, direct: c.direct }));
    if (isPrivateName(o.primary.package, pats))
        throw new Error("the updated package matches a private pattern: this observation cannot be shared");
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
        fingerprints: o.fingerprints.map(scrub).slice(0, 8),
        provenance: { kind: o.provenance.kind, ...(opts.includeSource && o.provenance.source_url ? { source_url: o.provenance.source_url } : {}) },
    };
}
const ATTRS = new Set(["regression", "compatible", "baseline_red", "upgrade_fixes", "unstable", "observational_fail", "observational_pass"]);
const RESULTS = new Set(["pass", "fail", "flaky", "error", "not_run"]);
const NAME = /^(?:@[a-z0-9][\w.-]{0,100}\/)?[a-z0-9][\w.-]{0,100}$/i;
const VER = /^[\w.+!-]{1,64}$/;
/** Server-side validation of a submitted observation. Throws with a reason; never trusts the client's attribution. */
export function validate(o) {
    if (!o || typeof o !== "object" || o.protocol !== PROTOCOL)
        throw new Error("not a cafe-signal/v1 observation");
    const p = o.primary;
    if (!p || !["npm", "pypi"].includes(p.ecosystem) || !NAME.test(p.package ?? "") || !VER.test(p.from ?? "") || !VER.test(p.to ?? ""))
        throw new Error("bad primary update");
    if (!RESULTS.has(o.baseline) || !RESULTS.has(o.candidate))
        throw new Error("bad run results");
    if (!ATTRS.has(o.attribution))
        throw new Error("bad attribution");
    // The server recomputes the attribution from the two results: a client cannot claim "regression" for FAIL/FAIL.
    if (o.attribution !== attribute(o.baseline, o.candidate))
        throw new Error("attribution does not follow from baseline/candidate results");
    if (!Array.isArray(o.changes) || o.changes.length > 500)
        throw new Error("bad changes");
    for (const c of o.changes)
        if (!["npm", "pypi"].includes(c.ecosystem) || !NAME.test(c.package ?? "") || (c.from !== null && !VER.test(c.from)) || (c.to !== null && !VER.test(c.to)))
            throw new Error("bad change entry");
    if (!Array.isArray(o.fingerprints) || o.fingerprints.length > 8 || o.fingerprints.some((f) => typeof f !== "string" || f.length > 160))
        throw new Error("bad fingerprints");
    if (o.fingerprints.some((f) => f !== scrub(f)))
        throw new Error("fingerprints must be scrubbed (no paths, numbers, URLs, strings)");
    if (o.env !== null && (typeof o.env !== "object" || !/^\d+(\.\d+)?$/.test(o.env.runtime_version ?? "") || !["node", "python"].includes(o.env.runtime)))
        throw new Error("bad env");
    if (!/^\d{4}-\d{2}-\d{2}/.test(o.observed_at ?? ""))
        throw new Error("bad date");
    return o;
}
export async function observationId(o) {
    const canon = JSON.stringify({
        p: o.primary, c: [...o.changes].sort((a, b) => a.package.localeCompare(b.package)), e: o.env, b: o.baseline, k: o.candidate, f: [...o.fingerprints].sort(), d: o.observed_at.slice(0, 10),
    });
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
