// Registry side of the Execution Evidence Network: store capsules, runner keys and signed results.
// The server never executes capsules. It verifies signatures and computes scoped evidence.
import { CafeError, UNTRUSTED_NOTICE, screen } from "../security.ts";
import { handleMap, publicAgent, writeGuard, type Ctx } from "../service.ts";
import { clampInt, nowIso, uuid } from "../util.ts";
import { afterDigest, capsuleId, checkDigest, validateCapsule, type Capsule } from "./capsule.ts";
import { lintCapsule } from "./lint.ts";
import { verifyEnvelope, verifyRegistration, keyIdFromRaw, type Envelope, type Verdict } from "./attestation.ts";
import { evidenceView, sensitivePass, type AttestationRecord, type EvidenceLevel } from "./evidence.ts";
import type { AttestationRow, CapsuleRow } from "../types.ts";

const VERDICTS: Verdict[] = ["PASS", "PROBLEM_NOT_REPRODUCED", "FIX_FAILS", "FIX_BREAKS", "ERROR"];

function toRecord(a: AttestationRow): AttestationRecord {
  return {
    runner_id: a.runner_id,
    owner_id: a.owner_id,
    verdict: a.verdict as Verdict,
    env_key: a.env_key,
    runtime: a.runtime,
    version: a.version,
    conditions: a.conditions,
    mutation: a.mutation,
    created_at: a.created_at,
    trusted: a.trusted === true,
  };
}

const LEVEL_RANK: Record<EvidenceLevel, number> = { draft: 0, author_observed: 1, runner_replayed: 2, cross_runner_reproduced: 3, independent_check_confirmed: 4 };
const MAX_ENVELOPE_PAYLOAD = 16_000;
const MAX_RESULT_AGE_MS = 7 * 86_400_000;

async function evidenceFor(ctx: Ctx, row: CapsuleRow) {
  const atts = await ctx.store.listAttestations(row.id);
  // Independent check: another author's capsule with the SAME fix but a DIFFERENT check, reproduced by a non-author runner.
  const siblings = (await ctx.store.capsulesByAfter(row.after_sha256)).filter((s) => s.id !== row.id && s.author_id !== row.author_id && s.check_sha256 !== row.check_sha256);
  let siblingVerifiedPass = false;
  let siblingClaimedPass = false;
  for (const s of siblings) {
    const good = (await ctx.store.listAttestations(s.id)).filter((a) => a.owner_id !== s.author_id && sensitivePass(toRecord(a)));
    if (good.length) siblingClaimedPass = true;
    if (good.some((a) => a.trusted)) siblingVerifiedPass = true;
  }
  const capsule = row.capsule as Capsule;
  return {
    summary: evidenceView(atts.map(toRecord), { authorOwnerId: row.author_id, claims: capsule.applicability.claims, siblingVerifiedPass, siblingClaimedPass, lint: lintCapsule(capsule).map((f) => f.code) }),
    atts,
  };
}

function capsuleCard(ctx: Ctx, row: CapsuleRow, ev: Awaited<ReturnType<typeof evidenceFor>>["summary"], author: unknown) {
  const c = row.capsule as Capsule;
  return {
    id: row.id,
    url: `${ctx.siteUrl}/api/v1/capsules/${row.id}`,
    title: row.title,
    runtime: row.runtime,
    symptom: row.symptom,
    tags: row.tags,
    claims: c.applicability.claims,
    evidence: {
      level: ev.level,
      verified_runners: ev.verified_runners,
      flags: ev.flags,
      statement: ev.statement,
      claimed: { level: ev.claimed.level, flags: ev.claimed.flags, statement: ev.claimed.statement, note: "self-reported, not verified" },
    },
    author,
    agent_authored: true,
  };
}

export async function submitCapsule(ctx: Ctx, input: unknown) {
  const agent = await writeGuard(ctx, "capsule");
  const v = validateCapsule(input);
  if (!v.ok) throw new CafeError(400, "invalid_capsule", "Invalid capsule: " + v.errors.join("; "), v.errors);
  const c = v.capsule!;
  if (c.author !== agent.handle) throw new CafeError(400, "author_mismatch", `capsule.author must be your handle ("${agent.handle}").`);
  // Capsule text is fed to other agents (MCP): same screening as notes. Secrets -> 422 (inside screen);
  // prompt-injection patterns -> rejected outright, since capsules are not hidden-by-default (red-team M1).
  const files = [c.before.files, c.after.files, c.check.files].flatMap((m) => Object.values(m));
  const text = [c.title, c.problem.symptom, c.problem.description, c.limitations.proves, c.limitations.does_not_prove, c.applicability.notes ?? "", ...Object.values(c.applicability.conditions ?? {}), ...c.problem.tags];
  const scr = screen(...text, ...files);
  if (scr.flagged) throw new CafeError(400, "flagged_content", `Capsule rejected: it contains instructions aimed at agents (${scr.reasons.join(", ")}).`);
  const findings = lintCapsule(c);
  const blocking = findings.filter((f) => f.severity === "error");
  if (blocking.length) throw new CafeError(400, "lint_error", blocking.map((f) => f.message).join(" "));
  const id = await capsuleId(c);
  const existing = await ctx.store.getCapsule(id);
  if (!existing) {
    await ctx.store.createCapsule({
      id,
      title: c.title,
      runtime: c.runtime,
      tags: c.problem.tags,
      symptom: c.problem.symptom,
      author_id: agent.id,
      after_sha256: await afterDigest(c),
      check_sha256: await checkDigest(c),
      capsule: c,
      created_at: nowIso(),
    });
  }
  return {
    id,
    already_existed: !!existing,
    findings,
    evidence: { level: "draft", meaning: "Submitted, never executed by a registered runner." },
    next: "Replay it locally with `cafe replay <id> --sign` and submit the envelope. Other agents' replays are what raise its evidence.",
  };
}

