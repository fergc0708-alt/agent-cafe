// Execution layer for Signal.
//
// Trust boundary. The project's install scripts, its tests and every dependency they pull in are UNTRUSTED (a
// malicious update is the threat). They run as the same OS user as Signal, so nothing here is a sandbox. What this
// module does is make sure that code (a) gets no credentials Signal holds, (b) cannot reach Signal's git machinery,
// (c) cannot leave processes behind that alter the next run, and (d) is caught when it touches the places Signal
// relies on (the repository's .git, the runner's workflow-command files). See signal/SECURITY.md.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
// ---------------------------------------------------------------- git (trusted phase only)
/** Git with no user/system config, no hooks, no credentials in the environment. Used only BEFORE any project code
 *  runs (or on blobs), so a filter/hook planted by that code is never executed by Signal. */
export function git(dir, args) {
    const env = { PATH: process.env.PATH, HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LANG: "C" };
    const r = spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", "-c", "credential.helper=", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 64 << 20, env });
    return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}
export function where(dir) {
    const root = git(dir, ["rev-parse", "--show-toplevel"]).out.trim();
    if (!root)
        throw new Error(`${dir} is not inside a git repository`);
    return { root, prefix: git(dir, ["rev-parse", "--show-prefix"]).out.trim() };
}
const gitEnv = () => ({ PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", HOME: os.tmpdir() });
/** A plain directory (no .git) with the tree of `ref`, optionally with `files` taken from `revertTo` instead
 *  (files absent there are removed). Built with `git archive` from the object database: no checkout, no filters. */
export function materialize(root, ref, files = [], revertTo) {
    const dir = mkdtempSync(join(os.tmpdir(), "signal-src-"));
    const r = spawnSync("sh", ["-c", 'git -c core.hooksPath=/dev/null -c core.fsmonitor=false archive --format=tar "$1" | tar -x -C "$2"', "sh", ref, dir], { cwd: root, env: gitEnv(), encoding: "utf8" });
    if (r.status !== 0) {
        removeTree(dir);
        throw new Error(`could not export ${ref}: ${(r.stderr ?? "").trim().split("\n")[0]}`);
    }
    if (revertTo) {
        for (const f of files) {
            const p = join(dir, f);
            const blob = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "cat-file", "blob", `${revertTo}:${f}`], { cwd: root, env: gitEnv(), maxBuffer: 256 << 20 });
            if (blob.status === 0) {
                mkdirSync(dirname(p), { recursive: true });
                writeFileSync(p, blob.stdout);
            }
            else
                rmSync(p, { force: true });
        }
    }
    return dir;
}
/** Removes a tree even if the code under test made parts of it unreadable. Never throws. */
export function removeTree(dir) {
    try {
        spawnSync("chmod", ["-R", "u+rwX", dir], { stdio: "ignore" });
    }
    catch { /* ignore */ }
    try {
        rmSync(dir, { recursive: true, force: true });
    }
    catch { /* best effort */ }
}
export function copyTree(from, to) {
    if (!existsSync(from))
        return false;
    try {
        cpSync(from, to, { recursive: true, verbatimSymlinks: true, force: true });
        return true;
    }
    catch {
        return false;
    }
}
// ---------------------------------------------------------------- environment for untrusted code
/** Allowlist: only what builds and test runners need. Everything else (tokens, cloud keys, SSH agent, npmrc with
 *  auth, the runner's workflow-command files, RUNNER_TEMP) is withheld. `SIGNAL_KEEP_ENV` adds names explicitly. */
