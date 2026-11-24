"""Summarize results.json with the manual relevance review (RELEVANCE.json): a raw hit near the ground truth only
counts if its message is about the break the fix addressed. Writes summary.json and prints a markdown table."""
import json
cases = {c["id"]: c for c in json.load(open("cases.json"))}
r = json.load(open("results.json"))
rel = json.load(open("RELEVANCE.json"))
tools = ["cafe", "mypy", "pyright", "pylint", "ruff", "vermin", "tsc+@types/node", "eslint-plugin-n"]
S = {t: {"cases": 0, "tp": 0, "tp_visible": 0, "extra": 0, "residual": 0, "ran": 0} for t in tools}
detected_by = {}
for cid, x in r.items():
    for t in tools:
        if t not in x["tools"] and t != "cafe":
            continue
        S[t]["cases"] += 1
        v = x["tools"].get(t, {})
        if "detected" not in v:
            continue
        S[t]["ran"] += 1
        ok = v["detected"] and rel.get(f"{cid}|{t}", True)
        if ok:
            S[t]["tp"] += 1
            S[t]["tp_visible"] += bool(x["statically_visible"])
            detected_by.setdefault(cid, []).append(t)
        S[t]["extra"] += v["extra_broken"] + (len(v["near_gt"]) if v["detected"] and not ok else 0)
        S[t]["residual"] += len(v["residual_fixed_touched"])
for cid in rel.get("_lenient_cafe", []):
    detected_by.setdefault(cid, []).append("cafe (environment-dependent flag)")
free = {"mypy", "pyright", "pylint", "ruff", "vermin", "tsc+@types/node", "eslint-plugin-n"}
n_py = sum(1 for c in cases.values() if c["runtime"] == "python"); n_js = len(cases) - n_py
vis = sum(1 for c in cases.values() if c["statically_visible"])
out = {
    "cases": len(cases), "python": n_py, "node": n_js, "statically_visible": vis,
    "per_tool": S,
    "detected_by": detected_by,
    "any_free_tool": sorted(c for c, ts in detected_by.items() if set(ts) & free),
    "cafe_strict": sorted(c for c, ts in detected_by.items() if "cafe" in ts),
    "cafe_only": sorted(c for c, ts in detected_by.items() if any(t.startswith("cafe") for t in ts) and not set(ts) & free),
    "nobody": sorted(c for c in cases if c not in detected_by),
}
json.dump(out, open("summary.json", "w"), indent=1)
print("| tool | runtime | cases | ran | detected (relevant) | of them statically visible | other findings in touched files (broken) | findings left in the fixed files |")
print("|---|---|---|---|---|---|---|---|")
for t in tools:
    s = S[t]
    rt = "both" if t == "cafe" else ("node" if t in ("tsc+@types/node", "eslint-plugin-n") else "python")
    print(f"| {t} | {rt} | {s['cases']} | {s['ran']} | **{s['tp']}** | {s['tp_visible']} | {s['extra']} | {s['residual']} |")
print()
for k in ("any_free_tool", "cafe_strict", "cafe_only", "nobody"):
    print(k, len(out[k]), out[k])
