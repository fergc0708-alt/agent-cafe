import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bindingAudience, GITHUB_ISSUER, verifyGithubOidc, type Jwks } from "../core/capsule/oidc.ts";
import { buildStatement, generateRunnerKey, signRegistration, signStatement, type ReplayPredicate } from "../core/capsule/attestation.ts";
import { capsuleId, checkDigest, type Capsule } from "../core/capsule/capsule.ts";
import { handle } from "../core/handler.ts";
import { MemoryStore } from "../core/memory-store.ts";
import { sha256Hex } from "../core/util.ts";

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? unescape(encodeURIComponent(b)) : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A fake GitHub OIDC issuer with its own RSA key, for tests only. */
async function issuer(kid = "test-kid") {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const jwks: Jwks = { keys: [{ ...pub, kid, alg: "RS256", use: "sig" }] };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid, typ: "JWT" }) => {
    const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data)));
    return `${data}.${b64url(sig)}`;
  };
  return { jwks, sign };
}

const WF = "acme/compat-lab/.github/workflows/replay.yml@refs/heads/main";
const claims = (aud: string, o: Record<string, unknown> = {}) => ({
  iss: GITHUB_ISSUER, aud, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, jti: crypto.randomUUID(),
  repository: "acme/compat-lab", repository_id: "11", repository_owner: "acme", repository_owner_id: "7", workflow_ref: WF, job_workflow_ref: WF,
  sha: "a".repeat(40), ref: "refs/heads/main", run_id: "99", run_attempt: "1", event_name: "push", runner_environment: "github-hosted", ...o,
});

describe("GitHub OIDC verification", () => {
  it("accepts a valid, policy-compliant token and rejects every tampering", async () => {
    const iss = await issuer();
    const aud = await bindingAudience("PUBKEY", ["d1", "d2"]);
    const policy = { workflows: ["acme/compat-lab/.github/workflows/replay.yml@refs/heads/*"] };
    const ok = await verifyGithubOidc(await iss.sign(claims(aud)), { jwks: iss.jwks, expectedAudience: aud, policy });
    // numeric ids are pinned: a re-created repository with the same name gets a new id
    await expect(verifyGithubOidc(await iss.sign(claims(aud, { repository_id: "999" })), { jwks: iss.jwks, expectedAudience: aud, policy: { ...policy, repositoryIds: ["11"] } })).rejects.toThrow(/repository_id/);
    expect(ok.repository_owner_id).toBe("7");
    // the audience binds key + exact payload set (order-insensitive)
    expect(await bindingAudience("PUBKEY", ["d2", "d1"])).toBe(aud);
    expect(await bindingAudience("PUBKEY", ["d1"])).not.toBe(aud);
    expect(await bindingAudience("OTHERKEY", ["d1", "d2"])).not.toBe(aud);
    const bad: [string, Promise<string>][] = [
      ["audience", iss.sign(claims(await bindingAudience("PUBKEY", ["d1"])))],
      ["self-hosted", iss.sign(claims(aud, { runner_environment: "self-hosted" }))],
      ["workflow", iss.sign(claims(aud, { job_workflow_ref: "acme/compat-lab/.github/workflows/evil.yml@refs/heads/main" }))],
      ["event", iss.sign(claims(aud, { event_name: "pull_request" }))],
      ["issuer", iss.sign(claims(aud, { iss: "https://evil.example" }))],
      ["old", iss.sign(claims(aud, { iat: Math.floor(Date.now() / 1000) - 30 * 86400 }))],
      ["future", iss.sign(claims(aud, { iat: Math.floor(Date.now() / 1000) + 3600 }))],
      ["repo substitution", iss.sign(claims(aud, { repository: "evil/repo" }))],
      ["alg none", iss.sign(claims(aud), { alg: "none", kid: "test-kid" })],
      ["no job_workflow_ref", iss.sign(claims(aud, { job_workflow_ref: undefined }))],
      ["expires before issued", iss.sign(claims(aud, { exp: Math.floor(Date.now() / 1000) - 3600 }))],
      ["unknown kid", iss.sign(claims(aud), { alg: "RS256", kid: "other" })],
    ];
    for (const [name, t] of bad) await expect(verifyGithubOidc(await t, { jwks: iss.jwks, expectedAudience: aud, policy }), name).rejects.toThrow();
    const good = await iss.sign(claims(aud));
    const [h, p, s] = good.split(".");
    const forgedClaims = b64url(JSON.stringify({ ...claims(aud), repository_owner_id: "8" }));
    await expect(verifyGithubOidc(`${h}.${forgedClaims}.${s}`, { jwks: iss.jwks, expectedAudience: aud, policy })).rejects.toThrow(/signature/);
    const other = await issuer();
    await expect(verifyGithubOidc(good, { jwks: other.jwks, expectedAudience: aud, policy })).rejects.toThrow(/signature/);
    void p;
  });
});

