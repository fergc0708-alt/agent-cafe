#!/usr/bin/env python3
"""Real-world benchmark: runtime-upgrade breaks taken from public commits (cases.json, collected without looking
at Agent Café's catalog). For each case, fetch the broken commit (parent of the fix) and the fixed commit, then run
every tool *differentially*: findings that appear for the new runtime and not for the last working one.

Ground truth comes from the fix commit (files/lines it changed), never from any tool's rules.
  TP  : a differential finding on the broken snapshot within +-WINDOW lines of a line the fix changed
  FN  : no such finding
  residual: differential findings still reported on the fixed snapshot in the files the fix touched
            (the project works there, so these are false alarms or unrelated latent issues)
  extra: differential findings on the broken snapshot away from the ground truth (reported, sampled by hand)

Third-party code is only READ (static tools). Nothing from the snapshots is executed.
Usage: run_bench.py cases.json out.json
"""
import json, os, re, subprocess, sys, shutil

WINDOW = 3
WORK = "/tmp/bench-snap"
CAFE = ["/opt/node22/bin/node", os.path.join(os.path.dirname(__file__), "../../dist/cli/cafe.js")]
PY = "/tmp/tools/bin"
JS = "/tmp/jstools/node_modules/.bin"
TIMEOUT = 300


def sh(cmd, cwd=None, timeout=TIMEOUT):
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.stdout + r.stderr
    except subprocess.TimeoutExpired:
        return "__TIMEOUT__"


def fetch(repo, sha, dest):
    if os.path.isdir(os.path.join(dest, ".git")):
        return True
    os.makedirs(dest, exist_ok=True)
    sh(["git", "init", "-q", dest])
    out = sh(["git", "-c", "core.hooksPath=/dev/null", "fetch", "-q", "--depth", "1", f"https://github.com/{repo}", sha], cwd=dest, timeout=600)
    sh(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "checkout", "-q", "FETCH_HEAD"], cwd=dest)
    return os.path.exists(os.path.join(dest, ".git", "HEAD")) and "fatal" not in out


def files(root, exts):
    out = []
    for d, dirs, fs in os.walk(root):
        dirs[:] = [x for x in dirs if x not in (".git", "node_modules", ".venv", "venv", "build", "dist", "__pycache__", ".tox")]
        out += [os.path.relpath(os.path.join(d, f), root) for f in fs if f.endswith(exts)]
    return out[:4000]


def norm(root, p):
    p = p.strip()
    return os.path.relpath(p, root) if os.path.isabs(p) else p


# ---------- tools: each returns set of (file, line, msg) for a given version ----------
SCOPE = []  # files touched by the fix, set per case


def scoped(root, exts):
    return [p for p in SCOPE if os.path.isfile(os.path.join(root, p)) and (exts is None or p.endswith(exts) or "." not in os.path.basename(p) or not p.endswith((".js", ".ts", ".py", ".cjs", ".mjs", ".md", ".txt", ".json", ".yml", ".yaml", ".toml", ".cfg", ".ac", ".in")))]


def t_mypy(root, ver):
    fs = scoped(root, (".py",))
    if not fs:
        return None
    out = sh([f"{PY}/mypy", "--python-version", ver, "--check-untyped-defs", "--no-incremental", "--follow-imports=silent", "--no-error-summary", "--hide-error-context", "--show-error-codes", "--cache-dir=/dev/null", *fs], cwd=root)
    if out == "__TIMEOUT__":
        return "timeout"
    return {(norm(root, m[0]), int(m[1]), m[2]) for m in re.findall(r"^(.+?):(\d+): error: (.*)$", out, re.M)}


def t_pyright(root, ver):
    fs = scoped(root, (".py",))
    if not fs:
        return None
    out = sh([f"{JS}/pyright", "--pythonversion", ver, "--outputjson", *fs], cwd=root)
    if out == "__TIMEOUT__":
        return "timeout"
    try:
        d = json.loads(out[out.index("{"):])
    except Exception:
        return "error"
    return {(norm(root, x["file"]), x["range"]["start"]["line"] + 1, f'{x.get("rule","")}: {x["message"].splitlines()[0]}') for x in d.get("generalDiagnostics", []) if x["severity"] == "error"}


def t_pylint(root, ver):
    fs = scoped(root, (".py",))
    if not fs:
        return None
    out = sh([f"{PY}/pylint", "--disable=all", "--enable=deprecated-module,deprecated-method,deprecated-argument,deprecated-class,deprecated-decorator,deprecated-attribute", f"--py-version={ver}", "--score=n", *fs], cwd=root)
    if out == "__TIMEOUT__":
        return "timeout"
    return {(norm(root, m[0]), int(m[1]), m[2]) for m in re.findall(r"^(.+?):(\d+):\d+: (W\d+.*)$", out, re.M)}


