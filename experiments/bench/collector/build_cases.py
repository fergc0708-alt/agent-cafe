import json, os, re, subprocess, sys, shutil
sys.path.insert(0, os.path.dirname(__file__))
from spec import CASES

BENCH = "/home/claude/bench"
VER = BENCH + "/verify"

def run(args, cwd=None):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()

def verify(c):
    d = f"{VER}/{c['id']}"
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    run(["git", "init", "-q"], d)
    rc, _, err = run(["git", "fetch", "-q", "--depth", "2", f"https://github.com/{c['repo']}", c["fix"]], d)
    if rc != 0:
        return False, "fetch failed: " + err[-200:]
    _, fh, _ = run(["git", "rev-parse", "FETCH_HEAD"], d)
    _, p1, _ = run(["git", "rev-parse", "FETCH_HEAD^1"], d)
    if fh != c["fix"]:
        return False, f"FETCH_HEAD {fh} != fix"
    if p1 != c["broken"]:
        return False, f"parent {p1} != broken {c['broken']}"
    rc, _, _ = run(["git", "cat-file", "-e", c["broken"] + "^{commit}"], d)
    if rc != 0:
        return False, "broken commit object missing"
    return True, "ok"

def hunks(c):
    repo_dir = f"{BENCH}/repos/" + c["repo"].replace("/", "__")
    out = []
    for p in c["paths"]:
        rc, diff, err = run(["git", "-C", repo_dir, "diff", "-U0", c["broken"], c["fix"], "--", p])
        if rc != 0 or not diff:
            raise SystemExit(f"{c['id']}: no diff for {p}: {err}")
        ranges = []
        for m in re.finditer(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", diff, re.M):
            s = int(m.group(1)); n = int(m.group(2)) if m.group(2) is not None else 1
            if n == 0:
                ranges.append((s, s, "insert-after"))
            else:
                ranges.append((s, s + n - 1, "changed"))
        only = (c.get("only_lines") or {}).get(p)
        if only:
            ranges = [r for r in ranges if any(not (r[1] < a or r[0] > b) for a, b in only)]
        out.append({"file": p,
                    "lines": [f"{a}" if a == b else f"{a}-{b}" for a, b, k in ranges if k == "changed"],
                    "insertions_after_line": [a for a, b, k in ranges if k == "insert-after"]})
    return out

cases, problems = [], []
for c in CASES:
    ok, msg = verify(c)
    print(c["id"], msg, flush=True)
    if not ok:
        problems.append((c["id"], msg)); continue
    fl = hunks(c)
    for f in fl:
        if not f["insertions_after_line"]:
            del f["insertions_after_line"]
    case = {
        "id": c["id"], "repo": c["repo"], "fix_commit": c["fix"], "broken_commit": c["broken"],
        "url": c["url"], "runtime": c["runtime"], "breaks_on": c["breaks_on"], "works_on": c["works_on"],
        "what_broke": c["what_broke"], "category": c["category"], "files_lines": fl,
        "symptom": c["symptom"], "statically_visible": c["statically_visible"],
        "found_via_search": c["search"],
    }
    if c.get("notes"):
        case["notes"] = c["notes"]
    cases.append(case)

json.dump(cases, open(f"{BENCH}/cases.json", "w"), indent=2, ensure_ascii=False)
print("WROTE", len(cases), "PROBLEMS", problems)
