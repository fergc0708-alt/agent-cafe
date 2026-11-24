import json,glob,sys
repo,n=sys.argv[1],int(sys.argv[2])
for f in sorted(glob.glob('/home/claude/bench/raw/*.json')):
    d=json.load(open(f))
    for i in d.get('items',[]):
        if i.get('number')==n and i['repository_url'].endswith('/'+repo):
            print(f.split('/')[-1], i['html_url'], i['created_at'][:10]); print((i.get('body') or '')[:int(sys.argv[3]) if len(sys.argv)>3 else 700]); sys.exit()
