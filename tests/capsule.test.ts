import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterDigest, capsuleId, checkDigest, satisfies, validateCapsule, type Capsule } from "../core/capsule/capsule.ts";
import { lintCapsule } from "../core/capsule/lint.ts";
import { buildStatement, generateRunnerKey, signStatement, verifyEnvelope, type ReplayPredicate } from "../core/capsule/attestation.ts";
import { summarize, type AttestationRecord } from "../core/capsule/evidence.ts";
import { replay } from "../cli/runner.ts";
import { MemoryStore } from "../core/memory-store.ts";
import { PostgresStore } from "../core/postgres-store.ts";
import { handle } from "../core/handler.ts";
import type { Store } from "../core/store.ts";

const load = (slug: string) => JSON.parse(readFileSync(new URL(`../capsules/built/${slug}.json`, import.meta.url), "utf8")) as Capsule;

describe("capsule validation", () => {
  const good = load("py-mutable-default");
  it("accepts the catalog and is content-addressed", async () => {
    expect(validateCapsule(good).ok).toBe(true);
    const id = await capsuleId(good);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await capsuleId({ ...good, title: good.title + "!" })).not.toBe(id);
  });
  it("rejects files that could hijack the check", () => {
    for (const f of ["conftest.py", "sub/sitecustomize.py", "evil.pth", "node_modules/x/index.js", ".npmrc"]) {
      const bad = { ...good, after: { files: { ...good.after.files, [f]: "x" } } };
      expect(validateCapsule(bad).ok, f).toBe(false);
    }
  });
  it("rejects inline commands, path traversal and name collisions", () => {
    expect(validateCapsule({ ...good, check: { ...good.check, run: ["python3", "-c", "pass"] } }).ok).toBe(false);
    expect(validateCapsule({ ...good, check: { ...good.check, run: ["bash", "-c", "exit 0"] } }).ok).toBe(false);
    expect(validateCapsule({ ...good, check: { ...good.check, run: ["curl", "x"] } }).ok).toBe(false);
    expect(validateCapsule({ ...good, after: { files: { "../x.py": "x" } } }).ok).toBe(false);
    expect(validateCapsule({ ...good, check: { ...good.check, files: { "bag.py": "x" } } }).ok).toBe(false);
  });
  it("semver ranges", () => {
    expect(satisfies("22.23.5", ">=22.18")).toBe(true);
    expect(satisfies("20.10.0", ">=20.11")).toBe(false);
    expect(satisfies("3.12.3", ">=3.9 <3.13")).toBe(true);
    expect(satisfies("3.13.1", "=3.13")).toBe(true);
  });
});

describe("static lint", () => {
  it("flags checks with no failure path and existence-only checks", () => {
    const c = load("py-mutable-default");
    const trivial = { ...c, check: { ...c.check, files: { "check.py": "print('ok')\n" } } };
    expect(lintCapsule(trivial).map((f) => f.code)).toEqual(expect.arrayContaining(["no_failure_path", "does_not_reference_fix"]));
    const exists = { ...c, check: { ...c.check, files: { "check.py": "import os\nassert os.path.exists('bag.py')\n" } } };
    expect(lintCapsule(exists).map((f) => f.code)).toContain("existence_only");
  });
});

describe("DSSE / in-toto attestations", () => {
  it("signs, verifies and detects tampering and wrong keys", async () => {
    const k1 = await generateRunnerKey();
    const k2 = await generateRunnerKey();
    const pred = { verdict: "PASS", capsule_id: "a".repeat(64), check_sha256: "b".repeat(64) } as unknown as ReplayPredicate;
    const env = await signStatement(buildStatement("a".repeat(64), pred), k1.privateJwk, k1.keyid);
    expect((await verifyEnvelope(env, k1.publicRaw)).predicate.verdict).toBe("PASS");
    await expect(verifyEnvelope(env, k2.publicRaw)).rejects.toThrow();
    const forged = { ...env, payload: btoa(atob(env.payload).replace('"PASS"', '"FIX_FAILS"')) };
    await expect(verifyEnvelope(forged, k1.publicRaw)).rejects.toThrow(/bad signature/);
  });
});

