#!/usr/bin/env python3
"""Stratified seed collector. For each package and ISO week, ONE query per CI status (newest 100 Renovate PRs),
plus the stratum's true total (search total_count). Both statuses are sampled from the same week, so the update
version cannot leak the label, and weights = total/sampled restore the real failure share.
Public data only (GitHub search API). Stored fields: repo, PR url/number, dates, package, from, to, CI status.
Usage: collect2.py packages.txt out.jsonl totals.json START END  (dates YYYY-MM-DD, weekly strata)"""
import json, re, subprocess, sys, time, os, datetime
pkgs = [l.split() for l in open(sys.argv[1]) if l.strip() and not l.startswith("#")]
out, totals_path, start, end = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
anon = bool(os.environ.get("ANON")); sleep = float(os.environ.get("SLEEP", "2.6"))
totals = json.load(open(totals_path)) if os.path.exists(totals_path) else {}
seen = set(json.loads(l)["url"] for l in open(out)) if os.path.exists(out) else set()
RE = re.compile(r"renovatebot\.com/diffs/(npm|pypi)/([^/)\s]+(?:/[^/)\s]+)?)/([^/)\s]+)/([^/)\s]+)\)")
MC = re.compile(r"developer\.mend\.io/api/mc/badges/confidence/(npm|pypi)/([^)\s]+?)/([^/)\s]+)/([^/?)\s]+)\?")
def search(q):
    for attempt in range(8):
        if anon:
            r = subprocess.run(["curl", "-s", "-G", "-H", "Accept: application/vnd.github+json", "--data-urlencode", f"q={q}", "--data-urlencode", "per_page=100", "--data-urlencode", "sort=created", "--data-urlencode", "order=desc", "https://api.github.com/search/issues"], capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_TOKEN")})
            try:
                d = json.loads(r.stdout)
                if "items" in d: return d
            except Exception: pass
        else:
            r = subprocess.run(["gh", "api", "-X", "GET", "search/issues", "-f", f"q={q}", "-f", "per_page=100", "-f", "sort=created", "-f", "order=desc"], capture_output=True, text=True)
            if r.returncode == 0: return json.loads(r.stdout)
            if "422" in r.stderr: return {"items": [], "total_count": 0}
        time.sleep(20 * (attempt + 1))
    return None
d0 = datetime.date.fromisoformat(start); d1 = datetime.date.fromisoformat(end)
weeks = []
while d0 < d1:
    weeks.append((d0, min(d0 + datetime.timedelta(days=6), d1))); d0 += datetime.timedelta(days=7)
with open(out, "a") as f:
    for eco, pkg in pkgs:
        for a, b in weeks:
            for status in ("failure", "success"):
                key = f"{pkg}|{a}|{status}"
                if key in totals: continue
                q = f'is:pr author:app/renovate status:{status} "update dependency {pkg} to" created:{a}..{b}'
                d = search(q); time.sleep(sleep)
                if d is None: print("GAVE UP", key, flush=True); continue
                n = 0
                for it in d.get("items", []):
                    if it["html_url"] in seen: continue
                    body = it.get("body") or ""
                    rows = [m for m in RE.findall(body) if m[1].replace("%2F", "/").lower() == pkg.lower()] or [m for m in MC.findall(body) if m[1].replace("%2F", "/").lower() == pkg.lower()]
                    if not rows: continue
                    ds, p, frm, to = rows[0]
                    rec = {"url": it["html_url"], "repo": it["repository_url"].split("repos/")[1], "number": it["number"], "title": it["title"], "ecosystem": ds, "package": pkg, "from": frm, "to": to, "ci": status, "state": it["state"], "merged_at": (it.get("pull_request") or {}).get("merged_at"), "created_at": it["created_at"], "closed_at": it["closed_at"], "mc_badge": bool(MC.search(body)), "multi_update": len(set(RE.findall(body))) > 1 or len(set(MC.findall(body))) > 1, "security": "[SECURITY]" in it["title"], "stratum": key}
                    seen.add(it["html_url"]); f.write(json.dumps(rec) + "\n"); f.flush(); n += 1
                totals[key] = {"total": d.get("total_count", 0), "returned": len(d.get("items", [])), "kept": n}
                json.dump(totals, open(totals_path, "w"))
                print(key, totals[key], flush=True)
