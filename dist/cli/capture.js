// `cafe capture`: turn a fix you (or your agent) just made into a reusable, PRIVATE capsule.
// It takes the changed files' committed version (before) and working-tree version (after) from
// git, plus a regression check you point at, then proves the check is meaningful by replaying it
// in the sandbox: it must fail on before, pass on after, and catch mutants of the fix. Only a
// candidate that passes all of that is saved, to <project>/.cafe/capsules/. Nothing is uploaded.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, extname, join, sep } from "node:path";
import { CAPSULE_SCHEMA, validateCapsule } from "../core/capsule/capsule.js";
import { lintCapsule } from "../core/capsule/lint.js";
import { findSecrets } from "../core/security.js";
import { replay } from "./runner.js";
// Repository-local git config can run programs (core.fsmonitor, filters, hooks): disable them.
const git = (cwd, args) => {
    const safe = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "core.pager=cat", "--no-pager"];
    const r = spawnSync("git", [...safe, ...args], { cwd, encoding: "utf8", maxBuffer: 4_000_000, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1", LANG: "C.UTF-8" } });
    return r.status === 0 ? r.stdout : null;
};
const RUNTIME_BY_EXT = {
    ".py": { runtime: "python", interp: "python3" },
    ".js": { runtime: "node", interp: "node" },
    ".cjs": { runtime: "node", interp: "node" },
    ".mjs": { runtime: "node", interp: "node" },
    ".ts": { runtime: "node", interp: "node" },
    ".sh": { runtime: "bash", interp: "bash" },
};
/** Builds the candidate without running anything. */
export function buildCandidate(o) {
    const problems = [];
    if (!git(o.project, ["rev-parse", "--is-inside-work-tree"]))
        return { problems: ["not a git repository: capture needs the committed version of your files as the 'before' state"], files: [] };
    // Every path must be a regular file inside the project (no ../, no absolute paths, no symlinks).
    const root = realpathSync(o.project);
    const inside = (rel) => {
        const p = join(root, rel);
        try {
            return !lstatSync(p).isSymbolicLink() && lstatSync(p).isFile() && realpathSync(p).startsWith(root + sep);
        }
        catch {
            return false;
        }
    };
    if (!inside(o.check))
        return { problems: [`check file must be a regular file inside the project: ${o.check}`], files: [] };
    const checkPath = join(root, o.check);
    const changed = o.files?.length ? o.files : (git(o.project, ["diff", "--name-only", "HEAD"]) ?? "").split("\n").filter(Boolean).filter((f) => f !== o.check);
    const outside = changed.filter((f) => !inside(f) && existsSync(join(root, f)));
    if (outside.length)
        problems.push(`files must be regular files inside the project: ${outside.join(", ")}`);
    const files = changed.filter((f) => RUNTIME_BY_EXT[extname(f)] && inside(f)).slice(0, 8);
    if (!files.length)
        problems.push("no changed source files found (git diff HEAD); pass --files a.py,b.py");
    const before = {};
    const after = {};
    for (const f of files) {
        const old = git(o.project, ["show", `HEAD:${f}`]);
        if (old !== null)
            before[f] = old;
        after[f] = readFileSync(join(root, f), "utf8");
    }
    const checkName = `cafe_check_${basename(o.check)}`;
    const kind = RUNTIME_BY_EXT[extname(o.check)];
    if (!kind)
        problems.push(`unsupported check type ${extname(o.check)} (use .py, .js/.cjs/.mjs/.ts or .sh)`);
    const all = [...Object.values(before), ...Object.values(after), readFileSync(checkPath, "utf8")].join("\n");
    const secrets = findSecrets(all);
    if (secrets.length)
        problems.push(`the files look like they contain secrets (${secrets.join(", ")}); remove them before capturing`);
    if (problems.length || !kind)
        return { problems, files };
    const capsule = {
        schema: CAPSULE_SCHEMA,
        title: o.title ?? `Fix in ${files.join(", ")}`,
        problem: { symptom: o.symptom ?? "(describe the error message)", description: "Captured locally with cafe capture.", tags: ["captured"], refs: [] },
        runtime: kind.runtime,
        applicability: { claims: {} },
        before: { files: before },
        after: { files: after },
        check: { run: [kind.interp, checkName], files: { [checkName]: readFileSync(checkPath, "utf8") }, timeout_ms: 20_000 },
        limitations: { proves: "The check fails on the committed code and passes with the change, in the replayed environment.", does_not_prove: "That the check covers every behavior of the code." },
        author: "local",
    };
    const v = validateCapsule(capsule);
    if (!v.ok)
        return { problems: v.errors, files };
    return { capsule: v.capsule, problems: [], files };
}
/** Replays the candidate in the sandbox and saves it only if the check is a real regression test. */
export async function capture(o, c) {
    const r = await replay(c, { bins: o.bins, isolation: o.isolation ?? "sandbox" });
    const p = r.predicate;
    const reasons = [];
    if (p.verdict === "PROBLEM_NOT_REPRODUCED")
        reasons.push("the check already passes on the committed code, so it does not test this fix");
    if (p.verdict === "FIX_FAILS")
        reasons.push("the check still fails with your change");
    if (p.verdict === "FIX_BREAKS")
        reasons.push("the check passes on the committed code but fails with your change");
    if (p.verdict === "ERROR")
        reasons.push("the check timed out or crashed");
    if (p.verdict === "PASS" && !(p.mutation.total > 0 && p.mutation.killed * 2 >= p.mutation.total)) {
        reasons.push(`the check caught only ${p.mutation.killed}/${p.mutation.total} mutants of the fix: it does not really test the changed lines`);
    }
    const lint = lintCapsule(c).map((f) => f.code);
    if (reasons.length)
        return { saved: null, verdict: p.verdict, mutation: p.mutation, reasons, lint };
    const dir = join(o.project, ".cafe", "capsules");
    mkdirSync(dir, { recursive: true });
    const name = (o.name ?? c.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "capsule";
    const file = join(dir, `${name}.json`);
    const row = { runtime: p.env.runtime, version: p.env.version, conditions: p.env.conditions, verdict: p.verdict, mutation: p.mutation, trust: "claimed", source: "this machine (cafe capture)" };
    writeFileSync(file, JSON.stringify({ capsule: c, local_results: [row], note: "Private. Share only with `cafe push`, after reviewing every file." }, null, 2) + "\n");
    return { saved: file, verdict: p.verdict, mutation: p.mutation, reasons: [], lint };
}
