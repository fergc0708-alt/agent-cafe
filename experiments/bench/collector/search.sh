#!/bin/bash
# usage: search.sh name "query"
name=$1; q=$2
env -u GH_TOKEN curl -s -G -H "Accept: application/vnd.github+json" --data-urlencode "q=$q" --data-urlencode "per_page=40" "https://api.github.com/search/issues" > /home/claude/bench/raw/$name.json
python3 -I -c "
import json,sys;d=json.load(open('/home/claude/bench/raw/$name.json'));print('TOTAL',d.get('total_count'),d.get('message',''))
for n,i in enumerate(d.get('items',[])):
  r=i['repository_url'].split('repos/')[1]
  print(n, r, i['number'], 'PR' if 'pull_request' in i else 'IS', i['state'], i['title'][:90])
"
