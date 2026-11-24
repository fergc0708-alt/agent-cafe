// Local replay engine. Runs a capsule's check on the "before" state (must fail), the "after" state
// (must pass) and on mutants of the fix (should fail).
// Isolation (default "sandbox") uses bubblewrap, an existing, widely used sandbox (Flatpak):
// no network, the filesystem read-only, $HOME / /root / /tmp replaced by empty tmpfs, only the
// replay dir writable, and every process killed when the run ends. If bubblewrap is missing the
// runner REFUSES to run unless the caller explicitly picks a weaker mode. Even bubblewrap is not a
// guarantee against kernel exploits; see docs/SECURITY-THREAT-MODEL.md.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  /** "sandbox" (bubblewrap, default) · "net-only" (unshare -rn: no network, full filesystem access) · "none". */
  isolation?: Isolation;
  maxMutants?: number;
  keyid?: string;
}

export interface ReplayResult {
  predicate: ReplayPredicate;
  mutants: { file: string; mutation: string; killed: boolean }[];
}

const TOOL = "agent-cafe-cli/0.3.0";
export type Isolation = "sandbox" | "net-only" | "none";

/** Internal result of one run; only `passed`/`timed_out` are ever published. */
interface LocalOutcome extends RunOutcome {
  exit: number | null;
  output: string;
}

const probe = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore", timeout: 5000 }).status === 0;
const available: Partial<Record<Isolation, boolean>> = { none: true };

export function isolationAvailable(mode: Isolation): boolean {
  if (available[mode] === undefined) {
    if (process.platform !== "linux") available[mode] = false;
    else if (mode === "net-only") available[mode] = probe("unshare", ["-rn", "true"]);
    else available[mode] = probe("bwrap", ["--unshare-all", "--die-with-parent", "--ro-bind", "/", "/", "true"]);
  }
  return available[mode]!;
}

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

function sandboxArgs(dir: string, bin: string): string[] {
  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--ro-bind", "/", "/", "--tmpfs", "/home", "--tmpfs", "/root", "--tmpfs", "/tmp", "--tmpfs", "/var/tmp"];
  // An interpreter living under a hidden directory (a venv in /tmp, or a symlink into ~/.bun) is re-exposed
  // read-only: both the path as given and its resolved target.
  const hidden = /^\/(tmp|home|root|var\/tmp)\//;
  const full = bin.includes("/") ? bin : spawnSync("sh", ["-c", 'command -v "$1"', "sh", bin], { encoding: "utf8" }).stdout.trim();
  for (const p of full ? [full, realpathSync(full)] : []) {
    if (hidden.test(p)) args.push("--ro-bind", dirname(dirname(p)), dirname(dirname(p)));
  }
  args.push("--bind", dir, dir, "--dev", "/dev", "--proc", "/proc", "--chdir", dir, "--");
  return args;
}

function runCheck(c: Capsule, files: FileMap, opts: ReplayOptions, mode: Isolation): LocalOutcome {
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
  const [cmd, args] =
    mode === "sandbox" ? ["bwrap", [...sandboxArgs(dir, bin), bin, ...rest]] : mode === "net-only" ? ["unshare", ["-rn", "--", bin, ...rest]] : [bin, rest];
  const r = spawnSync(cmd, args as string[], {
    cwd: dir,
    env: env as unknown as NodeJS.ProcessEnv,
    timeout: c.check.timeout_ms ?? 10_000,
    killSignal: "SIGKILL",
    maxBuffer: 1_000_000,
    encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  return { exit: r.status, timed_out: timedOut, passed: r.status === 0 && !timedOut, output: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.slice(0, 64_000) };
}

const passed = (o: LocalOutcome) => o.passed;

/** Line-deletion mutants of each changed file. Comments and braces are skipped. (The "empty file" mutant
 * was removed: almost any check kills it, so it inflated sensitivity — red-team C3.) */
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
  }
  return out;
}

const siteCache = new Map<string, string | null>();
/** Python environment fact that changes behavior (Experiment C): is distutils absent (clean venv) or
 *  provided by setuptools' shim? Recorded in every Python result so evidence is not ambiguous. */
