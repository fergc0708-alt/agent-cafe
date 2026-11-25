#!/usr/bin/env python3
"""Fetches the two existing public risk indicators for every (ecosystem, package, from, to) in the dataset:
 - Mend Merge Confidence: public badge (a PNG inside an SVG); the few distinct images are identified by hash and
   were labeled by looking at them (see LABELS). Unknown images are saved for manual labeling.
 - Dependabot compatibility score: public badge, the SVG <title> carries the percentage ("unknown" if none).
Caveat: both are read NOW, so they include information collected after the PR was opened (an advantage for them).
Usage: indicators.py prs.jsonl [...] -- out.json"""
import hashlib, json, re, subprocess, sys, time, concurrent.futures as cf, os, base64
args = sys.argv[1:]; sep = args.index("--"); files, out = args[:sep], args[sep + 1]
LABELS = {"6aaa5d26d2": "low", "a31f2503d3": "high", "cead4a22f9": "neutral"}
res = json.load(open(out)) if os.path.exists(out) else {}
todo = set()
for f in files:
    for l in open(f):
        r = json.loads(l); k = f'{r["ecosystem"]}|{r["package"]}|{r["from"]}|{r["to"]}'
        if k not in res: todo.add(k)
def get(url):
    for a in range(3):
        p = subprocess.run(["curl", "-s", "-m", "20", url], capture_output=True)
        if p.returncode == 0 and p.stdout: return p.stdout
        time.sleep(2)
    return b""
def one(k):
    eco, pkg, frm, to = k.split("|")
    svg = get(f"https://developer.mend.io/api/mc/badges/confidence/{eco}/{pkg.replace('/', '%2F')}/{frm}/{to}?slim=true")
    h = hashlib.sha1(svg).hexdigest()[:10]
    mend = LABELS.get(h)
    if svg and not mend:
        m = re.search(rb'base64,([^"]+)', svg)
        if m: open(f"/tmp/mc/unknown-{h}.png", "wb").write(base64.b64decode(m.group(1)))
        mend = f"unknown:{h}"
    pm = "npm_and_yarn" if eco == "npm" else "pip"
    d = get(f"https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name={pkg}&package-manager={pm}&previous-version={frm}&new-version={to}")
    t = re.search(rb"<title>compatibility: ([^<]+)</title>", d)
    dep = None
    if t and t.group(1).endswith(b"%"): dep = int(t.group(1)[:-1])
    return k, {"mend": mend, "dependabot": dep, "dependabot_raw": t.group(1).decode() if t else None}
os.makedirs("/tmp/mc", exist_ok=True)
with cf.ThreadPoolExecutor(6) as ex:
    for i, (k, v) in enumerate(ex.map(one, sorted(todo))):
        res[k] = v
        if i % 100 == 0: json.dump(res, open(out, "w")); print(i, len(todo), flush=True)
json.dump(res, open(out, "w"), indent=0)
from collections import Counter
print(Counter(v["mend"] for v in res.values()), Counter(v["dependabot"] is not None for v in res.values()))
