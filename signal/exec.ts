// Low-level execution for Signal: throw-away git worktrees, install/test commands with timeouts, a child
// environment without credentials, and package-manager detection. Untrusted code (the project's install scripts
// and tests, and the dependencies they pull in) only ever runs through `sh()` below.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export function git(dir: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 64 << 20 });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Variables the code under test must never see: they would let it act as this job (push, mint OIDC tokens, use the
 *  Actions cache/artifact services) or as the user. Extend with `SIGNAL_STRIP_ENV` (comma-separated names/prefixes). */
const NEVER = [/^GITHUB_TOKEN$/, /^GH_TOKEN$/, /^ACTIONS_ID_TOKEN_/, /^ACTIONS_RUNTIME_/, /^ACTIONS_CACHE_/, /^ACTIONS_RESULTS_/, /^INPUT_/, /^SIGNAL_/];
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const extra = (base.SIGNAL_STRIP_ENV ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const e = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(base)) {
    if (NEVER.some((re) => re.test(k)) || extra.some((p) => (p.endsWith("*") ? k.startsWith(p.slice(0, -1)) : k === p))) continue;
    e[k] = v;
  }
  e.CI = e.CI ?? "true";
  return e;
}

export interface ShResult {
  ok: boolean;
  timedOut: boolean;
  code: number | null;
  ms: number;
  log: string;
}

export function sh(dir: string, cmd: string, timeoutMs: number, env = childEnv()): ShResult {
  const t0 = Date.now();
  const r = spawnSync("sh", ["-c", cmd], { cwd: dir, encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 512 << 20, env });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  return { ok: r.status === 0, timedOut, code: r.status, ms: Date.now() - t0, log: `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error && !timedOut ? `\n${r.error.message}` : ""}` };
}

export interface Worktree {
  dir: string; // project directory inside the worktree (root + prefix)
  root: string;
  remove(): void;
}

/** A detached worktree of HEAD; if `revertTo` is given, the dependency `files` are restored from that ref (files
 *  that did not exist there are removed). Never touches the user's checkout. */
export function worktree(repoRoot: string, prefix: string, files: string[] = [], revertTo?: string): Worktree {
  const root = mkdtempSync(join(os.tmpdir(), "signal-wt-"));
  const add = git(repoRoot, ["worktree", "add", "--detach", "-f", root, "HEAD"]);
  const remove = () => {
    git(repoRoot, ["worktree", "remove", "--force", root]);
    rmSync(root, { recursive: true, force: true });
    git(repoRoot, ["worktree", "prune"]);
  };
  if (!add.ok) { remove(); throw new Error(`could not create a git worktree: ${add.err.trim().split("\n")[0]}`); }
  if (revertTo && files.length) {
    const existing = files.filter((f) => git(repoRoot, ["cat-file", "-e", `${revertTo}:${f}`]).ok);
    if (existing.length && !git(root, ["checkout", revertTo, "--", ...existing]).ok) { remove(); throw new Error("could not revert the dependency files"); }
    for (const f of files.filter((x) => !existing.includes(x))) {
      const p = join(root, f);
      if (existsSync(p) && lstatSync(p).isFile()) rmSync(p);
    }
  }
  return { dir: join(root, prefix), root, remove };
}

export function where(dir: string): { root: string; prefix: string } {
  const root = git(dir, ["rev-parse", "--show-toplevel"]).out.trim();
  if (!root) throw new Error(`${dir} is not inside a git repository`);
  return { root, prefix: git(dir, ["rev-parse", "--show-prefix"]).out.trim() };
}

/** Copies an installed node_modules tree (copy-on-write when the file system supports it). */
export function copyTree(from: string, to: string): boolean {
  if (!existsSync(from)) return false;
  try {
    cpSync(from, to, { recursive: true, verbatimSymlinks: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ---------- package manager detection ----------

export type PackageManager = "npm" | "pnpm" | "yarn" | "yarn-berry" | "python";

export interface Commands {
  pm: PackageManager | null;
  install: string | null;
  test: string | null;
  why: string[]; // how each was chosen, shown in the report
}

const has = (bin: string) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).status === 0;

/** Zero-config defaults for JavaScript projects; Python needs explicit commands (one venv per side). */
export function detectCommands(projectDir: string, repoRoot: string): Commands {
  const why: string[] = [];
  const find = (f: string) => [projectDir, repoRoot].map((d) => join(d, f)).find(existsSync);
  let pkg: any = null;
  try { pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")); } catch { /* none */ }
  const pmField: string = pkg?.packageManager ?? "";
  let pm: PackageManager | null = null;
  let install: string | null = null;
  if (find("pnpm-lock.yaml") || pmField.startsWith("pnpm@")) {
    pm = "pnpm";
    const v = pmField.match(/^pnpm@(\d+[\w.-]*)/)?.[1];
    const bin = has("pnpm") ? "pnpm" : v ? `npx --yes pnpm@${v}` : "npx --yes pnpm@9";
    install = `${bin} install --frozen-lockfile`;
    why.push(`pnpm-lock.yaml → ${install}`);
  } else if (find("yarn.lock") || pmField.startsWith("yarn@")) {
    const berry = !!find(".yarnrc.yml") || /^yarn@[2-9]/.test(pmField);
    pm = berry ? "yarn-berry" : "yarn";
    install = berry ? (has("corepack") ? "corepack yarn install --immutable" : "yarn install --immutable") : "yarn install --frozen-lockfile";
    why.push(`yarn.lock (${berry ? "berry" : "classic"}) → ${install}`);
  } else if (find("package-lock.json") || find("npm-shrinkwrap.json")) {
    pm = "npm";
    install = "npm ci --no-audit --no-fund";
    why.push(`package-lock.json → ${install}`);
  } else if (find("uv.lock") || find("poetry.lock") || find("requirements.txt") || find("pyproject.toml")) {
    pm = "python";
    why.push("Python project: pass `install` and `test` explicitly (use a fresh virtualenv per side, e.g. `python -m venv .venv && .venv/bin/pip install -r requirements.txt`)");
  }
  let test: string | null = null;
  const t = pkg?.scripts?.test;
  if (typeof t === "string" && t.trim() && !/no test specified/.test(t)) {
    test = pm === "pnpm" ? (install!.startsWith("pnpm") ? "pnpm test" : install!.replace(/ install.*/, " test")) : pm === "yarn" || pm === "yarn-berry" ? "yarn test" : "npm test";
    why.push(`package.json scripts.test → ${test}`);
  }
  return { pm, install, test, why };
}

/** Installed version of an npm package in a project directory (null if missing). */
export function installedVersion(projectDir: string, name: string): string | null {
  try {
    return JSON.parse(readFileSync(join(projectDir, "node_modules", name, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** Command that installs exactly `specs` (name@version) on top of an installed tree, without touching others. */
export function addCommand(pm: PackageManager, installCmd: string, specs: string[]): string | null {
  const q = specs.map((s) => `'${s.replace(/'/g, "")}'`).join(" ");
  if (pm === "npm") return `npm install --no-save --no-audit --no-fund ${q}`;
  if (pm === "pnpm") return `${installCmd.replace(/ install.*/, "")} add ${q}`;
  if (pm === "yarn") return `yarn add --ignore-workspace-root-check ${q}`;
  if (pm === "yarn-berry") return `${installCmd.replace(/ install.*/, "")} add ${q}`;
  return null;
}
