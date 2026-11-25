#!/usr/bin/env python3
"""Seed collector: public Renovate dependency-update PRs with their CI outcome (GitHub search `status:`).
Stores only structured fields: repo, PR number/url, created/closed/merged dates, datasource, package, from, to,
CI status at collection time. No code, no logs. Source: GitHub search API (public data), via the authenticated gh CLI.
Usage: collect.py packages.txt out.jsonl [since] [until]"""
import json, re, subprocess, sys, time, os
pkgs = [l.split() for l in open(sys.argv[1]) if l.strip() and not l.startswith("#")]
out = sys.argv[2]
since, until = (sys.argv[3] if len(sys.argv) > 3 else "2026-06-01"), (sys.argv[4] if len(sys.argv) > 4 else "2026-11-20")
seen = set()
if os.path.exists(out):
    for l in open(out):
        seen.add(json.loads(l)["url"])
RE = re.compile(r"renovatebot\.com/diffs/(npm|pypi)/([^/)\s]+(?:/[^/)\s]+)?)/([^/)\s]+)/([^/)\s]+)\)")
MC = re.compile(r"developer\.mend\.io/api/mc/badges/confidence/(npm|pypi)/([^)\s]+?)/([^/)\s]+)/([^/?)\s]+)\?")
def search(q, page):
    for attempt in range(6):
        cmd = ["gh", "api", "-X", "GET", "search/issues", "-f", f"q={q}", "-f", "per_page=100", "-f", f"page={page}"]
        env = dict(os.environ)
        if os.environ.get("ANON"):
            env.pop("GH_TOKEN", None); env.pop("GITHUB_TOKEN", None)
            cmd = ["curl", "-s", "-f", "-G", "-H", "Accept: application/vnd.github+json", "--data-urlencode", f"q={q}", "--data-urlencode", "per_page=100", "--data-urlencode", f"page={page}", "https://api.github.com/search/issues"]
        r = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if r.returncode != 0 and os.environ.get("ANON"): r = type("R", (), {"returncode": 1, "stderr": "rate limit", "stdout": ""})()
        if r.returncode == 0:
            return json.loads(r.stdout)
        if "rate limit" in r.stderr.lower() or "403" in r.stderr or "secondary" in r.stderr.lower():
            time.sleep(30 * (attempt + 1)); continue
        if "422" in r.stderr: return {"items": []}
        time.sleep(5)
    return {"items": []}
with open(out, "a") as f:
    for eco, pkg in pkgs:
        for status in ("failure", "success"):
            for page in range(1, int(os.environ.get("PAGES", "5")) + 1):
                q = f'is:pr author:app/renovate status:{status} "update dependency {pkg} to" created:{since}..{until}'
                d = search(q, page); time.sleep(float(os.environ.get("SLEEP", "2.1")))
                items = d.get("items", [])
                for it in items:
                    if it["html_url"] in seen: continue
                    body = it.get("body") or ""
                    rows = [m for m in RE.findall(body) if m[1].replace("%2F", "/") == pkg]
                    mc = [m for m in MC.findall(body) if m[1].replace("%2F", "/").lower() == pkg.lower()]
                    if not rows and mc:
                        rows = [mc[0]]
                    if not rows: continue
                    ds, p, frm, to = rows[0]
                    rec = {"url": it["html_url"], "repo": it["repository_url"].split("repos/")[1], "number": it["number"],
                           "title": it["title"], "ecosystem": ds, "package": pkg, "from": frm, "to": to,
                           "ci": status, "state": it["state"], "merged_at": (it.get("pull_request") or {}).get("merged_at"),
                           "created_at": it["created_at"], "closed_at": it["closed_at"],
                           "mc_badge": bool(mc), "multi_update": len(set(RE.findall(body))) > 1, "security": "[SECURITY]" in it["title"]}
                    seen.add(it["html_url"]); f.write(json.dumps(rec) + "\n"); f.flush()
                print(eco, pkg, status, page, len(items), d.get("total_count"), flush=True)
                if len(items) < 100: break
