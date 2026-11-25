// Signal diagnosis: parsers, verdict logic and the full experiment on real git repositories. Installs are real
// (a fresh node_modules per side) but come from a local fixture registry, so the tests run offline.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { parseJunit, parseOutput, infraProblem } from "../signal/testparse.ts";
import { npmLock, pnpmLock, requirements, tomlLock, yarnLock, updateFromTitle, diffVersions } from "../signal/lockfiles.ts";
import { diagnose } from "../signal/diagnose.ts";
import { isolate, type Probe } from "../signal/isolate.ts";
import { childEnv, detectCommands, sh } from "../signal/exec.ts";
import { flags, preflight } from "../signal/cli.ts";
import { units } from "../signal/isolate.ts";
import { renderMarkdown, md } from "../signal/report.ts";
import type { Change } from "../signal/protocol.ts";

// ---------------------------------------------------------------- fixture repositories
// A tiny "registry": package -> version -> module source. install.js materializes package-lock.json into
// node_modules; add.js installs explicit versions on top (used by isolation).
const REGISTRY = {
  left: { "1.0.0": "exports.pad = (s, n) => String(s).padStart(n);", "2.0.0": "exports.padStart = (s, n) => String(s).padStart(n);" },
  right: { "1.0.0": "exports.v = 1;", "1.1.0": "exports.v = 1;" },
  utilx: { "1.0.0": "exports.mode = 'a';", "2.0.0": "exports.mode = 'b';" },
  flag: { "1.0.0": "exports.on = false;", "2.0.0": "exports.on = true;" },
};
const INSTALL = `
const fs=require('fs'),p=require('path');const reg=JSON.parse(fs.readFileSync('reg.json','utf8'));
if(fs.existsSync('install-fails'))process.exit(1);
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));fs.rmSync('node_modules',{recursive:true,force:true});
for(const [k,v] of Object.entries(lock.packages)){if(!k)continue;const n=k.slice(13);const d=p.join('node_modules',n);fs.mkdirSync(d,{recursive:true});
fs.writeFileSync(p.join(d,'index.js'),reg[n][v.version]);fs.writeFileSync(p.join(d,'package.json'),JSON.stringify({name:n,version:v.version}));}`;
const ADD = `
const fs=require('fs'),p=require('path');const reg=JSON.parse(fs.readFileSync('reg.json','utf8'));
for(const s of process.argv.slice(2)){const i=s.lastIndexOf('@');const n=s.slice(0,i),v=s.slice(i+1);const d=p.join('node_modules',n);fs.mkdirSync(d,{recursive:true});
fs.writeFileSync(p.join(d,'index.js'),reg[n][v]);fs.writeFileSync(p.join(d,'package.json'),JSON.stringify({name:n,version:v}));}`;

type Deps = Record<string, string>;
const lock = (deps: Deps) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...Object.fromEntries(Object.entries(deps).map(([k, v]) => [`node_modules/${k}`, { version: v }])) } });
const manifest = (deps: Deps) => JSON.stringify({ name: "app", private: true, scripts: { test: "node --test --test-reporter=tap" }, dependencies: Object.fromEntries(Object.keys(deps).map((k) => [k, "*"])) });

function repo(opts: { base: Deps; update: Deps; tests: Record<string, string>; extraBase?: Record<string, string> }) {
  const d = mkdtempSync(join(os.tmpdir(), "signal-t-"));
  const g = (...a: string[]) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: d, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  writeFileSync(join(d, "reg.json"), JSON.stringify(REGISTRY));
  writeFileSync(join(d, "install.js"), INSTALL);
  writeFileSync(join(d, "add.js"), ADD);
  writeFileSync(join(d, ".gitignore"), "node_modules\n");
  mkdirSync(join(d, "test"));
  for (const [f, src] of Object.entries(opts.tests)) writeFileSync(join(d, "test", f), src);
  for (const [f, src] of Object.entries(opts.extraBase ?? {})) writeFileSync(join(d, f), src);
  writeFileSync(join(d, "package.json"), manifest(opts.base));
  writeFileSync(join(d, "package-lock.json"), lock(opts.base));
  g("add", "-A"); g("commit", "-qm", "base");
  g("checkout", "-qb", "renovate/deps");
  writeFileSync(join(d, "package.json"), manifest(opts.update));
  writeFileSync(join(d, "package-lock.json"), lock(opts.update));
  g("commit", "-qam", "Update dependencies");
  return d;
}
const T = (name: string, body: string) => `{const test=require('node:test');const assert=require('node:assert');test(${JSON.stringify(name)},()=>{${body}});}\n`;
const run = (dir: string, extra: Partial<Parameters<typeof diagnose>[0]> = {}) =>
  diagnose({ dir, base: "main", install: "node install.js", addCommand: "node add.js {specs}", retries: 1, ...extra });

