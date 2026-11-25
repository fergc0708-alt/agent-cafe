// Signal's diagnosis of a dependency-update branch.
//
// Fail-first: the update is tested first (fresh copy of the tree, fresh install, fresh HOME). If it passes, Signal
// stops: one run, no baseline needed. Only when it fails does Signal re-run it (flakiness) and test the baseline:
// the SAME commit with only the dependency files reverted, in its own fresh copy and install. Then it compares WHICH
// TESTS fail (and how), so a red main neither hides a regression nor gets blamed on the update.
//
// Order matters for security: every git operation happens before any project code runs (see exec.ts).
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { Change } from "./protocol.ts";
import { dependencyDelta, type Delta } from "./delta.ts";
import { addCommand, changedSince, childEnv, copyTree, detectCommands, fingerprint, git, installedVersion, materialize, removeTree, safeSpec, sh, type PackageManager } from "./exec.ts";
import { infraProblem, messageKey, parseJunit, parseOutput, type FailedTest } from "./testparse.ts";
import { isolate, type Isolation, type Probe } from "./isolate.ts";

export type Verdict =
  | "regression" //            the update breaks tests that pass without it
  | "regression_on_red" //     main already fails some tests; the update breaks additional ones (or breaks them differently)
  | "pre_existing" //          the same tests fail the same way without the update: not caused by it
  | "flaky" //                 results changed between identical runs
  | "compatible" //            the update passed the tests that were run
  | "inconclusive"; //         the comparison could not be made reliably (install, infra, timeout, setup, tampering)

export interface RunRecord {
  side: "update" | "baseline";
  attempt: number; // 0 = isolation probe
  phase: "install" | "test";
  ok: boolean;
  timedOut: boolean;
  ms: number;
  failed: FailedTest[];
  runner: string;
  infra: string | null;
  tail?: string[]; // last lines of a failed install (untrusted text; escaped when rendered)
}

/** What the project's own CI reported (signal/ci-context.mjs), read before any project code ran. */
export interface CiContext {
  available: boolean;
  base: { state: "green" | "green_partial" | "red" | "unknown"; failed: string[]; passed: number; pending: boolean } | null;
  head: { state: "green" | "green_partial" | "red" | "unknown"; failed: string[]; passed: number; pending: boolean } | null;
  note?: string;
}

export interface Diagnosis {
  verdict: Verdict;
  confidence: "high" | "medium" | "low";
  reasons: string[]; // why this verdict and confidence, in plain words
  merge: string; // what this means for merging the PR
  next: string; // the single most useful next action
  delta: Pick<Delta, "base" | "files" | "otherFiles" | "changes" | "direct" | "primary">;
  newFailures: FailedTest[]; // fail with the update, pass without it (reproduced)
  changedFailures: { id: string; before: string; after: string }[]; // fail on both sides, with a different error
  preExisting: FailedTest[]; // fail with and without the update, the same way
  flipped: string[]; // tests whose result changed between identical runs
  runs: RunRecord[];
  isolation: Isolation | null;
  commands: { install: string; test: string; detected: string[] };
  ci: CiContext | null;
  limits: string[];
  cost: { runs: number; extraRuns: number; ms: number };
  env: { os: string; arch: string; node: string };
  integrity: "ok" | "changed";
  tampered: string[];
}

export interface Options {
  dir: string;
  base?: string; // default "auto"
  install?: string;
  test?: string;
  junit?: string; // path (relative to the project) of a JUnit XML report the test command writes
  retries?: number; // re-runs of a failing side (default 2, max 3); the baseline always runs 1 + retries times
  timeoutMs?: number; // per command
  isolate?: boolean; // default true
  isolateBudget?: number; // max extra runs for isolation (default 8)
  title?: string;
  ci?: CiContext | null;
  log?: (s: string) => void;
  /** Command that installs specific versions on top of an install, with "{specs}" for "name@version ..."
   *  (default: derived from the package manager, e.g. npm install --no-save). */
  addCommand?: string;
  env?: NodeJS.ProcessEnv; // base environment for project commands (default process.env), filtered by childEnv
}