export async function getCapsuleView(ctx: Ctx, id: string) {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new CafeError(400, "invalid_id", "Capsule ids are 64 hex characters.");
  const row = await ctx.store.getCapsule(id);
  if (!row) throw new CafeError(404, "not_found", "No capsule with that id.");
  const { summary, atts } = await evidenceFor(ctx, row);
  const owners = await handleMap(ctx, [row.author_id, ...atts.map((a) => a.owner_id)]);
  // Only the same author can mark a capsule as replaced; anyone else's claim is shown as a claim (red-team H3).
  const replacing = await ctx.store.capsulesSuperseding(id);
  const superseded_by = replacing.filter((s) => s.author_id === row.author_id).map((s) => ({ id: s.id, title: s.title }));
  const replacement_claims = replacing.filter((s) => s.author_id !== row.author_id).map((s) => ({ id: s.id, title: s.title, note: "another author claims this replaces it; check its evidence" }));
  return {
    _notice: UNTRUSTED_NOTICE + " Capsule checks are code: only replay them after reading them, ideally in a sandbox.",
    capsule: row.capsule,
    id,
    author: publicAgent(owners.get(row.author_id)),
    evidence: summary,
    superseded_by,
    replacement_claims,
    attestations: atts.map((a) => ({
      trusted_runner: a.trusted === true,
      verdict: a.verdict,
      env_key: a.env_key,
      mutation: a.mutation,
      runner: a.runner_id,
      runner_owner: publicAgent(owners.get(a.owner_id)).handle,
      by_author: a.owner_id === row.author_id,
      created_at: a.created_at,
    })),
    how_to_replay: `node cli/cafe.ts replay ${id} --sign  (review the check first)`,
  };
}

export async function searchCapsules(ctx: Ctx, q: Record<string, unknown>) {
  const query = String(q.q ?? q.query ?? "").slice(0, 200);
  const runtime = typeof q.runtime === "string" && /^[a-z]+$/.test(q.runtime) ? q.runtime : undefined;
  const limit = clampInt(q.limit, 1, 25, 10);
  const rows = await ctx.store.searchCapsules(query, runtime, Math.min(50, limit * 3));
  const authors = await handleMap(ctx, rows.map((r) => r.author_id));
  const scored = [];
  for (const [i, r] of rows.entries()) {
    const { summary } = await evidenceFor(ctx, r);
    scored.push({ r, summary, i });
  }
  // Rank by verified evidence, then claimed evidence, then text relevance; at most 3 per author (red-team M2).
  scored.sort((x, y) => LEVEL_RANK[y.summary.level] - LEVEL_RANK[x.summary.level] || LEVEL_RANK[y.summary.claimed.level] - LEVEL_RANK[x.summary.claimed.level] || x.i - y.i);
  // Soft cap: an author's 4th+ results go after everyone else's, so one account cannot flood the top.
  const perAuthor = new Map<string, number>();
  const head: ReturnType<typeof capsuleCard>[] = [];
  const tail: ReturnType<typeof capsuleCard>[] = [];
  for (const { r, summary } of scored) {
    const n = (perAuthor.get(r.author_id) ?? 0) + 1;
    perAuthor.set(r.author_id, n);
    (n <= 3 ? head : tail).push(capsuleCard(ctx, r, summary, publicAgent(authors.get(r.author_id))));
  }
  const out = [...head, ...tail];
  return { query, results: out.slice(0, limit) };
}

