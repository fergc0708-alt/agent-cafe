import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { buildFinding, evaluate, matchError, type EvidenceRow, type IndexEntry, type TargetEnv } from "../core/doctor/match.ts";
import { loadIndex, scanProject, doctor } from "../cli/doctor.ts";
import { buildCandidate, capture } from "../cli/capture.ts";
import { isolationAvailable } from "../cli/runner.ts";
import { handleMessage } from "../cli/mcp.ts";
import { verifyEnvelope } from "../core/capsule/attestation.ts";
import { bindingAudience, verifyGithubOidc } from "../core/capsule/oidc.ts";
import { safeRegex, validateCapsule } from "../core/capsule/capsule.ts";

const row = (version: string, verdict: EvidenceRow["verdict"], trust: EvidenceRow["trust"] = "verified", conditions: Record<string, string> = {}): EvidenceRow => ({
  runtime: "python", version, conditions, verdict, mutation: verdict === "PASS" ? { total: 4, killed: 4 } : { total: 0, killed: 0 }, trust, source: "test",
});
const env = (version: string, label = "installed", conditions: Record<string, string> = {}): TargetEnv => ({ runtime: "python", version, conditions, label });

describe("compatibility engine", async () => {
  const index = await loadIndex();
  const entry = (rows: EvidenceRow[]): IndexEntry => ({ ...index.bySlug.get("py-imp-removed")!, rows });
  it("classifies exact environments and prefers verified over claimed", () => {
    const e = entry([row("3.11.9", "PROBLEM_NOT_REPRODUCED"), row("3.12.4", "PASS"), row("3.12.3", "PROBLEM_NOT_REPRODUCED", "claimed")]);
    expect(evaluate(e, env("3.11.2")).status).toBe("not_affected");
    const v = evaluate(e, env("3.12.0"));
    expect(v.status).toBe("affected_fix_verified"); // the claimed contradiction does not override verified evidence
    expect(v.trust).toBe("verified");
  });
  it("one fabricated claim cannot flip verified evidence, but conflicts among verified rows are surfaced", () => {
    expect(evaluate(entry([row("3.12.1", "PASS"), row("3.12.1", "FIX_FAILS", "claimed")]), env("3.12.1")).status).toBe("affected_fix_verified");
    expect(evaluate(entry([row("3.12.1", "PASS"), row("3.12.2", "PROBLEM_NOT_REPRODUCED")]), env("3.12.1")).status).toBe("conflicting");
  });
  it("never reports an untested version as passing; it shows neighbours and marks inference", () => {
    const v = evaluate(entry([row("3.10.1", "PROBLEM_NOT_REPRODUCED"), row("3.13.1", "PASS")]), env("3.12.0"));
    expect(v.status).toBe("untested");
    expect(v.summary).toMatch(/not tested/);
    const w = evaluate(entry([row("3.12.1", "PASS"), row("3.14.1", "PASS")]), env("3.13.0"));
    expect(w.status).toBe("untested");
    expect(w.summary).toMatch(/LIKELY.*inferred, not tested/);
  });
  it("conditions: TZ compares as UTC vs non-UTC; clean-venv rows do not apply to unknown site setups", () => {
    const e = entry([row("3.12.1", "PASS", "verified", { TZ: "America/Argentina/Buenos_Aires" }), row("3.12.1", "PROBLEM_NOT_REPRODUCED", "verified", { TZ: "UTC" })]);
    expect(evaluate(e, env("3.12.0", "installed", { TZ: "Europe/Madrid" })).status).toBe("affected_fix_verified");
    expect(evaluate(e, env("3.12.0", "installed", { TZ: "Etc/UTC" })).status).toBe("not_affected");
    expect(evaluate(entry([row("3.12.1", "PASS", "verified", { SITE: "venv-clean" })]), env("3.12.0")).status).toBe("no_evidence");
    // the same version gives opposite answers depending on setuptools' distutils shim
    const site = entry([row("3.12.1", "PASS", "verified", { SITE: "no-distutils" }), row("3.12.1", "PROBLEM_NOT_REPRODUCED", "verified", { SITE: "setuptools-shim" })]);
    expect(evaluate(site, env("3.12.0", "installed", { SITE: "setuptools-shim" })).status).toBe("not_affected");
    expect(evaluate(site, env("3.12.0", "installed", { SITE: "venv-clean" })).status).toBe("affected_fix_verified");
  });
  it("a fix that breaks an older supported version is reported as such", () => {
    const e = entry([row("3.12.1", "PASS"), row("3.10.1", "FIX_BREAKS")]);
    const f = buildFinding(e, [env("3.12.1"), env("3.10.0", "declared requires-python >=3.10")], "test", [], index.byId);
    expect(f.verdicts.map((v) => v.status)).toEqual(["affected_fix_verified", "fix_breaks"]);
    expect(f.action).toMatch(/version-guarded/);
  });
  it("diagnose: symptom regex is strong, unrelated errors match nothing", () => {
    expect(matchError(index.entries, "ModuleNotFoundError: No module named 'pipes'")[0].entry.slug).toBe("py-pipes-removed");
    expect(matchError(index.entries, "TypeError: Cannot read properties of undefined (reading 'map')")).toEqual([]);
    expect(matchError(index.entries, "AttributeError: module 'unittest' has no attribute 'makeSuite'")[0].entry.slug).toBe("py-unittest-makesuite");
  });
  it("rejects ReDoS-prone detect patterns", () => {
    expect(safeRegex("(a+)+$")).toBeNull();
    expect(safeRegex("(.*a){3}")).toBeNull();
    expect(safeRegex("\\bimport\\s+imp\\b")).toBe("\\bimport\\s+imp\\b");
    const c = { ...index.bySlug.get("py-imp-removed")!.capsule, detect: { files: ["*.py"], pattern: "(x+)+y" } };
    expect(validateCapsule(c).ok).toBe(false);
  });
});

