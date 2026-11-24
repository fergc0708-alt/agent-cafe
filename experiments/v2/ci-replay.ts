// Experiment E (runner independence): replays every capsule of one runtime on a GitHub Actions
// machine with an ephemeral key generated there, and writes signed envelopes + the public key.
// The registry treats these as a different runner from the local machine's runs.
//   TARGET_RUNTIME=node TARGET_BIN=/path/to/node20 node experiments/v2/ci-replay.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { replay } from "../../cli/runner.ts";
import type { Capsule } from "../../core/capsule/capsule.ts";
import { buildStatement, generateRunnerKey, signRegistration, signStatement } from "../../core/capsule/attestation.ts";

const runtime = process.env.TARGET_RUNTIME!;
const bin = process.env.TARGET_BIN!;
const label = process.env.LABEL ?? `${runtime}`;
const bins = runtime === "python" ? { python3: bin, python: bin } : { [runtime]: bin };
const built = new URL("../../capsules/built/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", built), "utf8")) as { slug: string; id: string }[];
const key = await generateRunnerKey();
const out = new URL("./results-ci/", import.meta.url);
mkdirSync(out, { recursive: true });
const lines: string[] = [];
for (const { slug, id } of index) {
  const c = JSON.parse(readFileSync(new URL(`${slug}.json`, built), "utf8")) as Capsule;
  if (c.runtime !== runtime) continue;
  const isolation = (process.env.CAFE_ISOLATION ?? "sandbox") as "sandbox" | "net-only" | "none";
  const r = await replay(c, { bins, keyid: key.keyid, isolation });
  const envelope = await signStatement(buildStatement(id, r.predicate), key.privateJwk, key.keyid);
  lines.push(JSON.stringify({ slug, envelope }));
  console.log(`${r.predicate.verdict.padEnd(22)} ${r.predicate.mutation.killed}/${r.predicate.mutation.total}  ${r.predicate.env.key}  ${slug}`);
}
writeFileSync(new URL(`${label}.jsonl`, out), lines.join("\n") + "\n");
// Proof of possession for the handle the results will be imported under (signed inside the CI job).
const importAs = process.env.IMPORT_AS ?? "ci-runner";
writeFileSync(new URL(`${label}.pubkey.json`, out), JSON.stringify({ keyid: key.keyid, public_key: key.publicRaw, import_as: importAs, proof: await signRegistration(importAs, key.publicRaw, key.privateJwk), github_run: process.env.GITHUB_RUN_ID ?? null }) + "\n");
