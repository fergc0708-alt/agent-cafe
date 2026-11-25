// Research code kept in experiments/signal-network (removed from the product); tests kept so it stays honest.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { GITHUB_ISSUER, type Jwks } from "../core/capsule/oidc.ts";
import { attribute, differentialFingerprints, observationId, PROTOCOL, scrub, shareable, signatures, validate, type Observation } from "../experiments/signal-network/protocol.ts";
import { betaCdf, betaQuantile, buildIndex, query } from "../experiments/signal-network/engine.ts";
import { npmLock, pnpmLock, requirements, tomlLock, yarnLock, updateFromTitle, diffVersions } from "../signal/lockfiles.ts";
import { audienceFor, handleSignal, MemorySignalStore, QUERY_AUDIENCE } from "../experiments/signal-network/server.ts";

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? unescape(encodeURIComponent(b)) : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function issuer(kid = "k1") {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const jwks: Jwks = { keys: [{ ...pub, kid, alg: "RS256", use: "sig" }] };
  const sign = async (claims: Record<string, unknown>) => {
    const data = `${b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
    return `${data}.${b64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data))))}`;
  };
  return { jwks, sign };
}
const claims = (aud: string, o: Record<string, unknown> = {}) => {
  const repo = (o.repository as string) ?? "acme/app";
  const wf = `${repo}/.github/workflows/ci.yml@refs/pull/1/merge`;
  return {
    iss: GITHUB_ISSUER, aud, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, jti: crypto.randomUUID(),
    repository: repo, repository_id: "11", repository_owner: "acme", repository_owner_id: "7", repository_visibility: "public",
    workflow_ref: wf, job_workflow_ref: wf, sha: "a".repeat(40), ref: "refs/pull/1/merge", run_id: "1", run_attempt: "1",
    event_name: "pull_request", runner_environment: "github-hosted", ...o,
  };
};

async function obs(p: Partial<Observation> & { baseline?: Observation["baseline"]; candidate?: Observation["candidate"] } = {}, prov: Observation["provenance"] = { kind: "local" }): Promise<Observation> {
  const baseline = p.baseline ?? "pass", candidate = p.candidate ?? "fail";
  const d = {
    protocol: PROTOCOL as typeof PROTOCOL, observed_at: p.observed_at ?? "2026-11-01",
    changes: [{ ecosystem: "npm" as const, package: "left", from: "1.0.0", to: "2.0.0", direct: true }],
    primary: p.primary ?? { ecosystem: "npm" as const, package: "left", from: "1.0.0", to: "2.0.0" },
    env: p.env === undefined ? { os: "linux", arch: "x64", runtime: "node", runtime_version: "22.11" } : p.env,
    baseline, candidate, attribution: attribute(baseline, candidate), phase: "test" as const, fingerprints: p.fingerprints ?? [],
  };
  return { ...d, id: await observationId(d), provenance: prov };
}

describe("signal protocol: attribution", () => {
  it("classifies paired experiments honestly", () => {
    expect(attribute("pass", "fail")).toBe("regression");
    expect(attribute("pass", "pass")).toBe("compatible");
    expect(attribute("fail", "fail")).toBe("baseline_red"); // a red main says nothing about the update
    expect(attribute("fail", "pass")).toBe("upgrade_fixes");
    expect(attribute("pass", "flaky")).toBe("unstable");
    expect(attribute("flaky", "fail")).toBe("unstable");
    expect(attribute("not_run", "fail")).toBe("observational_fail"); // no baseline: never causal
  });

  it("the server recomputes attribution: a client cannot claim a regression for FAIL/FAIL", async () => {
    const o = await obs({ baseline: "fail", candidate: "fail" });
    expect(() => validate({ ...o, attribution: "regression" })).toThrow(/does not follow/);
    expect(validate(o).attribution).toBe("baseline_red");
  });
});

describe("signal protocol: privacy", () => {
  it("scrubs paths, URLs, emails, secrets and numbers out of error signatures", () => {
    const s = scrub("TypeError: Cannot read 'x' of undefined at /home/alice/acme-secret/src/app.ts:42:7 https://internal.acme.corp/x token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA bob@acme.com");
    expect(s).not.toMatch(/alice|acme-secret|internal|ghp_|bob@|42/);
    expect(s).toMatch(/^TypeError/);
  });

  it("keeps only errors introduced by the update (differential), never raw logs", () => {
    const base = "ok\nDeprecationWarning: x is deprecated\n";
    const cand = "DeprecationWarning: x is deprecated\nTypeError: foo.bar is not a function\n    at /srv/app/index.js:10:3\n";
    expect(differentialFingerprints(base, cand)).toEqual(["TypeError: <id> is not a function"]);
    expect(signatures("just text\nnothing here")).toEqual([]);
  });

  it("shares only allow-listed fields; internal packages never leave", async () => {
    const o = await obs({}, { kind: "local", source_url: "https://github.com/acme/private-thing/pull/3" });
    o.changes.push({ ecosystem: "npm", package: "@acme/internal-auth", from: "1.0.0", to: "1.0.1", direct: false });
    const s = shareable(o, { privatePackages: ["@acme/*"] });
    expect(JSON.stringify(s)).not.toMatch(/internal-auth|private-thing/);
    expect(Object.keys(s).sort()).toEqual(["attribution", "baseline", "candidate", "changes", "env", "fingerprints", "id", "observed_at", "phase", "primary", "protocol", "provenance"].sort());
    const p = await obs({ primary: { ecosystem: "npm", package: "@acme/internal-auth", from: "1.0.0", to: "2.0.0" } });
    expect(() => shareable(p, { privatePackages: ["@acme/*"] })).toThrow(/private/);
  });

  it("signatures keep the error type and message shape only (no secrets, hosts, users, identifiers)", () => {
    const leaks = [
      "Error: AKIAIOSFODNN7EXAMPLE rejected", "Error: token ghp_shortTok12345 invalid", "ConnectionError: host.acme.internal user=svc_billing password=Sup3rS3cret!",
      "OperationalError: postgresql+psycopg2://admin:hunter2@db/prod", "Error: getaddrinfo ENOTFOUND registry.npm.acme-corp.net", "Error: C:\\Users\\Juan Gonzalez\\app\\x.js",
      "ValueError: user fernando.gonzalez not allowed", "KeyError: AcmeInternalBillingClient", "Error: sk-live-51Habc23XYZ",
      "JWTError: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
    ];
    for (const l of leaks) expect(scrub(l)).not.toMatch(/AKIA|ghp_|acme|svc_billing|Sup3r|hunter2|admin|ENOTFOUND registry|Gonzalez|fernando|AcmeInternal|sk-live|eyJ/);
    const big = "Error: x\n".repeat(20000);
    const t = Date.now(); signatures(big); expect(Date.now() - t).toBeLessThan(1500);
    const s1 = scrub("TypeError: " + "word ".repeat(60));
    expect(scrub(s1)).toBe(s1); // idempotent
  });

  it("the server rejects unscrubbed fingerprints", async () => {
    const o = await obs({ fingerprints: ["TypeError at /home/alice/x.js:1"] });
    expect(() => validate(o)).toThrow(/scrubbed/);
  });
});

describe("signal engine: independence, uncertainty and honesty", () => {
  it("one owner is one voice: 10 retries/repos of one org do not outweigh another org", async () => {
    const many = await Promise.all(Array.from({ length: 10 }, (_, i) => obs({ observed_at: `2026-10-0${(i % 9) + 1}` }, { kind: "github-oidc", owner_id: "1", repository_id: String(i) })));
    const one = await obs({ candidate: "pass" }, { kind: "github-oidc", owner_id: "2", repository_id: "99" });
    const r = query(buildIndex([...many, one]), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0" });
    expect(r.causal.owners).toBe(2);
    expect(r.causal.failures).toBe(1);
    expect(r.verdict).toBe("single_report"); // two owners are not enough to conclude anything
    // fleet mode (inside one org): repositories are the unit
    const f = query(buildIndex(many), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0", unit: "repository" });
    expect(f.causal.owners).toBe(10);
  });

  it("never pools observational CI status with paired evidence, and says 'insufficient' with little data", async () => {
    const seeds = await Promise.all(Array.from({ length: 3 }, (_, i) => obs({ baseline: "not_run", candidate: "fail" }, { kind: "seed", source_url: `https://github.com/o${i}/r/pull/1` })));
    const r = query(buildIndex(seeds), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0" });
    expect(r.causal.owners).toBe(0);
    expect(r.causal.mean).toBeNull(); // no score without evidence
    expect(r.observational.owners).toBe(3);
    expect(r.verdict).toBe("insufficient_evidence");
  });

  it("red baselines and flaky runs are inconclusive, not failures", async () => {
    const a = await obs({ baseline: "fail", candidate: "fail" }, { kind: "github-oidc", owner_id: "1" });
    const b = await obs({ baseline: "pass", candidate: "flaky" }, { kind: "github-oidc", owner_id: "2" });
    const r = query(buildIndex([a, b]), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0" });
    expect(r.causal.owners).toBe(0);
    expect(r.inconclusive).toBe(2);
  });

  it("does not look at the future, excludes the asking owner and flags an untested environment", async () => {
    const past = await obs({ observed_at: "2026-10-01", env: { os: "linux", arch: "x64", runtime: "node", runtime_version: "20.18" } }, { kind: "github-oidc", owner_id: "1" });
    const future = await obs({ observed_at: "2026-12-01" }, { kind: "github-oidc", owner_id: "2" });
    const mine = await obs({ observed_at: "2026-09-01" }, { kind: "github-oidc", owner_id: "3" });
    const r = query(buildIndex([past, future, mine]), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0", before: "2026-11-01", excludeOwner: "id:3", env: { runtime: "node", runtime_version: "24.1" } });
    expect(r.causal.owners).toBe(1);
    expect(r.your_env_tested).toBe(false);
  });

  it("Sybil resistance: two fabricated owners can neither clear nor condemn an update", async () => {
    const crowd = await Promise.all(Array.from({ length: 30 }, (_, i) => obs({ baseline: "not_run", candidate: "fail" }, { kind: "seed", source_url: `https://github.com/o${i}/r/pull/1` })));
    const sybils = await Promise.all([1, 2].map((i) => obs({ baseline: "pass", candidate: "pass" }, { kind: "github-oidc", owner_login: `sybil${i}` })));
    expect(query(buildIndex([...crowd, ...sybils]), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0" }).verdict).not.toBe("likely_safe");
    const three = await Promise.all([1, 2, 3].map((i) => obs({ baseline: "pass", candidate: "pass" }, { kind: "github-oidc", owner_login: `s${i}` })));
    expect(query(buildIndex([...crowd, ...three]), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0" }).verdict).toBe("mixed"); // contradiction is shown, not resolved
    const passes = await Promise.all(Array.from({ length: 40 }, (_, i) => obs({ baseline: "not_run", candidate: "pass" }, { kind: "seed", source_url: `https://github.com/p${i}/r/pull/1` })));
    const one = await obs({}, { kind: "github-oidc", owner_login: "attacker" });
    expect(query(buildIndex([...passes, one]), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0" }).verdict).not.toBe("known_regression");
  });

  it("exact matches do not shadow same-target evidence; prereleases are not pooled with releases", async () => {
    const reg = await Promise.all([1, 2, 3].map((i) => obs({ primary: { ecosystem: "npm", package: "left", from: "1.5.0", to: "2.0.0" } }, { kind: "github-oidc", owner_login: `r${i}` })));
    const exactPass = await obs({ baseline: "not_run", candidate: "pass" }, { kind: "seed", source_url: "https://github.com/z/r/pull/1" });
    const r = query(buildIndex([...reg, exactPass]), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0" });
    expect(r.causal.failures).toBe(3);
    expect(r.verdict).toBe("known_regression");
    const beta = await Promise.all([1, 2, 3].map((i) => obs({ primary: { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0-beta.1" } }, { kind: "github-oidc", owner_login: `b${i}` })));
    expect(query(buildIndex(beta), { ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.1" }).match).toBe("none");
  });

  it("credible intervals are correct and shrink with data", () => {
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 6);
    expect(betaQuantile(0.95, 1, 1)).toBeCloseTo(0.95, 4);
    expect(betaQuantile(0.05, 3, 7)).toBeCloseTo(0.0977, 3); // reference value from the Beta(3,7) quantile function
  });
});

describe("signal lockfiles", () => {
  it("reads npm (v3), pnpm, yarn, requirements and uv/poetry lockfiles", () => {
    expect(npmLock(JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "app" }, "node_modules/vite": { version: "7.1.0" }, "node_modules/a/node_modules/vite": { version: "5.0.0" } } })).get("vite")).toBe("7.1.0");
    expect(pnpmLock("lockfileVersion: '9.0'\npackages:\n  vite@7.1.0:\n    resolution: {}\n  '@types/node@22.1.0':\n    x: y\n").get("@types/node")).toBe("22.1.0");
    expect(yarnLock('"vite@^7.0.0":\n  version "7.1.0"\n').get("vite")).toBe("7.1.0");
    expect(requirements("Django==5.1.4 # pinned\nrequests>=2\n").get("django")).toBe("5.1.4");
    expect(tomlLock('[[package]]\nname = "Pydantic_Core"\nversion = "2.27.1"\n').get("pydantic-core")).toBe("2.27.1");
    expect(updateFromTitle("chore(deps): update dependency vite to v7.1.0")).toEqual({ package: "vite", to: "7.1.0" });
    expect(updateFromTitle("Bump requests from 2.31.0 to 2.32.0")).toEqual({ package: "requests", from: "2.31.0", to: "2.32.0" });
    // the hoisted copy wins over nested ones; workspace links and patches are not packages
    const multi = npmLock(JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@babel/core/node_modules/semver": { version: "6.3.1" }, "node_modules/semver": { version: "7.6.3" }, "packages/app": { version: "1.0.0" }, "node_modules/app": { link: true, resolved: "packages/app" } } }));
    expect(multi.get("semver")).toBe("7.6.3");
    expect([...multi.keys()]).not.toContain("");
    expect(pnpmLock("importers:\n  .:\n    dependencies:\n      semver:\n        specifier: ^7\n        version: 7.6.3\npackages:\n  semver@6.3.1:\n    x: y\n  semver@7.6.3:\n    x: y\n").get("semver")).toBe("7.6.3");
    const y = yarnLock('"resolve@patch:resolve@^1.0.0#~builtin<compat/resolve>":\n  version: 1.22.8\n"is-num@npm:is-number@^7":\n  version: 7.0.0\n');
    expect([...y.keys()]).toEqual(["is-num"]);
    const d = diffVersions("npm", new Map([["a", "1.0.0"], ["b", "1.0.0"]]), new Map([["a", "2.0.0"], ["c", "1.0.0"]]), new Set(["a"]));
    expect(d.map((c) => `${c.package}:${c.from}->${c.to}:${c.direct}`)).toEqual(["a:1.0.0->2.0.0:true", "b:1.0.0->null:false", "c:null->1.0.0:false"]);
  });
});

describe("signal ingestion service", () => {
  const setup = async () => {
    const iss = await issuer();
    const store = new MemorySignalStore();
    const deps = { store, jwks: async () => iss.jwks };
    const post = async (body: unknown) => handleSignal(new Request("http://x/api/signal/v1/observations", { method: "POST", body: JSON.stringify(body) }), "/api/signal/v1/observations", deps);
    return { iss, store, deps, post };
  };

  it("accepts a bound OIDC token; provenance comes from the token, not from the client", async () => {
    const { iss, store, post } = await setup();
    const o = await obs({}, { kind: "github-oidc", owner_id: "999-spoofed", source_url: "https://github.com/evil/x" });
    const r = await post({ observation: o, oidc_token: await iss.sign(claims(audienceFor(o.id))), share_public: true });
    expect(r!.status).toBe(200);
    const s = [...store.rows.values()][0];
    expect(s.provenance.owner_id).toBe("7");
    expect(s.provenance.source_url).toBeUndefined(); // not shared unless asked
    expect(s.scope).toBe("public");
  });

  it("rejects spoofed identities: wrong audience, self-hosted runner, forged signature, other issuer", async () => {
    const { iss, post } = await setup();
    const other = await issuer();
    const o = await obs();
    const bad = [
      await iss.sign(claims(audienceFor("f".repeat(64)))), // token minted for a different observation
      await iss.sign(claims(audienceFor(o.id), { runner_environment: "self-hosted" })),
      await other.sign(claims(audienceFor(o.id))), // signed by an unknown key
      await iss.sign(claims(audienceFor(o.id), { iss: "https://evil.example" })),
      "not-a-jwt",
    ];
    for (const t of bad) expect((await post({ observation: o, oidc_token: t }))!.status).toBe(401);
  });

  it("duplicate submissions replace each other (retries are not evidence) and quotas cap flooding", async () => {
    const { iss, store, deps, post } = await setup();
    const o = await obs();
    for (let i = 0; i < 3; i++) expect((await post({ observation: o, oidc_token: await iss.sign(claims(audienceFor(o.id), { run_attempt: String(i + 1) })) }))!.status).toBe(200);
    expect(store.rows.size).toBe(1);
    const capped = { ...deps, dailyQuotaPerOwner: 1 };
    const o2 = await obs({ observed_at: "2026-11-02" });
    const r = await handleSignal(new Request("http://x/api/signal/v1/observations", { method: "POST", body: JSON.stringify({ observation: o2, oidc_token: await iss.sign(claims(audienceFor(o2.id), { sha: "b".repeat(40) })) }) }), "/api/signal/v1/observations", capped);
    expect(r!.status).toBe(429);
  });

  it("private repositories' observations are never shown to other owners, but inform their own fleet", async () => {
    const { iss, deps, post } = await setup();
    const o = await obs();
    await post({ observation: o, oidc_token: await iss.sign(claims(audienceFor(o.id), { repository_visibility: "private" })), share_public: true });
    const anon = await handleSignal(new Request("http://x/api/signal/v1/query?ecosystem=npm&package=left&from=1.0.0&to=2.0.0"), "/api/signal/v1/query", deps);
    expect((await anon!.json()).network.causal.owners).toBe(0);
    const mine = await handleSignal(new Request("http://x/api/signal/v1/query", { method: "POST", body: JSON.stringify({ ecosystem: "npm", package: "left", from: "1.0.0", to: "2.0.0", oidc_token: await iss.sign(claims(QUERY_AUDIENCE)) }) }), "/api/signal/v1/query", deps);
    const j = await mine!.json();
    expect(j.network.causal.owners).toBe(0);
    expect(j.your_organization.causal.owners).toBe(1);
  });

  it("a token works once and only for the content it was minted for; read tokens cannot write", async () => {
    const { iss, post } = await setup();
    const a = await obs();
    const b = await obs({ primary: { ecosystem: "npm", package: "react", from: "18.0.0", to: "19.0.0" } });
    const tok = await iss.sign(claims(audienceFor(a.id)));
    expect((await post({ observation: a, oidc_token: tok }))!.status).toBe(200);
    expect((await post({ observation: a, oidc_token: tok }))!.status).toBe(401); // replay
    expect((await post({ observation: { ...b, id: a.id }, oidc_token: await iss.sign(claims(audienceFor(a.id))) }))!.status).toBe(400); // id/content mismatch
    expect((await post({ observation: { ...a, id: "query" }, oidc_token: await iss.sign(claims(QUERY_AUDIENCE)) }))!.status).toBe(400);
    expect((await post({ observation: a, oidc_token: await iss.sign(claims(audienceFor(a.id), { event_name: "push" })) }))!.status).toBe(401); // only PR runs
    expect((await post({ observation: a, oidc_token: await iss.sign(claims(audienceFor(a.id), { exp: undefined })) }))!.status).toBe(401);
  });

  it("drops unknown fields and rejects bad enums; bad query bodies are 400s, never crashes", async () => {
    const { iss, store, deps, post } = await setup();
    const o = await obs();
    expect((await post({ observation: { ...o, env: { ...o.env, os: "linux](https://evil)" } }, oidc_token: await iss.sign(claims(audienceFor(o.id))) }))!.status).toBe(400);
    expect((await post({ observation: { ...o, junk: "x".repeat(1000) }, oidc_token: await iss.sign(claims(audienceFor(o.id))) }))!.status).toBe(200);
    expect(JSON.stringify([...store.rows.values()][0])).not.toMatch(/junk/);
    for (const body of ["null", "[]", '{"package": 5}', "{"]) {
      const r = await handleSignal(new Request("http://x/api/signal/v1/query", { method: "POST", body }), "/api/signal/v1/query", deps);
      expect(r!.status).toBe(400);
    }
    const big = await handleSignal(new Request("http://x/api/signal/v1/query", { method: "POST", body: "x".repeat(200_000) }), "/api/signal/v1/query", deps);
    expect(big!.status).toBe(413);
  });

  it("rejects malformed observations and oversized payloads", async () => {
    const { post } = await setup();
    expect((await post({ observation: { protocol: "x" } }))!.status).toBe(400);
    expect((await post({ observation: { ...(await obs()), primary: { ecosystem: "npm", package: "../../etc", from: "1", to: "2" } } }))!.status).toBe(400);
    const big = await handleSignal(new Request("http://x/api/signal/v1/observations", { method: "POST", body: "x".repeat(70_000) }), "/api/signal/v1/observations", { store: new MemorySignalStore(), jwks: async () => ({ keys: [] }) });
    expect(big!.status).toBe(413);
  });
});
