"""Builds results/C-matrix.md (capsule x environment table) from results/C-matrix.json. Run: python3 experiments/v2/summarize.py"""
import json, os, collections
here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "")
RD = os.environ.get("RESULTS_DIR", "results")
rows = json.load(open(os.path.join(here, RD + "/C-matrix.json")))
ci_path = os.path.join(here, RD + "/E-ci-merged.json")
if os.path.exists(ci_path):
    rows += [{**r, "env": r["env"].replace(" (ci)", "") + " [CI]"} for r in json.load(open(ci_path))["ci_runs"]]
ab = {"PASS": "P", "PROBLEM_NOT_REPRODUCED": "nr", "FIX_FAILS": "FAIL", "FIX_BREAKS": "BRK", "ERROR": "ERR"}
def short(env):
    rt, ver = env.split()[:2]
    import re
    cond = ",".join(re.findall(r"\[([^\]]*)\]", env))
    cond = cond.replace("SITE=venv-clean", "venv").replace("CI", "ci").replace("TZ=UTC", "UTC").replace("TZ=America/Argentina/Buenos_Aires", "BsAs").replace(",", "+")
    return f"{rt} {'.'.join(ver.split('.')[:2])}" + (f" {cond}" if cond else "")
by = collections.defaultdict(dict); cols = []
for r in rows:
    c = short(r["env"]); cols.append(c) if c not in cols else None
    v = ab[r["verdict"]]
    if v == "P": v += f" {r['mutants']}"
    by[r["slug"]][c] = v
groups = {"node": [c for c in cols if c.startswith(("node", "bun"))], "python": [c for c in cols if c.startswith("python") and "TZ" not in c and "UTC" not in c], "python, timezone condition": [c for c in cols if c.startswith("python") and ("TZ" in c or "UTC" in c)], "bash": [c for c in cols if c.startswith("bash")]}
out = ["# Experiments C + E — compatibility matrix (real runs: one local Linux x64 machine + GitHub Actions ubuntu-latest jobs marked ci)", "",
       "P k/n = fail→pass reproduced, k of n mutants of the fix caught · nr = problem not reproduced (before already passes) · FAIL = fix fails · venv = clean venv without system site-packages · UTC = TZ=UTC condition", ""]
for g, cs in groups.items():
    slugs = [s for s in by if any(c in by[s] for c in cs)]
    if not slugs: continue
    out += [f"## {g}", "", "| capsule | " + " | ".join(cs) + " |", "|---|" + "---|" * len(cs)]
    for s in slugs: out.append(f"| {s} | " + " | ".join(by[s].get(c, "") for c in cs) + " |")
    out.append("")
cnt = collections.Counter(r["verdict"] for r in rows)
out.append(f"Totals: {len(rows)} runs — " + ", ".join(f"{k} {v}" for k, v in cnt.most_common()))
open(os.path.join(here, RD + "/C-matrix.md"), "w").write("\n".join(out) + "\n")
print("\n".join(out))
