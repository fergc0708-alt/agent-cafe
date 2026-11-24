#!/bin/bash
# usage: prgit.sh owner/repo PRNUM  -> finds fix commit on default branch
repo=$1; n=$2
d=/home/claude/bench/repos/${repo/\//__}
if [ ! -d $d ]; then git clone -q --filter=blob:none --no-checkout https://github.com/$repo $d 2>&1 | tail -2; fi
cd $d || exit 1
git fetch -q origin "+refs/pull/$n/head:refs/pr/$n" 2>&1 | tail -2
head=$(git rev-parse refs/pr/$n 2>/dev/null)
def=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
echo "PRHEAD $head  DEFAULT $def"
# merge commit containing head
mc=$(git log --merges --format='%H %P' $def 2>/dev/null | awk -v h=$head '$3==h{print $1; exit}')
if [ -n "$mc" ]; then echo "MERGECOMMIT $mc"; fi
if git merge-base --is-ancestor $head $def 2>/dev/null; then echo "HEAD_IN_DEFAULT yes"; fi
sq=$(git log --format='%H' --grep="(#$n)" $def | head -3)
echo "SQUASH_CANDIDATES $sq"
for s in $sq; do git log -1 --format='  %H %P | %s' $s; done
echo "PR COMMITS:"; git log --format='  %H %P | %s' $def..$head 2>/dev/null | head -20
