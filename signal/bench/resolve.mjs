// Benchmark job 1 (trusted: runs NO project code; read-only GITHUB_TOKEN for public API data).
// For each candidate PR: the bot's commit, its parent (the base the bot branched from), human commits added to the
// PR, and the ORIGINAL CI conclusions of the base commit and of the bot commit, as recorded by the project's own CI.
// These are the oracles; Signal never sees them.
import { readFileSync, writeFileSync } from "node:fs";
const token = process.env.GITHUB_TOKEN;
const api = async (p) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://api.github.com/${p}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } });
    if (r.status === 403 || r.status === 429) { await new Promise((s) => setTimeout(s, 15000 * (i + 1))); continue; }
    if (!r.ok) return null;
    return r.json();
  }
  return null;
};
const isBot = (c) => /\[bot\]$|^renovate|^dependabot/i.test(c?.author?.login ?? c?.commit?.author?.name ?? "");
async function ciOf(repo, sha) {
  const runs = (await api(`repos/${repo}/commits/${sha}/check-runs?per_page=100`))?.check_runs ?? [];
  const st = await api(`repos/${repo}/commits/${sha}/status`);
  const concl = runs.map((r) => r.conclusion).filter(Boolean);
  const states = (st?.statuses ?? []).map((s) => s.state);
  if (!concl.length && !states.length) return { ci: "unknown", checks: 0 };
  const bad = concl.some((c) => ["failure", "timed_out", "startup_failure"].includes(c)) || states.some((s) => ["failure", "error"].includes(s));
  const pending = runs.some((r) => r.status !== "completed") || states.includes("pending");
  return { ci: bad ? "failure" : pending ? "pending" : "success", checks: concl.length + states.length, failed: runs.filter((r) => ["failure", "timed_out"].includes(r.conclusion)).map((r) => r.name).slice(0, 10) };
}
const cands = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = [];
for (const c of cands) {
  const pr = await api(`repos/${c.repo}/pulls/${c.number}`);
  if (!pr) { out.push({ ...c, skip: "pr not readable" }); continue; }
  const commits = (await api(`repos/${c.repo}/pulls/${c.number}/commits?per_page=100`)) ?? [];
  const bot = commits.filter(isBot);
  const human = commits.filter((x) => !isBot(x));
  if (!bot.length) { out.push({ ...c, skip: "no bot commit" }); continue; }
  const first = bot[0];
  const base = first.parents?.[0]?.sha;
  let humanCode = false;
  for (const h of human.slice(0, 5)) {
    const full = await api(`repos/${c.repo}/commits/${h.sha}`);
    if ((full?.files ?? []).some((f) => !/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|\.npmrc|\.nvmrc|renovate\.json5?)$/.test(f.filename))) humanCode = true;
  }
  const lastBot = bot[bot.length - 1];
  out.push({
    ...c, state: pr.state, merged: !!pr.merged_at, base_ref: pr.base?.ref,
    bot_sha: lastBot.sha, bot_commits: bot.length, base_sha: lastBot.parents?.length === 1 ? lastBot.parents[0].sha : base,
    human_commits: human.length, human_code_changes: humanCode,
    oracle_base: base ? await ciOf(c.repo, lastBot.parents?.[0]?.sha ?? base) : { ci: "unknown" },
    oracle_update: await ciOf(c.repo, lastBot.sha),
  });
}
writeFileSync(process.argv[3], JSON.stringify(out));
const ok = out.filter((x) => !x.skip);
console.log(`resolved ${ok.length}/${out.length}; skipped: ${out.filter((x) => x.skip).map((x) => x.skip).join(", ")}`);
