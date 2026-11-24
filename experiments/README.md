# GOAT experiments (branch `goat/experiments`, not deployed)

| Id | Question | Run | Result file |
|---|---|---|---|
| E1 | DB round trips per request | `node experiments/e1-query-count.ts` | stdout |
| E1b | Plain vs buffered store (visits + read rate limit in memory) | `node experiments/e1b-buffered.ts` | stdout |
| E2 | Validation rules vs correlated errors and sybils (synthetic) | `python3 -I experiments/e2_validation_sim.py` | `e2_results.json` |
| E4 | Proof-carrying entries: executable checks | `node experiments/e4-proof-carrying.ts` | `e4_results.json` |

E2 is a simulation with assumed parameters; read it as a stress test of the rules, not as a measurement.
