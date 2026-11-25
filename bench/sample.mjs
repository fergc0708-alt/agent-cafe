// Benchmark sampling (trusted: reads public GitHub API data only, runs no project code).
//
// Population: public pull requests opened by renovate[bot] or dependabot[bot] between 2026-10-01 and 2026-11-15
// (UTC) that update npm dependencies. Strata: bot × CI outcome of the PR head at freeze time (red = at least one
// failed check; green = all checks succeeded).
//
// Sampling: the window is cut into 30-minute slices; slices are visited in an order shuffled with a fixed seed;
// every PR returned by the search for a slice is shuffled with the same generator; PRs are screened in that order
// against the mechanical eligibility rules below, one PR per repository owner across the whole sample, until each
// stratum reaches its quota. Nothing here looks at Signal or at any test result.
//
// Data sources: the GitHub search API (PR list and CI outcome at search time) and `git` over HTTPS for everything
// else (SHAs, changed files, manifests). This session's proxy does not serve the REST API for third-party
// repositories, so CI check details are collected afterwards by bench/freeze-ci (see PROTOCOL.md).
//
// Usage: GITHUB_TOKEN=... NODE_USE_ENV_PROXY=1 node bench/sample.mjs bench/candidates.json bench/frame.jsonl
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

const SEED = 20261125;
const WINDOW = ["2026-10-01T00:00:00Z", "2026-11-15T00:00:00Z"];
const SLICE_MIN = 30;
// oversampled: freeze-ci later drops cases whose recorded CI does not confirm the stratum, in sampled order,
// and the frozen list keeps the first 100 / 25 confirmed per stratum
const QUOTA = { "renovate:red": 115, "dependabot:red": 115, "renovate:green": 30, "dependabot:green": 30 };
const BOT_EMAIL = { renovate: /renovate\[bot\]@users\.noreply\.github\.com$/i, dependabot: /dependabot\[bot\]@users\.noreply\.github\.com$/i };
const DEP_FILE = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const LOCK_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/;

const [, , OUT = "bench/candidates.json", FRAME = "bench/frame.jsonl"] = process.argv;
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN required (read-only use)");