const ALLOW = [
    /^PATH$/, /^LANG$/, /^LANGUAGE$/, /^LC_[A-Z]+$/, /^TZ$/, /^TERM$/, /^SHELL$/, /^USER$/, /^LOGNAME$/,
    /^CI$/, /^GITHUB_ACTIONS$/, /^RUNNER_OS$/, /^RUNNER_ARCH$/, /^FORCE_COLOR$/, /^NO_COLOR$/,
    /^NODE_ENV$/, /^COREPACK_[A-Z_]+$/, /^PNPM_HOME$/, /^YARN_ENABLE_[A-Z_]+$/,
    /^PYTHON(PATH|HOME|UNBUFFERED|DONTWRITEBYTECODE)$/, /^PIP_(NO_INPUT|DISABLE_PIP_VERSION_CHECK)$/, /^UV_(PYTHON|NO_PROGRESS)$/,
    /^JAVA_HOME$/, /^GOROOT$/,
    // network configuration the install needs on proxied runners (a proxy URL can embed credentials: those are
    // passed, as in your normal CI, because without them nothing installs)
    /^(HTTPS?|NO|ALL)_PROXY$/i, /^(NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|PIP_CERT)$/,
    /^npm_config_(https_proxy|proxy|noproxy|registry|cafile|strict_ssl)$/i, /^YARN_(HTTPS?_PROXY|NPM_REGISTRY_SERVER|CA_FILE_PATH)$/,
    /^GLOBAL_AGENT_(HTTPS?_PROXY|NO_PROXY)$/,
];
const NEVER = [/^GITHUB_TOKEN$/, /^GH_TOKEN$/, /^ACTIONS_/, /^GITHUB_(ENV|OUTPUT|PATH|STATE|STEP_SUMMARY)$/, /^RUNNER_TEMP$/];
export function childEnv(home, base = process.env) {
    const keep = (base.SIGNAL_KEEP_ENV ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const e = {};
    for (const [k, v] of Object.entries(base)) {
        if (NEVER.some((re) => re.test(k)))
            continue;
        if (ALLOW.some((re) => re.test(k)) || keep.includes(k))
            e[k] = v;
    }
    // fresh HOME and TMPDIR per side: no ~/.npmrc, ~/.ssh, ~/.git-credentials, gh config, and no shared caches
    e.HOME = home;
    e.TMPDIR = join(home, "tmp");
    e.npm_config_cache = join(home, ".npm");
    e.CI = e.CI ?? "true";
    mkdirSync(e.TMPDIR, { recursive: true });
    return e;
}
const TAIL = 2 << 20; // only the last 2 MB of output are kept: enough to parse failures, huge logs cannot crash Signal
function tail(file) {
    try {
        const size = statSync(file).size;
        const fd = openSync(file, "r");
        const len = Math.min(size, TAIL);
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, size - len);
        closeSync(fd);
        return buf.toString("utf8");
    }
    catch {
        return "";
    }
}
/** Runs `cmd` in its own process group with output to a file. When it exits or times out the whole group is killed,
 *  so background processes it started cannot outlive it (a process that escapes with setsid is not caught). */
export function sh(dir, cmd, timeoutMs, env) {
    const t0 = Date.now();
    const logDir = mkdtempSync(join(os.tmpdir(), "signal-log-"));
    const logFile = join(logDir, "out");
    const fd = openSync(logFile, "w");
    return new Promise((resolve) => {
        let timedOut = false;
        let finished = false;
        const child = spawn("sh", ["-c", cmd], { cwd: dir, env, detached: true, stdio: ["ignore", fd, fd] });
        const killGroup = () => { try {
            if (child.pid)
                process.kill(-child.pid, "SIGKILL");
        }
        catch { /* gone */ } };
        const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
        const done = (code) => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timer);
            killGroup(); // leftovers of the group
            closeSync(fd);
            const log = tail(logFile);
            removeTree(logDir);
            resolve({ ok: code === 0 && !timedOut, timedOut, code, ms: Date.now() - t0, log });
        };
        child.on("error", () => done(127));
        child.on("exit", (code) => done(code));
    });
}
// ---------------------------------------------------------------- tamper detection
/** Fingerprint of what untrusted code must not touch: the repository's git control files and the runner's
 *  workflow-command files (outputs, env, path, summary). Compared before and after project code runs. */