describe("evidence semantics", () => {
  const rec = (o: Partial<AttestationRecord>): AttestationRecord => ({
    runner_id: "r1", owner_id: "author", verdict: "PASS", env_key: "node 22.23.5 linux-x64", runtime: "node", version: "22.23.5",
    conditions: {}, mutation: { total: 4, killed: 3 }, created_at: new Date().toISOString(), ...o,
  });
  const opts = { authorOwnerId: "author", claims: { node: ">=20" } };
  it("levels: author only < other runner < two runners; insensitive PASS does not count", () => {
    expect(summarize([], opts).level).toBe("draft");
    expect(summarize([rec({})], opts).level).toBe("author_observed");
    expect(summarize([rec({ owner_id: "other" })], opts).level).toBe("runner_replayed");
    expect(summarize([rec({}), rec({ owner_id: "other", runner_id: "r2" })], opts).level).toBe("cross_runner_reproduced");
    const insensitive = summarize([rec({ owner_id: "other", mutation: { total: 4, killed: 0 } })], opts);
    expect(insensitive.level).toBe("draft");
    expect(insensitive.flags.join()).toMatch(/insensitive_check/);
  });
  it("detects regressions and contradictions of the author's claims", () => {
    const s = summarize(
      [
        rec({ owner_id: "other", version: "20.18.0", env_key: "node 20.18.0" }),
        rec({ owner_id: "other", version: "22.23.5", env_key: "node 22.23.5", verdict: "FIX_FAILS", mutation: { total: 0, killed: 0 } }),
      ],
      opts,
    );
    expect(s.regressions).toEqual([{ from: "node 20.18.0", to: "node 22.23.5" }]);
    expect(s.contradictions.length).toBe(1);
    expect(s.flags.join()).toMatch(/regressed/);
  });
  it("flags stale evidence", () => {
    const old = new Date(Date.now() - 120 * 86_400_000).toISOString();
    expect(summarize([rec({ owner_id: "other", created_at: old })], opts).flags.join()).toMatch(/stale/);
  });
});

describe("local runner (anti-vacuity, real processes)", () => {
  const c = load("py-mutable-default");
  it("reproduces fail->pass and catches mutants", async () => {
    const r = await replay(c, { bins: { python3: "python3" } });
    expect(r.predicate.verdict).toBe("PASS");
    expect(r.predicate.mutation.killed).toBeGreaterThan(0);
  });
  it("a check that always passes never reaches PASS", async () => {
    const vacuous = { ...c, check: { ...c.check, files: { "check.py": "import bag\n" } } };
    expect((await replay(vacuous)).predicate.verdict).toBe("PROBLEM_NOT_REPRODUCED");
  });
  it("a check that always fails is FIX_FAILS", async () => {
    const broken = { ...c, check: { ...c.check, files: { "check.py": "import bag\nraise SystemExit(1)\n" } } };
    expect((await replay(broken)).predicate.verdict).toBe("FIX_FAILS");
  });
  it("an existence-only check passes fail->pass but no mutant is caught", async () => {
    const newFile: Capsule = { ...c, before: { files: {} }, check: { ...c.check, files: { "check.py": "import os\nassert os.path.exists('bag.py')\n" } } };
    const withBefore = { ...newFile, before: { files: { "other.py": "x = 1\n" } } };
    const r = await replay(withBefore);
    expect(r.predicate.verdict).toBe("PASS");
    expect(r.predicate.mutation.killed).toBe(0); // -> insensitive, never counted as evidence
  });
});

