# Experiments C + E — compatibility matrix (real runs: one local Linux x64 machine + GitHub Actions ubuntu-latest jobs marked ci)

P k/n = fail→pass reproduced, k of n mutants of the fix caught · nr = problem not reproduced (before already passes) · FAIL = fix fails · venv = clean venv without system site-packages · UTC = TZ=UTC condition

## node

| capsule | node 22.23 | node 24.22 | bun 1.4 | node 20.10 ci | node 20.18 ci | node 22.11 ci | node 22.23 ci |
|---|---|---|---|---|---|---|---|
| node-require-esm | nr | nr | nr | P 1/1 | P 1/1 | P 1/1 | nr |
| node-esm-dirname | P 1/1 | P 1/1 | nr | FAIL | P 1/1 | P 1/1 | P 1/1 |
| node-ts-parameter-properties | P 6/8 | P 6/8 | nr | FAIL | FAIL | FAIL | P 6/8 |
| node-ts-import-extension | P 2/2 | P 2/2 | nr | FAIL | FAIL | FAIL | P 2/2 |
| node-import-assert-to-with | P 2/2 | P 2/2 | nr | nr | nr | P 2/2 | P 2/2 |
| node-json-import-assert-OLD | FAIL | FAIL | nr | P 2/2 | P 2/2 | FAIL | FAIL |
| node-json-import-with | P 2/2 | P 2/2 | nr | P 2/2 | P 2/2 | P 2/2 | P 2/2 |
| node-cjs-top-level-await | P 3/3 | P 3/3 | nr | P 3/3 | P 3/3 | P 3/3 | P 3/3 |
| node-structuredclone-dates | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 |
| node-sort-mutates | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 |
| node-money-cents | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 |
| node-bigint-json | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 | P 1/1 |

## python

| capsule | python 3.11 | python 3.12 | python 3.13 | python 3.11 venv | python 3.12 venv | python 3.13 venv | python 3.11 BsAs | python 3.12 BsAs | python 3.13 BsAs | python 3.11 venv+BsAs | python 3.12 venv+BsAs | python 3.13 venv+BsAs | python 3.10 ci | python 3.10 BsAs+ci | python 3.12 ci | python 3.12 BsAs+ci | python 3.13 ci | python 3.13 BsAs+ci |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| py-fromisoformat-z | nr | nr | nr | nr | nr | nr |  |  |  |  |  |  | P 5/5 |  | nr |  | nr |  |
| py-utcnow-deprecated | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 |  |  |  |  |  |  | P 3/3 |  | P 3/3 |  | P 3/3 |  |
| py-distutils-removed | nr | nr | nr | nr | P 4/4 | P 4/4 |  |  |  |  |  |  | nr |  | P 4/4 |  | P 4/4 |  |
| py-csv-utf8-bom | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 |  |  |  |  |  |  | P 4/4 |  | P 4/4 |  | P 4/4 |  |
| py-mutable-default | P 5/5 | P 5/5 | P 5/5 | P 5/5 | P 5/5 | P 5/5 |  |  |  |  |  |  | P 5/5 |  | P 5/5 |  | P 5/5 |  |
| py-lstrip-is-not-removeprefix | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 |  |  |  |  |  |  | P 2/2 |  | P 2/2 |  | P 2/2 |  |
| py-sqlite-injection | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 | P 2/2 |  |  |  |  |  |  | P 2/2 |  | P 2/2 |  | P 2/2 |  |
| py-fromtimestamp-local-tz |  |  |  |  |  |  | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 | P 3/3 |  | P 3/3 |  | P 3/3 |  | P 3/3 |
| py-imghdr-OLD | P 3/3 | P 3/3 | FAIL | P 3/3 | P 3/3 | FAIL |  |  |  |  |  |  | P 3/3 |  | P 3/3 |  | FAIL |  |
| py-png-magic-bytes | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 | P 4/4 |  |  |  |  |  |  | P 4/4 |  | P 4/4 |  | P 4/4 |  |

## python, timezone condition

| capsule | python 3.11 UTC | python 3.12 UTC | python 3.13 UTC | python 3.11 venv+UTC | python 3.12 venv+UTC | python 3.13 venv+UTC |
|---|---|---|---|---|---|---|
| py-fromtimestamp-local-tz | nr | nr | nr | nr | nr | nr |

## bash

| capsule | bash 5.2 | bash 5.3 ci |
|---|---|---|
| bash-pipefail | P 2/3 | P 2/3 |
| bash-read-raw | P 3/3 | P 3/3 |

Totals: 184 runs — PASS 138, PROBLEM_NOT_REPRODUCED 32, FIX_FAILS 14
