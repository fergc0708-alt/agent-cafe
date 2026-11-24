// Paired upgrade experiment, run in the user's own CI (or laptop) on a dependency-update branch:
//   candidate = the branch as-is (in place); baseline = a separate git worktree of the same commit with ONLY the
//   dependency files reverted to the base, installed from scratch. Same runner, OS, runtime, source code and test
//   command; nothing (node_modules, build caches) carries over from one side to the other. A failing side is re-run
//   so a flaky test is reported as unstable instead of being blamed on the update.
// Logs stay on the machine; only privacy-shaped differential signatures are kept in the observation.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { attribute, differentialFingerprints, observationId, PROTOCOL } from "./protocol.js";
import { declared, diffVersions, LOCKFILES, updateFromTitle } from "./lockfiles.js";
const MANIFESTS = /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|requirements[^/]*\.(txt|in))$/;
const MAX_DEP_FILE = 32 << 20;
function git(dir, args) {
    const r = spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 64 << 20 });
    return { ok: r.status === 0, out: r.stdout ?? "" };
}
/** The code under test must not be able to mint the job's OIDC tokens or reach the runner's internal services. */
function childEnv() {
    const e = { ...process.env };
    for (const k of Object.keys(e))
        if (/^ACTIONS_(ID_TOKEN|RUNTIME|CACHE|RESULTS)_/.test(k))
            delete e[k];
    return e;
}
function sh(dir, cmd, timeoutMs) {
    const r = spawnSync("sh", ["-c", cmd], { cwd: dir, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 << 20, env: childEnv() });
    return { ok: r.status === 0, log: `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}` };
}
/** install (once) + test, re-running a failing test: pass | fail (all attempts failed) | flaky | error (install failed). */
export function side(dir, o, label) {
    const t = o.timeoutMs ?? 30 * 60_000;
    const retries = Math.max(0, Math.min(3, Number.isFinite(o.retries) ? Math.floor(o.retries) : 1));
    let logs = "";
    if (o.install) {
        o.log?.(`[signal] ${label}: install`);
        const i = sh(dir, o.install, t);
        logs += i.log;
        if (!i.ok)
            return { result: "error", phase: "install", log: logs };
    }
    const results = [];
    for (let attempt = 0; attempt <= retries; attempt++) {
        o.log?.(`[signal] ${label}: test attempt ${attempt + 1}`);
        const r = sh(dir, o.test, t);
        logs += r.log;
        results.push(r.ok);
        if (r.ok)
            break; // a pass needs no retry; a failure is retried up to `retries` times
    }
    if (!results.length)
        return { result: "error", phase: "unknown", log: logs };
    const result = results.every(Boolean) ? "pass" : results.every((x) => !x) ? "fail" : "flaky";
    return { result, phase: result === "pass" ? "unknown" : "test", log: logs };
}
function where(dir) {
    const root = git(dir, ["rev-parse", "--show-toplevel"]).out.trim() || dir;
    const prefix = git(dir, ["rev-parse", "--show-prefix"]).out.trim();
    return { root, prefix };
}
/** Dependency files that belong to the project at `prefix`: inside it, or lockfiles in an ancestor (workspaces). */
function relevant(name, prefix) {
    if (name.startsWith(prefix))
        return true;
    const d = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
    return LOCKFILES.some((l) => l.match.test(name)) && prefix.startsWith(d);
}
export function dependencyDelta(dir, base) {
    const { root, prefix } = where(dir);
    const names = git(root, ["diff", "--name-only", base, "HEAD"]).out.split("\n").filter(Boolean);
    const files = names.filter((n) => (LOCKFILES.some((l) => l.match.test(n)) || MANIFESTS.test(n)) && relevant(n, prefix));
    const others = names.filter((n) => n.startsWith(prefix) && !files.includes(n));
    const changes = [];
    const direct = new Set();
    for (const f of files.filter((n) => MANIFESTS.test(n)))
        for (const n of declared(f, git(root, ["show", `HEAD:${f}`]).out.slice(0, MAX_DEP_FILE)))
            direct.add(n);
    for (const f of files) {
        const l = LOCKFILES.find((x) => x.match.test(f));
        if (!l)
            continue;
        const before = l.parse(git(root, ["show", `${base}:${f}`]).out.slice(0, MAX_DEP_FILE));
        const after = l.parse(git(root, ["show", `HEAD:${f}`]).out.slice(0, MAX_DEP_FILE));
        changes.push(...diffVersions(l.ecosystem, before, after, direct));
    }
    const seen = new Set();
    const uniq = changes.filter((c) => { const k = `${c.ecosystem}:${c.package}:${c.from}:${c.to}`; return seen.has(k) ? false : (seen.add(k), true); });
    return { changes: uniq, files, other: others.length };
}
function runtimeOf(eco, dir) {
    if (eco === "npm")
        return { runtime: "node", runtime_version: process.versions.node.split(".").slice(0, 2).join(".") };
    const r = spawnSync("python3", ["-c", "import sys;print('%d.%d'%sys.version_info[:2])"], { cwd: dir, encoding: "utf8" });
    return { runtime: "python", runtime_version: (r.stdout ?? "").trim() || "0.0" };
}
export function primaryUpdate(changes, title) {
    const t = title ? updateFromTitle(title) : null;
    if (t) {
        const want = t.package.toLowerCase().replace(/[-_.]+/g, "-");
        const c = changes.find((x) => x.package.replace(/[-_.]+/g, "-") === want && x.from && x.to);
        if (c)
            return c;
    }
    return changes.find((c) => c.direct && c.from && c.to) ?? null;
}
/** "auto": a PR merge commit's first parent is exactly the base the PR was tested against. */
export function resolveBase(dir, base) {
    if (base !== "auto")
        return base;
    const parents = git(dir, ["rev-list", "--parents", "-n", "1", "HEAD"]).out.trim().split(" ");
    if (parents.length === 3)
        return parents[1];
    return "origin/main";
}
export async function runPaired(o) {
    const base = resolveBase(o.dir, o.base);
    if (!git(o.dir, ["rev-parse", "--verify", `${base}^{commit}`]).ok)
        throw new Error(`base ref ${base} not found (fetch it first)`);
    if (!o.install && !o.allowNoInstall)
        throw new Error("an install command is required: without it the baseline would run on the update's installed packages");
    if (git(o.dir, ["status", "--porcelain", "--untracked-files=no"]).out.trim())
        throw new Error("working tree has uncommitted changes to tracked files; commit or stash them first");
    const { root, prefix } = where(o.dir);
    const { changes, files, other } = dependencyDelta(o.dir, base);
    const primary = primaryUpdate(changes, o.title);
    if (!primary || !primary.from || !primary.to)
        throw new Error("no dependency update found between the base ref and HEAD (lockfiles/manifests unchanged)");
    const cand = side(o.dir, o, "candidate (the update)");
    let baseSide = { result: "not_run", phase: "unknown", log: "" };
    let note;
    if (o.install) {
        // Baseline in a throw-away worktree: the user's checkout is never modified, even if this process is killed.
        const wt = mkdtempSync(join(os.tmpdir(), "cafe-signal-baseline-"));
        try {
            if (!git(root, ["worktree", "add", "--detach", "-f", wt, "HEAD"]).ok)
                throw new Error("could not create the baseline worktree");
            const existing = files.filter((f) => git(root, ["cat-file", "-e", `${base}:${f}`]).ok);
            if (existing.length && !git(wt, ["checkout", base, "--", ...existing]).ok)
                throw new Error("could not revert the dependency files in the baseline worktree");
            for (const f of files.filter((x) => !existing.includes(x))) {
                const p = join(wt, f);
                if (existsSync(p) && lstatSync(p).isFile())
                    rmSync(p); // did not exist at the base: remove (regular files only)
            }
            baseSide = side(join(wt, prefix), o, "baseline (dependencies reverted, fresh install)");
        }
        finally {
            git(root, ["worktree", "remove", "--force", wt]);
            rmSync(wt, { recursive: true, force: true });
            git(root, ["worktree", "prune"]);
        }
    }
    else
        note = "no install command: baseline not run (observational only)";
    let attribution = attribute(baseSide.result, cand.result);
    if (other > 0 && (attribution === "regression" || attribution === "compatible" || attribution === "upgrade_fixes" || attribution === "baseline_red")) {
        // The branch also changes code (e.g. adapts to the new API): the baseline runs that new code on old dependencies,
        // which is not the base project. Keep only the candidate's result, as observational evidence.
        attribution = cand.result === "pass" ? "observational_pass" : "observational_fail";
        note = `the branch also changes ${other} non-dependency file(s); attribution downgraded to observational`;
    }
    const fingerprints = cand.result === "fail" ? differentialFingerprints(baseSide.log, cand.log) : [];
    const env = { os: process.platform, arch: process.arch, ...runtimeOf(primary.ecosystem, o.dir) };
    const draft = {
        protocol: PROTOCOL, observed_at: new Date().toISOString().slice(0, 10), changes,
        primary: { ecosystem: primary.ecosystem, package: primary.package, from: primary.from, to: primary.to },
        env, baseline: attribution.startsWith("observational_") ? "not_run" : baseSide.result, candidate: cand.result, attribution,
        phase: cand.result === "pass" ? "unknown" : cand.phase, fingerprints,
    };
    const observation = { ...draft, id: await observationId(draft), provenance: { kind: "local" } };
    return { observation, depFiles: files, otherFilesChanged: other, candidateLog: cand.log, baselineLog: baseSide.log, note };
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
