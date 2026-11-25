// One benchmark case in one mode, inside the sandbox user (see .github/workflows/bench-*.yml).
// This file is the REFERENCE harness and the launcher for Signal and lastgreen. It shares no code with Signal.
//
//   node case.mjs <mode> <case.json> <outdir> [signal-dist-dir]
//   mode: ref-base | ref-head | signal | lastgreen
//
// Everything this process writes can be altered by the code under test (same user): results are evidence
// produced next to untrusted code, as documented in PROTOCOL.md.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, readSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

const [, , MODE, CASE_FILE, OUT, SIGNAL_DIST] = process.argv;
const c = JSON.parse(readFileSync(CASE_FILE, "utf8"));
mkdirSync(OUT, { recursive: true });
const WORK = join(process.env.HOME, "w");
const PROJ = c.project_dir ? join(WORK, c.project_dir) : WORK;
const T0 = Date.now();
const BUDGET_MS = 52 * 60_000; // the job is killed at 60 minutes
const RUN_TIMEOUT_MS = 10 * 60_000;
const N_RUNS = 5;
const result = { case_id: c.id, mode: MODE, head_sha: c.head_sha, base_sha: c.base_sha, started: new Date().toISOString(), node: process.version, steps: [], errors: [] };
const save = () => { result.elapsed_ms = Date.now() - T0; writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 1)); };

function tailOf(file, max = 200_000) {
  try {
    const size = statSync(file).size, len = Math.min(size, max), fd = openSync(file, "r"), b = Buffer.alloc(len);
    readSync(fd, b, 0, len, size - len); closeSync(fd); return b.toString("utf8");
  } catch { return ""; }
}

