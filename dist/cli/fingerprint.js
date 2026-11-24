// Environment fingerprint: what actually decides whether a known break applies to THIS project.
// Collected locally and never uploaded. It records kinds, versions and conditions, not paths,
// usernames, hostnames, environment variable values or package contents.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "../core/capsule/capsule.js";
import { sha256Hex } from "../core/util.js";
const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 8000, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", LANG: "C.UTF-8" } });
    return r.status === 0 ? `${r.stdout}`.trim() : null;
};
const readJson = (p) => {
    try {
        return JSON.parse(readFileSync(p, "utf8"));
    }
    catch {
        return null;
    }
};
const readText = (p) => (existsSync(p) ? readFileSync(p, "utf8").trim() : null);
const PY_PROBE = `
import json, os, sys, sysconfig, importlib.util
out = {"version": sys.version.split()[0], "venv": sys.prefix != sys.base_prefix}
cfg = os.path.join(sys.prefix, "pyvenv.cfg")
sysite = None
if out["venv"] and os.path.exists(cfg):
    for line in open(cfg):
        if line.split("=")[0].strip() == "include-system-site-packages":
            sysite = line.split("=")[1].strip().lower() == "true"
out["system_site_packages"] = (not out["venv"]) or bool(sysite)
spec = importlib.util.find_spec("distutils")
std = sysconfig.get_paths()["stdlib"]
out["distutils"] = "missing" if spec is None else ("stdlib" if (spec.origin or "").startswith(std) else "setuptools-shim")
out["setuptools"] = importlib.util.find_spec("setuptools") is not None
out["kind"] = "conda" if "conda" in sys.prefix.lower() else ("pyenv" if ".pyenv" in sys.prefix else ("venv" if out["venv"] else "system"))
print(json.dumps(out))
`;
function timeZone() {
    if (process.env.TZ)
        return process.env.TZ;
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    catch {
        return undefined;
    }
}
/** `bins` points at the interpreters that actually run the code (e.g. a deploy venv) instead of PATH. */
export async function fingerprint(projectDir, bins = {}) {
    const missing = [];
    const pkg = readJson(join(projectDir, "package.json"));
    const kinds = [];
    const declared = {};
    const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "requirements.txt"].filter((f) => existsSync(join(projectDir, f)));
    if (pkg) {
        kinds.push("node");
        if (typeof pkg.engines?.node === "string")
            declared.node = pkg.engines.node;
    }
    const nvmrc = readText(join(projectDir, ".nvmrc")) ?? readText(join(projectDir, ".node-version"));
    if (nvmrc)
        declared["node (.nvmrc)"] = nvmrc.replace(/^v/, "");
    const pyproject = readText(join(projectDir, "pyproject.toml"));
    if (pyproject || existsSync(join(projectDir, "requirements.txt")) || existsSync(join(projectDir, "setup.py")))
        kinds.push("python");
    const reqPy = pyproject?.match(/requires-python\s*=\s*["']([^"']+)["']/)?.[1];
    if (reqPy)
        declared.python = reqPy;
    const pyv = readText(join(projectDir, ".python-version"));
    if (pyv)
        declared["python (.python-version)"] = pyv.split("\n")[0];
    const runtimes = [];
    const nodeV = run(bins.node ?? "node", ["--version"]);
    if (nodeV)
        runtimes.push({ runtime: "node", version: nodeV.replace(/^v/, ""), source: bins.node ? "given interpreter" : "PATH", details: {} });
    else if (kinds.includes("node"))
        missing.push("node is not on PATH");
    const bunV = run("bun", ["--version"]);
    if (bunV)
        runtimes.push({ runtime: "bun", version: bunV, source: "PATH", details: {} });
    // Prefer the project's own virtualenv: that is what the code actually runs with.
    const venvPy = [".venv/bin/python", "venv/bin/python", ".venv/Scripts/python.exe"].map((p) => join(projectDir, p)).find((p) => existsSync(p));
    const given = bins.python3 ?? bins.python;
    const pyBin = given ?? venvPy ?? "python3";
    const py = run(pyBin, ["-I", "-c", PY_PROBE]);
    if (py) {
        const d = JSON.parse(py);
        runtimes.push({ runtime: "python", version: d.version, source: given ? "given interpreter" : venvPy ? "project virtualenv" : "PATH", details: { kind: d.kind, system_site_packages: d.system_site_packages, distutils: d.distutils, setuptools: d.setuptools } });
    }
    else if (kinds.includes("python"))
        missing.push("python3 is not available");
    const bashV = run("bash", ["--version"])?.match(/version (\d+\.\d+(\.\d+)?)/)?.[1];
    if (bashV)
        runtimes.push({ runtime: "bash", version: bashV, source: "PATH", details: {} });
    const conditions = {};
    const tz = timeZone();
    if (tz)
        conditions.TZ = tz;
    else
        missing.push("time zone unknown");
    const pyInfo = runtimes.find((r) => r.runtime === "python");
    if (pyInfo && pyInfo.details.system_site_packages === false && pyInfo.details.setuptools === false)
        conditions.SITE = "venv-clean";
    if (!lockfiles.length && kinds.length)
        missing.push("no lockfile: dependency versions are unknown");
    missing.push("native dependencies and compiler toolchains are not fingerprinted yet");
    const base = {
        schema: "agent-cafe.fingerprint/v1",
        os: process.platform,
        arch: process.arch,
        project: { kinds, ...(pkg?.packageManager ? { package_manager: String(pkg.packageManager).split("@")[0] } : {}), lockfiles, declared, ...(pkg?.type ? { package_type: String(pkg.type) } : {}) },
        runtimes,
        conditions,
        missing,
    };
    return { ...base, digest: (await sha256Hex(canonical({ ...base, missing: [] }))).slice(0, 16) };
}