export function fingerprint(repoRoot) {
    const m = new Map();
    const add = (p) => {
        try {
            const st = statSync(p);
            if (st.isDirectory()) {
                for (const f of readdirSync(p))
                    add(join(p, f));
                return;
            }
            m.set(p, `${st.size}:${st.mtimeMs}`);
        }
        catch {
            m.set(p, "absent");
        }
    };
    const gitDir = join(repoRoot, ".git");
    for (const p of ["config", "info", "hooks", "commondir", "HEAD"])
        add(join(gitDir, p));
    for (const k of ["GITHUB_ENV", "GITHUB_OUTPUT", "GITHUB_PATH", "GITHUB_STEP_SUMMARY", "GITHUB_STATE"])
        if (process.env[k])
            add(process.env[k]);
    if (process.env.RUNNER_TEMP)
        add(join(process.env.RUNNER_TEMP, "_runner_file_commands"));
    return m;
}
export function changedSince(before, repoRoot) {
    const now = fingerprint(repoRoot);
    const out = [];
    for (const [k, v] of now)
        if (before.get(k) !== v)
            out.push(k);
    for (const k of before.keys())
        if (!now.has(k))
            out.push(k);
    return out;
}
const has = (bin) => spawnSync("sh", ["-c", 'command -v "$1"', "sh", bin], { encoding: "utf8" }).status === 0;
/** Zero-config defaults for JavaScript projects; Python needs explicit commands (one venv per side). */
export function detectCommands(projectDir, repoRoot) {
    const why = [];
    const find = (f) => [projectDir, repoRoot].map((d) => join(d, f)).find(existsSync);
    let pkg = null;
    try {
        pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    }
    catch { /* none */ }
    const pmField = typeof pkg?.packageManager === "string" ? pkg.packageManager : "";
    let pm = null;
    let install = null;
    let runner = "npm";
    if (find("pnpm-lock.yaml") || pmField.startsWith("pnpm@")) {
        pm = "pnpm";
        const v = pmField.match(/^pnpm@(\d+[\w.-]*)$/)?.[1];
        runner = has("pnpm") ? "pnpm" : v ? `npx --yes pnpm@${v}` : "npx --yes pnpm@9";
        install = `${runner} install --frozen-lockfile`;
        why.push(`pnpm-lock.yaml → ${install}`);
    }
    else if (find("yarn.lock") || pmField.startsWith("yarn@")) {
        const berry = !!find(".yarnrc.yml") || /^yarn@[2-9]/.test(pmField);
        pm = berry ? "yarn-berry" : "yarn";
        runner = berry && has("corepack") ? "corepack yarn" : "yarn";
        install = berry ? `${runner} install --immutable` : "yarn install --frozen-lockfile";
        why.push(`yarn.lock (${berry ? "berry" : "classic"}) → ${install}`);
    }
    else if (find("package-lock.json") || find("npm-shrinkwrap.json")) {
        pm = "npm";
        install = "npm ci --no-audit --no-fund";
        why.push(`package-lock.json → ${install}`);
    }
    else if (find("uv.lock") || find("poetry.lock") || find("requirements.txt") || find("pyproject.toml")) {
        pm = "python";
        why.push("Python project: pass `install` and `test` explicitly, creating a fresh virtualenv per side (e.g. `python -m venv .venv && .venv/bin/pip install -r requirements.txt`)");
    }
    let test = null;
    const t = pkg?.scripts?.test;
    if (pm && pm !== "python" && typeof t === "string" && t.trim() && !/no test specified/.test(t)) {
        test = pm === "npm" ? "npm test" : `${runner} test`;
        why.push(`package.json scripts.test → ${test}`);
    }
    return { pm, install, test, why };
}
export function installedVersion(projectDir, name) {
    try {
        return JSON.parse(readFileSync(join(projectDir, "node_modules", name, "package.json"), "utf8")).version ?? null;
    }
    catch {
        return null;
    }
}
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const VERSION = /^[0-9A-Za-z.+_~-]{1,64}$/;
export const safeSpec = (name, version) => NPM_NAME.test(name) && VERSION.test(version);
/** Command that installs exactly `specs` (validated name@version) on top of an installed tree. */
export function addCommand(pm, installCmd, specs) {
    const q = specs.map((s) => `'${s}'`).join(" ");
    const runner = installCmd.replace(/ install.*/, "");
    if (pm === "npm")
        return `npm install --no-save --no-audit --no-fund -- ${q}`;
    if (pm === "pnpm")
        return `${runner} add -- ${q}`;
    if (pm === "yarn")
        return `yarn add --ignore-workspace-root-check ${q}`;
    if (pm === "yarn-berry")
        return `${runner} add ${q}`;
    return null;
}