def t_ruff(root, ver):
    fs = scoped(root, (".py",))
    if not fs:
        return None
    out = sh([f"{PY}/ruff", "check", "--isolated", "--select", "UP,PGH,PLW,PLE", "--target-version", "py" + ver.replace(".", ""), "--output-format", "concise", "--exit-zero", *fs], cwd=root)
    return {(norm(root, m[0]), int(m[1]), m[2]) for m in re.findall(r"^(.+?):(\d+):\d+: (.*)$", out, re.M)}


def t_vermin(root, ver):
    fs = scoped(root, (".py",))
    if not fs:
        return None
    out = sh([f"{PY}/vermin", "--no-tips", "--violations", f"-t={ver}-", "--no-parse-comments", *fs], cwd=root)
    return {(norm(root, m[0]), int(m[1]), m[2]) for m in re.findall(r"^!?(.+?\.py):(\d+):\d*:?\s*(.*)$", out, re.M)}


def t_semgrep(root, ver):
    if ver != "__once__":
        return None
    return None  # see note in RESULTS: version-agnostic ruleset, run once separately


TYPES = {"16": "18", "18": "18", "20": "20", "21": "22", "22": "22", "23": "24", "24": "24", "25": "24"}


def t_tsc(root, ver):
    fs = [f for f in scoped(root, (".js", ".cjs", ".mjs", ".ts", ".mts", ".cts")) if not f.endswith(".d.ts")]
    if not fs:
        return None
    tr = f"/tmp/types{TYPES.get(ver.split('.')[0], '24')}/node_modules/@types"
    args = [f"{JS}/tsc", "--ignoreConfig", "--allowJs", "--checkJs", "--noEmit", "--skipLibCheck", "--noImplicitAny", "false", "--types", "node", "--typeRoots", tr, "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", "--pretty", "false"]
    out = sh(args + fs, cwd=root)
    if out == "__TIMEOUT__":
        return "timeout"
    return {(norm(root, m[0]), int(m[1]), m[2]) for m in re.findall(r"^(.+?)\((\d+),\d+\): error (TS\d+: .*)$", out, re.M)}


def t_eslint_n(root, ver):
    fs = scoped(root, (".js", ".cjs", ".mjs"))
    if not fs:
        return None
    os.environ["NODE_TARGET"] = f">={ver if '.' in ver else ver + '.0.0'}"
    out = sh([f"{JS}/eslint", "-c", "/tmp/jstools/eslint.config.mjs", "--no-config-lookup", "--no-ignore", "--format", "json", "--no-warn-ignored", *fs], cwd=root)
    try:
        d = json.loads(out[out.index("["):])
    except Exception:
        return "error"
    return {(norm(root, f["filePath"]), m.get("line", 0), m.get("ruleId", "") + ": " + m["message"]) for f in d for m in f["messages"] if m.get("ruleId")}


def t_cafe(root, ver, runtime):
    out = sh(CAFE + ["doctor", root, "--target", f"{runtime}@{ver}", "--json"])
    try:
        d = json.loads(out[out.index("{"):])
    except Exception:
        return "error"
    res = set()
    for f in d["findings"]:
        bad = [v for v in f["verdicts"] if v["env"]["runtime"] == runtime and v["env"]["version"].startswith(ver) and v["status"] not in ("not_affected", "no_evidence")]
        if bad or f["scope"] == "code":
            res |= {(h["file"], h["line"], f["slug"]) for h in f["hits"]}
    if os.environ.get("CAFE_LENIENT"):
        for c in d.get("clear", []):
            if c.get("conditional"):
                res |= {(h["file"], h["line"], c["slug"] + " (conditional)") for h in c.get("hits", [])}
    return res


ABSOLUTE = {"pylint", "ruff", "vermin", "eslint-plugin-n"}
PY_TOOLS = {"cafe": None, "mypy": t_mypy, "pyright": t_pyright, "pylint": t_pylint, "ruff": t_ruff, "vermin": t_vermin}
JS_TOOLS = {"cafe": None, "tsc+@types/node": t_tsc, "eslint-plugin-n": t_eslint_n}


