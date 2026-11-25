#!/usr/bin/env bash
# Runs one case in one mode as a throwaway, unprivileged user. Executed by the runner user (trusted), before and
# after the untrusted code. See bench/PROTOCOL.md, "Execution environment".
#   bash bench/sandbox.sh <mode> <case-id>
set -uo pipefail
MODE="$1"; ID="$2"
ROOT="$PWD"; OUT="$ROOT/bench-out"; mkdir -p "$OUT"
note() { echo "$*" | tee -a "$OUT/sandbox.txt"; }
node bench/extract-case.mjs "$ID" > /tmp/case.json || { note "case not found"; exit 0; }
PROJ_NODE_BIN="$(dirname "$(command -v node)")"
HN=/usr/local/bin/node; [ -x "$HN" ] || HN="$(command -v node)"
note "project node: $("$PROJ_NODE_BIN/node" -v 2>&1) ($PROJ_NODE_BIN); harness node: $("$HN" -v)"
note "runner image: ${ImageOS:-?} ${ImageVersion:-?}; runner environment: ${RUNNER_ENVIRONMENT:-?}"
[ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ] || { note "REFUSED: not a GitHub-hosted runner"; exit 1; }

# --- isolation (as runner, with sudo) ---
sudo iptables -I OUTPUT -d 169.254.169.254 -j REJECT && note "blocked instance metadata (169.254.169.254)" || note "WARN: could not block instance metadata"
sudo chmod 700 /home/runner && note "/home/runner is 700"
sudo useradd -m -s /bin/bash sbx || { note "REFUSED: could not create sandbox user"; exit 1; }
id sbx | grep -qvE '\b(sudo|docker|adm)\b' && note "sandbox user: $(id sbx)" || { note "REFUSED: sandbox user is privileged"; exit 1; }
sudo install -d -o sbx -g sbx -m 700 /home/sbx/out
sudo install -o sbx -g sbx -m 600 /tmp/case.json /home/sbx/case.json
sudo install -o sbx -g sbx -m 600 bench/case.mjs /home/sbx/case.mjs
if [ "$MODE" = "signal" ]; then sudo cp -r dist /home/sbx/signal-dist && sudo chown -R sbx:sbx /home/sbx/signal-dist; note "signal dist sha256: $(cd dist && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)"; fi
SBX_ENV=(HOME=/home/sbx USER=sbx LOGNAME=sbx SHELL=/bin/bash PATH="$PROJ_NODE_BIN:/usr/local/bin:/usr/bin:/bin" LANG=C.UTF-8 TZ=UTC CI=true)
sudo -u sbx -H env -i "${SBX_ENV[@]}" bash -c 'env | cut -d= -f1 | sort | tr "\n" " "' > "$OUT/sbx-env-names.txt"
sudo -u sbx -H env -i "${SBX_ENV[@]}" bash -c 'sudo -n true 2>/dev/null && echo SUDO-AVAILABLE || echo no-sudo' >> "$OUT/sandbox.txt"

# --- untrusted phase ---
START=$(date +%s)
sudo -u sbx -H env -i "${SBX_ENV[@]}" timeout -k 30 55m "$HN" /home/sbx/case.mjs "$MODE" /home/sbx/case.json /home/sbx/out /home/sbx/signal-dist
note "harness exit: $? after $(( $(date +%s) - START ))s"

# --- teardown: nothing of the sandbox user survives ---
sudo pkill -KILL -u sbx; sleep 2; sudo pkill -KILL -u sbx
LEFT=$(pgrep -u sbx | wc -l); note "sandbox processes left after kill: $LEFT"
sudo find /home/sbx/out -type l -delete
sudo cp -r /home/sbx/out/. "$OUT/" && sudo chown -R "$(id -u):$(id -g)" "$OUT"
for f in "$OUT"/*.log; do [ -f "$f" ] && [ "$(stat -c %s "$f")" -gt 1048576 ] && { tail -c 1048576 "$f" > "$f.t" && mv "$f.t" "$f"; }; done
sudo userdel -r sbx 2>/dev/null; note "sandbox user removed"
[ -f "$OUT/result.json" ] && note "result sha256: $(sha256sum "$OUT/result.json" | cut -c1-64)"
exit 0
