// Freezes the benchmark list (trusted; git reads only, no project code).
//   node bench/freeze.mjs <candidates.json> <ci-dir> <cases.json> <pilot.json> <freeze-log.json>
// Rules (PROTOCOL.md §1): in sampled order per stratum, keep a candidate when the CI snapshot confirms its stratum
// (red: at least one failed check on the head; green: every check on the head succeeded); the first 100 (red) / 25
// (green) kept per stratum form the list; the next confirmed ones form the plumbing pilot, never analysed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

const [, , CANDS, CIDIR, OUT, PILOT, LOG] = process.argv;
const KEEP = { "renovate:red": 100, "dependabot:red": 100, "renovate:green": 25, "dependabot:green": 25 };
const PILOT_N = { "renovate:red": 2, "dependabot:red": 2, "renovate:green": 1, "dependabot:green": 0 };
const cands = JSON.parse(readFileSync(CANDS, "utf8"));
const ci = new Map();
for (const f of readdirSync(CIDIR, { recursive: true }).filter((x) => /ci-\d+\.json$/.test(String(x)))) {
  for (const x of JSON.parse(readFileSync(join(CIDIR, String(f)), "utf8"))) ci.set(x.key, x);
}
const env = { PATH: process.env.PATH, HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", HTTPS_PROXY: process.env.HTTPS_PROXY, https_proxy: process.env.https_proxy, SSL_CERT_FILE: process.env.SSL_CERT_FILE, GIT_SSL_CAINFO: process.env.GIT_SSL_CAINFO };
const git = (dir, args) => spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", ...args], { cwd: dir, env, encoding: "utf8", timeout: 180_000, maxBuffer: 64 << 20 });

/** Reference-oracle reporter injection (PROTOCOL.md §4): a single jest/vitest call, same script at base and head,
 *  no pretest/posttest hook (the direct call would skip it), node_modules linker. */
function injection(c) {
  if (!c.inject || !c.test_script_same_at_base) return null;
  const g = mkdtempSync(join(os.tmpdir(), "bench-freeze-"));
  try {
    git(g, ["init", "-q"]);
    if (git(g, ["fetch", "-q", "--depth=1", "--filter=blob:none", `https://github.com/${c.repo}.git`, `refs/pull/${c.number}/head`]).status !== 0) return null;
    const p = git(g, ["show", `${c.head_sha}:${c.project_dir ? c.project_dir + "/" : ""}package.json`]);
    if (p.status !== 0) return null;
    const s = JSON.parse(p.stdout).scripts ?? {};
    if (s.pretest || s.posttest) return null;
    return c.inject;
  } catch { return null; } finally { rmSync(g, { recursive: true, force: true }); }
}

const kept = [], pilot = [], log = [];
const n = Object.fromEntries(Object.keys(KEEP).map((k) => [k, 0]));
const np = Object.fromEntries(Object.keys(KEEP).map((k) => [k, 0]));
for (const c of cands) {
  const x = ci.get(`${c.repo}#${c.number}`);
  const want = c.stratum.split(":")[1];
  if (!x) { log.push({ key: `${c.repo}#${c.number}`, stratum: c.stratum, decision: "excluded", reason: "no CI snapshot" }); continue; }
  if (x.head_sha !== c.head_sha) { log.push({ key: `${c.repo}#${c.number}`, decision: "excluded", reason: "CI snapshot for another head" }); continue; }
  if (x.ci_head.state !== want) { log.push({ key: `${c.repo}#${c.number}`, stratum: c.stratum, decision: "excluded", reason: `CI head is ${x.ci_head.state}, stratum ${want}` }); continue; }
  const full = { ...c, ci_head: x.ci_head, ci_base: x.ci_base, ci_read_at: x.read_at, inject: injection(c) };
  if (n[c.stratum] < KEEP[c.stratum]) {
    n[c.stratum]++;
    kept.push({ ...full, id: c.id }); // the sampler's id (stratum + rank in sampled order)
    log.push({ key: `${c.repo}#${c.number}`, stratum: c.stratum, decision: "kept" });
  } else if (np[c.stratum] < PILOT_N[c.stratum]) {
    np[c.stratum]++;
    pilot.push({ ...full, id: `pilot-${c.id}` });
    log.push({ key: `${c.repo}#${c.number}`, stratum: c.stratum, decision: "pilot (not analysed)" });
  } else log.push({ key: `${c.repo}#${c.number}`, stratum: c.stratum, decision: "excluded", reason: "beyond quota" });
}
writeFileSync(OUT, JSON.stringify(kept, null, 1));
writeFileSync(PILOT, JSON.stringify(pilot, null, 1));
writeFileSync(LOG, JSON.stringify({ counts: n, pilot: np, log }, null, 1));
console.log(JSON.stringify({ kept: n, pilot: np, injectable: kept.filter((c) => c.inject).length }));