describe("project scan and doctor", () => {
  it("finds affected code, skips vendored dirs, and predicts per environment", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "cafe-doctor-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "src", "plugins.py"), "import imp\n\ndef load(p):\n    return imp.load_source('x', p)\n");
    writeFileSync(join(dir, "node_modules", "x", "a.py"), "import imp\n");
    writeFileSync(join(dir, "pyproject.toml"), '[project]\nrequires-python = ">=3.11"\n');
    const index = await loadIndex(dir);
    const { hits } = scanProject(dir, index.entries);
    const h = hits.get(index.bySlug.get("py-imp-removed")!.id)!;
    expect(h.map((x) => x.file)).toEqual(["src/plugins.py"]);
    const r = await doctor(dir, ["python@3.13"]);
    const f = r.findings.find((x) => x.slug === "py-imp-removed")!;
    // keyed by version: the installed interpreter differs between machines
    const byVersion = Object.fromEntries(f.verdicts.map((v) => [v.env.version.split(".").slice(0, 2).join("."), v.status]));
    expect(byVersion["3.13"]).toBe("affected_fix_verified");
    expect(byVersion["3.11"]).toBe("not_affected");
    expect(JSON.stringify(r.fingerprint)).not.toContain(dir); // no absolute paths in the fingerprint
  });
});

