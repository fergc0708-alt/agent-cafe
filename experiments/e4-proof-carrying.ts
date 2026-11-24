// E4: "proof-carrying entries". A library claim ships with a tiny executable check.
// A validator runs it in ITS OWN environment and reports {env, exit code, output hash}.
// Agreement then means "it ran and passed here", not "a model thinks it sounds right".
// Checks run in a throwaway temp dir with a timeout. In production this must be a real sandbox.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Check {
  entry: string;
  claim: string;
  truth: "true" | "false"; // ground truth, for the experiment only
  files?: Record<string, string>;
  cmd: string[];
}

const CHECKS: Check[] = [
  {
    entry: "rfc-3339-timestamps",
    claim: "Python 3.11+ datetime.fromisoformat accepts a trailing 'Z'",
    truth: "true",
    cmd: ["python3", "-I", "-c", "from datetime import datetime; print(datetime.fromisoformat('2026-11-24T15:17:00Z').isoformat())"],
  },
  {
    entry: "node-esm-commonjs",
    claim: "Node 22.12+ can require() an ES module without top-level await",
    truth: "true",
    files: { "esm.mjs": "export const answer = 42;\n", "main.cjs": "console.log(require('./esm.mjs').answer);\n" },
    cmd: ["node", "main.cjs"],
  },
  {
    entry: "money-floating-point",
    claim: "0.1 + 0.2 != 0.3 in binary floating point, Decimal('0.10') + Decimal('0.20') == Decimal('0.30')",
    truth: "true",
    cmd: ["python3", "-I", "-c", "from decimal import Decimal as D; assert 0.1 + 0.2 != 0.3; assert D('0.10') + D('0.20') == D('0.30'); print('ok')"],
  },
  {
    entry: "bash-strict-mode",
    claim: "With set -o pipefail, `false | true` makes the pipeline fail",
    truth: "true",
    cmd: ["bash", "-c", "set -o pipefail; if false | true; then echo 'pipeline ok'; exit 1; else echo 'pipeline failed as claimed'; fi"],
  },
  {
    entry: "(planted false claim)",
    claim: "datetime.fromisoformat rejects a trailing 'Z' (a plausible, outdated belief: true before Python 3.11)",
    truth: "false",
    cmd: ["python3", "-I", "-c", "from datetime import datetime\ntry:\n    datetime.fromisoformat('2026-11-24T15:17:00Z')\nexcept ValueError:\n    raise SystemExit(0)\nraise SystemExit(1)"],
  },
  {
    entry: "(planted false claim)",
    claim: "In Node, require() of an .mjs file always throws ERR_REQUIRE_ESM (true before Node 22.12/20.19)",
    truth: "false",
    files: { "esm.mjs": "export const answer = 42;\n", "main.cjs": "try { require('./esm.mjs'); process.exit(1); } catch (e) { process.exit(e.code === 'ERR_REQUIRE_ESM' ? 0 : 1); }\n" },
    cmd: ["node", "main.cjs"],
  },
];

function env(): string {
  const v = (c: string[]) => spawnSync(c[0], c.slice(1), { encoding: "utf8" }).stdout.trim().split("\n")[0];
  return `${process.platform} · ${v(["python3", "--version"])} · node ${process.version} · ${v(["bash", "--version"]).replace(/^GNU bash, version /, "bash ").split(" (")[0]}`;
}

const rows = CHECKS.map((c) => {
  const dir = mkdtempSync(join(tmpdir(), "cafe-check-"));
  for (const [name, body] of Object.entries(c.files ?? {})) writeFileSync(join(dir, name), body);
  const t0 = performance.now();
  const r = spawnSync(c.cmd[0], c.cmd.slice(1), { cwd: dir, encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv });
  const ms = Math.round(performance.now() - t0);
  rmSync(dir, { recursive: true, force: true });
  const passed = r.status === 0;
  return {
    entry: c.entry,
    claim: c.claim,
    truth: c.truth,
    check_passed: passed,
    verdict_correct: passed === (c.truth === "true"),
    exit: r.status,
    stdout_sha256: createHash("sha256").update(r.stdout ?? "").digest("hex").slice(0, 12),
    ms,
  };
});
console.log(JSON.stringify({ environment: env(), results: rows }, null, 1));
