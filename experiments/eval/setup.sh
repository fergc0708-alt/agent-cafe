#!/usr/bin/env bash
# Creates one fresh workspace per task x arm x repetition under $EVAL_DIR (default /tmp/eval-runs).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${EVAL_DIR:-/tmp/eval-runs}"
reps="${REPS:-2}"
mkdir -p "$out"
for t in "$here"/tasks/*/; do
  name="$(basename "$t")"
  for arm in control cafe; do
    for r in $(seq 1 "$reps"); do
      ws="$out/${name}__${arm}__r$r"
      mkdir -p "$ws"
      cp -r "$t/project/." "$ws/"
      cp "$t/TASK.md" "$ws/TASK.md"
      if [ "$arm" = cafe ]; then cat "$here/CAFE-NOTE.md" >> "$ws/TASK.md"; fi
    done
  done
done
echo "workspaces in $out"