def run_tool(name, fn, root, runtime, old, new):
    """Differential: findings for `new` that are not findings for `old` (compared by file+message, line-agnostic)."""
    if name == "cafe":
        n = t_cafe(root, new, runtime)
        return n if isinstance(n, str) else sorted(n)
    n = fn(root, new)
    if n is None or isinstance(n, str):
        return n
    if name in ABSOLUTE:
        return sorted(n)
    o = fn(root, old)
    if isinstance(o, str) or o is None:
        o = set()
    okeys = {(f, re.sub(r"\d+", "#", m)) for f, _, m in o}
    return sorted(x for x in n if (x[0], re.sub(r"\d+", "#", x[2])) not in okeys)


def gt_lines(case):
    """[(file, line)] from the case's files_lines in whatever shape the collector used."""
    out = []
    fl = case.get("files_lines") or []
    if isinstance(fl, dict):
        fl = [{"file": k, "lines": v} for k, v in fl.items()]
    for x in fl:
        if isinstance(x, str):
            m = re.match(r"(.+?):(\d+)(?:-(\d+))?", x)
            if m:
                a, b = int(m[2]), int(m[3] or m[2])
                out += [(m[1], l) for l in range(a, b + 1)]
            else:
                out.append((x, None))
        elif isinstance(x, dict):
            f = x.get("file") or x.get("path")
            ls = (x.get("lines") or x.get("line") or []) + list(x.get("insertions_after_line") or [])
            if isinstance(ls, (int, str)):
                ls = [ls]
            got = False
            for l in ls:
                m = re.match(r"(\d+)(?:-(\d+))?", str(l))
                if m:
                    got = True
                    out += [(f, k) for k in range(int(m[1]), int(m[2] or m[1]) + 1)]
            if not got:
                out.append((f, None))
    return out


def hit(findings, gt):
    for f, l, _ in findings:
        for gf, gl in gt:
            if gf and (f == gf or f.endswith("/" + gf) or gf.endswith("/" + f)) and (gl is None or abs(l - gl) <= WINDOW):
                return True
    return False


def main():
    cases = json.load(open(sys.argv[1]))
    out_path = sys.argv[2]
    results = json.load(open(out_path)) if os.path.exists(out_path) else {}
    os.makedirs(WORK, exist_ok=True)
    for c in cases:
        cid = c["id"]
        if cid in results and not os.environ.get("RERUN"):
            continue
        rt = c["runtime"]
        if rt == "python":
            new = re.search(r"3\.\d+", str(c["breaks_on"]))[0]
            m = re.search(r"3\.\d+", str(c["works_on"]))
            old = m[0] if m and m[0] != new else f"3.{int(new.split('.')[1]) - 1}"  # unknown: previous minor
        else:
            new = re.search(r"\d+", str(c["breaks_on"]))[0]
            m = re.search(r"\d+", str(c["works_on"]))
            old = m[0] if m and m[0] != new else str(int(new) - 2)  # unknown: previous even major
        b, f = os.path.join(WORK, cid, "broken"), os.path.join(WORK, cid, "fixed")
        ok = fetch(c["repo"], c["broken_commit"], b) and fetch(c["repo"], c["fix_commit"], f)
        r = {"id": cid, "repo": c["repo"], "runtime": rt, "old": old, "new": new, "category": c.get("category"), "statically_visible": c.get("statically_visible"), "fetched": ok, "tools": {}}
        if not ok:
            results[cid] = r
            json.dump(results, open(out_path, "w"), indent=1)
            continue
        gt = gt_lines(c)
        touched = {g[0] for g in gt}
        SCOPE[:] = sorted(touched)
        for name, fn in (PY_TOOLS if rt == "python" else JS_TOOLS).items():
            fb = run_tool(name, fn, b, rt, old, new)
            ff = run_tool(name, fn, f, rt, old, new)
            if fb is None or isinstance(fb, str):
                r["tools"][name] = {"status": fb or "n/a"}
                continue
            ffl = ff if isinstance(ff, list) else []
            near = [x for x in fb if hit([x], gt)]
            r["tools"][name] = {
                "detected": bool(near),
                "near_gt": near[:5],
                "extra_broken": len(fb) - len(near),
                "extra_sample": [x for x in fb if x not in near][:5],
                "residual_fixed_touched": [x for x in ffl if any(x[0] == t or x[0].endswith("/" + str(t)) for t in touched)][:5],
                "residual_fixed_total": len(ffl),
            }
        results[cid] = r
        print(cid, {k: v.get("detected", v.get("status")) for k, v in r["tools"].items()}, flush=True)
        json.dump(results, open(out_path, "w"), indent=1)


if __name__ == "__main__":
    main()