export function pythonSite(bin: string): string | null {
  if (siteCache.has(bin)) return siteCache.get(bin)!;
  const probe = "import importlib.util, sys, sysconfig\ns = importlib.util.find_spec('distutils')\nstd = sysconfig.get_paths()['stdlib']\nprint('distutils-stdlib' if s and (s.origin or '').startswith(std) else ('setuptools-shim' if s else ('venv-clean' if sys.prefix != sys.base_prefix else 'no-distutils')))";
  const r = spawnSync(bin, ["-I", "-c", probe], { encoding: "utf8", timeout: 5000 });
  const v = r.status === 0 ? r.stdout.trim() : null;
  siteCache.set(bin, v);
  return v;
}

export function runtimeVersion(c: Capsule, bins: Record<string, string>): string {
  const bin = resolveBin(c.check.run[0], bins);
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return text.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? "unknown";
}

export async function replay(c: Capsule, opts: ReplayOptions = {}): Promise<ReplayResult> {
  const mode: Isolation = opts.isolation ?? "sandbox";
  if (mode !== "sandbox" && mode !== "net-only" && mode !== "none") throw new Error(`unknown isolation mode: ${String(mode)}`);
  if (!isolationAvailable(mode)) {
    throw new Error(
      mode === "sandbox"
        ? "Sandbox unavailable: install bubblewrap (Linux: apt install bubblewrap) or run inside a VM/container and pass --isolation none explicitly."
        : `Isolation mode "${mode}" is not available on this system.`,
    );
  }
  const started_at = new Date().toISOString();
  const bins = opts.bins ?? {};
  const before = Object.keys(c.before.files).length ? runCheck(c, c.before.files, opts, mode) : null;
  const after = runCheck(c, c.after.files, opts, mode);
  let verdict: Verdict;
  if (after.timed_out || after.exit === null) verdict = "ERROR";
  else if (before && !passed(before) && passed(after)) {
    // When the capsule declares its symptom, the BEFORE failure must show it (ties check to problem).
    const sym = c.problem.symptom_regex;
    verdict = sym && !new RegExp(sym).test(before.output) ? "PROBLEM_NOT_REPRODUCED" : "PASS";
  }
  else if (before && passed(before) && passed(after)) verdict = "PROBLEM_NOT_REPRODUCED";
  else if (before && passed(before) && !passed(after)) verdict = "FIX_BREAKS";
  else if (!before && passed(after)) verdict = "PASS"; // no before state: weaker, lint flags it
  else verdict = "FIX_FAILS";

  const mutants: ReplayResult["mutants"] = [];
  if (verdict === "PASS") {
    for (const m of mutantsOf(c, opts.maxMutants ?? 8)) {
      const o = runCheck(c, m.files, opts, mode);
      mutants.push({ file: m.file, mutation: m.mutation, killed: !passed(o) });
    }
  }
  // Label the runtime by the binary actually used (a node capsule replayed with Bun is a Bun result).
  const binName = basename(resolveBin(c.check.run[0], bins));
  const runtime = /^bun/.test(binName) ? "bun" : c.runtime;
  const version = runtimeVersion(c, bins);
  const site = c.runtime === "python" ? pythonSite(resolveBin(c.check.run[0], bins)) : null;
  const conditions: Record<string, string> = { ...(c.check.env ?? {}), ...(opts.conditions ?? {}), ...(site && site !== "distutils-stdlib" ? { SITE: site } : {}) };
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
      ...(process.env.GITHUB_ACTIONS ? { ci: "github-actions" } : {}),
      conditions,
    },
    // Coarse on purpose: exit codes, timings and output hashes are a covert channel (red-team C2/L4).
    before: before ? { passed: before.passed, timed_out: before.timed_out } : null,
    after: { passed: after.passed, timed_out: after.timed_out },
    mutation: { total: mutants.length, killed: mutants.filter((m) => m.killed).length },
    lint: lintCapsule(c).map((f) => f.code),
    isolation: mode === "sandbox" ? "bubblewrap (no network, read-only fs, hidden home)" : mode === "net-only" ? "unshare-net (no network; NOT a sandbox)" : "none",
    runner: { keyid: opts.keyid ?? "unsigned", tool: TOOL },
    started_at,
  };
  return { predicate, mutants };
}
