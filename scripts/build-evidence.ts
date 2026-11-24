// Builds capsules/built/evidence.json (+ evidence-sources.json and github-jwks.json) from a results dir.
//   node scripts/build-evidence.ts [results dir, default experiments/v2/results-run5]
// Fetches GitHub's OIDC keys live; if they differ from the digest pinned in core/doctor/pins.ts the build
// stops, so a key rotation (or tampering) is a deliberate, reviewed source change.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Envelope } from "../core/capsule/attestation.ts";
import { fetchGithubJwks } from "../core/capsule/oidc.ts";
import { deriveEvidence, type EvidenceSources } from "../core/doctor/bundle.ts";
import { EVIDENCE_TRUST_POLICY, GITHUB_JWKS_DIGEST, LOCAL_RUNNER_KEYS } from "../core/doctor/pins.ts";

const root = new URL("../", import.meta.url);
const dir = new URL(`${process.argv[2] ?? "experiments/v2/results-run5"}/`, root);
const built = new URL("capsules/built/", root);
const index = JSON.parse(readFileSync(new URL("index.json", built), "utf8")) as { slug: string; id: string }[];
const lines = (u: URL) => readFileSync(u, "utf8").trim().split("\n").map((l) => JSON.parse(l).envelope as Envelope);

const ciDir = new URL("ci/", dir);
const sources: EvidenceSources = {
  generated_at: new Date().toISOString(),
  local: { public_key: JSON.parse(readFileSync(new URL("runner-public-key.json", dir), "utf8")).public_key_ed25519_raw_b64, envelopes: lines(new URL("C-attestations.jsonl", dir)) },
  ci: (existsSync(ciDir) ? readdirSync(ciDir).filter((f) => f.endsWith(".oidc.json")).sort() : []).map((f) => {
    const label = f.replace(".oidc.json", "");
    const { token, manifest } = JSON.parse(readFileSync(new URL(f, ciDir), "utf8"));
    return { label, token, manifest, public_key: JSON.parse(readFileSync(new URL(`${label}.pubkey.json`, ciDir), "utf8")).public_key, envelopes: lines(new URL(`${label}.jsonl`, ciDir)) };
  }),
};
const jwks = await fetchGithubJwks();
const d = await deriveEvidence(sources, { jwks, jwksDigest: GITHUB_JWKS_DIGEST, policy: EVIDENCE_TRUST_POLICY, localKeys: LOCAL_RUNNER_KEYS }, new Set(index.map((i) => i.id)));
const out = {
  schema: "agent-cafe.evidence/v2",
  generated_at: sources.generated_at,
  note: "Rows marked verified were produced by GitHub-hosted runners of a workflow pinned in core/doctor/pins.ts (GitHub OIDC). The same operator wrote the capsules and owns that workflow: verified means WHERE it ran, not independent review.",
  ci_jobs: d.jobs,
  capsules: Object.fromEntries(index.filter((i) => d.rows[i.id]).map((i) => [i.slug, { id: i.id, rows: d.rows[i.id] }])),
};
writeFileSync(new URL("evidence.json", built), JSON.stringify(out, null, 1) + "\n");
writeFileSync(new URL("evidence-sources.json", built), JSON.stringify(sources) + "\n");
writeFileSync(new URL("github-jwks.json", built), JSON.stringify(jwks, null, 1) + "\n");
const all = Object.values(d.rows).flat();
console.log(`evidence: ${all.length} rows (${all.filter((r) => r.trust === "verified").length} verified from ${d.jobs.length} CI jobs), ${Object.keys(d.rows).length}/${index.length} capsules, ${d.dropped} stale rows dropped`);