const PAD = T("pads", "const l=require('left');assert.equal(l.pad('a',3),'  a');");
const OK = T("always ok", "assert.ok(true);");
const MAIN_RED = T("already broken on main", "assert.equal(1,2,'main is red');");
const ci = (base: "green" | "red", head: "green" | "red") => ({
  available: true,
  base: { state: base, failed: base === "red" ? ["test"] : [], passed: 3, pending: false },
  head: { state: head, failed: head === "red" ? ["build (ubuntu)"] : [], passed: 2, pending: false },
});

// ---------------------------------------------------------------- parsers
describe("test output parsing", () => {
  it("names failing tests for the common runners", () => {
    const vitest = parseOutput(" FAIL  test/a.test.ts > math > adds\nAssertionError: expected 3 to be 4\n Tests  1 failed | 4 passed (5)\n");
    expect(vitest.runner).toBe("vitest");
    expect(vitest.failed).toEqual([{ id: "test/a.test.ts > math > adds", message: "AssertionError: expected 3 to be 4" }]);
    const jest = parseOutput("FAIL src/x.test.js\n  ● sum › adds numbers\n\n    expect(received).toBe(expected)\n\nTests:       1 failed, 2 passed, 3 total\n");
    expect(jest.failed[0].id).toBe("src/x.test.js > sum > adds numbers"); // file kept: same name in two files ≠ same test
    expect(jest.totals).toEqual({ failed: 1, passed: 2 });
    const tap = parseOutput("TAP version 13\nnot ok 1 - pads\n  ---\n  location: '/tmp/x/test/a.test.js:3:1'\n  error: 'Expected values to be strictly equal'\n  ...\nok 2 - other\nnot ok 3 - skipped one # SKIP\n# pass 1\n# fail 1\n");
    expect(tap.failed.map((f) => f.id)).toEqual(["test/a.test.js > pads"]);
    expect(tap.failed[0].message).toBe("Expected values to be strictly equal");
    const pytest = parseOutput("FAILED tests/test_a.py::test_parse - AssertionError: assert 1 == 2\nERROR tests/test_b.py - ImportError: cannot import name 'x'\n==== 1 failed, 3 passed in 0.1s ====\n");
    expect(pytest.failed.map((f) => f.id)).toEqual(["tests/test_a.py::test_parse", "tests/test_b.py"]);
    const mocha = parseOutput("  2 passing\n  1 failing\n\n  1) Array\n       #indexOf()\n         returns -1:\n     AssertionError: expected 1 to equal -1\n");
    expect(mocha.failed[0].id).toBe("Array > #indexOf() > returns -1");
    expect(parseOutput("all good\n").failed).toEqual([]);
    const tsc = parseOutput("src/a.ts(12,5): error TS2339: Property 'pad' does not exist on type 'typeof import(\"left\")'.\n");
    expect(tsc.runner).toBe("tsc");
    expect(tsc.failed[0].id).toBe("src/a.ts TS2339");
  });

  it("stays linear on hostile output (no regex blow-up, bounded input)", () => {
    const t0 = Date.now();
    parseOutput("= ".repeat(200_000) + "x");
    parseOutput(" ".repeat(300_000) + "1 failing");
    parseJunit("<testcase " + "a".repeat(500_000));
    parseOutput("x".repeat(30 << 20));
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("reads JUnit XML", () => {
    const xml = `<testsuite><testcase classname="a.test.js" name="pads"><failure message="expected &apos;a&apos;">stack</failure></testcase><testcase classname="b" name="ok"/></testsuite>`;
    expect(parseJunit(xml).map((f) => f.id)).toEqual(["a.test.js > pads"]);
  });

  it("recognizes infrastructure failures", () => {
    expect(infraProblem("npm ERR! code ENOTFOUND\nnpm ERR! request to https://registry.npmjs.org failed")).toMatch(/DNS/);
    expect(infraProblem("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory")).toMatch(/memory/);
    expect(infraProblem("AssertionError: expected 1 to be 2")).toBeNull();
  });
});

describe("lockfiles", () => {
  it("reads npm (v3), pnpm, yarn, requirements and uv/poetry lockfiles", () => {
    const multi = npmLock(JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@babel/core/node_modules/semver": { version: "6.3.1" }, "node_modules/semver": { version: "7.6.3" }, "packages/app": { version: "1.0.0" } } }));
    expect(multi.get("semver")).toBe("7.6.3");
    expect(pnpmLock("importers:\n  .:\n    dependencies:\n      semver:\n        specifier: ^7\n        version: 7.6.3\npackages:\n  semver@6.3.1:\n    x: y\n").get("semver")).toBe("7.6.3");
    expect([...yarnLock('"resolve@patch:resolve@^1.0.0#~builtin<compat/resolve>":\n  version: 1.22.8\n"is-num@npm:is-number@^7":\n  version: 7.0.0\n').keys()]).toEqual(["is-num"]);
    expect(requirements("Django==5.1.4 # pinned\nrequests>=2\n").get("django")).toBe("5.1.4");
    expect(tomlLock('[[package]]\nname = "Pydantic_Core"\nversion = "2.27.1"\n').get("pydantic-core")).toBe("2.27.1");
    expect(updateFromTitle("chore(deps): update dependency vite to v7.1.0")).toEqual({ package: "vite", to: "7.1.0" });
    expect(diffVersions("npm", new Map([["a", "1.0.0"]]), new Map([["a", "2.0.0"], ["c", "1.0.0"]]), new Set(["a"])).map((c) => `${c.package}:${c.direct}`)).toEqual(["a:true", "c:false"]);
  });
});

// ---------------------------------------------------------------- the experiment
describe("diagnosis on real git repositories", () => {
  it("compatible: one run only, no baseline (fail-first)", async () => {
    const d = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": OK } }));
    expect(d.verdict).toBe("compatible");
    expect(d.runs.filter((r) => r.phase === "test")).toHaveLength(1);
    expect(d.runs.every((r) => r.side === "update")).toBe(true);
  });

  it("regression: names the test that fails only with the update; the checkout is untouched", async () => {
    const dir = repo({ base: { left: "1.0.0" }, update: { left: "2.0.0" }, tests: { "a.test.js": PAD + OK } });
    const d = await run(dir);
    expect(d.verdict).toBe("regression");
    expect(d.confidence).toBe("high");
    expect(d.newFailures.map((f) => f.id)).toEqual(["test/a.test.js > pads"]);
    expect(d.newFailures[0].message).toMatch(/pad is not a function/);
    expect(d.runs.filter((r) => r.side === "update" && r.phase === "test")).toHaveLength(2); // reproduced
    expect(d.runs.filter((r) => r.side === "baseline" && r.phase === "test")).toHaveLength(2); // baseline confirmed
    expect(existsSync(join(dir, "node_modules"))).toBe(false); // ran in exported copies, never in the checkout
    expect(spawnSync("git", ["worktree", "list"], { cwd: dir, encoding: "utf8" }).stdout.trim().split("\n")).toHaveLength(1);
    expect(d.next).toMatch(/left/);
  });

  it("pre-existing: the same test fails without the update → not the update's fault", async () => {
    const d = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": MAIN_RED + OK } }));
    expect(d.verdict).toBe("pre_existing");
    expect(d.confidence).toBe("medium"); // no CI context: Signal's red baseline is not confirmed by the project's CI
    expect(d.preExisting.map((f) => f.id)).toEqual(["test/a.test.js > already broken on main"]);
    expect(d.merge).toMatch(/Not caused by the update/);
    const confirmed = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": MAIN_RED + OK } }), { ci: ci("red", "red") });
    expect(confirmed.confidence).toBe("high");
  });

  it("regression on a red base: separates new failures from the ones main already had", async () => {
    const d = await run(repo({ base: { left: "1.0.0" }, update: { left: "2.0.0" }, tests: { "a.test.js": PAD + MAIN_RED } }));
    expect(d.verdict).toBe("regression_on_red");
    expect(d.newFailures.map((f) => f.id)).toEqual(["test/a.test.js > pads"]);
    expect(d.preExisting.map((f) => f.id)).toEqual(["test/a.test.js > already broken on main"]);
  });

  it("a test that already failed but now fails with a different error is not called pre-existing", async () => {
    const differ = T("parses config", "const l=require('left');assert.ok(l.pad,'missing pad');assert.equal(1,2,'old bug');");
    const d = await run(repo({ base: { left: "1.0.0" }, update: { left: "2.0.0" }, tests: { "a.test.js": differ } }));
    expect(d.verdict).toBe("regression_on_red");
    expect(d.confidence).toBe("medium");
    expect(d.changedFailures.map((c) => c.id)).toEqual(["test/a.test.js > parses config"]);
    expect(d.changedFailures[0].before).toMatch(/old bug/);
    expect(d.changedFailures[0].after).toMatch(/missing pad/);
  });

  it("different tests failing in each run is flakiness, not a regression", async () => {
    const counter = "const fs=require('fs');const k=require('path').join(require('os').tmpdir(),'alt-count');const n=Number(fs.existsSync(k)?fs.readFileSync(k,'utf8'):0);";
    const one = T("one", counter + "fs.writeFileSync(k,String(n+1));assert.ok(n%2===1,'one fails');");
    const two = T("two", counter + "assert.ok(n%2===1,'two fails');");
    const alt = (x: string) => x;
    const d = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": alt(one) + alt(two) } }));
    expect(d.reasons[0]).toMatch(/different set of tests/);
    expect(d.verdict).toBe("flaky");
  });

  it("flaky: identical runs disagree → not blamed on the update", async () => {
    const flip = T("flips", "const f=require('path').join(require('os').tmpdir(),'signal-flip-'+process.cwd().split('/').slice(-1)[0]);const n=Number(require('fs').existsSync(f)?require('fs').readFileSync(f,'utf8'):0);require('fs').writeFileSync(f,String(n+1));assert.ok(n%2===1,'flaky');");
    const d = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": flip } }));
    expect(d.verdict).toBe("flaky");
    expect(d.flipped).toContain("test/a.test.js > flips");
  });

  it("install failure: inconclusive, never a regression", async () => {
    const dir = repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": OK } });
    writeFileSync(join(dir, "install-fails"), "");
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "install-fails"], { cwd: dir });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "break install"], { cwd: dir });
    const d = await run(dir);
    expect(d.verdict).toBe("inconclusive");
    expect(d.reasons[0]).toMatch(/install/);
  });

  it("network errors in the failing run make it inconclusive", async () => {
    const net = T("calls an API", "throw new Error('getaddrinfo ENOTFOUND api.example.com');");
    const d = await run(repo({ base: { left: "1.0.0" }, update: { left: "2.0.0" }, tests: { "a.test.js": net } }));
    expect(d.verdict).toBe("inconclusive");
    expect(d.reasons.join(" ")).toMatch(/DNS/);
  });

  it("an environment word printed by a passing test does not hide a real regression", async () => {
    const noisy = T("reconnects", "console.log('warn: socket ECONNRESET, retrying');assert.ok(true);");
    const d = await run(repo({ base: { left: "1.0.0" }, update: { left: "2.0.0" }, tests: { "a.test.js": noisy + PAD } }));
    expect(d.verdict).toBe("regression");
  });

  it("cross-checks against the project's CI: a disagreement is inconclusive, never a confident verdict", async () => {
    // Signal's baseline is red, but the project's CI says main is green: Signal is not reproducing the CI
    const red = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": MAIN_RED } }), { ci: ci("green", "red") });
    expect(red.verdict).toBe("inconclusive");
    expect(red.reasons.join(" ")).toMatch(/does not reproduce your CI/);
    // tests pass here, but the PR's CI failed elsewhere (lint, build, another OS)
    const ok = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": OK } }), { ci: ci("green", "red") });
    expect(ok.verdict).toBe("inconclusive");
    expect(ok.next).toMatch(/build \(ubuntu\)/);
  });

  it("timeouts make it inconclusive", async () => {
    const slow = T("hangs", "const t=Date.now();while(Date.now()-t<5000){}");
    const d = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": slow } }), { timeoutMs: 1500 });
    expect(d.verdict).toBe("inconclusive");
  });

  it("grouped PR: isolates the responsible update and confirms it both ways", async () => {
    const d = await run(repo({ base: { left: "1.0.0", right: "1.0.0", utilx: "1.0.0" }, update: { left: "2.0.0", right: "1.1.0", utilx: "2.0.0" }, tests: { "a.test.js": PAD + OK } }));
    expect(d.verdict).toBe("regression");
    expect(d.isolation?.status).toBe("single");
    expect(d.isolation?.culprits.map((c) => c.package)).toEqual(["left"]);
    expect(d.isolation?.confirmed).toEqual({ sufficient: true, necessary: true });
    expect(d.next).toMatch(/left 2\.0\.0/);
  });

  it("grouped PR: two updates that only fail together are reported as an interaction, not blamed individually", async () => {
    const both = T("combo", "assert.ok(!(require('utilx').mode==='b'&&require('flag').on),'combo breaks');");
    const d = await run(repo({ base: { utilx: "1.0.0", flag: "1.0.0", right: "1.0.0" }, update: { utilx: "2.0.0", flag: "2.0.0", right: "1.1.0" }, tests: { "a.test.js": both } }));
    expect(d.verdict).toBe("regression");
    expect(d.isolation?.status).toBe("interaction");
    expect(d.isolation?.culprits.map((c) => c.package).sort()).toEqual(["flag", "utilx"]);
  });

  it("explains clearly when there is nothing to diagnose or no command", async () => {
    const dir = repo({ base: { right: "1.0.0" }, update: { right: "1.0.0" }, tests: { "a.test.js": OK } });
    await expect(run(dir)).rejects.toThrow(/no dependency change/);
    const py = mkdtempSync(join(os.tmpdir(), "signal-py-"));
    writeFileSync(join(py, "requirements.txt"), "requests==2.0\n");
    expect(detectCommands(py, py)).toMatchObject({ pm: "python", install: null });
  });
});

