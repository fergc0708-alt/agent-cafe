// Shared types and normalization for Signal. Nothing here sends data anywhere: Signal runs entirely on the CI
// runner (or laptop) that already runs the project's tests.
export function normalizeVersion(v) {
    return v.trim().replace(/^[v=^~]+/, "");
}
export function semverParts(v) {
    const m = normalizeVersion(v).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}
/** "major" | "minor" | "patch" | "other": the size of the jump. 0.x minor bumps count as major (semver). */
export function bumpKind(from, to) {
    const a = semverParts(from), b = semverParts(to);
    if (!a || !b)
        return "other";
    if (a[0] !== b[0] || (a[0] === 0 && a[1] !== b[1]))
        return "major";
    if (a[1] !== b[1])
        return "minor";
    return a[2] !== b[2] ? "patch" : "other";
}
/** Package names as the registries compare them (PyPI: PEP 503). */
export function normalizePackage(eco, name) {
    const n = name.trim();
    return eco === "pypi" ? n.toLowerCase().replace(/[-_.]+/g, "-") : n.toLowerCase();
}
// ---------- error shapes (optional redaction for public repositories) ----------
const ERR = /\b([A-Z][A-Za-z]{1,40}(?:Error|Exception)|ERR_[A-Z_]{2,60}|TS\d{4}|E[A-Z]{3,12})\b:?\s*(.{0,300})/;
const WORD = /^[a-z]{1,15}$/;
/** "TypeError: chalk.bold is not a function" -> "TypeError: <id> is not a function". Used when `redact` is on. */
export function shape(line) {
    const m = line.match(ERR);
    if (!m)
        return "";
    const out = [];
    for (const t of m[2].replace(/\x1b\[[0-9;]*m/g, "").split(/\s+/).filter(Boolean).slice(0, 14)) {
        const core = t.replace(/^[("'`[{<]+|[)"'`\]}>,;:.!?]+$/g, "");
        const p = WORD.test(core) ? core : "<id>";
        if (!(p === "<id>" && out[out.length - 1] === "<id>"))
            out.push(p);
    }
    const msg = out.join(" ");
    return (msg ? `${m[1]}: ${msg}` : m[1]).slice(0, 120).trim();
}
