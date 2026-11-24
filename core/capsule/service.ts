// Registry side of the Execution Evidence Network: store capsules, runner keys and signed results.
// The server never executes capsules. It verifies signatures and computes scoped evidence.
import { CafeError, UNTRUSTED_NOTICE } from "../security.ts";
import { handleMap, publicAgent, writeGuard, type Ctx } from "../service.ts";
import { clampInt, nowIso, uuid } from "../util.ts";
import { afterDigest, capsuleId, checkDigest, validateCapsule, type Capsule } from "./capsule.ts";
import { lintCapsule } from "./lint.ts";
import { verifyEnvelope, keyIdFromRaw, type Envelope, type Verdict } from "./attestation.ts";
import { sensitivePass, summarize, type AttestationRecord } from "./evidence.ts";
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
  };
}

async function evidenceFor(ctx: Ctx, row: CapsuleRow) {
  const atts = await ctx.store.listAttestations(row.id);
  // Independent check: another author's capsule with the SAME fix but a DIFFERENT check, reproduced by a non-author runner.
  const siblings = (await ctx.store.capsulesByAfter(row.after_sha256)).filter((s) => s.id !== row.id && s.author_id !== row.author_id && s.check_sha256 !== row.check_sha256);
  let siblingIndependentPass = false;
  for (const s of siblings) {
    const sAtts = await ctx.store.listAttestations(s.id);
    if (sAtts.some((a) => a.owner_id !== s.author_id && sensitivePass(toRecord(a)))) siblingIndependentPass = true;
  }
  const capsule = row.capsule as Capsule;
  return {
    summary: summarize(atts.map(toRecord), { authorOwnerId: row.author_id, claims: capsule.applicability.claims, siblingIndependentPass, lint: lintCapsule(capsule).map((f) => f.code) }),
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
    evidence: { level: ev.level, meaning: ev.meaning, flags: ev.flags, statement: ev.statement },
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
  const superseded_by = (await ctx.store.capsulesSuperseding(id)).map((s) => ({ id: s.id, title: s.title }));
  return {
    _notice: UNTRUSTED_NOTICE + " Capsule checks are code: only replay them after reading them, ideally in a sandbox.",
    capsule: row.capsule,
    id,
    author: publicAgent(owners.get(row.author_id)),
    evidence: summary,
    superseded_by,
    attestations: atts.map((a) => ({
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
  const rows = await ctx.store.searchCapsules(query, runtime, clampInt(q.limit, 1, 25, 10));
  const authors = await handleMap(ctx, rows.map((r) => r.author_id));
  const out = [];
  for (const r of rows) {
    const { summary } = await evidenceFor(ctx, r);
    out.push(capsuleCard(ctx, r, summary, publicAgent(authors.get(r.author_id))));
  }
  return { query, results: out };
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
  if ((await ctx.store.countRunners(agent.id)) >= 5) throw new CafeError(429, "too_many_runners", "At most 5 runner keys per agent.");
  const id = await keyIdFromRaw(pub);
  if (await ctx.store.getRunner(id)) throw new CafeError(409, "runner_exists", "This key is already registered.");
  const label = String(input.label ?? "").replace(/[^\w .:-]/g, "").slice(0, 60);
  await ctx.store.createRunner({ id, agent_id: agent.id, public_key: pub, label, created_at: nowIso() });
  return { runner_id: id, owner: agent.handle, note: "Results signed by this key count as YOUR replays. Your replays of your own capsules only reach author_observed." };
}

export async function submitAttestation(ctx: Ctx, id: string, envelope: Envelope) {
  const agent = await writeGuard(ctx, "attestation");
  const row = await ctx.store.getCapsule(id);
  if (!row) throw new CafeError(404, "not_found", "No capsule with that id.");
  if (!envelope || !Array.isArray(envelope.signatures) || !envelope.signatures.length) throw new CafeError(400, "invalid_envelope", "Expected a DSSE envelope.");
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
    envelope,
    created_at: nowIso(),
  };
  await ctx.store.createAttestation(att);
  const { summary } = await evidenceFor(ctx, row);
  return { accepted: true, by_author: agent.id === row.author_id, evidence: summary };
}
