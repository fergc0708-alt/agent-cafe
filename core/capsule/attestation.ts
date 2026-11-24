// Signed replay results as in-toto Statement v1 inside a DSSE envelope (Ed25519 via WebCrypto).
// Reuses open standards instead of inventing a format: https://github.com/in-toto/attestation
export const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const PREDICATE_TYPE = "https://agent-cafe.dev/attestation/replay/v0.1";
export const PAYLOAD_TYPE = "application/vnd.in-toto+json";

export type Verdict = "PASS" | "PROBLEM_NOT_REPRODUCED" | "FIX_FAILS" | "FIX_BREAKS" | "ERROR";

export interface RunOutcome {
  passed: boolean;
  timed_out: boolean;
}

export interface ReplayPredicate {
  verdict: Verdict;
  capsule_id: string;
  check_sha256: string;
  env: {
    key: string;
    runtime: string;
    version: string;
    os: string;
    arch: string;
    ci?: string;
    conditions: Record<string, string>;
  };
  before: RunOutcome | null;
  after: RunOutcome;
  mutation: { total: number; killed: number };
  lint: string[];
  isolation: string;
  runner: { keyid: string; tool: string };
  started_at: string;
}

export interface Statement {
  _type: string;
  subject: { name: string; digest: { sha256: string } }[];
  predicateType: string;
  predicate: ReplayPredicate;
}

export interface Envelope {
  payloadType: string;
  payload: string; // base64
  signatures: { keyid: string; sig: string }[];
}

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** DSSE pre-authentication encoding. */
export function pae(payloadType: string, body: Uint8Array): Uint8Array {
  const head = enc.encode(`DSSEv1 ${enc.encode(payloadType).length} ${payloadType} ${body.length} `);
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

export async function keyIdFromRaw(rawPublicKeyB64: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", unb64(rawPublicKeyB64) as BufferSource);
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generateRunnerKey(): Promise<{ privateJwk: JsonWebKey; publicRaw: string; keyid: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicRaw = b64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return { privateJwk, publicRaw, keyid: await keyIdFromRaw(publicRaw) };
}

export async function signStatement(statement: Statement, privateJwk: JsonWebKey, keyid: string): Promise<Envelope> {
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "Ed25519" }, false, ["sign"]);
  const body = enc.encode(JSON.stringify(statement));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, pae(PAYLOAD_TYPE, body) as BufferSource));
  return { payloadType: PAYLOAD_TYPE, payload: b64(body), signatures: [{ keyid, sig: b64(sig) }] };
}

/** Verifies the envelope against ONE trusted public key and returns the statement. Throws on any mismatch. */
export async function verifyEnvelope(env: Envelope, publicRawB64: string): Promise<Statement> {
  if (!env || env.payloadType !== PAYLOAD_TYPE || typeof env.payload !== "string" || !Array.isArray(env.signatures)) {
    throw new Error("malformed envelope");
  }
  const keyid = await keyIdFromRaw(publicRawB64);
  const sig = env.signatures.find((s) => s.keyid === keyid);
  if (!sig) throw new Error("no signature from this runner key");
  const key = await crypto.subtle.importKey("raw", unb64(publicRawB64) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  const body = unb64(env.payload);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, unb64(sig.sig) as BufferSource, pae(PAYLOAD_TYPE, body) as BufferSource);
  if (!ok) throw new Error("bad signature");
  const statement = JSON.parse(new TextDecoder().decode(body)) as Statement;
  if (statement._type !== STATEMENT_TYPE || statement.predicateType !== PREDICATE_TYPE) throw new Error("unexpected statement type");
  return statement;
}

/** Message a runner key signs to prove possession when it is registered to an account (red-team C4). */
export function registrationMessage(handle: string, publicRawB64: string): string {
  return `agent-cafe/runner-registration/v1\n${handle}\n${publicRawB64}`;
}

export async function signRegistration(handle: string, publicRawB64: string, privateJwk: JsonWebKey): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "Ed25519" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, enc.encode(registrationMessage(handle, publicRawB64)) as BufferSource)));
}

export async function verifyRegistration(handle: string, publicRawB64: string, proofB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", unb64(publicRawB64) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, unb64(proofB64) as BufferSource, enc.encode(registrationMessage(handle, publicRawB64)) as BufferSource);
  } catch {
    return false;
  }
}

export function buildStatement(capsuleId: string, predicate: ReplayPredicate): Statement {
  return {
    _type: STATEMENT_TYPE,
    subject: [
      { name: `capsule:${capsuleId}`, digest: { sha256: capsuleId } },
      { name: "check", digest: { sha256: predicate.check_sha256 } },
    ],
    predicateType: PREDICATE_TYPE,
    predicate,
  };
}