describe("isolation logic", () => {
  const c = (p: string): Change => ({ ecosystem: "npm", package: p, from: "1", to: "2", direct: true });
  it("refuses individual blame when reverting the suspect does not fix the update", async () => {
    const probe: Probe = async (side, apply) => ({ outcome: side === "baseline" ? (apply.some((x) => x.package === "a") ? "new_failures" : "clean") : "new_failures" });
    const r = await isolate([c("a"), c("b")], probe, 8);
    expect(r.status).toBe("inconclusive");
    expect(r.confirmed.necessary).toBe(false);
  });
  it("says when the declared updates do not explain the failure (transitive changes)", async () => {
    const r = await isolate([c("a"), c("b")], async () => ({ outcome: "clean" }), 8);
    expect(r.status).toBe("not_direct");
  });
  it("stops at the budget instead of guessing", async () => {
    const r = await isolate(["a", "b", "c", "d", "e", "f", "g", "h"].map(c), async (side, apply) => ({ outcome: side === "baseline" && apply.length >= 8 ? "new_failures" : "clean" }), 3);
    expect(r.status).not.toBe("single");
  });
});

describe("security", () => {
  it("the code under test cannot see tokens or the Actions runtime credentials", async () => {
    process.env.GITHUB_TOKEN = "ghs_secret"; process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "oidc"; process.env.ACTIONS_RUNTIME_TOKEN = "rt";
    try {
      const e = childEnv(mkdtempSync(join(os.tmpdir(), "signal-h-")));
      expect(e.GITHUB_TOKEN).toBeUndefined();
      expect(e.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
      expect(e.ACTIONS_RUNTIME_TOKEN).toBeUndefined();
      const leak = T("no tokens", `assert.ok(!process.env.GITHUB_TOKEN && !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN && !process.env.ACTIONS_RUNTIME_TOKEN,'token visible');assert.notEqual(process.env.HOME, ${JSON.stringify(os.homedir())},'real HOME');assert.ok(!require('fs').existsSync('.git'),'git dir visible');`);
      const d = await run(repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": leak } }));
      expect(d.verdict).toBe("compatible");
    } finally {
      delete process.env.GITHUB_TOKEN; delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN; delete process.env.ACTIONS_RUNTIME_TOKEN;
    }
  });

  it("refuses pull_request_target and checkouts that persisted a token", () => {
    const dir = repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": OK } });
    expect(() => preflight(dir, false, { GITHUB_EVENT_NAME: "pull_request_target" })).toThrow(/pull_request_target/);
    spawnSync("git", ["config", "http.https://github.com/.extraheader", "AUTHORIZATION: basic abc"], { cwd: dir });
    expect(() => preflight(dir, false, {})).toThrow(/persist-credentials: false/);
    expect(preflight(dir, true, {})).toHaveLength(1);
  });

  it("detects the code under test tampering with the repository's git config", async () => {
    const dir = repo({ base: { left: "1.0.0" }, update: { left: "2.0.0" }, tests: { "a.test.js": OK } });
    const cfg = join(dir, ".git", "config");
    writeFileSync(join(dir, "test", "b.test.js"), T("tamper", `require('fs').appendFileSync(${JSON.stringify(cfg)},'\\n[filter "x"]\\n\\tsmudge = evil\\n');assert.fail('x');`));
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: dir });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "tamper"], { cwd: dir });
    const d = await run(dir, { retries: 0 });
    expect(d.integrity).toBe("changed");
    expect(d.tampered.some((p) => p.endsWith(".git/config"))).toBe(true);
    expect(d.verdict).toBe("inconclusive");
  });

  it("kills what the command left running, and the whole group on timeout", async () => {
    const m = join(mkdtempSync(join(os.tmpdir(), "signal-bg-")), "marker");
    const env = childEnv(mkdtempSync(join(os.tmpdir(), "signal-h-")));
    const r = await sh(os.tmpdir(), `(sleep 1; touch '${m}') & exit 0`, 10_000, env);
    expect(r.ok).toBe(true);
    const t = await sh(os.tmpdir(), `(sleep 1; touch '${m}.2') & sleep 30`, 300, env);
    expect(t.timedOut).toBe(true);
    await new Promise((res) => setTimeout(res, 1500));
    expect(existsSync(m)).toBe(false);
    expect(existsSync(m + ".2")).toBe(false);
  });

  it("refuses privileged events and credentials anywhere in .git/config", () => {
    const dir = repo({ base: { right: "1.0.0" }, update: { right: "1.1.0" }, tests: { "a.test.js": OK } });
    expect(() => preflight(dir, false, { GITHUB_EVENT_NAME: "workflow_run" })).toThrow(/workflow_run/);
    expect(preflight(dir, false, { GITHUB_EVENT_NAME: "workflow_run" }, true)).toEqual([]);
    spawnSync("git", ["remote", "add", "origin", "https://x-access-token:ghs_abc@github.com/o/r.git"], { cwd: dir });
    expect(() => preflight(dir, false, {})).toThrow(/remote URL/);
    spawnSync("git", ["remote", "remove", "origin"], { cwd: dir });
    spawnSync("git", ["config", "http.extraheader", "AUTHORIZATION: basic abc"], { cwd: dir });
    expect(() => preflight(dir, false, {})).toThrow(/extraheader/);
  });

  it("parses flag values that contain '='", () => {
    expect(flags(["--test=FOO=1 npm test", "--install", "a=b"]).f).toEqual({ test: "FOO=1 npm test", install: "a=b" });
  });

  it("treats packages released together as one unit when isolating", () => {
    const c = (p: string, to: string): Change => ({ ecosystem: "npm", package: p, from: "1", to, direct: true });
    expect(units([c("react", "19.0.0"), c("react-dom", "19.0.0"), c("@vitest/coverage-v8", "3.0.0"), c("vitest", "3.0.0"), c("ms", "3.0.0")]).map((u) => u.map((x) => x.package))).toEqual([["react", "react-dom"], ["@vitest/coverage-v8", "vitest"], ["ms"]]);
  });

  it("escapes everything that came from the project or the registry", () => {
    const out = md("[click](https://evil) <img src=x>");
    expect(out).toContain("\\[click\\]\\(https:\u2060//evil\\)"); // rendered literally, not as a link or autolink
    expect(md("ping @octocat")).toBe("ping @\u2060octocat"); // no notification
    expect(out).toContain("\\<img"); // not an HTML tag
  });
});

describe("report", () => {
  it("leads with the verdict, the merge advice and the next step", async () => {
    const d = await run(repo({ base: { left: "1.0.0" }, update: { left: "2.0.0" }, tests: { "a.test.js": PAD + MAIN_RED } }));
    const r = renderMarkdown(d, {});
    const lines = r.split("\n").filter(Boolean);
    expect(lines[1]).toMatch(/left 1\.0\.0 → 2\.0\.0 breaks 1 test \(the base branch was already red\)/);
    expect(r).toMatch(/\*\*Merge:\*\* Do not merge/);
    expect(r).toMatch(/Tests that fail only with the update \(1\)/);
    expect(r).toMatch(/Already failing without the update \(1\)/);
    expect(r).toMatch(/Limits of this run/);
    expect(renderMarkdown(d, {}, { redact: true })).not.toMatch(/pad is not a function/);
  });
});
