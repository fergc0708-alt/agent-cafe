// Derives the bundled evidence rows from signed sources. Used by scripts/build-evidence.ts to build
// capsules/built/evidence.json AND by the test suite to prove that every shipped row follows from a
// valid signature under the policy pinned in core/doctor/pins.ts (so the rows are not "just JSON").
import { verifyEnvelope, type Envelope } from "../capsule/attestation.ts";
import { bindingAudience, jwksDigest, verifyGithubOidc, type Jwks, type TrustPolicy } from "../capsule/oidc.ts";
import { sha256Hex } from "../util.ts";
import type { EvidenceRow } from "./match.ts";

export interface EvidenceSources {
  generated_at: string;
  local: { public_key: string; envelopes: Envelope[] };
  ci: { label: string; public_key: string; token: string; manifest: string[]; envelopes: Envelope[] }[];
}

export interface DerivedEvidence {
  rows: Record<string, EvidenceRow[]>; // by capsule id
  jobs: { label: string; repository: string; owner: string; owner_id: string; workflow: string; sha: string; run_id: string }[];
  dropped: number;
}

export async function deriveEvidence(
  src: EvidenceSources,
  pins: { jwks: Jwks; jwksDigest: string; policy: TrustPolicy; localKeys: string[] },
  knownIds: Set<string>,
): Promise<DerivedEvidence> {
  if ((await jwksDigest(pins.jwks)) !== pins.jwksDigest) throw new Error("JWKS snapshot does not match the digest pinned in source");
  const rows: Record<string, EvidenceRow[]> = {};
  let dropped = 0;
  const add = (p: any, trust: EvidenceRow["trust"], source: string) => {
    if (!knownIds.has(p.capsule_id)) return void dropped++;
    (rows[p.capsule_id] ??= []).push({ runtime: p.env.runtime, version: p.env.version, conditions: p.env.conditions ?? {}, verdict: p.verdict, mutation: p.mutation, trust, source });
  };
  if (!pins.localKeys.includes(src.local.public_key)) throw new Error("local runner key is not pinned");
  for (const e of src.local.envelopes) add((await verifyEnvelope(e, src.local.public_key)).predicate, "claimed", "curator's Linux machine");
  const now = Date.parse(src.generated_at);
  const jobs: DerivedEvidence["jobs"] = [];
  for (const job of src.ci) {
    const digests = await Promise.all(job.envelopes.map((e) => sha256Hex(e.payload)));
    if (digests.slice().sort().join() !== [...job.manifest].sort().join()) throw new Error(`${job.label}: manifest does not match the envelopes`);
    const id = await verifyGithubOidc(job.token, { jwks: pins.jwks, expectedAudience: await bindingAudience(job.public_key, job.manifest), policy: pins.policy, now });
    const source = `GitHub Actions ${id.repository}@${id.sha.slice(0, 7)} run ${id.run_id}`;
    for (const e of job.envelopes) {
      const p = (await verifyEnvelope(e, job.public_key)).predicate;
      if (Date.parse(p.started_at) > id.iat * 1000 + 60_000) throw new Error(`${job.label}: result started after the token was issued`);
      add(p, "verified", source);
    }
    jobs.push({ label: job.label, repository: id.repository, owner: id.repository_owner, owner_id: id.repository_owner_id, workflow: id.job_workflow_ref, sha: id.sha, run_id: id.run_id });
  }
  return { rows, jobs, dropped };
}
