// Experiments A (search -> fetch -> local replay), C (compatibility matrix) and D (regression
// detection), run against an in-process registry (same handler code as production, memory store).
// Everything here is a REAL execution on this machine; nothing is simulated. Output: ./results/.
//   node experiments/v2/run-acd.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { replay } from "../../cli/runner.ts";
import type { Capsule } from "../../core/capsule/capsule.ts";
import { buildStatement, generateRunnerKey, signRegistration, signStatement } from "../../core/capsule/attestation.ts";
import { handle } from "../../core/handler.ts";
import { MemoryStore } from "../../core/memory-store.ts";

const OUT = new URL(`./${process.env.RESULTS_DIR ?? "results"}/`, import.meta.url);
mkdirSync(OUT, { recursive: true });
const built = new URL("../../capsules/built/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", built), "utf8")) as { slug: string; id: string }[];
const load = (slug: string) => JSON.parse(readFileSync(new URL(`${slug}.json`, built), "utf8")) as Capsule;

const MATRIX: Record<string, Record<string, string>[]> = {
  node: [{ node: "/opt/node22/bin/node" }, { node: "/opt/node24/bin/node" }, { node: "/usr/local/bin/bun" }],
  python: ["3.11", "3.12", "3.13"].map((v) => ({ python3: `/usr/bin/python${v}`, python: `/usr/bin/python${v}` })),
  // Clean venvs (python -m venv --without-pip): no system site-packages, so Debian's setuptools
  // distutils shim does not leak in. Recorded as the condition SITE=venv-clean.
  "python-venv": ["3.11", "3.12", "3.13"].map((v) => ({ python3: `/tmp/venv-${v}/bin/python`, python: `/tmp/venv-${v}/bin/python` })),
  bash: [{ bash: "/bin/bash" }],
  bun: [{ bun: "/usr/local/bin/bun" }],
};
// Extra conditions per capsule (the capsule's own check.env still applies on top of these).
const EXTRA_CONDITIONS: Record<string, Record<string, string>[]> = {
  "py-fromtimestamp-local-tz": [{}, { TZ: "UTC" }],
};

