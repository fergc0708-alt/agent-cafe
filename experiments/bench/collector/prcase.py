import subprocess, sys, os, re
repo, n = sys.argv[1], sys.argv[2]
maxd = int(sys.argv[3]) if len(sys.argv)>3 else 120
d = "/home/claude/bench/repos/" + repo.replace("/","__")
def g(*a, check=False):
    r = subprocess.run(["git","-C",d]+list(a),capture_output=True,text=True)
    return r.stdout.strip()
if not os.path.isdir(d):
    subprocess.run(["git","clone","-q","--filter=blob:none","--no-checkout","https://github.com/"+repo,d],capture_output=True)
subprocess.run(["git","-C",d,"fetch","-q","origin",f"+refs/pull/{n}/head:refs/pr/{n}"],capture_output=True)
head = g("rev-parse",f"refs/pr/{n}")
dflt = g("symbolic-ref","--short","refs/remotes/origin/HEAD") or "origin/main"
# include all remote branches for search
fix=broken=None; how=None
if g("merge-base","--is-ancestor",head,dflt)=="" and subprocess.run(["git","-C",d,"merge-base","--is-ancestor",head,dflt]).returncode==0:
    prc = g("log","--format=%H",f"{head}","--not",*(g("rev-list","--merges","--max-count=1","--ancestry-path",f"{head}..{dflt}").split() or []))
    # find merge commit
    mc = None
    for line in g("log","--merges","--format=%H %P","--ancestry-path",f"{head}..{dflt}").splitlines()[::-1]:
        p=line.split()
        if head in p[2:]: mc=p[0]; break
    if mc:
        pcs = g("rev-list",f"{mc}^1..{head}").split()
        if len(pcs)==1: fix=head; broken=g("rev-parse",head+"^1"); how="single PR commit (merged via merge commit)"
        else: fix=mc; broken=g("rev-parse",mc+"^1"); how=f"merge commit of {len(pcs)} PR commits"
    else:
        fix=head; broken=g("rev-parse",head+"^1"); how="PR head is on default (rebase/ff)"
else:
    sq = g("log","--format=%H","--grep",f"(#{n})",dflt).split()
    if sq:
        fix=sq[0]; broken=g("rev-parse",fix+"^1"); how="squash commit"
    else:
        how="NOT FOUND on default branch"
print("REPO",repo,"PR",n,"HEAD",head,"DEFAULT",dflt)
print("HOW",how); print("FIX",fix); print("BROKEN",broken)
if fix:
    print(g("log","-1","--format=MSG: %s%n%b",fix)[:700])
    print(g("diff","--stat",broken,fix))
    diff = g("diff","-U1",broken,fix,"--",".",":(exclude).github",":(exclude)*.md",":(exclude)*.yml",":(exclude)*.yaml",":(exclude)*lock*",":(exclude)CHANGES*",":(exclude)*.rst",":(exclude)docs")
    lines = diff.splitlines()
    print("\n".join(lines[:maxd]))
    if len(lines)>maxd: print(f"... ({len(lines)} lines)")
