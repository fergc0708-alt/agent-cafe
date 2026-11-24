// Builds capsules/built/evidence.json: the executed evidence `cafe doctor` reasons over.
//   node scripts/build-evidence.ts [results dir, default experiments/v2/results-run3]
// Every row is checked before it is included:
//   - local rows: DSSE signature by the recorded runner key  -> trust "claimed" (self-reported)
//   - CI rows: DSSE signature by the job's ephemeral key, AND a GitHub Actions OIDC token whose
//     audience binds that key + the exact payload set, issued by GitHub for a GitHub-hosted runner of
//     a workflow in TRUST_POLICY                               -> trust "verified"
// Results whose capsule changed since the run (different capsule id) are dropped, not guessed.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { verifyEnvelope, type Envelope } from "../core/capsule/attestation.ts";
import { bindingAudience, fetchGithubJwks, verifyGithubOidc, type Jwks, type TrustPolicy } from "../core/capsule/oidc.ts";
import { sha256Hex } from "../core/util.ts";

export const TRUST_POLICY: TrustPolicy = {
  workflows: [
    "fergc0708-alt/agent-cafe/.github/workflows/replay-matrix.yml@refs/heads/main",
    "fergc0708-alt/agent-cafe/.github/workflows/replay-matrix.yml@refs/heads/goat/*",
  ],
};

const root = new URL("../", import.meta.url);
const dir = new URL(`${process.argv[2] ?? "experiments/v2/results-run5"}/`, root);
const built = new URL("capsules/built/", root);
const index = JSON.parse(readFileSync(new URL("index.json", built), "utf8")) as { slug: string; id: string }[];
const slugById = new Map(index.map((i) => [i.id, i.slug]));
const payloadOf = (e: Envelope) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(e.payload), (c) => c.charCodeAt(0))));

type Row = { runtime: string; version: string; conditions: Record<string, string>; verdict: string; mutation: { total: number; killed: number }; trust: "verified" | "claimed"; source: string; started_at: string };
const rows = new Map<string, Row[]>();
let dropped = 0;
const add = (capsuleId: string, r: Row) => {
  const slug = slugById.get(capsuleId);
  if (!slug) return void dropped++;
  rows.set(slug, [...(rows.get(slug) ?? []), r]);
};
const row = (p: any, trust: Row["trust"], source: string): Row => ({
  runtime: p.env.runtime, version: p.env.version, conditions: p.env.conditions ?? {}, verdict: p.verdict, mutation: p.mutation, trust, source, started_at: p.started_at,
});

// ---- local (self-reported) ----
const localKey = JSON.parse(readFileSync(new URL("runner-public-key.json", dir), "utf8")).public_key_ed25519_raw_b64;
for (const line of readFileSync(new URL("C-attestations.jsonl", dir), "utf8").trim().split("\n")) {
  const { envelope } = JSON.parse(line);
  const st = await verifyEnvelope(envelope, localKey);
  add(st.predicate.capsule_id, row(st.predicate, "claimed", "curator's Linux machine"));
}

// ---- CI (verified identity) ----
const jwks: Jwks = await fetchGithubJwks();
const now = Date.now();
const jobs = [];
const ciDir = new URL("ci/", dir);
for (const f of existsSync(ciDir) ? readdirSync(ciDir).filter((x) => x.endsWith(".oidc.json")).sort() : []) {
  const label = f.replace(".oidc.json", "");
  const { token, manifest } = JSON.parse(readFileSync(new URL(f, ciDir), "utf8"));
  const pub = JSON.parse(readFileSync(new URL(`${label}.pubkey.json`, ciDir), "utf8")).public_key;
  const envelopes: Envelope[] = readFileSync(new URL(`${label}.jsonl`, ciDir), "utf8").trim().split("\n").map((l) => JSON.parse(l).envelope);
  const digests = await Promise.all(envelopes.map((e) => sha256Hex(e.payload)));
  if (digests.slice().sort().join() !== [...manifest].sort().join()) throw new Error(`${label}: manifest does not match the envelopes`);
  const identity = await verifyGithubOidc(token, { jwks, expectedAudience: await bindingAudience(pub, manifest), policy: TRUST_POLICY, now });
  const source = `GitHub Actions ${identity.repository}@${identity.sha.slice(0, 7)} run ${identity.run_id}`;
  for (const e of envelopes) {
    const st = await verifyEnvelope(e, pub);
    if (Date.parse(st.predicate.started_at) > identity.iat * 1000 + 60_000) throw new Error(`${label}: result started after the token was issued`);
    add(st.predicate.capsule_id, row(st.predicate, "verified", source));
  }
  jobs.push({ label, public_key: pub, manifest, token, identity: { repository: identity.repository, owner: identity.repository_owner, owner_id: identity.repository_owner_id, workflow: identity.job_workflow_ref, sha: identity.sha, run_id: identity.run_id, runner: identity.runner_environment } });
}

const out = {
  schema: "agent-cafe.evidence/v1",
  generated_at: new Date(now).toISOString(),
  note: "Rows marked verified were produced by GitHub-hosted runners of a trusted workflow (GitHub OIDC). The same operator wrote the capsules and owns that workflow: verified means WHERE it ran, not independent review.",
  trust_policy: TRUST_POLICY,
  ci_jobs: jobs,
  capsules: Object.fromEntries([...rows.entries()].sort().map(([slug, r]) => [slug, { id: index.find((i) => i.slug === slug)!.id, rows: r }])),
};
writeFileSync(new URL("evidence.json", built), JSON.stringify(out, null, 1) + "\n");
writeFileSync(new URL("github-jwks.json", built), JSON.stringify({ fetched_at: new Date(now).toISOString(), ...jwks }, null, 1) + "\n");
const v = [...rows.values()].flat();
console.log(`evidence: ${v.length} rows (${v.filter((r) => r.trust === "verified").length} verified from ${jobs.length} CI jobs, ${v.filter((r) => r.trust === "claimed").length} self-reported), ${rows.size}/${index.length} capsules covered, ${dropped} stale rows dropped`);