// ---------------------------------------------------------------- deterministic RNG
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(SEED);
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------------------------------------------------------------- API
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastSearch = 0;
async function api(path, { raw = false, search = false, range } = {}) {
  if (search) { const wait = lastSearch + 2200 - Date.now(); if (wait > 0) await sleep(wait); lastSearch = Date.now(); }
  const url = path.startsWith("http") ? path : `https://api.github.com/${path}`;
  for (let i = 0; i < 5; i++) {
    const headers = raw ? { ...(range ? { range } : {}) } : { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    let r;
    try { r = await fetch(url, { headers }); } catch { await sleep(3000 * (i + 1)); continue; }
    if (r.status === 403 || r.status === 429 || r.status >= 500) { await sleep(20000 * (i + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok && r.status !== 206) return null;
    return raw ? r.text() : r.json();
  }
  return null;
}
// git, with no credentials and no hooks; partial clone (blobs fetched on demand)
const GIT_ENV = { PATH: process.env.PATH, HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", HTTPS_PROXY: process.env.HTTPS_PROXY, https_proxy: process.env.https_proxy, SSL_CERT_FILE: process.env.SSL_CERT_FILE, GIT_SSL_CAINFO: process.env.GIT_SSL_CAINFO };
const git = (dir, args, timeout = 120_000) => {
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "protocol.file.allow=never", ...args], { cwd: dir, env: GIT_ENV, encoding: "utf8", timeout, maxBuffer: 64 << 20 });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const showFile = (dir, sha, path) => { const r = git(dir, ["show", `${sha}:${path}`]); return r.ok ? r.out : null; };

// ---------------------------------------------------------------- frozen command rules
function splitScript(s) { return s.trim().split(/\s+/); }
/** Per-test reporter injection for the reference oracle: only for a single jest/vitest invocation. */
function injectable(script, nodeLinkerPnp) {
  if (nodeLinkerPnp || typeof script !== "string") return null;
  if (/[&|;<>$`()\\"']/.test(script)) return null;
  const t = splitScript(script);
  const env = [];
  let i = 0;
  if (t[i] === "cross-env") i++;
  while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(t[i])) env.push(t[i++]);
  if (t[i] === "cross-env") { i++; while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(t[i])) env.push(t[i++]); }
  const runner = t[i];
  if (runner !== "jest" && runner !== "vitest") return null;
  const args = t.slice(i + 1);
  if (args.some((a) => /^--(watch|watchAll|ui)$/.test(a)) || (runner === "vitest" && args[0] && /^(watch|dev|bench)$/.test(args[0]))) return null;
  return { runner, env, args };
}

async function commandsFor(g, sha, dir, lockfile, pkg) {
  const rawFile = (_repo, _sha, path, range) => { const t = showFile(g, sha, path); return t === null ? null : range ? t.slice(0, 400) : t; };
  const repo = "";
  const p = (f) => (dir ? `${dir}/${f}` : f);
  const pmField = typeof pkg.packageManager === "string" ? pkg.packageManager.replace(/\+.*$/, "") : "";
  let pm, install, test, pmSpec = "", pnp = false;
  if (/pnpm-lock\.yaml$/.test(lockfile)) {
    pm = "pnpm";
    let v = pmField.match(/^pnpm@(\d[\w.-]*)$/)?.[1];
    if (!v) {
      const head = (await rawFile(repo, sha, lockfile, "bytes=0-200")) ?? "";
      const lv = head.match(/lockfileVersion:\s*'?([\d.]+)/)?.[1] ?? "";
      v = lv.startsWith("9") ? "9" : lv.startsWith("6") ? "8" : lv.startsWith("5") ? "7" : "9";
    }
    pmSpec = `pnpm@${v}`;
    install = `npx --yes ${pmSpec} install --frozen-lockfile`;
    test = `npx --yes ${pmSpec} test`;
  } else if (/yarn\.lock$/.test(lockfile)) {
    const rc = await rawFile(repo, sha, p(".yarnrc.yml"));
    const berry = rc !== null || /^yarn@[2-9]/.test(pmField);
    if (berry) {
      pm = "yarn-berry";
      pnp = !/nodeLinker:\s*["']?node-modules/.test(rc ?? "");
      if (rc && /yarnPath:/.test(rc)) { install = "yarn install --immutable"; test = "yarn test"; pmSpec = "yarnPath"; }
      else { install = "npx --yes corepack@0.36.0 yarn install --immutable"; test = "npx --yes corepack@0.36.0 yarn test"; pmSpec = pmField || "corepack-default"; }
    } else { pm = "yarn"; install = "yarn install --frozen-lockfile --non-interactive"; test = "yarn test"; pmSpec = "yarn@1 (runner)"; }
  } else { pm = "npm"; install = "npm ci --no-audit --no-fund"; test = "npm test"; pmSpec = "npm (bundled with node)"; }
  // Node version, first match wins
  let node = "22", nodeFrom = "default";
  const nvmrc = await rawFile(repo, sha, p(".nvmrc"));
  const nodeVersion = nvmrc === null ? await rawFile(repo, sha, p(".node-version")) : null;
  const tool = nvmrc === null && nodeVersion === null ? await rawFile(repo, sha, p(".tool-versions")) : null;
  const clean = (s) => s.split("\n").map((l) => l.replace(/#.*/, "").trim()).find(Boolean) ?? "";
  if (nvmrc !== null && clean(nvmrc)) { node = clean(nvmrc); nodeFrom = ".nvmrc"; }
  else if (nodeVersion !== null && clean(nodeVersion)) { node = clean(nodeVersion); nodeFrom = ".node-version"; }
  else if (tool && /^nodejs\s+(\S+)/m.test(tool)) { node = tool.match(/^nodejs\s+(\S+)/m)[1]; nodeFrom = ".tool-versions"; }
  else if (typeof pkg.volta?.node === "string") { node = pkg.volta.node; nodeFrom = "volta.node"; }
  else if (typeof pkg.engines?.node === "string") { node = pkg.engines.node; nodeFrom = "engines.node"; }
  if (!/^[\w.^~<>=*|/ -]{1,40}$/.test(node)) { node = "22"; nodeFrom = "default (unparseable spec)"; }
  return { pm, pmSpec, install, test, node, nodeFrom, pnp, inject: injectable(pkg.scripts?.test, pnp) };
}

// ---------------------------------------------------------------- eligibility
async function screen(item, stratum) {
  const [owner, name] = item.repository_url.replace("https://api.github.com/repos/", "").split("/");
  const repo = `${owner}/${name}`;
  const reject = (reason, extra = {}) => ({ ok: false, repo, number: item.number, reason, ...extra });
  if (item.state !== "open" && !item.pull_request?.merged_at && item.state !== "closed") return reject("unknown state");
  const g = mkdtempSync(join(os.tmpdir(), "bench-sample-"));
  try {
    git(g, ["init", "-q"]);
    const url = `https://github.com/${repo}.git`;
    const ref = `refs/pull/${item.number}/head`;
    const f = git(g, ["fetch", "-q", "--depth=2", "--filter=blob:none", url, ref], 180_000);
    if (!f.ok) return reject("pr head not fetchable");
    const head = git(g, ["rev-parse", "FETCH_HEAD"]).out.trim();
    const parents = git(g, ["rev-list", "--parents", "-n", "1", head]).out.trim().split(" ").slice(1);
    if (parents.length !== 1) return reject("head commit is not a single-parent commit");
    const base = parents[0];
    const bot = stratum.split(":")[0];
    const who = (sha) => git(g, ["log", "-1", "--format=%ae%n%ce", sha]).out.trim().split("\n");
    const [ha] = who(head);
    if (!BOT_EMAIL[bot].test(ha)) return reject("head commit not authored by the bot (human commits on the PR)");
    // single bot commit on top of the target branch: the parent must already be on the repository's default
    // branch (a squash-merged bot commit on main is fine; a second commit on the PR branch is not)
    const d = git(g, ["fetch", "-q", "--filter=tree:0", "--shallow-since=2026-06-01", url, "HEAD"], 180_000);
    if (!d.ok) return reject("default branch not fetchable");
    const tip = git(g, ["rev-parse", "FETCH_HEAD"]).out.trim();
    if (!git(g, ["merge-base", "--is-ancestor", base, tip]).ok) return reject("parent not on the default branch (multi-commit PR, other target branch, or base older than 2026-06-01)");
    // checkout size proxy: number of files at head (sizes would need every blob), so one case cannot exhaust a runner
    const nfiles = git(g, ["ls-tree", "-r", "--name-only", head]).out.split("\n").filter(Boolean).length;
    if (nfiles > 20000) return reject(`checkout has more than 20,000 files (${nfiles})`);
    const files = git(g, ["diff", "--name-only", base, head]).out.trim().split("\n").filter(Boolean);
    if (!files.length) return reject("no files");
    if (files.some((x) => !DEP_FILE.test(x))) return reject("changes non-dependency files", { files: files.slice(0, 8) });
    const locks = files.filter((x) => LOCK_FILE.test(x));
    if (locks.length !== 1) return reject(`${locks.length} lockfiles changed (exactly 1 required)`);
    const lockfile = locks[0];
    const dir = lockfile.includes("/") ? lockfile.slice(0, lockfile.lastIndexOf("/")) : "";
    if (files.some((x) => x.endsWith("package.json") && !(dir === "" || x.startsWith(dir + "/")))) return reject("package.json outside the lockfile's project");
    const pkgPath = dir ? `${dir}/package.json` : "package.json";
    let pkg;
    try { pkg = JSON.parse(showFile(g, head, pkgPath) ?? ""); } catch { return reject("package.json unreadable at head"); }
    const t = pkg.scripts?.test;
    if (typeof t !== "string" || !t.trim() || /no test specified/.test(t)) return reject("no test script");
    let baseTest = null;
    try { baseTest = JSON.parse(showFile(g, base, pkgPath) ?? "").scripts?.test ?? null; } catch { /* none */ }
    const cmds = await commandsFor(g, head, dir, lockfile, pkg);
    return {
      ok: true,
      case: {
        stratum, bot, repo, number: item.number, url: item.html_url, title: item.title.slice(0, 200), created_at: item.created_at,
        head_sha: head, base_sha: base, pr_state_at_freeze: item.pull_request?.merged_at ? "merged" : item.state,
        search_status: stratum.split(":")[1] === "red" ? "failure" : "success",
        project_dir: dir, lockfile, files, checkout_files: nfiles,
        ...cmds, test_script: t, test_script_same_at_base: baseTest === t,
      },
    };
  } finally {
    rmSync(g, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- main
const t0 = Date.parse(WINDOW[0]), t1 = Date.parse(WINDOW[1]);
const slices = [];
for (let t = t0; t < t1; t += SLICE_MIN * 60_000) slices.push([new Date(t).toISOString().replace(".000", ""), new Date(t + SLICE_MIN * 60_000 - 1000).toISOString().replace(".000", "")]);
const order = shuffle(slices.map((_, i) => i));
const cases = [];
const owners = new Set();
const counts = Object.fromEntries(Object.keys(QUOTA).map((k) => [k, 0]));
writeFileSync(FRAME, "");
const log = (o) => appendFileSync(FRAME, JSON.stringify(o) + "\n");
log({ meta: { seed: SEED, window: WINDOW, slice_minutes: SLICE_MIN, quota: QUOTA, started: new Date().toISOString() } });

for (const si of order) {
  if (Object.entries(QUOTA).every(([k, q]) => counts[k] >= q)) break;
  const [from, to] = slices[si];
  for (const stratum of Object.keys(QUOTA)) {
    if (counts[stratum] >= QUOTA[stratum]) continue;
    const [bot, ci] = stratum.split(":");
    const q = `is:pr is:public author:app/${bot} status:${ci === "red" ? "failure" : "success"} created:${from}..${to}`;
    const res = await api(`search/issues?q=${encodeURIComponent(q)}&per_page=100&sort=created&order=asc`, { search: true });
    const items = shuffle(res?.items ?? []);
    log({ slice: [from, to], stratum, query: q, total: res?.total_count ?? null, returned: items.length });
    for (const it of items) {
      if (counts[stratum] >= QUOTA[stratum]) break;
      const owner = it.repository_url.split("/").slice(-2)[0].toLowerCase();
      if (owners.has(owner)) { log({ stratum, number: it.number, repo: it.repository_url.split("/").slice(-2).join("/"), ok: false, reason: "owner already sampled" }); continue; }
      // cheap title prefilter is NOT used: every PR is screened by the same rules
      let r;
      try { r = await screen(it, stratum); } catch (e) { r = { ok: false, repo: it.repository_url, number: it.number, reason: `error: ${e.message}` }; }
      if (r.ok) {
        owners.add(owner);
        counts[stratum]++;
        cases.push({ id: `${stratum.replace(":", "-")}-${String(counts[stratum]).padStart(3, "0")}`, ...r.case });
        log({ stratum, number: it.number, repo: r.case.repo, ok: true });
        process.stderr.write(`${stratum} ${counts[stratum]}/${QUOTA[stratum]} ${r.case.repo}#${it.number}\n`);
        writeFileSync(OUT, JSON.stringify(cases, null, 1));
      } else log({ stratum, ...r });
    }
  }
}
log({ meta: { finished: new Date().toISOString(), counts } });
writeFileSync(OUT, JSON.stringify(cases, null, 1));
console.log(JSON.stringify(counts));