describe("bundled evidence is real", () => {
  it("every verified row comes from a GitHub OIDC token that re-verifies against the pinned JWKS snapshot", async () => {
    const ev = JSON.parse(readFileSync(new URL("../capsules/built/evidence.json", import.meta.url), "utf8"));
    const jwks = JSON.parse(readFileSync(new URL("../capsules/built/github-jwks.json", import.meta.url), "utf8"));
    expect(ev.ci_jobs.length).toBeGreaterThan(0);
    for (const job of ev.ci_jobs) {
      const id = await verifyGithubOidc(job.token, { jwks, expectedAudience: await bindingAudience(job.public_key, job.manifest), policy: ev.trust_policy, now: Date.parse(ev.generated_at) });
      expect(id.runner_environment).toBe("github-hosted");
      expect(id.repository).toBe(job.identity.repository);
    }
    const verified = Object.values(ev.capsules).flatMap((c: any) => c.rows).filter((r: any) => r.trust === "verified");
    expect(verified.length).toBeGreaterThan(100);
  });
  it("the CI envelopes behind them carry valid signatures by the bound keys", async () => {
    const dir = new URL("../experiments/v2/results-run4/ci/", import.meta.url);
    const job = JSON.parse(readFileSync(new URL("ci-python-3.13.pubkey.json", dir), "utf8"));
    const first = JSON.parse(readFileSync(new URL("ci-python-3.13.jsonl", dir), "utf8").split("\n")[0]);
    expect((await verifyEnvelope(first.envelope, job.public_key)).predicate.env.version).toMatch(/^3\.13\./);
  });
});

describe("local MCP", () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    return { isError: r!.result.isError === true, text: r!.result.content[0].text as string };
  };
  it("diagnose returns a compact match with the fix diff", async () => {
    const r = await call("cafe_diagnose", { error: "ModuleNotFoundError: No module named 'pipes'", targets: ["python@3.13"] });
    const j = JSON.parse(r.text);
    expect(j.matches[0].name).toBe("py-pipes-removed");
    expect(j.matches[0].fix).toContain("shlex.quote");
    expect(r.text.length).toBeLessThan(3000);
  });
  it("replay needs a preview digest from this session; no file paths, no odd interpreters", async () => {
    expect((await call("cafe_replay", { name: "../../etc/passwd" })).isError).toBe(true);
    expect((await call("cafe_replay", { name: "py-pipes-removed", bins: { python3: "/bin/sh-evil" } })).isError).toBe(true);
    expect((await call("cafe_replay", { name: "py-pipes-removed", confirm_digest: "0".repeat(64) })).isError).toBe(true);
    const preview = JSON.parse((await call("cafe_replay", { name: "py-pipes-removed" })).text);
    expect(preview.needs_confirmation).toBe(true);
    expect(preview.will_run).toContain("shell.py");
  });
});

describe("capture", () => {
  it.skipIf(!isolationAvailable("sandbox"))("saves only fixes whose test fails before, passes after and catches mutants", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "cafe-capture-"));
    const g = (...a: string[]) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir });
    g("init", "-q");
    writeFileSync(join(dir, "price.py"), "def total(items):\n    return sum(items)\n");
    g("add", "-A"), g("commit", "-qm", "init");
    writeFileSync(join(dir, "price.py"), "def total(items):\n    cents = sum(round(i * 100) for i in items)\n    return cents / 100\n");
    writeFileSync(join(dir, "test_price.py"), "from price import total\nassert total([0.1, 0.2]) == 0.3, total([0.1, 0.2])\n");
    writeFileSync(join(dir, "test_weak.py"), "import price\n");
    const good = buildCandidate({ project: dir, check: "test_price.py", files: ["price.py"] });
    expect(good.problems).toEqual([]);
    const r = await capture({ project: dir, check: "test_price.py" }, good.capsule!);
    expect(r.saved).toMatch(/\.cafe\/capsules\/.+\.json$/);
    const weak = buildCandidate({ project: dir, check: "test_weak.py", files: ["price.py"] });
    const w = await capture({ project: dir, check: "test_weak.py" }, weak.capsule!);
    expect(w.saved).toBeNull();
    expect(w.reasons.join()).toMatch(/already passes/);
    // the private capsule is now part of this project's index, marked local
    expect((await loadIndex(dir)).entries.some((e) => e.origin === "local")).toBe(true);
  }, 60_000);
});