/** Runs a shell command in its own process group with a hard timeout; output to a log file. */
function run(label, cmd, cwd, timeoutMs, extraEnv = {}) {
  return new Promise((resolve) => {
    const log = join(OUT, `${label}.log`);
    const fd = openSync(log, "w");
    const t = Date.now();
    const env = { ...process.env, CI: "true", ...extraEnv };
    const child = spawn("bash", ["-c", cmd], { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
    let timedOut = false;
    const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const fin = (code, signal) => {
      clearTimeout(timer); kill(); closeSync(fd);
      const step = { label, cmd, exit: code, signal: signal ?? null, timed_out: timedOut, ms: Date.now() - t, log: `${label}.log` };
      result.steps.push(step); save();
      resolve({ ...step, out: tailOf(log) });
    };
    child.on("error", () => fin(127, null));
    child.on("exit", fin);
  });
}

const sh = (cmd, cwd = WORK) => spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" } });
const remaining = () => BUDGET_MS - (Date.now() - T0);

// ---------------------------------------------------------------- source (git only, no project code)
function fetchSource(sha, depth) {
  mkdirSync(WORK, { recursive: true });
  const url = `https://github.com/${c.repo}.git`;
  const g = (a) => sh(`git -c core.hooksPath=/dev/null -c credential.helper= ${a}`);
  g("init -q");
  let r = g(`fetch -q --depth=${depth} ${url} ${sha}`);
  if (r.status !== 0) r = g(`fetch -q --depth=${depth + 1} ${url} refs/pull/${c.number}/head`);
  const co = g(`-c advice.detachedHead=false checkout -q ${sha}`);
  if (co.status !== 0) { result.errors.push(`source: ${sha} not fetchable (${(r.stderr || co.stderr).trim().split("\n")[0]})`); return false; }
  result.source = { sha: sh("git rev-parse HEAD").stdout.trim(), tree: sh("git rev-parse HEAD^{tree}").stdout.trim() };
  return true;
}

// ---------------------------------------------------------------- per-test results (jest/vitest JSON, independent parser)
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
export function normMessage(m) {
  // first 4 non-empty lines that are not stack frames: jest's first line is generic ("expect(received).toBe(expected)");
  // the expected/received values follow
  const line = String(m ?? "").replace(ANSI, "").split("\n").map((l) => l.trim()).filter((l) => l && !/^at\s/.test(l)).slice(0, 4).join(" | ");
  return line.split(PROJ).join("<root>").split(WORK).join("<root>").replace(/:\d+:\d+/g, ":L:C").replace(/\d+(\.\d+)?\s?(ms|s)\b/g, "<dur>").replace(/\s+/g, " ").slice(0, 600);
}
function readTests(file) {
  let j;
  try { j = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  if (!Array.isArray(j?.testResults)) return null;
  const tests = [];
  for (const tr of j.testResults) {
    const f = relative(PROJ, String(tr.name ?? tr.testFilePath ?? "")) || String(tr.name ?? "?");
    const as = tr.assertionResults ?? tr.testResults ?? [];
    if (!as.length && (tr.status === "failed" || tr.failureMessage || tr.message)) tests.push({ id: `${f} > [suite]`, status: "failed", message: normMessage(tr.failureMessage ?? tr.message) });
    for (const a of as) {
      const titles = [...(a.ancestorTitles ?? []), a.title ?? a.fullName ?? "?"];
      tests.push({ id: `${f} > ${titles.join(" > ")}`, status: a.status, message: a.status === "failed" ? normMessage((a.failureMessages ?? [])[0]) : undefined });
    }
  }
  return { tests, numFailed: j.numFailedTests ?? null, numTotal: j.numTotalTests ?? null, success: j.success ?? null };
}

// ---------------------------------------------------------------- modes
async function reference(side) {
  const sha = side === "base" ? c.base_sha : c.head_sha;
  if (!fetchSource(sha, 1)) return save();
  result.install = [];
  for (let i = 1; i <= 2; i++) {
    if (i === 2) sh("rm -rf node_modules", PROJ);
    const r = await run(`install-${i}`, c.install, PROJ, 15 * 60_000);
    result.install.push({ attempt: i, exit: r.exit, timed_out: r.timed_out, ms: r.ms });
    if (r.exit === 0) break;
  }
  if (result.install.at(-1).exit !== 0) { result.install_ok = false; return save(); }
  result.install_ok = true;
  const inj = c.inject;
  result.per_test = !!inj;
  result.runs = [];
  for (let i = 1; i <= N_RUNS; i++) {
    if (i > 3 && remaining() < RUN_TIMEOUT_MS + 60_000) { result.errors.push(`stopped after ${i - 1} runs: job time budget`); break; }
    const jsonOut = join(OUT, `tests-${i}.json`);
    rmSync(jsonOut, { force: true });
    let cmd = c.test;
    if (inj) {
      const flags = inj.runner === "jest" ? `--json --outputFile=${jsonOut}` : `--reporter=json --outputFile=${jsonOut}`;
      const bin = existsSync(join(PROJ, "node_modules/.bin", inj.runner)) ? `./node_modules/.bin/${inj.runner}` : join(WORK, "node_modules/.bin", inj.runner);
      cmd = `env ${inj.env.join(" ")} ${bin} ${inj.args.join(" ")} ${flags}`.replace(/\s+/g, " ");
    }
    const r = await run(`test-${i}`, cmd, PROJ, RUN_TIMEOUT_MS);
    const parsed = inj ? readTests(jsonOut) : null;
    result.runs.push({ run: i, exit: r.exit, timed_out: r.timed_out, ms: r.ms, tests: parsed?.tests ?? null, json_ok: !!parsed });
    save();
    if (r.timed_out) break;
  }
  save();
}

async function signal() {
  if (!fetchSource(c.head_sha, 2)) return save();
  const ciFile = join(OUT, "ci-context.json");
  // what the project's CI reported (frozen before the benchmark), in the format ci-context.mjs writes
  const ci = (x) => (x && x.state !== "unknown" ? { state: x.state === "pending" ? "unknown" : x.state, failed: x.failed ?? [], passed: x.passed ?? 0, pending: (x.pending ?? 0) > 0 } : null);
  writeFileSync(ciFile, JSON.stringify({ available: !!(c.ci_head?.state && c.ci_head.state !== "unknown"), base: ci(c.ci_base), head: ci(c.ci_head), note: "frozen before the benchmark" }));
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const cmd = [`node ${SIGNAL_DIST}/cli/cafe.js signal diagnose`, `--dir ${q(PROJ)}`, `--base ${c.base_sha}`, `--install ${q(c.install)}`, `--test ${q(c.test)}`,
    "--retries 2", "--timeout-minutes 10", "--offline", `--ci-context ${q(ciFile)}`, `--json ${q(join(OUT, "signal.json"))}`, `--markdown ${q(join(OUT, "signal.md"))}`].join(" ");
  const r = await run("signal", cmd, WORK, BUDGET_MS - 60_000);
  result.signal_exit = r.exit;
  result.signal_timed_out = r.timed_out;
  try { const d = JSON.parse(readFileSync(join(OUT, "signal.json"), "utf8")); result.signal = { verdict: d.verdict, confidence: d.confidence, newFailures: d.newFailures?.map((f) => f.id), changedFailures: d.changedFailures?.map((f) => f.id), preExisting: d.preExisting?.map((f) => f.id), flipped: d.flipped, isolation: d.isolation ? { status: d.isolation.status, culprits: d.isolation.culprits?.map((x) => x.package) } : null, cost: d.cost, integrity: d.integrity, reasons: d.reasons }; }
  catch { result.errors.push("signal produced no JSON"); }
  save();
}

async function lastgreen() {
  if (c.pm !== "npm") { result.errors.push("lastgreen supports npm lockfiles only: not run"); result.not_applicable = true; return save(); }
  if (!fetchSource(c.head_sha, 2)) return save();
  const i = await run("install", c.install, PROJ, 15 * 60_000);
  result.install_ok = i.exit === 0;
  if (i.exit !== 0) return save();
  const lgOut = join(OUT, "lastgreen.json");
  const cmd = `npx --yes lastgreen@0.3.0 why --from-git ${c.base_sha} -c ${JSON.stringify(c.test)} --json --repeat 3 --max-runs 30 --timeout 600 > ${JSON.stringify(lgOut)}`;
  const r = await run("lastgreen", cmd, PROJ, BUDGET_MS - (Date.now() - T0) - 60_000);
  result.lastgreen_exit = r.exit;
  result.lastgreen_timed_out = r.timed_out;
  try { const j = JSON.parse(readFileSync(lgOut, "utf8")); result.lastgreen = { status: j.status ?? null, confirmed: j.confirmed ?? null, culprit: j.culprit ?? null, flakySide: j.flakySide ?? null, runs: j.runs ?? null, executions: j.executions ?? null, durationMs: j.durationMs ?? null }; }
  catch { result.errors.push("lastgreen produced no JSON"); }
  save();
}

save();
try {
  if (MODE === "ref-base") await reference("base");
  else if (MODE === "ref-head") await reference("head");
  else if (MODE === "signal") await signal();
  else if (MODE === "lastgreen") await lastgreen();
  else throw new Error(`unknown mode ${MODE}`);
} catch (e) { result.errors.push(`harness: ${e.message}`); }
result.finished = new Date().toISOString();
save();
