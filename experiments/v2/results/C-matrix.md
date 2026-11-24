# Experiments C + E — compatibility matrix (real runs: one local Linux x64 machine + GitHub Actions ubuntu-latest jobs marked ci)

P k/n = fail→pass reproduced, k of n mutants of the fix caught · nr = problem not reproduced (before already passes) · FAIL = fix fails · venv = clean venv without system site-packages · UTC = TZ=UTC condition

## node

| capsule | node 22.23 | node 24.22 | bun 1.4 | node 20.10 ci | node 20.18 ci | node 22.11 ci | node 22.23 ci |
|---|---|---|---|---|---|---|---|
| node-require-esm | nr | nr | nr | P 2/2 | P 2/2 | P 2/2 | nr |
| node-esm-dirname | P 2/2 | P 2/2 | nr | FAIL | P 2/2 | P 2/2 | P 2/2 |
| node-ts-parameter-properties | P 7/9 | P 7/9 | nr | FAIL | FAIL | FAIL | P 7/9 |
| node-ts-import-extension | P 3/3 | P 3/3 | nr | FAIL | FAIL | FAIL | P 3/3 |
| node-import-assert-to-with | P 3/3 | P 3/3 | nr | nr | nr | P 3/3 | P 3/3 |
| node-json-import-assert-OLD | FAIL | FAIL | nr | P 3/3 | P 3/3 | FAIL | FAIL |
| node-json-import-with | P 3/3 | P 3/3 | nr | P 3/3 | P 3/3 | P 3/3 | P 3/3 |
| node-cjs-top-level-await | P 4/4 | P 4/4 | nr | P 4/4 | P 4/4 | P 4/4 | P 4/4 |
| node-structuredclone-dates | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 |
| node-sort-mutates | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 |
| node-money-cents | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 |
| node-bigint-json | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 |

## python

| capsule | python 3.11 | python 3.12 | python 3.13 | python 3.11 venv | python 3.12 venv | python 3.13 venv | python 3.11 BsAs | python 3.12 BsAs | python 3.13 BsAs | python 3.11 venv+BsAs | python 3.12 venv+BsAs | python 3.13 venv+BsAs | python 3.10 ci | python 3.10 BsAs+ci | python 3.12 ci | python 3.12 BsAs+ci | python 3.13 ci | python 3.13 BsAs+ci |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| py-fromisoformat-z | nr | nr | nr | nr | nr | nr |  |  |  |  |  |  | P 6/6 |  | nr |  | nr |  |
| py-utcnow-deprecated | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 |  |  |  |  |  |  | P 4/4 |  | P 4/4 |  | P 4/4 |  |
| py-distutils-removed | nr | nr | nr | nr | P 5/5 | P 5/5 |  |  |  |  |  |  | nr |  | P 5/5 |  | P 5/5 |  |
| py-csv-utf8-bom | P 5/5 | P 5/5 | P 5/5 | P 5/5 | P 5/5 | P 5/5 |  |  |  |  |  |  | P 5/5 |  | P 5/5 |  | P 5/5 |  |
| py-mutable-default | P 6/6 | P 6/6 | P 6/6 | P 6/6 | P 6/6 | P 6/6 |  |  |  |  |  |  | P 6/6 |  | P 6/6 |  | P 6/6 |  |
| py-lstrip-is-not-removeprefix | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 |  |  |  |  |  |  | P 3/3 |  | P 3/3 |  | P 3/3 |  |
| py-sqlite-injection | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 |  |  |  |  |  |  | P 3/3 |  | P 3/3 |  | P 3/3 |  |
| py-fromtimestamp-local-tz |  |  |  |  |  |  | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 |  | P 4/4 |  | P 4/4 |  | P 4/4 |
| py-imghdr-OLD | P 4/4 | P 4/4 | FAIL | P 4/4 | P 4/4 | FAIL |  |  |  |  |  |  | P 4/4 |  | P 4/4 |  | FAIL |  |
| py-png-magic-bytes | P 5/5 | P 5/5 | P 5/5 | P 5/5 | P 5/5 | P 5/5 |  |  |  |  |  |  | P 5/5 |  | P 5/5 |  | P 5/5 |  |

## python, timezone condition

| capsule | python 3.11 UTC | python 3.12 UTC | python 3.13 UTC | python 3.11 venv+UTC | python 3.12 venv+UTC | python 3.13 venv+UTC |
|---|---|---|---|---|---|---|
| py-fromtimestamp-local-tz | nr | nr | nr | nr | nr | nr |

## bash

| capsule | bash 5.2 | bash 5.3 ci |
|---|---|---|
| bash-pipefail | P 3/4 | P 3/4 |
| bash-read-raw | P 4/4 | P 4/4 |

Totals: 184 runs — PASS 138, PROBLEM_NOT_REPRODUCED 32, FIX_FAILS 14
