// Records what each candidate PR's own CI reported, for the PR head and for its parent (the base the bot branched
// from). Runs in a GitHub Actions job with `permissions: {}` that executes NO project code: it only reads the
// public REST API. Output: one JSON file per shard, merged and committed by bench/freeze.mjs.
//
// Usage: node bench/freeze-ci.mjs <candidates.json> <shard> <shards> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [, , CANDS, SHARD = "0", SHARDS = "1", OUT = "ci.json"] = process.argv;
const all = JSON.parse(readFileSync(CANDS, "utf8"));
const mine = all.filter((_, i) => i % Number(SHARDS) === Number(SHARD));
const token = process.env.GITHUB_TOKEN || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

async function api(path) {
  for (let i = 0; i < 4; i++) {
    // unauthenticated first (60/h per runner IP); the job token (no permissions, read of public data) as fallback
    const useToken = i > 0 && token;
    calls++;
    const r = await fetch(`https://api.github.com/${path}`, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(useToken ? { authorization: `Bearer ${token}` } : {}) } });
    if (r.ok) return { ok: true, body: await r.json(), via: useToken ? "token" : "anon" };
    if (r.status === 404 || r.status === 422) return { ok: false, status: r.status };
    await sleep(i === 0 ? 500 : 5000 * i);
  }
  return { ok: false, status: "exhausted" };
}

async function ciOf(repo, sha) {
  const runs = [];
  let complete = true;
  for (let page = 1; page <= 3; page++) {
    const r = await api(`repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    if (!r.ok) { complete = false; break; }
    runs.push(...r.body.check_runs);
    if (r.body.check_runs.length < 100) break;
  }
  const st = await api(`repos/${repo}/commits/${sha}/status`);
  if (!st.ok) complete = false;
  const statuses = st.ok ? st.body.statuses : [];
  const failedRuns = runs.filter((r) => ["failure", "timed_out", "startup_failure"].includes(r.conclusion));
  const failedStatuses = statuses.filter((s) => ["failure", "error"].includes(s.state));
  const pending = runs.filter((r) => r.status !== "completed").length + statuses.filter((s) => s.state === "pending").length;
  const total = runs.length + statuses.length;
  const failed = [...failedRuns.map((r) => r.name), ...failedStatuses.map((s) => s.context)];
  const state = !complete ? "unknown" : total === 0 ? "unknown" : failed.length ? "red" : pending ? "pending" : "green";
  return {
    state, complete, total, pending, failed: failed.slice(0, 30),
    passed: runs.filter((r) => r.conclusion === "success").length + statuses.filter((s) => s.state === "success").length,
    checks: runs.map((r) => ({ name: r.name, app: r.app?.slug ?? null, conclusion: r.conclusion, status: r.status, completed_at: r.completed_at })).slice(0, 60),
  };
}

const out = [];
for (const c of mine) {
  out.push({ key: `${c.repo}#${c.number}`, head_sha: c.head_sha, base_sha: c.base_sha, ci_head: await ciOf(c.repo, c.head_sha), ci_base: await ciOf(c.repo, c.base_sha), read_at: new Date().toISOString() });
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`shard ${SHARD}/${SHARDS}: ${out.length} cases, ${calls} API calls, ${out.filter((x) => x.ci_head.state === "unknown").length} unknown heads`);
