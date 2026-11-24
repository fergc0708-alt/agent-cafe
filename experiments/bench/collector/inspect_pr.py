import json, subprocess, sys
def api(path):
    out = subprocess.run(["curl","-s","-H","Accept: application/vnd.github+json","https://api.github.com/"+path],capture_output=True,text=True,env={k:v for k,v in __import__('os').environ.items() if k not in('GH_TOKEN','GITHUB_TOKEN')}).stdout
    return json.loads(out)
repo, num = sys.argv[1], sys.argv[2]
maxpatch = int(sys.argv[3]) if len(sys.argv)>3 else 2500
kind = "pulls"
p = api(f"repos/{repo}/pulls/{num}")
if p.get("message"):
    # maybe issue
    i = api(f"repos/{repo}/issues/{num}")
    print("ISSUE", i.get("title"), i.get("state")); print((i.get("body") or "")[:1500]); sys.exit()
print("TITLE:", p["title"]); print("MERGED:", p.get("merged"), "merge_sha:", p.get("merge_commit_sha"), "base:", p["base"]["ref"])
print("BODY:", (p.get("body") or "")[:1200].replace("\r",""))
cs = api(f"repos/{repo}/pulls/{num}/commits")
print("COMMITS:", [(c["sha"], [x["sha"][:10] for x in c["parents"]], c["commit"]["message"].splitlines()[0][:70]) for c in cs])
if p.get("merged"):
    m = api(f"repos/{repo}/commits/{p['merge_commit_sha']}")
    print("MERGE_COMMIT parents:", [x["sha"] for x in m.get("parents",[])], "|", m.get("commit",{}).get("message","").splitlines()[0][:80] if m.get("commit") else m.get("message"))
fs = api(f"repos/{repo}/pulls/{num}/files?per_page=100")
for f in fs:
    print(f"FILE {f['filename']} +{f['additions']} -{f['deletions']}")
for f in fs:
    if any(s in f['filename'] for s in ['.github/','tox.ini','.yml','.yaml','lock','CHANGELOG','CHANGES','.md','.rst','.txt']) and not f['filename'].endswith('requirements.txt'):
        continue
    print("=== ", f['filename']); print((f.get('patch') or '')[:maxpatch])
