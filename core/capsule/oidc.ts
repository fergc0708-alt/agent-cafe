// Verified runner identity via GitHub Actions OIDC.
//
// A replay job running on a GitHub-hosted runner asks GitHub for an OIDC token whose AUDIENCE is a
// digest of (the job's ephemeral runner public key + the digests of every result payload it signed).
// GitHub signs the token (RS256) with keys published at GITHUB_JWKS_URL. Verifying it proves:
//   - the results were produced inside a job of a specific repository/workflow/commit/run,
//   - on GitHub-hosted infrastructure (a self-hosted runner could fabricate the execution),
//   - and that exactly THESE payloads, signed by THIS key, are what that job vouched for.
// It does NOT prove the check is meaningful, or that the workflow owner is independent of the
// capsule author. Identity is where a result came from, not whether it is true.
//
// The token is used as a signed identity statement, not as a bearer credential, so `exp` (minutes)
// is not enforced; replay is prevented by the audience binding (exact payload set) plus payload
// de-duplication, and freshness by `iat` and the predicates' started_at.
import { sha256Hex } from "../util.ts";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`;
export const AUDIENCE_PREFIX = "agent-cafe/v1:";

export interface Jwks {
  keys: (JsonWebKey & { kid?: string })[];
}

export interface GithubIdentity {
  repository: string;
  repository_id: string;
  repository_owner: string;
  repository_owner_id: string;
  workflow_ref: string;
  job_workflow_ref: string;
  sha: string;
  ref: string;
  run_id: string;
  run_attempt: string;
  event_name: string;
  runner_environment: string;
  jti: string;
  iat: number;
}

export interface TrustPolicy {
  /** Allowed workflow refs, e.g. "owner/repo/.github/workflows/replay.yml@refs/heads/main". A trailing
   *  "*" matches any suffix (e.g. "...@refs/heads/goat/*"). Matched against job_workflow_ref. */
  workflows: string[];
  /** Allowed triggering events. Pull requests are excluded by default (fork code could run). */
  events?: string[];
  /** Max age of the token at verification time (default 7 days). */
  maxAgeMs?: number;
  /** Pin numeric ids too: a deleted and re-created repository/owner with the same NAME gets new ids. */
  repositoryIds?: string[];
  ownerIds?: string[];
}

const DEFAULT_EVENTS = ["push", "workflow_dispatch", "schedule"];

/** Audience that binds a token to one runner key and an exact set of signed payloads. */
export async function bindingAudience(publicKeyB64: string, payloadDigests: string[]): Promise<string> {
  const sorted = [...new Set(payloadDigests)].sort();
  return AUDIENCE_PREFIX + (await sha256Hex(`${publicKeyB64}\n${sorted.join("\n")}`));
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, any> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

export function matchesWorkflow(ref: string, pattern: string): boolean {
  return pattern.endsWith("*") ? ref.startsWith(pattern.slice(0, -1)) : ref === pattern;
}

/** Throws with a precise reason unless the token is a valid, policy-compliant GitHub Actions identity. */
export async function verifyGithubOidc(
  token: string,
  opts: { jwks: Jwks; expectedAudience: string; policy: TrustPolicy; now?: number },
): Promise<GithubIdentity> {
  if (typeof token !== "string" || token.length > 8192) throw new Error("token missing or too large");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const header = decodeJson(parts[0]);
  if (header.alg !== "RS256") throw new Error(`unexpected alg ${header.alg}`); // no "none", no HS256 confusion
  const jwk = opts.jwks.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) throw new Error(`unknown signing key ${header.kid}`);
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]) as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as BufferSource);
  if (!ok) throw new Error("bad token signature");
  const c = decodeJson(parts[1]);
  const now = opts.now ?? Date.now();
  if (c.iss !== GITHUB_ISSUER) throw new Error(`wrong issuer ${c.iss}`);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(opts.expectedAudience)) throw new Error("audience does not bind this key and these results");
  const iat = Number(c.iat) * 1000;
  if (!Number.isFinite(iat) || iat > now + 120_000) throw new Error("token issued in the future");
  if (now - iat > (opts.policy.maxAgeMs ?? 7 * 86_400_000)) throw new Error("token too old");
  if (c.nbf !== undefined && Number(c.nbf) * 1000 > now + 120_000) throw new Error("token not yet valid");
  if (c.runner_environment !== "github-hosted") throw new Error("not a GitHub-hosted runner (self-hosted runners can fabricate executions)");
  if (!(opts.policy.events ?? DEFAULT_EVENTS).includes(c.event_name)) throw new Error(`event ${c.event_name} is not trusted`);
  // job_workflow_ref names the workflow file that actually ran the job; never fall back to workflow_ref.
  if (typeof c.job_workflow_ref !== "string" || !c.job_workflow_ref) throw new Error("missing job_workflow_ref");
  const wf = c.job_workflow_ref;
  if (!opts.policy.workflows.some((p) => matchesWorkflow(wf, p))) throw new Error(`workflow ${wf} is not in the trust policy`);
  if (opts.policy.repositoryIds && !opts.policy.repositoryIds.includes(String(c.repository_id))) throw new Error("repository_id is not the pinned one");
  if (opts.policy.ownerIds && !opts.policy.ownerIds.includes(String(c.repository_owner_id))) throw new Error("repository_owner_id is not the pinned one");
  for (const k of ["repository", "repository_id", "repository_owner", "repository_owner_id", "sha", "run_id", "jti"]) {
    if (typeof c[k] !== "string" || !c[k]) throw new Error(`missing claim ${k}`);
  }
  if (!/^[0-9a-f]{40}$/.test(c.sha)) throw new Error("bad sha claim");
  if (c.exp !== undefined && Number(c.exp) * 1000 < iat) throw new Error("token expires before it was issued");
  if (!wf.startsWith(`${c.repository}/`)) throw new Error("workflow ref does not belong to the token's repository");
  return {
    repository: c.repository,
    repository_id: c.repository_id,
    repository_owner: c.repository_owner,
    repository_owner_id: c.repository_owner_id,
    workflow_ref: String(c.workflow_ref ?? ""),
    job_workflow_ref: wf,
    sha: c.sha,
    ref: String(c.ref ?? ""),
    run_id: c.run_id,
    run_attempt: String(c.run_attempt ?? ""),
    event_name: c.event_name,
    runner_environment: c.runner_environment,
    jti: c.jti,
    iat: Number(c.iat),
  };
}

let cache: { at: number; jwks: Jwks } | null = null;

/** Fetches GitHub's signing keys (cached 10 minutes). */
export async function fetchGithubJwks(fetcher: typeof fetch = fetch): Promise<Jwks> {
  if (cache && Date.now() - cache.at < 600_000) return cache.jwks;
  const res = await fetcher(GITHUB_JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const jwks = (await res.json()) as Jwks;
  if (!Array.isArray(jwks?.keys)) throw new Error("bad JWKS");
  cache = { at: Date.now(), jwks };
  return jwks;
}

/** Digest of a key set (kid, kty, n, e only): lets a JWKS snapshot be pinned in source code. */
export async function jwksDigest(jwks: Jwks): Promise<string> {
  const keys = jwks.keys.map((k) => ({ kid: k.kid, kty: k.kty, n: k.n, e: k.e })).sort((a, b) => String(a.kid).localeCompare(String(b.kid)));
  return sha256Hex(JSON.stringify(keys));
}

/** Server trust policy from CAFE_TRUSTED_WORKFLOWS (comma-separated). Empty means: trust no workflow. */
export function policyFromEnv(value: string | undefined): TrustPolicy {
  return { workflows: (value ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
}