describe("registry: verified CI identities", () => {
  it("trusted only with a valid bound token; owners decide independence", async () => {
    const iss = await issuer();
    const store = new MemoryStore();
    const policy = { workflows: ["acme/compat-lab/.github/workflows/replay.yml@*", "zeta/lab/.github/workflows/replay.yml@*"] };
    let ip = 0;
    const call = async (method: string, path: string, body?: unknown, key?: string, withTrust = true) => {
      const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": `10.8.0.${++ip}` };
      if (key) headers.authorization = `Bearer ${key}`;
      const res = await handle(new Request("https://x.test" + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), {
        store, siteUrl: "https://x.test", ...(withTrust ? { trust: { jwks: async () => iss.jwks, policy } } : {}),
      });
      return { status: res.status, json: await res.json() };
    };
    const reg = async (h: string) => (await call("POST", "/api/v1/agents/register", { handle: h, model: "model-x", provider: "prov" })).json.api_key as string;
    const author = await reg("cafe-curator");
    const ci = await reg("ci-runner");
    const capsule = JSON.parse(readFileSync(new URL("../capsules/built/py-mutable-default.json", import.meta.url), "utf8")) as Capsule;
    const id = (await call("POST", "/api/v1/capsules", capsule, author)).json.id as string;
    const pred = async (v: string) => ({
      verdict: "PASS", capsule_id: id, check_sha256: await checkDigest(capsule),
      env: { key: `python ${v} linux-x64`, runtime: "python", version: v, os: "linux", arch: "x64", conditions: {} },
      before: { passed: false, timed_out: false }, after: { passed: true, timed_out: false }, mutation: { total: 4, killed: 4 }, lint: [], isolation: "bubblewrap", runner: { keyid: "", tool: "t" }, started_at: new Date(Date.now() - 60_000).toISOString(),
    }) as unknown as ReplayPredicate;
    const job = async (owner: { repository: string; repository_owner: string; repository_owner_id: string; workflow: string }, version: string) => {
      const k = await generateRunnerKey();
      expect((await call("POST", "/api/v1/runners", { public_key: k.publicRaw, proof: await signRegistration("ci-runner", k.publicRaw, k.privateJwk) }, ci)).status).toBe(201);
      const env = await signStatement(buildStatement(id, await pred(version)), k.privateJwk, k.keyid);
      const manifest = [await sha256Hex(env.payload)];
      const token = await iss.sign(claims(await bindingAudience(k.publicRaw, manifest), { ...owner, job_workflow_ref: owner.workflow, workflow_ref: owner.workflow }));
      return { k, env, manifest, token };
    };
    const acme = { repository: "acme/compat-lab", repository_owner: "acme", repository_owner_id: "7", workflow: WF };
    // 1) valid token -> trusted, ci_reproduced (one owner)
    const j1 = await job(acme, "3.12.1");
    let r = await call("POST", `/api/v1/capsules/${id}/attestations`, { envelope: j1.env, github_oidc: { token: j1.token, manifest: j1.manifest } }, ci);
    expect(r.status).toBe(201);
    expect(r.json.verified_identity.repository).toBe("acme/compat-lab");
    expect(r.json.evidence.level).toBe("ci_reproduced");
    // 2) a second job of the SAME owner is not independence
    const j2 = await job(acme, "3.13.1");
    r = await call("POST", `/api/v1/capsules/${id}/attestations`, { envelope: j2.env, github_oidc: { token: j2.token, manifest: j2.manifest } }, ci);
    expect(r.json.evidence.level).toBe("ci_reproduced");
    // 3) token replayed onto a different result (not in its manifest) is refused
    const j3 = await job(acme, "3.11.1");
    r = await call("POST", `/api/v1/capsules/${id}/attestations`, { envelope: j3.env, github_oidc: { token: j1.token, manifest: j1.manifest } }, ci);
    expect(r.status).toBe(400);
    // 4) token for one key reused with another key's envelope (manifest forged to include it) is refused
    r = await call("POST", `/api/v1/capsules/${id}/attestations`, { envelope: j3.env, github_oidc: { token: j1.token, manifest: [...j1.manifest, await sha256Hex(j3.env.payload)] } }, ci);
    expect(r.status).toBe(400);
    // 5) a registry with no trust policy stores it as a claim, never trusted
    const j4 = await job({ repository: "zeta/lab", repository_owner: "zeta", repository_owner_id: "9", workflow: "zeta/lab/.github/workflows/replay.yml@refs/heads/main" }, "3.10.4");
    r = await call("POST", `/api/v1/capsules/${id}/attestations`, { envelope: j4.env, github_oidc: { token: j4.token, manifest: j4.manifest } }, ci, false);
    expect(r.status).toBe(201);
    expect(r.json.verified_identity).toBeNull();
    expect(r.json.note).toMatch(/trusts no CI workflow/);
    // 6) a different owner's trusted workflow -> cross_runner_reproduced
    const j5 = await job({ repository: "zeta/lab", repository_owner: "zeta", repository_owner_id: "9", workflow: "zeta/lab/.github/workflows/replay.yml@refs/heads/main" }, "3.12.2");
    r = await call("POST", `/api/v1/capsules/${id}/attestations`, { envelope: j5.env, github_oidc: { token: j5.token, manifest: j5.manifest } }, ci);
    expect(r.json.evidence.level).toBe("cross_runner_reproduced");
    expect(r.json.evidence.verified_runners).toBe(3);
  });
});
