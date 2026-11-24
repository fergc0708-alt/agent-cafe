// Paired upgrade experiment, run in the user's own CI (or laptop) on a dependency-update branch:
//   candidate = the branch as-is; baseline = the same checkout with ONLY the dependency files reverted to the
//   base ref. Same runner, same OS, same runtime, same source code, same test command. A failure is retried once on
//   each side, so a flaky test is reported as unstable instead of being blamed on the update.
// Logs stay on the machine; only normalized differential signatures are kept in the observation.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { attribute, differentialFingerprints, observationId, PROTOCOL } from "./protocol.js";
import { declared, diffVersions, LOCKFILES, updateFromTitle } from "./lockfiles.js";
const MANIFESTS = /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|requirements[^/]*\.(txt|in))$/;
function git(dir, args) {
    const r = spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 64 << 20 });
    return { ok: r.status === 0, out: r.stdout ?? "" };
}
function sh(dir, cmd, timeoutMs) {
    const r = spawnSync("sh", ["-c", cmd], { cwd: dir, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 << 20, env: process.env });
    return { ok: r.status === 0, log: `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}` };
}
/** Runs install+test; a failure is retried. pass→pass, fail,fail→fail, fail,pass→flaky. */
function side(o, label) {
    const t = o.timeoutMs ?? 30 * 60_000;
    let logs = "";
    const results = [];
    let phase = "unknown";
    for (let attempt = 0; attempt <= (o.retries ?? 1); attempt++) {
        o.log?.(`[signal] ${label}: attempt ${attempt + 1}`);
        if (o.install) {
            const i = sh(o.dir, o.install, t);
            logs += i.log;
            if (!i.ok) {
                results.push(false);
                phase = "install";
                continue;
            }
        }
        const r = sh(o.dir, o.test, t);
        logs += r.log;
        results.push(r.ok);
        if (r.ok && attempt === 0)
            break;
        if (!r.ok)
            phase = "test";
        if (results.length >= 2)
            break;
    }
    const result = results.every(Boolean) ? "pass" : results.every((x) => !x) ? "fail" : "flaky";
    return { result, phase: result === "pass" ? "unknown" : phase, log: logs };
}
/** Repository root and the project's path inside it ("" at the root), so monorepo sub-projects work. */
function where(dir) {
    const root = git(dir, ["rev-parse", "--show-toplevel"]).out.trim() || dir;
    const prefix = git(dir, ["rev-parse", "--show-prefix"]).out.trim();
    return { root, prefix };
}
export function dependencyDelta(dir, base) {
    const { root, prefix } = where(dir);
    dir = root;
    const names = git(dir, ["diff", "--name-only", base, "HEAD"]).out.split("\n").filter(Boolean).filter((n) => n.startsWith(prefix));
    const files = names.filter((n) => LOCKFILES.some((l) => l.match.test(n)) || MANIFESTS.test(n));
    const changes = [];
    const direct = new Set();
    for (const f of files.filter((n) => MANIFESTS.test(n))) {
        for (const n of declared(f, git(dir, ["show", `HEAD:${f}`]).out))
            direct.add(n);
    }
    for (const f of files) {
        const l = LOCKFILES.find((x) => x.match.test(f));
        if (!l)
            continue;
        const before = l.parse(git(dir, ["show", `${base}:${f}`]).out);
        const after = l.parse(git(dir, ["show", `HEAD:${f}`]).out);
        changes.push(...diffVersions(l.ecosystem, before, after, direct));
    }
    const seen = new Set();
    const uniq = changes.filter((c) => { const k = `${c.ecosystem}:${c.package}:${c.from}:${c.to}`; return seen.has(k) ? false : (seen.add(k), true); });
    return { changes: uniq, files, other: names.length - files.length };
}
function runtimeOf(eco, dir) {
    if (eco === "npm")
        return { runtime: "node", runtime_version: process.versions.node.split(".").slice(0, 2).join(".") };
    const r = spawnSync("python3", ["-c", "import sys;print('%d.%d'%sys.version_info[:2])"], { cwd: dir, encoding: "utf8" });
    return { runtime: "python", runtime_version: (r.stdout ?? "").trim() || "unknown" };
}
export function primaryUpdate(changes, title) {
    const t = title ? updateFromTitle(title) : null;
    if (t) {
        const c = changes.find((x) => x.package === t.package.toLowerCase() || x.package.replace(/[-_.]+/g, "-") === t.package.toLowerCase().replace(/[-_.]+/g, "-"));
        if (c)
            return c;
    }
    return changes.find((c) => c.direct && c.from && c.to) ?? changes.find((c) => c.from && c.to) ?? null;
}
export async function runPaired(o) {
    if (!git(o.dir, ["rev-parse", "--verify", `${o.base}^{commit}`]).ok)
        throw new Error(`base ref ${o.base} not found (fetch it: git fetch origin <base-branch>)`);
    if (git(o.dir, ["status", "--porcelain", "--untracked-files=no"]).out.trim())
        throw new Error("working tree has uncommitted changes to tracked files; commit or stash them first");
    const { changes, files, other } = dependencyDelta(o.dir, o.base);
    const root = where(o.dir).root;
    const primary = primaryUpdate(changes, o.title);
    if (!primary || !primary.from || !primary.to)
        throw new Error("no dependency update found between the base ref and HEAD (lockfiles/manifests unchanged)");
    const cand = side(o, "candidate (the update)");
    // Baseline: revert ONLY the dependency files to the base ref, keep every other file of the branch.
    const existing = files.filter((f) => git(root, ["cat-file", "-e", `${o.base}:${f}`]).ok);
    const added = files.filter((f) => !existing.includes(f));
    if (existing.length)
        git(root, ["checkout", o.base, "--", ...existing]);
    for (const f of added)
        rmSync(join(root, f), { force: true }); // did not exist at the base ref
    let base;
    try {
        base = side(o, "baseline (dependencies reverted)");
    }
    finally {
        git(root, ["checkout", "HEAD", "--", ...files]); // restore the branch exactly
        git(root, ["reset", "-q"]);
    }
    const attribution = attribute(base.result, cand.result);
    const fingerprints = cand.result === "fail" ? differentialFingerprints(base.log, cand.log) : [];
    const env = { os: process.platform, arch: process.arch, ...runtimeOf(primary.ecosystem, o.dir) };
    const draft = {
        protocol: PROTOCOL, observed_at: new Date().toISOString().slice(0, 10), changes,
        primary: { ecosystem: primary.ecosystem, package: primary.package, from: primary.from, to: primary.to },
        env, baseline: base.result, candidate: cand.result, attribution,
        phase: cand.result === "pass" ? "unknown" : cand.phase, fingerprints,
    };
    const observation = { ...draft, id: await observationId(draft), provenance: { kind: "local" } };
    return { observation, depFiles: files, otherFilesChanged: other, candidateLog: cand.log, baselineLog: base.log };
}
/** Reads the PR title from the GitHub Actions event payload when available. */
export function prTitleFromEvent() {
    const p = process.env.GITHUB_EVENT_PATH;
    if (!p || !existsSync(p))
        return undefined;
    try {
        return JSON.parse(readFileSync(p, "utf8"))?.pull_request?.title;
    }
    catch {
        return undefined;
    }
}
export const hostInfo = () => ({ os: process.platform, arch: process.arch, cpus: os.cpus().length });