// ---------- in-process registry ----------
const store = new MemoryStore();
let ip = 0;
async function call(method: string, path: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.20.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await handle(new Request("https://registry.local" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { store, siteUrl: "https://registry.local" });
  return { status: res.status, json: (await res.json()) as any };
}
const reg = async (handle: string, provider: string) => (await call("POST", "/api/v1/agents/register", { handle, model: "exp", provider })).json.api_key as string;
const curator = await reg("cafe-curator", "anthropic");
const runnerAgent = await reg("local-runner-1", "anthropic");
for (const { slug } of index) {
  const r = await call("POST", "/api/v1/capsules", load(slug), curator);
  if (r.status !== 201) throw new Error(`submit ${slug}: ${r.status} ${JSON.stringify(r.json)}`);
}
const key = await generateRunnerKey();
const rr = await call("POST", "/api/v1/runners", { public_key: key.publicRaw, proof: await signRegistration("local-runner-1", key.publicRaw, key.privateJwk), label: "experiment matrix (this machine)" }, runnerAgent);
if (rr.status !== 201) throw new Error("runner " + JSON.stringify(rr.json));

// ---------- Experiment A: symptom -> search -> fetch -> replay ----------
// Queries are written as an agent would paste an error, NOT copied from capsule titles.
const A_QUERIES: { q: string; expect: string; bins: Record<string, string> }[] = [
  { q: "ModuleNotFoundError: No module named 'imghdr'", expect: "py-png-magic-bytes", bins: { python3: "/usr/bin/python3.13" } },
  { q: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX parameter property", expect: "node-ts-parameter-properties", bins: { node: "/opt/node22/bin/node" } },
  { q: "SyntaxError: Unexpected identifier 'assert' json import", expect: "node-import-assert-to-with", bins: { node: "/opt/node22/bin/node" } },
  { q: "ReferenceError: __dirname is not defined in ES module scope", expect: "node-esm-dirname", bins: { node: "/opt/node22/bin/node" } },
  { q: "TypeError: Do not know how to serialize a BigInt", expect: "node-bigint-json", bins: { node: "/opt/node22/bin/node" } },
  { q: "No module named 'distutils'", expect: "py-distutils-removed", bins: { python3: "/usr/bin/python3.12" } },
  { q: "csv first column name has \\ufeff BOM", expect: "py-csv-utf8-bom", bins: { python3: "/usr/bin/python3.12" } },
  { q: "datetime.utcnow() is deprecated", expect: "py-utcnow-deprecated", bins: { python3: "/usr/bin/python3.12" } },
  { q: "pipeline exit status hides failure in bash script", expect: "bash-pipefail", bins: { bash: "/bin/bash" } },
  { q: "0.1 + 0.2 rounding error in invoice total", expect: "node-money-cents", bins: { node: "/opt/node22/bin/node" } },
];
const aRows = [];
for (const t of A_QUERIES) {
  const s = await call("GET", `/api/v1/capsules?q=${encodeURIComponent(t.q)}`);
  const slugs = (s.json.results ?? []).map((r: any) => index.find((i) => i.id === r.id)?.slug);
  const rank = slugs.indexOf(t.expect) + 1;
  let verdict = "not found";
  if (rank > 0) {
    const id = index.find((i) => i.slug === t.expect)!.id;
    const got = await call("GET", `/api/v1/capsules/${id}`);
    const r = await replay(got.json.capsule as Capsule, { bins: t.bins, maxMutants: 4 });
    verdict = `${r.predicate.verdict} (${r.predicate.env.key}, mutants ${r.predicate.mutation.killed}/${r.predicate.mutation.total})`;
  }
  aRows.push({ query: t.q, expected: t.expect, rank: rank || null, top3: slugs.slice(0, 3), replay: verdict });
}
writeFileSync(new URL("A-search-replay.json", OUT), JSON.stringify(aRows, null, 2) + "\n");

// ---------- Experiment C: matrix with signed attestations ----------
const cRows: any[] = [];
const envelopes: any[] = [];
for (const { slug, id } of index) {
  const c = load(slug);
  const variants = [...MATRIX[c.runtime].map((b) => ({ bins: b, base: {} as Record<string, string> })),
    ...(c.runtime === "python" ? MATRIX["python-venv"].map((b) => ({ bins: b, base: { SITE: "venv-clean" } })) : [])];
  for (const { bins, base } of variants) {
    for (const extra of EXTRA_CONDITIONS[slug] ?? [{}]) {
      const conditions = { ...base, ...extra };
      if (!Object.values(bins).every((b) => existsSync(b))) continue;
      const r = await replay(c, { bins, conditions, keyid: key.keyid });
      const envelope = await signStatement(buildStatement(id, r.predicate), key.privateJwk, key.keyid);
      const sub = await call("POST", `/api/v1/capsules/${id}/attestations`, envelope, runnerAgent);
      if (sub.status !== 201) throw new Error(`attest ${slug}: ${sub.status} ${JSON.stringify(sub.json)}`);
      envelopes.push({ slug, envelope });
      cRows.push({ slug, env: r.predicate.env.key, verdict: r.predicate.verdict, mutants: `${r.predicate.mutation.killed}/${r.predicate.mutation.total}`, lint: r.predicate.lint, isolation: r.predicate.isolation });
    }
  }
}
writeFileSync(new URL("C-matrix.json", OUT), JSON.stringify(cRows, null, 2) + "\n");
writeFileSync(new URL("C-attestations.jsonl", OUT), envelopes.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(new URL("runner-public-key.json", OUT), JSON.stringify({ keyid: key.keyid, public_key_ed25519_raw_b64: key.publicRaw, note: "Ephemeral key generated for this run; private key was never written to disk." }, null, 2) + "\n");
writeFileSync(new URL("runner-registration-proof.json", OUT), JSON.stringify({ handle: "local-runner-1", proof: await signRegistration("local-runner-1", key.publicRaw, key.privateJwk) }, null, 2) + "\n");

// ---------- Experiment D: what the registry concludes ----------
const dRows = [];
for (const { slug, id } of index) {
  const v = await call("GET", `/api/v1/capsules/${id}`);
  const e = v.json.evidence;
  dRows.push({ slug, verified_level: e.level, level: e.claimed.level, flags: e.claimed.flags, regressions: e.claimed.regressions, contradictions: e.claimed.contradictions, superseded_by: (v.json.superseded_by ?? []).map((x: any) => index.find((i) => i.id === x.id)?.slug) });
}
writeFileSync(new URL("D-evidence.json", OUT), JSON.stringify(dRows, null, 2) + "\n");

// ---------- console summary ----------
const verdicts: Record<string, number> = {};
for (const r of cRows) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
console.log("A:", aRows.filter((r) => r.rank === 1).length, "rank-1 /", aRows.filter((r) => r.rank && r.rank <= 3).length, "top-3 /", aRows.length, "queries;", aRows.filter((r) => r.replay.startsWith("PASS")).length, "replayed PASS");
for (const r of aRows) console.log("  ", r.rank ?? "-", r.expected, "|", r.replay);
console.log("C:", cRows.length, "runs", verdicts);
for (const r of cRows) if (r.verdict !== "PASS" || r.mutants.startsWith("0/")) console.log("  ", r.slug, "|", r.env, "|", r.verdict, r.mutants);
console.log("D:");
for (const r of dRows) if (r.flags.length || r.regressions.length || r.superseded_by.length) console.log("  ", r.slug, r.level, r.flags, JSON.stringify(r.regressions), "superseded_by:", r.superseded_by);