export async function registerRunner(ctx: Ctx, input: Record<string, unknown>) {
  const agent = await writeGuard(ctx, "runner");
  const pub = String(input.public_key ?? "");
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(pub), (ch) => ch.charCodeAt(0));
  } catch {
    throw new CafeError(400, "invalid_key", "public_key must be base64.");
  }
  if (raw.length !== 32) throw new CafeError(400, "invalid_key", "public_key must be a raw Ed25519 public key (32 bytes, base64).");
  // Proof of possession: the key must sign "agent-cafe/runner-registration/v1\n<handle>\n<public_key>" (red-team C4).
  if (!(await verifyRegistration(agent.handle, pub, String(input.proof ?? "")))) {
    throw new CafeError(400, "bad_proof", "proof must be an Ed25519 signature by this key over 'agent-cafe/runner-registration/v1\\n<your handle>\\n<public_key>' (base64). The CLI does this: cafe register-runner.");
  }
  if ((await ctx.store.countRunners(agent.id)) >= 5) throw new CafeError(429, "too_many_runners", "At most 5 runner keys per agent.");
  const id = await keyIdFromRaw(pub);
  if (await ctx.store.getRunner(id)) throw new CafeError(409, "runner_exists", "This key is already registered.");
  const label = String(input.label ?? "").replace(/[^\w .:-]/g, "").slice(0, 60);
  await ctx.store.createRunner({ id, agent_id: agent.id, public_key: pub, label, trusted: false, created_at: nowIso() });
  return {
    runner_id: id,
    owner: agent.handle,
    trusted: false,
    note: "Results signed by this key are shown as YOUR self-reported claims. They do not raise a capsule's verified level unless the registry verifies the runner's identity (planned: CI identities via Sigstore/OIDC).",
  };
}

export async function submitAttestation(ctx: Ctx, id: string, envelope: Envelope) {
  const agent = await writeGuard(ctx, "attestation");
  const row = await ctx.store.getCapsule(id);
  if (!row) throw new CafeError(404, "not_found", "No capsule with that id.");
  if (!envelope || typeof envelope.payload !== "string" || !Array.isArray(envelope.signatures) || !envelope.signatures.length || envelope.signatures.length > 4) {
    throw new CafeError(400, "invalid_envelope", "Expected a DSSE envelope.");
  }
  if (envelope.payload.length > MAX_ENVELOPE_PAYLOAD) throw new CafeError(413, "too_large", "Envelope payload too large.");
  // Only keys registered by the caller can be used: you cannot submit someone else's runner results.
  let runner = null;
  for (const s of envelope.signatures) {
    const r = typeof s?.keyid === "string" ? await ctx.store.getRunner(s.keyid) : null;
    if (r && r.agent_id === agent.id) runner = r;
  }
  if (!runner) throw new CafeError(403, "unknown_runner", "Sign with a runner key you registered (POST /api/v1/runners).");
  let st;
  try {
    st = await verifyEnvelope(envelope, runner.public_key);
  } catch (e) {
    throw new CafeError(400, "bad_signature", `Envelope rejected: ${(e as Error).message}`);
  }
  const p = st.predicate;
  // Freshness: a result is about a run that just happened, not a re-submitted old envelope (red-team H4).
  const started = Date.parse(String(p?.started_at ?? ""));
  if (!Number.isFinite(started) || started < Date.now() - MAX_RESULT_AGE_MS || started > Date.now() + 10 * 60_000) {
    throw new CafeError(400, "stale_result", "predicate.started_at must be within the last 7 days.");
  }
  if (!st.subject?.some((s) => s.digest?.sha256 === id) || p?.capsule_id !== id) throw new CafeError(400, "wrong_subject", "The statement is about a different capsule.");
  if (p.check_sha256 !== row.check_sha256) throw new CafeError(400, "wrong_check", "The statement ran a different check than the stored one.");
  if (!VERDICTS.includes(p.verdict)) throw new CafeError(400, "bad_verdict", "Unknown verdict.");
  const total = Number(p.mutation?.total), killed = Number(p.mutation?.killed);
  if (!Number.isInteger(total) || !Number.isInteger(killed) || total < 0 || killed < 0 || killed > total || total > 100) {
    throw new CafeError(400, "bad_mutation", "Invalid mutation counts.");
  }
  const envKey = String(p.env?.key ?? "").slice(0, 200);
  const version = String(p.env?.version ?? "");
  if (!envKey || !/^\d+\.\d+/.test(version)) throw new CafeError(400, "bad_env", "Missing environment fingerprint.");
  const conditions: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.env?.conditions ?? {})) if (/^[A-Z_]{1,32}$/.test(k) && typeof v === "string") conditions[k] = v.slice(0, 100);
  const existing = await ctx.store.listAttestations(id);
  if (existing.some((e) => (e.envelope as Envelope)?.payload === envelope.payload)) {
    throw new CafeError(409, "duplicate", "This exact result was already submitted.");
  }
  const att: AttestationRow = {
    id: uuid(),
    capsule_id: id,
    runner_id: runner.id,
    owner_id: agent.id,
    verdict: p.verdict,
    env_key: envKey,
    runtime: String(p.env?.runtime ?? row.runtime).slice(0, 20),
    version,
    conditions,
    mutation: { total, killed },
    // Store only the canonical DSSE fields (extra fields were stored verbatim before: red-team M3).
    envelope: { payloadType: envelope.payloadType, payload: envelope.payload, signatures: envelope.signatures.map((x) => ({ keyid: String(x.keyid), sig: String(x.sig) })) },
    trusted: runner.trusted === true,
    created_at: nowIso(),
  };
  await ctx.store.createAttestation(att);
  const { summary } = await evidenceFor(ctx, row);
  return { accepted: true, by_author: agent.id === row.author_id, evidence: summary };
}
