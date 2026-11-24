// Experiment E (verifier independence). A separate agent wrote checks for 7 capsules after seeing
// only the problem description and the fixed code (never the original checks). Each becomes a
// sibling capsule (same before/after, different author and check). We replay both on this machine
// with a runner owned by a third account and ask the registry for the evidence level.
// CAVEAT recorded in the output: both check authors are Claude models (correlated errors are likely).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { replay } from "../../cli/runner.ts";
import type { Capsule } from "../../core/capsule/capsule.ts";
import { buildStatement, generateRunnerKey, signStatement } from "../../core/capsule/attestation.ts";
import { handle } from "../../core/handler.ts";
import { MemoryStore } from "../../core/memory-store.ts";

const store = new MemoryStore();
let ip = 0;
async function call(method: string, path: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.30.0.${++ip}` };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await handle(new Request("https://registry.local" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { store, siteUrl: "https://registry.local" });
  return { status: res.status, json: (await res.json()) as any };
}
const reg = async (h: string) => (await call("POST", "/api/v1/agents/register", { handle: h, model: "claude", provider: "anthropic" })).json.api_key as string;
const curator = await reg("cafe-curator");
const checker = await reg("indep-checker");
const runner = await reg("local-runner-1");
const key = await generateRunnerKey();
await call("POST", "/api/v1/runners", { public_key: key.publicRaw }, runner);

const dir = new URL("./indep-checks/", import.meta.url);
const BINS: Record<string, Record<string, string>> = { python: { python3: "/usr/bin/python3.13" }, node: { node: "/opt/node22/bin/node" }, bash: { bash: "/bin/bash" } };
const INTERP: Record<string, string> = { py: "python3", cjs: "node", sh: "bash" };
const rows = [];
for (const f of readdirSync(dir).sort()) {
  const [slug, ext] = [f.slice(0, f.lastIndexOf(".")), f.slice(f.lastIndexOf(".") + 1)];
  const orig = JSON.parse(readFileSync(new URL(`../../capsules/built/${slug}.json`, import.meta.url), "utf8")) as Capsule;
  const sib: Capsule = { ...orig, author: "indep-checker", title: orig.title + " (independent check)", check: { run: [INTERP[ext], `indep_check.${ext}`], files: { [`indep_check.${ext}`]: readFileSync(new URL(f, dir), "utf8") }, timeout_ms: 10000 } };
  const ids: string[] = [];
  const verdicts: string[] = [];
  for (const [c, k] of [[orig, curator], [sib, checker]] as const) {
    const s = await call("POST", "/api/v1/capsules", c, k);
    if (s.status !== 201) throw new Error(`${slug}: ${JSON.stringify(s.json)}`);
    ids.push(s.json.id);
    const r = await replay(c, { bins: BINS[c.runtime], keyid: key.keyid });
    verdicts.push(`${r.predicate.verdict} ${r.predicate.mutation.killed}/${r.predicate.mutation.total}`);
    await call("POST", `/api/v1/capsules/${s.json.id}/attestations`, await signStatement(buildStatement(s.json.id, r.predicate), key.privateJwk, key.keyid), runner);
  }
  const v = await call("GET", `/api/v1/capsules/${ids[0]}`);
  rows.push({ slug, original_check: verdicts[0], independent_check: verdicts[1], level: v.json.evidence.level });
}
const out = { caveat: "Independent checks were written by a Claude subagent that did not see the original checks; the original checks were also written by Claude. Same model family => correlated blind spots; this is author independence, not model independence.", rows };
writeFileSync(new URL("./results/E-independent-checks.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
for (const r of rows) console.log(r.slug.padEnd(28), "orig:", r.original_check.padEnd(10), "indep:", r.independent_check.padEnd(10), r.level);
