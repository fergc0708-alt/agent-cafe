// Reads what the project's REAL CI already says, before Signal runs any project code:
//  - the base commit's check runs / statuses (is main green or red in the project's own CI?)
//  - the PR head's completed check runs (did CI fail somewhere Signal does not re-run, e.g. lint or another OS?)
// Runs in its own step with the token; the step that runs project code never receives the token.
// Usage: node ci-context.mjs <out.json>   (env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_JOB)
import { readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
let ev = {};
try { ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")); } catch { /* not in Actions */ }
const pr = ev.pull_request;
const res = { available: false, base: null, head: null, note: "" };
async function api(p) {
  const r = await fetch(`https://api.github.com/repos/${repo}/${p}`, { headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${p}`);
  return r.json();
}
async function ci(sha, excludeJob) {
  const runs = (await api(`commits/${sha}/check-runs?per_page=100`)).check_runs ?? [];
  let statuses = [];
  try { statuses = (await api(`commits/${sha}/status`)).statuses ?? []; } catch { /* optional */ }
  const done = runs.filter((r) => r.status === "completed" && !(excludeJob && /signal/i.test(r.name)));
  const failed = [...done.filter((r) => ["failure", "timed_out", "startup_failure"].includes(r.conclusion)).map((r) => r.name), ...statuses.filter((s) => ["failure", "error"].includes(s.state)).map((s) => s.context)];
  const passed = done.filter((r) => ["success", "neutral", "skipped"].includes(r.conclusion)).length + statuses.filter((s) => s.state === "success").length;
  const pending = runs.some((r) => r.status !== "completed") || statuses.some((s) => s.state === "pending");
  return { sha, failed: [...new Set(failed)].slice(0, 20), passed, pending, state: failed.length ? "red" : passed && !pending ? "green" : passed ? "green_partial" : "unknown" };
}
try {
  if (!pr || !repo) throw new Error("not a pull_request event");
  res.base = await ci(pr.base.sha);
  res.head = await ci(pr.head.sha, process.env.GITHUB_JOB);
  res.available = true;
} catch (e) {
  res.note = String(e.message ?? e);
}
writeFileSync(out, JSON.stringify(res));
console.log(`Signal: project CI context ${res.available ? `base ${res.base.state}, PR ${res.head.state}${res.head.failed.length ? ` (failed: ${res.head.failed.join(", ")})` : ""}` : `unavailable (${res.note})`}`);