type Pending = Omit<Diagnosis, "delta" | "runs" | "commands" | "limits" | "cost" | "env" | "integrity" | "tampered" | "isolation" | "ci" | "changedFailures"> & { isolation?: Isolation | null; changedFailures?: Diagnosis["changedFailures"] };

const ids = (fs: FailedTest[]) => new Set(fs.map((f) => f.id));
const sameIds = (a: FailedTest[], b: FailedTest[]) => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id));
/** Tests failing in every run of `rs` (with the message of the first run). */
const intersect = (rs: RunRecord[]) => rs.reduce<FailedTest[]>((acc, r, i) => (i === 0 ? r.failed : acc.filter((f) => r.failed.some((x) => x.id === f.id))), []);
/** pip/pytest into the job's own interpreter: both sides would share site-packages. */
const sharedPython = (cmd: string) => /\bpip3?\b[^\n]*\binstall\b/.test(cmd) && !/venv|virtualenv|\buv\b|poetry|conda|pipenv|--target|--prefix/.test(cmd);

export async function diagnose(o: Options): Promise<Diagnosis> {
  const t0 = Date.now();
  const log = o.log ?? (() => {});
  const baseEnv = o.env ?? process.env;
  // ---------- trusted phase: git only, no project code yet ----------
  if (git(o.dir, ["status", "--porcelain", "--untracked-files=no"]).out.trim()) throw new Error("the working tree has uncommitted changes to tracked files; commit or stash them first");
  const d = dependencyDelta(o.dir, o.base ?? "auto", o.title);
  if (!d.files.length || !d.changes.length) throw new Error(`no dependency change between ${d.base} and HEAD (no lockfile or manifest change in this project)`);
  const head = git(d.root, ["rev-parse", "HEAD"]).out.trim();
  const detected = detectCommands(join(d.root, d.prefix), d.root);
  const install = o.install ?? detected.install;
  const test = o.test ?? detected.test;
  if (!install) throw new Error(`no install command: pass --install (${detected.why.join("; ") || "no lockfile recognized"})`);
  if (!test) throw new Error("no test command: pass --test (package.json has no test script)");
  const retries = Math.max(0, Math.min(3, Number.isFinite(o.retries) ? Math.floor(o.retries!) : 2));
  const timeout = o.timeoutMs ?? 20 * 60_000;
  const pm: PackageManager | null = detected.pm;
  const canIsolate = o.isolate !== false && d.direct.length >= 2 && (!!o.addCommand || (!!pm && pm !== "python"));
  // Both trees are exported now, while no project code has run; every run works on a fresh copy of one of them.
  // (A malicious update could still edit these pristine copies, as the same user: that can only forge Signal's
  // verdict, which is advisory and documented as forgeable by the code under test.)
  const pristine = { update: materialize(d.root, head), baseline: materialize(d.root, head, d.files, d.base) };
  const scratch: string[] = [];
  const fresh = (side: "update" | "baseline") => {
    const dir = mkdtempSync(join(os.tmpdir(), `signal-${side}-`));
    scratch.push(dir);
    if (!copyTree(pristine[side], dir)) throw new Error(`could not copy the ${side} tree`);
    return dir;
  };
  const homes: string[] = [];
  const newHome = () => { const h = mkdtempSync(join(os.tmpdir(), "signal-home-")); homes.push(h); return h; };
  const before = fingerprint(d.root);
  const cleanup = () => { for (const p of [pristine.update, pristine.baseline, ...scratch, ...homes]) removeTree(p); };

  const runs: RunRecord[] = [];
  const limits: string[] = [];
  const ci = o.ci ?? null;

  const readFailures = (dir: string, out: string) => {
    if (o.junit) {
      try { return { failed: parseJunit(readFileSync(join(dir, o.junit), "utf8")), runner: "junit" }; } catch { /* fall back to output */ }
    }
    const p = parseOutput(out);
    return { failed: p.failed, runner: p.runner };
  };
  // Environment words count only where the failure is: the failing tests' messages, or the last lines when no
  // test could be named. A passing test that prints ECONNRESET does not make a real regression "inconclusive".
  const infraOf = (failed: FailedTest[], out: string) => infraProblem(failed.length ? failed.map((f) => f.message).join("\n") : out.slice(-4000));

  // One side = its exported tree, a fresh HOME, install once, test 1..N times.
  const runSide = async (side: "update" | "baseline", attempts: number, stopOnPass: boolean) => {
    const dir = join(fresh(side), d.prefix);
    const env = childEnv(newHome(), baseEnv);
    const recs: RunRecord[] = [];
    log(`[signal] ${side}: install (${install})`);
    const i = await sh(dir, install, timeout, env);
    if (!i.ok) {
      recs.push({ side, attempt: 1, phase: "install", ok: false, timedOut: i.timedOut, ms: i.ms, failed: [], runner: "", infra: infraProblem(i.log.slice(-20000)), tail: i.log.trimEnd().split("\n").slice(-12).map((l) => l.slice(0, 240)) });
      return { recs, dir };
    }
    for (let a = 1; a <= attempts; a++) {
      log(`[signal] ${side}: test run ${a}/${attempts} (${test})`);
      const r = await sh(dir, test, timeout, env);
      const f = readFailures(dir, r.log);
      recs.push({ side, attempt: a, phase: "test", ok: r.ok, timedOut: r.timedOut, ms: r.ms, failed: f.failed, runner: f.runner, infra: r.ok ? null : infraOf(f.failed, r.log) });
      if (r.timedOut || (stopOnPass && r.ok)) break;
      if (side === "update" && a === 1 && r.ok) break; // fail-first: a passing update needs nothing else
      const tests = recs.filter((x) => x.phase === "test");
      if (tests.some((x) => x.ok) && tests.some((x) => !x.ok)) break; // already known to be flaky
    }
    return { recs, dir };
  };

  const finish = (v: Pending): Diagnosis => {
    const tampered = changedSince(before, d.root);
    const result: Diagnosis = {
      ...v,
      changedFailures: v.changedFailures ?? [],
      isolation: v.isolation ?? null,
      delta: { base: d.base, files: d.files, otherFiles: d.otherFiles, changes: d.changes, direct: d.direct, primary: d.primary },
      runs, commands: { install, test, detected: o.install && o.test ? [] : detected.why }, ci, limits,
      cost: { runs: runs.length, extraRuns: Math.max(0, runs.filter((r) => r.phase === "test").length - 1), ms: Date.now() - t0 },
      env: { os: process.platform, arch: process.arch, node: process.versions.node },
      integrity: tampered.length ? "changed" : "ok", tampered,
    };
    if (tampered.length) {
      result.verdict = "inconclusive"; result.confidence = "low";
      result.reasons.unshift(`the project's code modified files it must not touch (${tampered.slice(0, 3).join(", ")}${tampered.length > 3 ? ", …" : ""}): treat this result, and anything later steps of this job do, as untrusted`);
      result.merge = "Do not merge: something in this update tampered with the repository or the runner.";
      result.next = "Inspect the update's install scripts; do not reuse this runner's workspace.";
    }
    return result;
  };
  const capConfidence = (v: Pending, max: "medium" | "low", why: string): Pending => {
    const order = { high: 2, medium: 1, low: 0 } as const;
    if (order[v.confidence] > order[max]) { v.confidence = max; v.reasons.push(why); }
    return v;
  };
  // Signal's reproduction vs the project's own CI. A disagreement means Signal's commands do not reproduce what
  // CI runs (a missing build step, a service, another OS): the comparison is then not about the same thing.
  const anchor = (v: Pending): Pending => {
    if (!ci?.available) {
      if (v.verdict === "pre_existing") capConfidence(v, "medium", "the project's own CI status for the base commit was not available to confirm that main is red there too");
      return v;
    }
    const baseGreen = ci.base?.state === "green";
    const headRed = (ci.head?.failed.length ?? 0) > 0;
    if (v.verdict === "compatible" && headRed) {
      return { ...v, verdict: "inconclusive", confidence: "low", reasons: [...v.reasons, `but the project's CI failed on this PR (${ci.head!.failed.slice(0, 3).join(", ")}): it runs something that \`${test}\` does not reproduce here`], merge: "Not shown safe: your CI is red for a reason Signal did not reproduce.", next: `Open the failing CI check (${ci.head!.failed[0]}) or point \`test\` at the same command it runs.` };
    }
    if ((v.verdict === "pre_existing" || v.verdict === "regression_on_red") && baseGreen) {
      return { ...v, verdict: "inconclusive", confidence: "low", reasons: [...v.reasons, "but the project's own CI is green on the base commit, while Signal's baseline fails: Signal's setup does not reproduce your CI (a missing build step, service or environment variable)"], merge: "Unknown: the baseline here does not match your CI.", next: "Make `install`/`test` match what your CI runs (e.g. add the build step), then re-run." };
    }
    if (v.verdict === "pre_existing" && ci.base?.state !== "red") capConfidence(v, "medium", "the project's CI did not report the base commit as red, so the red baseline is only Signal's observation");
    return v;
  };

  limits.push(`Only this runner was tested: ${process.platform}/${process.arch}, Node ${process.versions.node}. Other OSes and runtime versions were not.`);
  limits.push(`Only what \`${test}\` runs was tested; "compatible" means no failure in that scope, not universal compatibility.`);
  if (d.otherFiles.length) limits.push(`The branch also changes ${d.otherFiles.length} non-dependency file(s); the baseline keeps them, so it is "this branch's code with the old dependencies", not the base commit.`);
  if (sharedPython(install)) limits.push("The install command uses pip without a virtualenv: both sides may share the job's interpreter, so the baseline is not guaranteed to have the old versions.");

  try {
    // ---------- 1. the update ----------
    const u = await runSide("update", 1 + retries, false);
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
    const uAll = u.recs.filter((r) => r.phase === "test");
    if (uAll.some((r) => r.timedOut)) {
      return finish({ verdict: "inconclusive", confidence: "low", reasons: [`the tests with the update exceeded the ${Math.round(timeout / 60000)}-minute timeout`], merge: "Unknown.", next: "Raise `timeout-minutes` or point `test` at a faster suite.", newFailures: [], preExisting: [], flipped: [] });
    }
    if (uAll.length === 1 && uAll[0].ok) {
      return finish(anchor({
        verdict: "compatible", confidence: "high",
        reasons: ["the tests pass with the update on a fresh install; no baseline was needed (fail-first: Signal only compares when something fails)"],
        merge: "Safe to merge as far as these tests can tell.",
        next: "Merge (or let automerge do it).",
        newFailures: [], preExisting: [], flipped: [],
      }));
    }
    const uFailed = intersect(uAll);
    const everNamed = uAll.every((r) => r.failed.length > 0);
    const uFlipped = [...new Set(uAll.flatMap((r) => r.failed.map((f) => f.id)))].filter((id) => !uFailed.some((f) => f.id === id));
    if (uAll.some((r) => r.ok) || (everNamed && uFailed.length === 0)) {
      const failing = uAll.filter((r) => !r.ok);
      const flipped = [...new Set(failing.flatMap((r) => r.failed.map((f) => f.id)))];
      return finish({
        verdict: "flaky", confidence: "medium",
        reasons: [uAll.some((r) => r.ok) ? `the same update failed ${failing.length} of ${uAll.length} identical runs and passed the others` : `every run with the update failed, but a different set of tests each time (no test failed in all ${uAll.length} runs)`],
        merge: "The update is not shown to be at fault. Merge if a re-run passes; fix or quarantine the flaky tests separately.",
        next: flipped.length ? `Quarantine or fix the flaky test(s): ${flipped.slice(0, 3).join(", ")}.` : "Re-run the job; investigate the flaky test separately.",
        newFailures: [], preExisting: [], flipped,
      });
    }
    const uInfra = uAll.map((r) => r.infra).find(Boolean);
    if (uInfra) {
      return finish({ verdict: "inconclusive", confidence: "low", reasons: [`the failing tests show ${uInfra}: an environment problem can produce the same failure with or without the update`], merge: "Unknown.", next: "Re-run the job. If it persists, check whether the tests need network access.", newFailures: uFailed, preExisting: [], flipped: uFlipped });
    }

    // ---------- 2. the baseline (only now), always 1 + retries runs ----------
    const b = await runSide("baseline", 1 + retries, false);
    runs.push(...b.recs);
    if (b.recs[0].phase === "install") {
      return finish({
        verdict: "inconclusive", confidence: "low",
        reasons: ["the update fails its tests reproducibly, but the baseline (old dependencies) could not be installed, so the failure cannot be attributed", b.recs[0].infra ? `baseline install: ${b.recs[0].infra}` : "baseline install failed"],
        merge: "Do not merge until the failure is understood.", next: "Read the failing tests below; the baseline install error is in the job log.",
        newFailures: uFailed, preExisting: [], flipped: uFlipped,
      });
    }
    const bTests = b.recs.filter((r) => r.phase === "test");
    if (bTests.some((r) => r.timedOut)) return finish({ verdict: "inconclusive", confidence: "low", reasons: ["the baseline tests timed out"], merge: "Unknown.", next: "Raise `timeout-minutes`.", newFailures: uFailed, preExisting: [], flipped: uFlipped });
    const bPassed = bTests.filter((r) => r.ok).length;
    const bPass = bPassed === bTests.length;
    const bFlaky = bPassed > 0 && !bPass;
    const bFailed = intersect(bTests.filter((r) => !r.ok));
    const bInfra = bTests.map((r) => r.infra).find(Boolean);
    const identified = uFailed.length > 0;
    const reasons: string[] = [
      `with the update: failed ${uAll.length}/${uAll.length} runs${identified ? ` (${uFailed.length} failing test${uFailed.length > 1 ? "s" : ""} identified, ${uAll[0].runner} output)` : " (failing tests could not be identified from the output)"}`,
      `without it (same commit, only ${d.files.join(", ")} reverted, fresh install, same runner): ${bPass ? `passed ${bTests.length}/${bTests.length}` : bFlaky ? `flaky (${bPassed}/${bTests.length} passed)` : `failed ${bTests.length}/${bTests.length}`}`,
    ];

    const doIsolate = async (newIds: Set<string>): Promise<Isolation | null> => {
      if (!canIsolate) return null;
      const baseModules = join(b.dir, "node_modules");
      const budget = o.isolateBudget ?? 8;
      const probe: Probe = async (side, apply) => {
        const src = fresh(side);
        const dir = join(src, d.prefix);
        const env = childEnv(newHome(), baseEnv);
        try {
          if (apply.some((c) => !c.to)) return { outcome: "error", note: "removing a dependency cannot be applied in isolation" };
          const specs = apply.map((c) => `${c.package}@${c.to}`);
          if (apply.some((c) => !safeSpec(c.package, c.to!))) return { outcome: "error", note: "a package name or version has characters Signal will not pass to a shell" };
          if (side === "baseline" && copyTree(baseModules, join(dir, "node_modules"))) { /* reuse the baseline install */ }
          else { const i = await sh(dir, install, timeout, env); if (!i.ok) return { outcome: "error", note: "install failed" }; }
          const quoted = specs.map((x) => `'${x}'`).join(" ");
          const cmd = o.addCommand ? o.addCommand.replace("{specs}", () => quoted) : addCommand(pm!, install, specs);
          if (!cmd) return { outcome: "error", note: "package manager not supported for isolation" };
          const a = await sh(dir, cmd, timeout, env);
          if (!a.ok) return { outcome: "error", note: `could not install ${specs.join(" ")}` };
          for (const c of apply) {
            const got = installedVersion(dir, c.package);
            if (got !== c.to) return { outcome: "error", note: `${c.package} installed as ${got ?? "missing"}, not ${c.to}` };
          }
          const r = await sh(dir, test, timeout, env);
          const f = readFailures(dir, r.log).failed;
          runs.push({ side, attempt: 0, phase: "test", ok: r.ok, timedOut: r.timedOut, ms: r.ms, failed: f, runner: "probe", infra: null });
          if (r.timedOut) return { outcome: "error", note: "timed out" };
          const hasNew = newIds.size ? f.some((x) => newIds.has(x.id)) : !r.ok;
          return { outcome: hasNew ? "new_failures" : "clean" };
        } finally {
          removeTree(src);
        }
      };
      log(`[signal] isolating the responsible update among ${d.direct.length} direct changes (budget ${budget} runs)`);
      return isolate(d.direct, probe, budget);
    };
    const culpritOf = (iso: Isolation | null) => (iso?.status === "single" && iso.culprits.length === 1 ? iso.culprits[0] : d.direct.length === 1 ? d.direct[0] : null);

    if (bFlaky) {
      return finish({ verdict: "flaky", confidence: "medium", reasons: [...reasons, "the baseline itself gives different results on identical runs"], merge: "Not attributable: the suite is unstable without the update too.", next: "Fix the flaky tests on the base branch first.", newFailures: [], preExisting: bFailed, flipped: uFlipped });
    }
    if (!bPass && bInfra) {
      return finish({ verdict: "inconclusive", confidence: "low", reasons: [...reasons, `the baseline failures show ${bInfra}, so the two sides are not comparable`], merge: "Unknown.", next: "Re-run the job; if it persists, the tests need network or resources this runner lacks.", newFailures: uFailed, preExisting: [], flipped: uFlipped });
    }
    if (bPass) {
      const iso = await doIsolate(ids(uFailed));
      const culprit = culpritOf(iso);
      let v: Pending = {
        verdict: "regression", confidence: identified ? "high" : "medium",
        reasons: [...reasons, ...(identified ? [] : ["confidence is medium because the failing tests could not be named (pass `junit` for exact test names)"])],
        merge: "Do not merge: the update breaks tests that pass without it.",
        next: culprit
          ? `Fix the code for ${culprit.package} ${culprit.to}, or keep ${culprit.package} at ${culprit.from} (Renovate: allowedVersions "<${culprit.to}"; Dependabot: an ignore rule)${d.direct.length > 1 ? " and merge the other updates separately" : ""}.`
          : iso?.status === "single" ? `Upgrade ${iso.culprits.map((c) => c.package).join(" and ")} together and fix the code for them; merge the other updates separately.`
          : iso?.status === "interaction" ? `Upgrade ${iso.culprits.map((c) => c.package).join(" and ")} together and fix them as one change; merge the other updates separately.`
          : "Read the new failures below; split the group to find the responsible update if needed.",
        newFailures: uFailed, preExisting: [], flipped: uFlipped, isolation: iso,
      };
      if (bTests.length < 2 && v.confidence === "high") v = capConfidence(v, "medium", "the baseline ran only once (retries 0), so a flaky test is not ruled out");
      if (sharedPython(install)) v = capConfidence(v, "medium", "both sides may have shared one Python interpreter");
      return finish(anchor(v));
    }
    // ---------- baseline fails reproducibly ----------
    if (!identified || bFailed.length === 0) {
      return finish(anchor({
        verdict: "pre_existing", confidence: "low",
        reasons: [...reasons, "both fail, but the failing tests could not be compared (not identified in the output), so a new failure hidden behind the old ones cannot be ruled out"],
        merge: "The baseline is already red; this PR cannot be judged until it is fixed.", next: "Fix the base branch, then re-run this PR. Pass `junit` so Signal can compare individual tests.",
        newFailures: [], preExisting: bFailed, flipped: uFlipped,
      }));
    }
    const newOnes = uFailed.filter((f) => !bFailed.some((x) => x.id === f.id));
    const fixed = bFailed.filter((f) => !uFailed.some((x) => x.id === f.id));
    // same test red on both sides, but with a different error in every run: the update changed how it fails
    const keys = (rs: RunRecord[], id: string) => new Set(rs.map((r) => messageKey(r.failed.find((f) => f.id === id)?.message ?? "")));
    const bFail = bTests.filter((r) => !r.ok);
    const changed = uFailed
      .filter((f) => bFailed.some((x) => x.id === f.id))
      .filter((f) => { const ku = keys(uAll, f.id), kb = keys(bFail, f.id); return ku.size === 1 && kb.size === 1 && [...ku][0] !== [...kb][0] && [...ku][0] !== "" && [...kb][0] !== ""; })
      .map((f) => ({ id: f.id, before: bFailed.find((x) => x.id === f.id)!.message, after: f.message }));
    if (newOnes.length === 0 && changed.length === 0) {
      let v: Pending = {
        verdict: "pre_existing", confidence: sameIds(uFailed, bFailed) ? "high" : "medium",
        reasons: [...reasons, sameIds(uFailed, bFailed) ? `exactly the same ${bFailed.length} test(s) fail without the update, with the same errors` : `every test that fails with the update also fails without it, the same way${fixed.length ? ` (and ${fixed.length} pass with it)` : ""}`],
        merge: d.otherFiles.length ? "Not caused by the dependency update: the same tests fail with the old dependencies on this branch's code." : "Not caused by the update: the base branch is already red. Safe to merge as far as the update is concerned.",
        next: `Fix ${bFailed.slice(0, 2).map((f) => f.id).join(", ")}${bFailed.length > 2 ? ", …" : ""} ${d.otherFiles.length ? "(this branch also changes other files: check them first)" : "on the base branch"}; this PR can be judged independently.`,
        newFailures: [], preExisting: bFailed, flipped: uFlipped,
      };
      if (d.otherFiles.length) v = capConfidence(v, "low", `the branch also changes ${d.otherFiles.length} non-dependency file(s), which are on both sides`);
      return finish(anchor(v));
    }
    const iso = newOnes.length ? await doIsolate(ids(newOnes)) : null;
    const culprit = culpritOf(iso);
    return finish(anchor({
      verdict: "regression_on_red", confidence: newOnes.length ? "high" : "medium",
      reasons: [...reasons, newOnes.length ? `${newOnes.length} test(s) fail only with the update; ${bFailed.length} already failed without it` : `no new failing test, but ${changed.length} test(s) that already failed now fail with a different error`],
      merge: "Do not merge: besides the failures already on the base branch, the update breaks other tests (or breaks them differently).",
      next: culprit ? `Fix the code for ${culprit.package} ${culprit.to} or keep it at ${culprit.from}; the pre-existing failures are a separate problem.` : changed.length && !newOnes.length ? `Compare the errors of ${changed[0].id} before and after the update (below).` : "Fix the new failures below (the pre-existing ones are a separate problem on the base branch).",
      newFailures: newOnes, changedFailures: changed, preExisting: bFailed.filter((f) => !changed.some((c) => c.id === f.id)), flipped: uFlipped, isolation: iso,
    }));
  } finally {
    cleanup();
  }
}

export type { Change };
