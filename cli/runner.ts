// Local replay engine. Runs a capsule's check on the "before" state (must fail), the "after" state
// (must pass) and on mutants of the fix (should fail). Network is cut with `unshare -rn` when the
// OS allows it. This is process isolation, NOT a security boundary: only replay code you have read,
// or run it inside a real sandbox (see docs/SECURITY-THREAT-MODEL.md).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { capsuleId, changedFiles, checkDigest, type Capsule, type FileMap } from "../core/capsule/capsule.ts";
import { lintCapsule } from "../core/capsule/lint.ts";
import type { ReplayPredicate, RunOutcome, Verdict } from "../core/capsule/attestation.ts";

export interface ReplayOptions {
  /** Interpreter overrides, e.g. {node: "/opt/node24/bin/node", python3: "/usr/bin/python3.12"}. */
  bins?: Record<string, string>;
  /** Extra environment conditions (recorded in the evidence), e.g. {TZ: "UTC"}. */
  conditions?: Record<string, string>;
  isolate?: boolean;
  maxMutants?: number;
  keyid?: string;
}

export interface ReplayResult {
  predicate: ReplayPredicate;
  mutants: { file: string; mutation: string; killed: boolean }[];
}

const TOOL = "agent-cafe-cli/0.2.0";

function canUnshare(): boolean {
  if (process.platform !== "linux") return false;
  const r = spawnSync("unshare", ["-rn", "true"], { stdio: "ignore", timeout: 3000 });
  return r.status === 0;
}

let unshareOk: boolean | null = null;

export function resolveBin(name: string, bins: Record<string, string>): string {
  if (bins[name]) return bins[name];
  if (name === "python") return bins.python3 ?? "python3";
  if (name === "node") return process.execPath;
  return name;
}

function materialize(files: FileMap, check: FileMap): string {
  const dir = mkdtempSync(join(os.tmpdir(), "cafe-replay-"));
  for (const [p, c] of Object.entries({ ...files, ...check })) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, c);
  }
  return dir;
}

function runCheck(c: Capsule, files: FileMap, opts: ReplayOptions, isolate: boolean): RunOutcome {
  const dir = materialize(files, c.check.files);
  const bins = opts.bins ?? {};
  const [first, ...rest] = c.check.run;
  const bin = resolveBin(first, bins);
  const binDir = bin.includes("/") ? dirname(bin) : "";
  const env: Record<string, string> = {
    PATH: [binDir, "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean).join(":"),
    HOME: dir,
    TMPDIR: dir,
    LANG: "C.UTF-8",
    TZ: "UTC",
    PYTHONDONTWRITEBYTECODE: "1",
    ...(c.check.env ?? {}),
    ...(opts.conditions ?? {}),
  };
  const cmd = isolate ? "unshare" : bin;
  const args = isolate ? ["-rn", "--", bin, ...rest] : rest;
  const t0 = performance.now();
  const r = spawnSync(cmd, args, {
    cwd: dir,
    env: env as unknown as NodeJS.ProcessEnv,
    timeout: c.check.timeout_ms ?? 10_000,
    killSignal: "SIGKILL",
    maxBuffer: 1_000_000,
    encoding: "utf8",
  });
  const ms = Math.round(performance.now() - t0);
  rmSync(dir, { recursive: true, force: true });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  return {
    exit: r.status,
    ms,
    timed_out: timedOut,
    stdout_sha256: createHash("sha256").update(r.stdout ?? "").digest("hex"),
  };
}

const passed = (o: RunOutcome) => o.exit === 0 && !o.timed_out;

/** Line-deletion mutants of each changed file, plus an emptied file. Comments and braces are skipped. */
export function mutantsOf(c: Capsule, max: number): { file: string; mutation: string; files: FileMap }[] {
  const out: { file: string; mutation: string; files: FileMap }[] = [];
  for (const file of changedFiles(c)) {
    const lines = c.after.files[file].split("\n");
    const candidates = lines
      .map((l, i) => ({ l: l.trim(), i }))
      .filter(({ l }) => l && !/^(\/\/|#|\/\*|\*|["']use strict["'];?$)/.test(l) && !/^[{}()[\];,]+$/.test(l));
    const step = Math.max(1, Math.ceil(candidates.length / max));
    for (let k = 0; k < candidates.length && out.length < max; k += step) {
      const { i } = candidates.at(k)!;
      const mutated = lines.filter((_, j) => j !== i).join("\n");
      out.push({ file, mutation: `delete line ${i + 1}`, files: { ...c.after.files, [file]: mutated } });
    }
    out.push({ file, mutation: "empty file", files: { ...c.after.files, [file]: "" } });
  }
  return out;
}

export function runtimeVersion(c: Capsule, bins: Record<string, string>): string {
  const bin = resolveBin(c.check.run[0], bins);
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return text.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? "unknown";
}

export async function replay(c: Capsule, opts: ReplayOptions = {}): Promise<ReplayResult> {
  if (unshareOk === null) unshareOk = canUnshare();
  const isolate = (opts.isolate ?? true) && unshareOk;
  const started_at = new Date().toISOString();
  const bins = opts.bins ?? {};
  const before = Object.keys(c.before.files).length ? runCheck(c, c.before.files, opts, isolate) : null;
  const after = runCheck(c, c.after.files, opts, isolate);
  let verdict: Verdict;
  if (after.timed_out || after.exit === null) verdict = "ERROR";
  else if (before && !passed(before) && passed(after)) verdict = "PASS";
  else if (before && passed(before) && passed(after)) verdict = "PROBLEM_NOT_REPRODUCED";
  else if (before && passed(before) && !passed(after)) verdict = "FIX_BREAKS";
  else if (!before && passed(after)) verdict = "PASS"; // no before state: weaker, lint flags it
  else verdict = "FIX_FAILS";

  const mutants: ReplayResult["mutants"] = [];
  if (verdict === "PASS") {
    for (const m of mutantsOf(c, opts.maxMutants ?? 8)) {
      const o = runCheck(c, m.files, opts, isolate);
      mutants.push({ file: m.file, mutation: m.mutation, killed: !passed(o) });
    }
  }
  // Label the runtime by the binary actually used (a node capsule replayed with Bun is a Bun result).
  const binName = basename(resolveBin(c.check.run[0], bins));
  const runtime = /^bun/.test(binName) ? "bun" : c.runtime;
  const version = runtimeVersion(c, bins);
  const conditions = { ...(c.check.env ?? {}), ...(opts.conditions ?? {}) };
  const condStr = Object.keys(conditions).sort().map((k) => `${k}=${conditions[k]}`).join(",");
  const predicate: ReplayPredicate = {
    verdict,
    capsule_id: await capsuleId(c),
    check_sha256: await checkDigest(c),
    env: {
      key: `${runtime} ${version} ${process.platform}-${process.arch}${condStr ? ` [${condStr}]` : ""}`,
      runtime,
      version,
      os: process.platform,
      arch: process.arch,
      kernel: os.release(),
      ...(process.env.GITHUB_ACTIONS ? { ci: "github-actions" } : {}),
      conditions,
    },
    before,
    after,
    mutation: { total: mutants.length, killed: mutants.filter((m) => m.killed).length },
    lint: lintCapsule(c).map((f) => f.code),
    isolation: isolate ? "unshare-net (no network; not a security sandbox)" : "none",
    runner: { keyid: opts.keyid ?? "unsigned", tool: TOOL },
    started_at,
  };
  return { predicate, mutants };
}
