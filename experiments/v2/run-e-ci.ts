// Experiment E, part 2 (runner diversity): verifies every CI envelope offline against the public key
// generated inside that CI job, then merges CI + local results in one in-process registry.
// HONESTY NOTE (written before running): the local machine and the CI jobs are operated by the same
// party. Registering them under different accounts is exactly the Sybil weakness of
// `cross_runner_reproduced`: it proves machine/runtime diversity, not operator independence.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { verifyEnvelope } from "../../core/capsule/attestation.ts";
import { handle } from "../../core/handler.ts";
import { MemoryStore } from "../../core/memory-store.ts";

const R = new URL(`./${process.env.RESULTS_DIR ?? "results"}/`, import.meta.url);
const index = JSON.parse(readFileSync(new URL("../../capsules/built/index.json", import.meta.url), "utf8")) as { slug: string; id: string }[];
const store = new MemoryStore();
let ip = 0;
async function call(method: string, path: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.40.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await handle(new Request("https://registry.local" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { store, siteUrl: "https://registry.local" });
  return { status: res.status, json: (await res.json()) as any };
}
const reg = async (h: string) => (await call("POST", "/api/v1/agents/register", { handle: h, model: "exp", provider: "anthropic" })).json.api_key as string;
const curator = await reg("cafe-curator");
for (const { slug } of index) await call("POST", "/api/v1/capsules", JSON.parse(readFileSync(new URL(`../../capsules/built/${slug}.json`, import.meta.url), "utf8")), curator);

type Src = { label: string; pub: string; handle: string; proof: string; lines: { slug: string; envelope: any }[] };
const sources: Src[] = [];
const local = JSON.parse(readFileSync(new URL("runner-public-key.json", R), "utf8"));
const localProof = JSON.parse(readFileSync(new URL("runner-registration-proof.json", R), "utf8"));
sources.push({ label: "local", pub: local.public_key_ed25519_raw_b64, handle: localProof.handle, proof: localProof.proof, lines: readFileSync(new URL("C-attestations.jsonl", R), "utf8").trim().split("\n").map((l) => JSON.parse(l)) });
const ciDir = new URL("ci/", R);
for (const f of readdirSync(ciDir).filter((f) => f.endsWith(".jsonl")).sort()) {
  const label = f.replace(".jsonl", "");
  const meta = JSON.parse(readFileSync(new URL(`${label}.pubkey.json`, ciDir), "utf8"));
  const pub = meta.public_key;
  sources.push({ label, pub, handle: meta.import_as, proof: meta.proof, lines: readFileSync(new URL(f, ciDir), "utf8").trim().split("\n").map((l) => JSON.parse(l)) });
}
// Accounts as named inside each job's proof of possession (CI is split over 2 accounts because of the
// 5-runner limit per account). Same operator behind all of them.
const accounts: Record<string, string> = {};
for (const s of sources) accounts[s.handle] ??= await reg(s.handle);
let verified = 0, rejected = 0;
const ciRows: { slug: string; env: string; verdict: string; mutants: string }[] = [];
for (const s of sources) {
  const acct = accounts[s.handle];
  const rr = await call("POST", "/api/v1/runners", { public_key: s.pub, proof: s.proof, label: s.label }, acct);
  if (rr.status !== 201) throw new Error(JSON.stringify(rr.json));
  for (const { slug, envelope } of s.lines) {
    try { await verifyEnvelope(envelope, s.pub); verified++; } catch { rejected++; continue; }
    const id = index.find((x) => x.slug === slug)!.id;
    const r = await call("POST", `/api/v1/capsules/${id}/attestations`, envelope, acct);
    if (r.status !== 201) throw new Error(`${slug} ${s.label}: ${JSON.stringify(r.json)}`);
    if (s.label !== "local") {
      const p = JSON.parse(atob(envelope.payload)).predicate;
      ciRows.push({ slug, env: p.env.key + (p.env.ci ? " (ci)" : ""), verdict: p.verdict, mutants: `${p.mutation.killed}/${p.mutation.total}` });
    }
  }
}
const final = [];
for (const { slug, id } of index) {
  const e = (await call("GET", `/api/v1/capsules/${id}`)).json.evidence;
  final.push({ slug, verified_level: e.level, level: e.claimed.level, flags: e.claimed.flags.map((f: string) => f.split(":")[0]), regressions: e.claimed.regressions, contradictions: e.claimed.contradictions.length });
}
writeFileSync(new URL("E-ci-merged.json", R), JSON.stringify({ honesty_note: "Local machine and CI jobs are run by the same operator; 'cross_runner_reproduced' here shows machine/runtime diversity only.", signatures_verified: verified, signatures_rejected: rejected, ci_runs: ciRows, final_evidence: final }, null, 2) + "\n");
console.log("signatures verified", verified, "rejected", rejected, "| CI runs", ciRows.length);
for (const r of ciRows) if (!(r.verdict === "PASS" && !r.mutants.startsWith("0/"))) console.log("  CI", r.slug, "|", r.env, "|", r.verdict, r.mutants);
console.log("verified levels:", JSON.stringify(final.reduce((a: any, f) => ((a[f.verified_level] = (a[f.verified_level] ?? 0) + 1), a), {})));
console.log("claimed levels:", JSON.stringify(final.reduce((a: any, f) => ((a[f.level] = (a[f.level] ?? 0) + 1), a), {})));
for (const f of final) if (f.flags.length || f.regressions.length) console.log("  ", f.slug, f.level, f.flags.join(","), f.regressions.map((r: any) => `${r.from} -> ${r.to}`).join("; "));
