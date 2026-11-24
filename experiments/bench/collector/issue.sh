#!/bin/bash
# issue.sh owner/repo number "keywords"
r=$1; n=$2; k=$3
env -u GH_TOKEN curl -s -G -H "Accept: application/vnd.github+json" --data-urlencode "q=repo:$r is:issue $k" --data-urlencode "per_page=100" "https://api.github.com/search/issues" > /home/claude/bench/raw/issue_${r/\//__}_$n.json
python3 -I - "$n" /home/claude/bench/raw/issue_${r/\//__}_$n.json <<'PY'
import json,sys
n=int(sys.argv[1]); d=json.load(open(sys.argv[2]))
for i in d.get('items',[]):
    if i['number']==n: print(i['html_url'], '|', i['title']); print((i.get('body') or '')[:1500]); break
else: print('NOT FOUND among', len(d.get('items',[])), d.get('message',''))
PY
