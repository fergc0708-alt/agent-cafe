#!/usr/bin/env bash
# Behavioral check: print.sh must echo each line of paths.txt verbatim
# (backslashes kept, leading/trailing whitespace kept).
set -u
fail=0
here="$(pwd)"

# 1) Run against the shipped paths.txt.
expected=$'C:\\Users\\fer\n  indented line'
actual="$(bash "$here/print.sh")"
if [ "$actual" != "$expected" ]; then
  echo "FAIL: shipped input mangled"
  printf 'expected: %q\nactual:   %q\n' "$expected" "$actual"
  fail=1
fi

# 2) Run against our own input in a temp dir (print.sh reads ./paths.txt).
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$here/print.sh" "$tmp/print.sh"
printf '%s\n' 'C:\Users\fer\new\table' '    four spaces' $'\ttabbed\\n' 'trailing   ' 'a\\b' > "$tmp/paths.txt"
want="$(cat "$tmp/paths.txt")"
got="$(cd "$tmp" && bash ./print.sh)"
if [ "$got" != "$want" ]; then
  echo "FAIL: custom input mangled"
  printf 'expected: %q\nactual:   %q\n' "$want" "$got"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "OK"
exit "$fail"
