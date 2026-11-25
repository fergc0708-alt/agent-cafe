// Signal's diagnosis of a dependency-update branch.
//
// Fail-first: the update is tested first (fresh worktree, fresh install). If it passes, Signal stops: one run, no
// baseline needed. Only when it fails does Signal re-run it (flakiness) and test the baseline: the SAME commit with
// only the dependency files reverted, in its own fresh worktree and install. Then it compares WHICH TESTS fail, so
// a red main does not hide a regression and does not get blamed on the update.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dependencyDelta } from "./delta.js";
import { addCommand, copyTree, detectCommands, git, installedVersion, sh, worktree } from "./exec.js";
import { infraProblem, parseJunit, parseOutput } from "./testparse.js";
import { isolate } from "./isolate.js";
const HERE = dirname(fileURLToPath(import.meta.url));
/** Hash of Signal's own files: if the code under test modified them, the report cannot be trusted. */
function selfHash() {
    const h = createHash("sha256");
    const walk = (d) => {
        for (const f of readdirSync(d).sort()) {
            const p = join(d, f);
            const st = statSync(p);
            if (st.isDirectory())
                walk(p);
            else if (/\.(js|ts)$/.test(f))
                h.update(f).update(readFileSync(p));
        }
    };
    try {
        walk(HERE);
    }
    catch {
        return "unreadable";
    }
    return h.digest("hex");
}
const sameIds = (a, b) => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id));
export async function diagnose(o) {
    const t0 = Date.now();
    const log = o.log ?? (() => { });
    const integrityBefore = selfHash();
    if (git(o.dir, ["status", "--porcelain", "--untracked-files=no"]).out.trim())
        throw new Error("the working tree has uncommitted changes to tracked files; commit or stash them first");
    const d = dependencyDelta(o.dir, o.base ?? "auto", o.title);
    if (!d.files.length || !d.changes.length)
        throw new Error(`no dependency change between ${d.base} and HEAD (no lockfile or manifest change in this project)`);
    const detected = detectCommands(join(d.root, d.prefix), d.root);
    const install = o.install ?? detected.install;
    const test = o.test ?? detected.test;
    if (!install)
        throw new Error(`no install command: pass --install (${detected.why.join("; ") || "no lockfile recognized"})`);
    if (!test)
        throw new Error("no test command: pass --test (package.json has no test script)");
    const retries = Math.max(0, Math.min(3, Number.isFinite(o.retries) ? Math.floor(o.retries) : 1));
    const timeout = o.timeoutMs ?? 20 * 60_000;
    const runs = [];
    const limits = [];
    const pm = detected.pm;
    const readFailures = (dir, out) => {
        if (o.junit) {
            try {
                const xml = readFileSync(join(dir, o.junit), "utf8");
                return { failed: parseJunit(xml), runner: "junit" };
            }
            catch { /* fall back to output */ }
        }
        const p = parseOutput(out);
        return { failed: p.failed, runner: p.runner };
    };
    // One side = a fresh worktree (dependency files reverted for the baseline), install once, test 1..N times.
    const runSide = (side, attempts, keep = false) => {
        const wt = worktree(d.root, d.prefix, d.files, side === "baseline" ? d.base : undefined);
        const recs = [];
        try {
            log(`[signal] ${side}: install (${install})`);
            const i = sh(wt.dir, install, timeout);
            const infra = infraProblem(i.log);
            if (!i.ok) {
                recs.push({ side, attempt: 1, phase: "install", ok: false, timedOut: i.timedOut, ms: i.ms, failed: [], runner: "", infra });
                return { recs, wt: keep ? wt : null, installOk: false, installLog: i.log };
            }
            // A pass needs no confirmation; a failure is re-run in the same install (up to `attempts`), and any pass
            // after a failure ends the loop: that side is flaky.
            for (let a = 1; a <= attempts; a++) {
                log(`[signal] ${side}: test run ${a} (${test})`);
                const r = sh(wt.dir, test, timeout);
                const f = readFailures(wt.dir, r.log);
                recs.push({ side, attempt: a, phase: "test", ok: r.ok, timedOut: r.timedOut, ms: r.ms, failed: f.failed, runner: f.runner, infra: r.ok ? null : infraProblem(r.log) });
                if (r.ok || r.timedOut)
                    break;
            }
            return { recs, wt: keep ? wt : null, installOk: true, installLog: i.log };
        }
        finally {
            if (!keep)
                wt.remove();
        }
    };
    const finish = (v) => {
        const integrity = selfHash() === integrityBefore ? "ok" : "changed";
        const result = {
            ...v,
            isolation: v.isolation ?? null,
            delta: { base: d.base, files: d.files, otherFiles: d.otherFiles, changes: d.changes, direct: d.direct, primary: d.primary },
            runs, commands: { install, test, detected: o.install && o.test ? [] : detected.why }, limits,
            cost: { runs: runs.length, extraRuns: Math.max(0, runs.filter((r) => r.phase === "test").length - 1), ms: Date.now() - t0 },
            env: { os: process.platform, arch: process.arch, node: process.versions.node }, integrity,
        };
        if (integrity === "changed") {
            result.verdict = "inconclusive";
            result.confidence = "low";
            result.reasons.unshift("Signal's own files changed while the project's code ran: the result may have been tampered with");
        }
        return result;
    };
    limits.push(`Only this runner was tested: ${process.platform}/${process.arch}, Node ${process.versions.node}. Other OSes and runtime versions were not.`);
    limits.push(`Only what \`${test}\` runs was tested; "compatible" means no failure in that scope, not universal compatibility.`);
    if (d.otherFiles.length) {
        limits.push(`The branch also changes ${d.otherFiles.length} non-dependency file(s); the baseline keeps them, so it is "this branch's code with the old dependencies", not the base commit.`);
    }
    // ---- 1. the update ----
    const u = runSide("update", 1 + retries);
    runs.push(...u.recs);
    const uInstall = u.recs[0];
    if (uInstall.phase === "install") {
        return finish({
            verdict: "inconclusive", confidence: "low",
            reasons: [uInstall.infra ? `installing the update failed because of ${uInstall.infra}` : uInstall.timedOut ? "installing the update timed out" : "installing the update failed"],
            merge: "Do not merge yet: the update does not even install here.",
            next: uInstall.infra ? "Re-run the job; the failure looks environmental." : `Read the install error of \`${install}\` (a peer dependency or engines conflict is the usual cause).`,
            newFailures: [], preExisting: [], flipped: [],
        });
    }
    const uTests = u.recs.filter((r) => r.phase === "test");
    if (uTests.some((r) => r.timedOut)) {
        return finish({ verdict: "inconclusive", confidence: "low", reasons: [`the tests with the update exceeded the ${Math.round(timeout / 60000)}-minute timeout`], merge: "Unknown.", next: "Raise `timeout-minutes` or point `test` at a faster suite.", newFailures: [], preExisting: [], flipped: [] });
    }
    if (uTests[0].ok && uTests.every((r) => r.ok)) {
        return finish({
            verdict: "compatible", confidence: "high",
            reasons: ["the tests pass with the update on a fresh install; no baseline was needed (fail-first: Signal only compares when something fails)"],
            merge: "Safe to merge as far as these tests can tell.",
            next: "Merge (or let automerge do it).",
            newFailures: [], preExisting: [], flipped: [],
        });
    }
    const uAll = runs.filter((r) => r.side === "update" && r.phase === "test");
    if (uAll.some((r) => r.ok)) {
        const ids = (r) => new Set(r.failed.map((f) => f.id));
        const failing = uAll.filter((r) => !r.ok);
        const flipped = [...new Set(failing.flatMap((r) => [...ids(r)]))];
        return finish({
            verdict: "flaky", confidence: "medium",
            reasons: [`the same update failed ${failing.length} of ${uAll.length} identical runs and passed the others`],
            merge: "The update is not shown to be at fault. Merge if a re-run passes; fix or quarantine the flaky test separately.",
            next: flipped.length ? `Quarantine or fix the flaky test(s): ${flipped.slice(0, 3).join(", ")}.` : "Re-run the job; investigate the flaky test separately.",
            newFailures: [], preExisting: [], flipped,
        });
    }
    const uInfra = uAll.map((r) => r.infra).find(Boolean);
    if (uInfra) {
        return finish({ verdict: "inconclusive", confidence: "low", reasons: [`the failing runs show ${uInfra}: an environment problem can produce the same failure with or without the update`], merge: "Unknown.", next: "Re-run the job. If it persists, check whether the tests need network access.", newFailures: [], preExisting: [], flipped: [] });
    }
    // stable failures: which tests fail in EVERY update run
    const intersect = (rs) => rs.reduce((acc, r, i) => (i === 0 ? r.failed : acc.filter((f) => r.failed.some((x) => x.id === f.id))), []);
    const uFailed = intersect(uAll);
    const uFlipped = [...new Set(uAll.flatMap((r) => r.failed.map((f) => f.id)))].filter((id) => !uFailed.some((f) => f.id === id));
    // ---- 2. the baseline (only now) ----
    const b = runSide("baseline", 1 + retries, true);
    runs.push(...b.recs);
    try {
        if (b.recs[0].phase === "install") {
            return finish({
                verdict: "inconclusive", confidence: "low",
                reasons: ["the update fails its tests reproducibly, but the baseline (old dependencies) could not be installed, so the failure cannot be attributed", b.recs[0].infra ? `baseline install: ${b.recs[0].infra}` : "baseline install failed"],
                merge: "Do not merge until the failure is understood.", next: "Read the failing tests below; the baseline install error is in the job log.",
                newFailures: uFailed, preExisting: [], flipped: uFlipped,
            });
        }
        const bTests = b.recs.filter((r) => r.phase === "test");
        if (bTests.some((r) => r.timedOut))
            return finish({ verdict: "inconclusive", confidence: "low", reasons: ["the baseline tests timed out"], merge: "Unknown.", next: "Raise `timeout-minutes`.", newFailures: uFailed, preExisting: [], flipped: uFlipped });
        const bFlaky = bTests.some((r) => r.ok) && bTests.some((r) => !r.ok);
        const bInfra = bTests.map((r) => r.infra).find(Boolean);
        const bPass = bTests.every((r) => r.ok);
        const bFailed = intersect(bTests.filter((r) => !r.ok));
        const identified = uFailed.length > 0;
        const reasons = [
            `with the update: failed ${uAll.length}/${uAll.length} runs${identified ? ` (${uFailed.length} failing test${uFailed.length > 1 ? "s" : ""} identified, ${uAll[0].runner} output)` : " (failing tests could not be identified from the output)"}`,
            `without it (same commit, only ${d.files.join(", ")} reverted, fresh install, same runner): ${bPass ? `passed${bTests.length > 1 ? ` ${bTests.length}/${bTests.length}` : ""}` : bFlaky ? `flaky (${bTests.filter((r) => r.ok).length}/${bTests.length} passed)` : `failed ${bTests.length}/${bTests.length}`}`,
        ];
        const doIsolate = async (newIds) => {
            if (o.isolate === false || d.direct.length < 2)
                return null;
            if (!o.addCommand && (!pm || pm === "python"))
                return null;
            if (!b.wt)
                return null;
            const baseModules = join(b.wt.dir, "node_modules");
            const budget = o.isolateBudget ?? 8;
            const probe = async (side, apply) => {
                const wt = worktree(d.root, d.prefix, d.files, side === "baseline" ? d.base : undefined);
                try {
                    if (side === "baseline") {
                        if (!copyTree(baseModules, join(wt.dir, "node_modules"))) {
                            const i = sh(wt.dir, install, timeout);
                            if (!i.ok)
                                return { outcome: "error", note: "install failed" };
                        }
                    }
                    else {
                        const i = sh(wt.dir, install, timeout);
                        if (!i.ok)
                            return { outcome: "error", note: "install failed" };
                    }
                    const specs = apply.filter((c) => c.to).map((c) => `${c.package}@${c.to}`);
                    if (apply.some((c) => !c.to))
                        return { outcome: "error", note: "removing a dependency cannot be applied in isolation" };
                    const cmd = o.addCommand ? o.addCommand.replace("{specs}", specs.map((x) => `'${x.replace(/'/g, "")}'`).join(" ")) : addCommand(pm, install, specs);
                    if (!cmd)
                        return { outcome: "error", note: "package manager not supported for isolation" };
                    const a = sh(wt.dir, cmd, timeout);
                    if (!a.ok)
                        return { outcome: "error", note: `could not install ${specs.join(" ")}` };
                    for (const c of apply) {
                        const got = installedVersion(wt.dir, c.package);
                        if (got !== c.to)
                            return { outcome: "error", note: `${c.package} installed as ${got ?? "missing"}, not ${c.to}` };
                    }
                    const r = sh(wt.dir, test, timeout);
                    runs.push({ side: side === "baseline" ? "baseline" : "update", attempt: 0, phase: "test", ok: r.ok, timedOut: r.timedOut, ms: r.ms, failed: readFailures(wt.dir, r.log).failed, runner: "probe", infra: null });
                    if (r.timedOut)
                        return { outcome: "error", note: "timed out" };
                    const f = readFailures(wt.dir, r.log).failed.map((x) => x.id);
                    const hasNew = newIds.size ? [...newIds].some((id) => f.includes(id)) : !r.ok;
                    return { outcome: hasNew ? "new_failures" : r.ok || newIds.size ? "clean" : "clean" };
                }
                finally {
                    wt.remove();
                }
            };
            log(`[signal] isolating the responsible update among ${d.direct.length} direct changes (budget ${budget} runs)`);
            return isolate(d.direct, probe, budget);
        };
        if (bFlaky) {
            return finish({ verdict: "flaky", confidence: "medium", reasons: [...reasons, "the baseline itself gives different results on identical runs"], merge: "Not attributable: the suite is unstable without the update too.", next: "Fix the flaky tests on the base branch first.", newFailures: [], preExisting: bFailed, flipped: uFlipped });
        }
        if (!bPass && bInfra) {
            return finish({ verdict: "inconclusive", confidence: "low", reasons: [...reasons, `the baseline failures show ${bInfra}, so the two sides are not comparable`], merge: "Unknown.", next: "Re-run the job; if it persists, the tests need network or resources this runner lacks.", newFailures: uFailed, preExisting: [], flipped: uFlipped });
        }
        if (bPass) {
            const iso = await doIsolate(new Set(uFailed.map((f) => f.id)));
            const culprit = iso?.status === "single" ? iso.culprits[0] : d.direct.length === 1 ? d.direct[0] : null;
            return finish({
                verdict: "regression", confidence: identified ? "high" : "medium",
                reasons: [...reasons, ...(identified ? [] : ["confidence is medium because the failing tests could not be named (pass `junit` for exact test names)"])],
                merge: "Do not merge: the update breaks tests that pass without it.",
                next: culprit
                    ? `Fix the code for ${culprit.package} ${culprit.to}, or keep ${culprit.package} at ${culprit.from} (Renovate: allowedVersions "<${culprit.to}"; Dependabot: an ignore rule)${d.direct.length > 1 ? " and merge the other updates separately" : ""}.`
                    : iso?.status === "interaction" ? `Upgrade ${iso.culprits.map((c) => c.package).join(" and ")} together and fix them as one change; merge the other updates separately.`
                        : "Read the new failures below; split the group to find the responsible update if needed.",
                newFailures: uFailed, preExisting: [], flipped: uFlipped, isolation: iso,
            });
        }
        // baseline fails reproducibly
        if (!identified || bFailed.length === 0) {
            return finish({
                verdict: "pre_existing", confidence: "low",
                reasons: [...reasons, "both fail, but the failing tests could not be compared (not identified in the output), so a new failure hidden behind the old ones cannot be ruled out"],
                merge: "The base branch is already red; this PR cannot be judged until it is fixed.", next: "Fix the base branch, then re-run this PR. Pass `junit` so Signal can compare individual tests.",
                newFailures: [], preExisting: bFailed, flipped: uFlipped,
            });
        }
        const newOnes = uFailed.filter((f) => !bFailed.some((x) => x.id === f.id));
        const fixed = bFailed.filter((f) => !uFailed.some((x) => x.id === f.id));
        if (newOnes.length === 0) {
            return finish({
                verdict: "pre_existing", confidence: sameIds(uFailed, bFailed) ? "high" : "medium",
                reasons: [...reasons, sameIds(uFailed, bFailed) ? `exactly the same ${bFailed.length} test(s) fail without the update` : `every test that fails with the update also fails without it${fixed.length ? ` (and ${fixed.length} pass with it)` : ""}`],
                merge: "Not caused by the update: the base branch is already red. Safe to merge as far as the update is concerned.",
                next: `Fix the base branch (${bFailed.slice(0, 2).map((f) => f.id).join(", ")}${bFailed.length > 2 ? ", …" : ""}); this PR can be merged independently.`,
                newFailures: [], preExisting: bFailed, flipped: uFlipped,
            });
        }
        const iso = await doIsolate(new Set(newOnes.map((f) => f.id)));
        return finish({
            verdict: "regression_on_red", confidence: "high",
            reasons: [...reasons, `${newOnes.length} test(s) fail only with the update; ${bFailed.length} already failed without it`],
            merge: "Do not merge: besides the failures already on the base branch, the update breaks other tests.",
            next: iso?.status === "single" ? `Fix the code for ${iso.culprits[0].package} ${iso.culprits[0].to} or keep it at ${iso.culprits[0].from}; the pre-existing failures are a separate problem.` : "Fix the new failures below (the pre-existing ones are a separate problem on the base branch).",
            newFailures: newOnes, preExisting: bFailed, flipped: uFlipped, isolation: iso,
        });
    }
    finally {
        b.wt?.remove();
    }
}