// ---------- registry API, against memory and real Postgres ----------
async function apiFlow(makeStore: () => Promise<Store>) {
  const store = await makeStore();
  let ip = 0;
  const call = async (method: string, path: string, body?: unknown, key?: string) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` };
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await handle(new Request("https://x.test" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), { store, siteUrl: "https://x.test" });
    return { status: res.status, json: await res.json() };
  };
  const reg = async (h: string, provider: string) => (await call("POST", "/api/v1/agents/register", { handle: h, model: "m-" + h, provider })).json.api_key as string;
  const author = await reg("cafe-curator", "anthropic");
  const other = await reg("other-agent", "openai");
  const third = await reg("third-agent", "google");

  const capsule = load("py-mutable-default");
  const sub = await call("POST", "/api/v1/capsules", capsule, author);
  expect(sub.status).toBe(201);
  const id = sub.json.id as string;
  expect(id).toBe(await capsuleId(capsule));
  expect((await call("POST", "/api/v1/capsules", { ...capsule, author: "someone-else" }, author)).status).toBe(400);

  const keys = await Promise.all([generateRunnerKey(), generateRunnerKey(), generateRunnerKey()]);
  expect((await call("POST", "/api/v1/runners", { public_key: keys[0].publicRaw, label: "author laptop" }, author)).status).toBe(201);
  expect((await call("POST", "/api/v1/runners", { public_key: keys[1].publicRaw, label: "other ci" }, other)).status).toBe(201);
  expect((await call("POST", "/api/v1/runners", { public_key: keys[2].publicRaw, label: "third" }, third)).status).toBe(201);
  expect((await call("POST", "/api/v1/runners", { public_key: keys[2].publicRaw }, author)).status).toBe(409);

  const pred = async (verdict: string, version = "3.12.3", c: Capsule = capsule): Promise<ReplayPredicate> =>
    ({
      verdict,
      capsule_id: await capsuleId(c),
      check_sha256: await checkDigest(c),
      env: { key: `python ${version} linux-x64`, runtime: "python", version, os: "linux", arch: "x64", conditions: {} },
      before: null,
      after: { exit: 0, ms: 1, timed_out: false, stdout_sha256: "" },
      mutation: verdict === "PASS" ? { total: 4, killed: 3 } : { total: 0, killed: 0 },
      lint: [],
      isolation: "test",
      runner: { keyid: "", tool: "test" },
      started_at: new Date().toISOString(),
    }) as unknown as ReplayPredicate;
  const env = async (k: (typeof keys)[number], p: ReplayPredicate, cid = id) => signStatement(buildStatement(cid, p), k.privateJwk, k.keyid);

  // author's own runner -> author_observed
  let r = await call("POST", `/api/v1/capsules/${id}/attestations`, await env(keys[0], await pred("PASS")), author);
  expect(r.status).toBe(201);
  expect(r.json.evidence.level).toBe("author_observed");
  // using someone else's key is refused
  expect((await call("POST", `/api/v1/capsules/${id}/attestations`, await env(keys[0], await pred("PASS")), other)).status).toBe(403);
  // a result about a different check is refused
  const otherCheck = { ...capsule, check: { ...capsule.check, files: { "check.py": "import bag\nassert bag.add(1) == [1]\n" } } };
  expect((await call("POST", `/api/v1/capsules/${id}/attestations`, await env(keys[1], await pred("PASS", "3.12.3", otherCheck)), other)).status).toBe(400);
  // forged payload is refused
  const good = await env(keys[1], await pred("PASS"));
  const forged = { ...good, payload: btoa(atob(good.payload).replace("3.12.3", "3.99.0")) };
  expect((await call("POST", `/api/v1/capsules/${id}/attestations`, forged, other)).status).toBe(400);
  // another owner's runner -> runner_replayed; a third runner -> cross_runner_reproduced
  r = await call("POST", `/api/v1/capsules/${id}/attestations`, good, other);
  expect(r.json.evidence.level).toBe("cross_runner_reproduced");
  // a FIX_FAILS inside the claimed range is shown as a contradiction
  r = await call("POST", `/api/v1/capsules/${id}/attestations`, await env(keys[2], await pred("FIX_FAILS", "3.13.1")), third);
  expect(r.json.evidence.contradictions.length).toBe(1);
  expect(r.json.evidence.regressions.length).toBe(1);

  // independent check: same fix, different check, different author, replayed by a non-author
  const indep: Capsule = { ...capsule, author: "other-agent", check: { ...capsule.check, files: { "check2.py": "from bag import add\nfor i in range(3):\n    assert add(i) == [i]\n" }, run: ["python3", "check2.py"] } };
  const isub = await call("POST", "/api/v1/capsules", indep, other);
  expect(isub.status).toBe(201);
  expect(await afterDigest(indep)).toBe(await afterDigest(capsule));
  await call("POST", `/api/v1/capsules/${isub.json.id}/attestations`, await env(keys[2], await pred("PASS", "3.12.3", indep), isub.json.id), third);
  const view = await call("GET", `/api/v1/capsules/${id}`);
  expect(view.json.evidence.level).toBe("independent_check_confirmed");
  expect(view.json.attestations.length).toBe(3);
  const search = await call("GET", "/api/v1/capsules?q=mutable%20default");
  expect(search.json.results.length).toBeGreaterThan(0);
}

describe("registry API", () => {
  it("memory store", async () => apiFlow(async () => new MemoryStore()), 30_000);
  it("postgres store", async () =>
    apiFlow(async () => {
      const db = new PGlite();
      const s = new PostgresStore(async (t, p) => (await db.query(t, p as any[])).rows as Record<string, unknown>[]);
      await s.migrate();
      return s;
    }), 60_000);
});

describe("weak checks are capped (Experiment B finding)", () => {
  it("text_inspection never rises above runner_replayed", () => {
    const r = (o: Partial<AttestationRecord>): AttestationRecord => ({ runner_id: "r1", owner_id: "x", verdict: "PASS", env_key: "k", runtime: "python", version: "3.12.3", conditions: {}, mutation: { total: 4, killed: 2 }, created_at: new Date().toISOString(), ...o });
    const s = summarize([r({}), r({ runner_id: "r2", owner_id: "y" })], { authorOwnerId: "a", claims: {}, lint: ["text_inspection"] });
    expect(s.level).toBe("runner_replayed");
    expect(s.flags.join()).toMatch(/weak_check/);
  });
});
