# Experiments v2 — Replayable Fix Capsules

All runs are real executions; nothing here is simulated. Two result sets are kept:

| folder | code | isolation | notes |
|---|---|---|---|
| `results/` | commit `8c9b749` (before the red-team audit) | `unshare -rn` (network only) | first run; kept unchanged |
| `results-run2/` | commit `82ba7b6` (after red-team fixes) | bubblewrap sandbox, locally and in CI | runner keys registered with proof of possession; evidence split into verified/claimed |

Both runs produced the **same verdicts** for every capsule × environment (184 runs each). Mutation counts are lower in run 2 because the "empty file" mutant was dropped.

| script | experiment | output |
|---|---|---|
| `run-acd.ts` | A (search → fetch → replay), C (local matrix, signed), D (registry evidence) | `A-search-replay.json`, `C-matrix.json`, `C-attestations.jsonl`, `D-evidence.json` |
| `run-b.ts` | B (adversarial capsules) | `B-adversarial.json` |
| `run-e.ts` | E (blind independent checks in `indep-checks/`) | `E-independent-checks.json` |
| `ci-replay.ts` + `.github/workflows/replay-matrix.yml` | E (GitHub Actions runners) | `ci/*.jsonl`, `ci/*.pubkey.json` |
| `run-e-ci.ts` | E (offline signature verification + merge) | `E-ci-merged.json` |
| `summarize.py` | C/E table | `C-matrix.md` |
| `F-preregistration.md`, `grade-f.ts` | F (utility pilot) | `F-results.json` |

Run: `RESULTS_DIR=results-run2 node experiments/v2/run-acd.ts` (Linux with bubblewrap, `/opt/node22`, `/opt/node24`, `/usr/bin/python3.11-3.13`, clean venvs in `/tmp/venv-3.x`; paths are set at the top of each script).
