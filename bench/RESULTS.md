# Signal real-PR benchmark: results (with deviation 2, Node-version check)

Cases: 250. Decision (pre-registered rule): **PIVOT**.

- NOT met: ≥20 confirmed regressions and false-exoneration upper bound ≤ 10% (n=8, upper 31.2%)
- met: ≥20 confirmed non-regressions and false-accusation upper bound ≤ 15% (n=99, upper 3.0%)
- NOT met: coverage ≥ 50% (39.3%)
- met: red baseline: ≥10 determinate cases, agreement lower bound ≥ 60%, no false exoneration (n=14, lower 76.8%)
- met: not more false exonerations than lastgreen on the shared npm cases (Signal 0.0%, lastgreen 60.0%)

## Reference truth classes

| class | cases |
|---|---|
| COMPATIBLE | 87 |
| INDET_RED_NO_TESTS | 50 |
| INDET_NODE_MISMATCH | 28 |
| INDET_BASE_INSTALL | 26 |
| INSTALL_REG | 18 |
| PRE_EXISTING | 12 |
| INDET_TIMEOUT | 8 |
| REG_GREEN | 6 |
| INDET_ENV_MISMATCH | 4 |
| INDET_FLAKY_NEW | 3 |
| INDET_OTHER | 3 |
| REG_ON_RED | 2 |
| INDET_FLAKY | 2 |
| INDET_MISSING | 1 |

Positives: REG_GREEN, REG_ON_RED, REG_FLAKY_BASE. Negatives: COMPATIBLE, PRE_EXISTING, FIXED, FLAKY_NOT_UPDATE. INDET_*: no reliable reference, counted neither way.

## Segments

Intervals: Clopper–Pearson exact 95%; "upper 95%" is the one-sided bound.

### all (250 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 107 (8 pos / 99 neg) | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 0/99 = 0.0% [0.0%–3.7%]; upper 95% 3.0% | 1/8 = 12.5% [0.3%–52.7%]; upper 95% 47.1% | 42/107 = 39.3% [30.0%–49.2%]; upper 95% 47.6% |
| lastgreen | 107 (8 pos / 99 neg) | 3/8 = 37.5% [8.5%–75.5%]; upper 95% 71.1% | 0/99 = 0.0% [0.0%–3.7%]; upper 95% 3.0% | 3/8 = 37.5% [8.5%–75.5%]; upper 95% 71.1% | 62/107 = 57.9% [48.0%–67.4%]; upper 95% 66.0% |
| naive_always | 107 (8 pos / 99 neg) | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 75/99 = 75.8% [66.1%–83.8%]; upper 95% 82.7% | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 107/107 = 100.0% [96.6%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 107 (8 pos / 99 neg) | 4/8 = 50.0% [15.7%–84.3%]; upper 95% 80.7% | 33/99 = 33.3% [24.2%–43.5%]; upper 95% 41.9% | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 107/107 = 100.0% [96.6%–100.0%]; upper 95% 100.0% |

### baseline green (123 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 93 (6 pos / 87 neg) | 0/6 = 0.0% [0.0%–45.9%]; upper 95% 39.3% | 0/87 = 0.0% [0.0%–4.2%]; upper 95% 3.4% | 1/6 = 16.7% [0.4%–64.1%]; upper 95% 58.2% | 28/93 = 30.1% [21.0%–40.5%]; upper 95% 38.9% |
| lastgreen | 93 (6 pos / 87 neg) | 1/6 = 16.7% [0.4%–64.1%]; upper 95% 58.2% | 0/87 = 0.0% [0.0%–4.2%]; upper 95% 3.4% | 3/6 = 50.0% [11.8%–88.2%]; upper 95% 84.7% | 54/93 = 58.1% [47.4%–68.2%]; upper 95% 66.7% |
| naive_always | 93 (6 pos / 87 neg) | 0/6 = 0.0% [0.0%–45.9%]; upper 95% 39.3% | 64/87 = 73.6% [63.0%–82.4%]; upper 95% 81.2% | 0/6 = 0.0% [0.0%–45.9%]; upper 95% 39.3% | 93/93 = 100.0% [96.1%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 93 (6 pos / 87 neg) | 2/6 = 33.3% [4.3%–77.7%]; upper 95% 72.9% | 33/87 = 37.9% [27.7%–49.0%]; upper 95% 47.3% | 0/6 = 0.0% [0.0%–45.9%]; upper 95% 39.3% | 93/93 = 100.0% [96.1%–100.0%]; upper 95% 100.0% |

### baseline red (84 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 14 (2 pos / 12 neg) | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 0/12 = 0.0% [0.0%–26.5%]; upper 95% 22.1% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 14/14 = 100.0% [76.8%–100.0%]; upper 95% 100.0% |
| lastgreen | 14 (2 pos / 12 neg) | 2/2 = 100.0% [15.8%–100.0%]; upper 95% 100.0% | 0/12 = 0.0% [0.0%–26.5%]; upper 95% 22.1% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 8/14 = 57.1% [28.9%–82.3%]; upper 95% 79.4% |
| naive_always | 14 (2 pos / 12 neg) | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 11/12 = 91.7% [61.5%–99.8%]; upper 95% 99.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 14/14 = 100.0% [76.8%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 14 (2 pos / 12 neg) | 2/2 = 100.0% [15.8%–100.0%]; upper 95% 100.0% | 0/12 = 0.0% [0.0%–26.5%]; upper 95% 22.1% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 14/14 = 100.0% [76.8%–100.0%]; upper 95% 100.0% |

### baseline red, CI agrees (not green) (54 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 14 (2 pos / 12 neg) | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 0/12 = 0.0% [0.0%–26.5%]; upper 95% 22.1% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 14/14 = 100.0% [76.8%–100.0%]; upper 95% 100.0% |
| lastgreen | 14 (2 pos / 12 neg) | 2/2 = 100.0% [15.8%–100.0%]; upper 95% 100.0% | 0/12 = 0.0% [0.0%–26.5%]; upper 95% 22.1% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 8/14 = 57.1% [28.9%–82.3%]; upper 95% 79.4% |
| naive_always | 14 (2 pos / 12 neg) | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 11/12 = 91.7% [61.5%–99.8%]; upper 95% 99.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 14/14 = 100.0% [76.8%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 14 (2 pos / 12 neg) | 2/2 = 100.0% [15.8%–100.0%]; upper 95% 100.0% | 0/12 = 0.0% [0.0%–26.5%]; upper 95% 22.1% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 14/14 = 100.0% [76.8%–100.0%]; upper 95% 100.0% |

### baseline flaky (3 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 0 (0 pos / 0 neg) | — (n=0) | — (n=0) | — (n=0) | — (n=0) |
| lastgreen | 0 (0 pos / 0 neg) | — (n=0) | — (n=0) | — (n=0) | — (n=0) |
| naive_always | 0 (0 pos / 0 neg) | — (n=0) | — (n=0) | — (n=0) | — (n=0) |
| naive_base_ci | 0 (0 pos / 0 neg) | — (n=0) | — (n=0) | — (n=0) | — (n=0) |

### stratum CI red (200 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 83 (8 pos / 75 neg) | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 0/75 = 0.0% [0.0%–4.8%]; upper 95% 3.9% | 1/8 = 12.5% [0.3%–52.7%]; upper 95% 47.1% | 18/83 = 21.7% [13.4%–32.1%]; upper 95% 30.4% |
| lastgreen | 83 (8 pos / 75 neg) | 3/8 = 37.5% [8.5%–75.5%]; upper 95% 71.1% | 0/75 = 0.0% [0.0%–4.8%]; upper 95% 3.9% | 3/8 = 37.5% [8.5%–75.5%]; upper 95% 71.1% | 45/83 = 54.2% [42.9%–65.2%]; upper 95% 63.6% |
| naive_always | 83 (8 pos / 75 neg) | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 75/75 = 100.0% [95.2%–100.0%]; upper 95% 100.0% | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 83/83 = 100.0% [95.7%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 83 (8 pos / 75 neg) | 4/8 = 50.0% [15.7%–84.3%]; upper 95% 80.7% | 33/75 = 44.0% [32.5%–55.9%]; upper 95% 54.1% | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 83/83 = 100.0% [95.7%–100.0%]; upper 95% 100.0% |

### stratum CI green (50 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 24 (0 pos / 24 neg) | — (n=0) | 0/24 = 0.0% [0.0%–14.2%]; upper 95% 11.7% | — (n=0) | 24/24 = 100.0% [85.8%–100.0%]; upper 95% 100.0% |
| lastgreen | 24 (0 pos / 24 neg) | — (n=0) | 0/24 = 0.0% [0.0%–14.2%]; upper 95% 11.7% | — (n=0) | 17/24 = 70.8% [48.9%–87.4%]; upper 95% 85.4% |
| naive_always | 24 (0 pos / 24 neg) | — (n=0) | 0/24 = 0.0% [0.0%–14.2%]; upper 95% 11.7% | — (n=0) | 24/24 = 100.0% [85.8%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 24 (0 pos / 24 neg) | — (n=0) | 0/24 = 0.0% [0.0%–14.2%]; upper 95% 11.7% | — (n=0) | 24/24 = 100.0% [85.8%–100.0%]; upper 95% 100.0% |

### renovate (125 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 53 (3 pos / 50 neg) | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 0/50 = 0.0% [0.0%–7.1%]; upper 95% 5.8% | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 19/53 = 35.8% [23.1%–50.2%]; upper 95% 48.0% |
| lastgreen | 53 (3 pos / 50 neg) | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 0/50 = 0.0% [0.0%–7.1%]; upper 95% 5.8% | 2/3 = 66.7% [9.4%–99.2%]; upper 95% 98.3% | 27/53 = 50.9% [36.8%–64.9%]; upper 95% 62.9% |
| naive_always | 53 (3 pos / 50 neg) | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 40/50 = 80.0% [66.3%–90.0%]; upper 95% 88.7% | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 53/53 = 100.0% [93.3%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 53 (3 pos / 50 neg) | 1/3 = 33.3% [0.8%–90.6%]; upper 95% 86.5% | 22/50 = 44.0% [30.0%–58.7%]; upper 95% 56.6% | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 53/53 = 100.0% [93.3%–100.0%]; upper 95% 100.0% |

### dependabot (125 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 54 (5 pos / 49 neg) | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 0/49 = 0.0% [0.0%–7.3%]; upper 95% 5.9% | 1/5 = 20.0% [0.5%–71.6%]; upper 95% 65.7% | 23/54 = 42.6% [29.2%–56.8%]; upper 95% 54.7% |
| lastgreen | 54 (5 pos / 49 neg) | 3/5 = 60.0% [14.7%–94.7%]; upper 95% 92.4% | 0/49 = 0.0% [0.0%–7.3%]; upper 95% 5.9% | 1/5 = 20.0% [0.5%–71.6%]; upper 95% 65.7% | 35/54 = 64.8% [50.6%–77.3%]; upper 95% 75.6% |
| naive_always | 54 (5 pos / 49 neg) | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 35/49 = 71.4% [56.7%–83.4%]; upper 95% 81.8% | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 54/54 = 100.0% [93.4%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 54 (5 pos / 49 neg) | 3/5 = 60.0% [14.7%–94.7%]; upper 95% 92.4% | 11/49 = 22.4% [11.8%–36.6%]; upper 95% 34.4% | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 54/54 = 100.0% [93.4%–100.0%]; upper 95% 100.0% |

### npm only (lastgreen comparable) (133 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 62 (5 pos / 57 neg) | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 0/57 = 0.0% [0.0%–6.3%]; upper 95% 5.1% | 1/5 = 20.0% [0.5%–71.6%]; upper 95% 65.7% | 27/62 = 43.5% [31.0%–56.7%]; upper 95% 54.8% |
| lastgreen | 62 (5 pos / 57 neg) | 3/5 = 60.0% [14.7%–94.7%]; upper 95% 92.4% | 0/57 = 0.0% [0.0%–6.3%]; upper 95% 5.1% | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 62/62 = 100.0% [94.2%–100.0%]; upper 95% 100.0% |
| naive_always | 62 (5 pos / 57 neg) | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 40/57 = 70.2% [56.6%–81.6%]; upper 95% 80.0% | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 62/62 = 100.0% [94.2%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 62 (5 pos / 57 neg) | 3/5 = 60.0% [14.7%–94.7%]; upper 95% 92.4% | 14/57 = 24.6% [14.1%–37.8%]; upper 95% 35.7% | 0/5 = 0.0% [0.0%–52.2%]; upper 95% 45.1% | 62/62 = 100.0% [94.2%–100.0%]; upper 95% 100.0% |

## Red baseline (Signal's differentiating scenario)

Determinate red-baseline cases: 14 (REG_ON_RED 2, PRE_EXISTING 12, CHANGED 0, FIXED 0).

- Exact verdict agreement: 14/14 = 100.0% [76.8%–100.0%]; upper 95% 100.0%
- False exonerations: 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6%
- False accusations: 0/12 = 0.0% [0.0%–26.5%]; upper 95% 22.1%
- "Fails differently" detected: — (n=0)

## Per-test agreement (secondary)

4 positives with per-test evidence where Signal accused the update: TP 4, FP 0, FN 0; precision 4/4 = 100.0% [39.8%–100.0%]; upper 95% 100.0%; recall 4/4 = 100.0% [39.8%–100.0%]; upper 95% 100.0%.

## Attribution errors (every one)

None.

## Time

Signal job (minutes): {"n":249,"median_min":0.4,"p90_min":5.6,"total_min":470}. lastgreen job: {"n":133,"median_min":0.5,"p90_min":6.9,"total_min":485}.


---

# Results under the frozen rules (deviation 1 only, no Node-version check)

Cases: 250. Decision (pre-registered rule): **PIVOT**.

- NOT met: ≥20 confirmed regressions and false-exoneration upper bound ≤ 10% (n=11, upper 23.8%)
- met: ≥20 confirmed non-regressions and false-accusation upper bound ≤ 15% (n=106, upper 2.8%)
- NOT met: coverage ≥ 50% (37.6%)
- met: red baseline: ≥10 determinate cases, agreement lower bound ≥ 60%, no false exoneration (n=15, lower 68.1%)
- met: not more false exonerations than lastgreen on the shared npm cases (Signal 0.0%, lastgreen 57.1%)

## Reference truth classes

| class | cases |
|---|---|
| COMPATIBLE | 93 |
| INDET_RED_NO_TESTS | 57 |
| INDET_BASE_INSTALL | 31 |
| INSTALL_REG | 23 |
| PRE_EXISTING | 12 |
| REG_GREEN | 9 |
| INDET_TIMEOUT | 8 |
| INDET_ENV_MISMATCH | 5 |
| INDET_FLAKY_NEW | 3 |
| INDET_OTHER | 3 |
| REG_ON_RED | 2 |
| INDET_FLAKY | 2 |
| FIXED | 1 |
| INDET_MISSING | 1 |

Positives: REG_GREEN, REG_ON_RED, REG_FLAKY_BASE. Negatives: COMPATIBLE, PRE_EXISTING, FIXED, FLAKY_NOT_UPDATE. INDET_*: no reliable reference, counted neither way.

## Segments

Intervals: Clopper–Pearson exact 95%; "upper 95%" is the one-sided bound.

### all (250 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 117 (11 pos / 106 neg) | 0/11 = 0.0% [0.0%–28.5%]; upper 95% 23.8% | 0/106 = 0.0% [0.0%–3.4%]; upper 95% 2.8% | 2/11 = 18.2% [2.3%–51.8%]; upper 95% 47.0% | 44/117 = 37.6% [28.8%–47.0%]; upper 95% 45.6% |
| lastgreen | 117 (11 pos / 106 neg) | 4/11 = 36.4% [10.9%–69.2%]; upper 95% 65.0% | 0/106 = 0.0% [0.0%–3.4%]; upper 95% 2.8% | 4/11 = 36.4% [10.9%–69.2%]; upper 95% 65.0% | 66/117 = 56.4% [46.9%–65.6%]; upper 95% 64.2% |
| naive_always | 117 (11 pos / 106 neg) | 0/11 = 0.0% [0.0%–28.5%]; upper 95% 23.8% | 82/106 = 77.4% [68.2%–84.9%]; upper 95% 83.9% | 0/11 = 0.0% [0.0%–28.5%]; upper 95% 23.8% | 117/117 = 100.0% [96.9%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 117 (11 pos / 106 neg) | 6/11 = 54.5% [23.4%–83.3%]; upper 95% 80.0% | 35/106 = 33.0% [24.2%–42.8%]; upper 95% 41.3% | 0/11 = 0.0% [0.0%–28.5%]; upper 95% 23.8% | 117/117 = 100.0% [96.9%–100.0%]; upper 95% 100.0% |

### baseline green (123 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 102 (9 pos / 93 neg) | 0/9 = 0.0% [0.0%–33.6%]; upper 95% 28.3% | 0/93 = 0.0% [0.0%–3.9%]; upper 95% 3.2% | 2/9 = 22.2% [2.8%–60.0%]; upper 95% 55.0% | 30/102 = 29.4% [20.8%–39.3%]; upper 95% 37.7% |
| lastgreen | 102 (9 pos / 93 neg) | 2/9 = 22.2% [2.8%–60.0%]; upper 95% 55.0% | 0/93 = 0.0% [0.0%–3.9%]; upper 95% 3.2% | 4/9 = 44.4% [13.7%–78.8%]; upper 95% 74.9% | 58/102 = 56.9% [46.7%–66.6%]; upper 95% 65.2% |
| naive_always | 102 (9 pos / 93 neg) | 0/9 = 0.0% [0.0%–33.6%]; upper 95% 28.3% | 70/93 = 75.3% [65.2%–83.6%]; upper 95% 82.5% | 0/9 = 0.0% [0.0%–33.6%]; upper 95% 28.3% | 102/102 = 100.0% [96.4%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 102 (9 pos / 93 neg) | 4/9 = 44.4% [13.7%–78.8%]; upper 95% 74.9% | 35/93 = 37.6% [27.8%–48.3%]; upper 95% 46.6% | 0/9 = 0.0% [0.0%–33.6%]; upper 95% 28.3% | 102/102 = 100.0% [96.4%–100.0%]; upper 95% 100.0% |

### baseline red (84 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 15 (2 pos / 13 neg) | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 0/13 = 0.0% [0.0%–24.7%]; upper 95% 20.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 14/15 = 93.3% [68.1%–99.8%]; upper 95% 99.7% |
| lastgreen | 15 (2 pos / 13 neg) | 2/2 = 100.0% [15.8%–100.0%]; upper 95% 100.0% | 0/13 = 0.0% [0.0%–24.7%]; upper 95% 20.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 8/15 = 53.3% [26.6%–78.7%]; upper 95% 75.6% |
| naive_always | 15 (2 pos / 13 neg) | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 12/13 = 92.3% [64.0%–99.8%]; upper 95% 99.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 15/15 = 100.0% [78.2%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 15 (2 pos / 13 neg) | 2/2 = 100.0% [15.8%–100.0%]; upper 95% 100.0% | 0/13 = 0.0% [0.0%–24.7%]; upper 95% 20.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 15/15 = 100.0% [78.2%–100.0%]; upper 95% 100.0% |

### baseline red, CI agrees (not green) (54 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 15 (2 pos / 13 neg) | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 0/13 = 0.0% [0.0%–24.7%]; upper 95% 20.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 14/15 = 93.3% [68.1%–99.8%]; upper 95% 99.7% |
| lastgreen | 15 (2 pos / 13 neg) | 2/2 = 100.0% [15.8%–100.0%]; upper 95% 100.0% | 0/13 = 0.0% [0.0%–24.7%]; upper 95% 20.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 8/15 = 53.3% [26.6%–78.7%]; upper 95% 75.6% |
| naive_always | 15 (2 pos / 13 neg) | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 12/13 = 92.3% [64.0%–99.8%]; upper 95% 99.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 15/15 = 100.0% [78.2%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 15 (2 pos / 13 neg) | 2/2 = 100.0% [15.8%–100.0%]; upper 95% 100.0% | 0/13 = 0.0% [0.0%–24.7%]; upper 95% 20.6% | 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6% | 15/15 = 100.0% [78.2%–100.0%]; upper 95% 100.0% |

### baseline flaky (3 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 0 (0 pos / 0 neg) | — (n=0) | — (n=0) | — (n=0) | — (n=0) |
| lastgreen | 0 (0 pos / 0 neg) | — (n=0) | — (n=0) | — (n=0) | — (n=0) |
| naive_always | 0 (0 pos / 0 neg) | — (n=0) | — (n=0) | — (n=0) | — (n=0) |
| naive_base_ci | 0 (0 pos / 0 neg) | — (n=0) | — (n=0) | — (n=0) | — (n=0) |

### stratum CI red (200 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 93 (11 pos / 82 neg) | 0/11 = 0.0% [0.0%–28.5%]; upper 95% 23.8% | 0/82 = 0.0% [0.0%–4.4%]; upper 95% 3.6% | 2/11 = 18.2% [2.3%–51.8%]; upper 95% 47.0% | 20/93 = 21.5% [13.7%–31.2%]; upper 95% 29.7% |
| lastgreen | 93 (11 pos / 82 neg) | 4/11 = 36.4% [10.9%–69.2%]; upper 95% 65.0% | 0/82 = 0.0% [0.0%–4.4%]; upper 95% 3.6% | 4/11 = 36.4% [10.9%–69.2%]; upper 95% 65.0% | 49/93 = 52.7% [42.1%–63.1%]; upper 95% 61.6% |
| naive_always | 93 (11 pos / 82 neg) | 0/11 = 0.0% [0.0%–28.5%]; upper 95% 23.8% | 82/82 = 100.0% [95.6%–100.0%]; upper 95% 100.0% | 0/11 = 0.0% [0.0%–28.5%]; upper 95% 23.8% | 93/93 = 100.0% [96.1%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 93 (11 pos / 82 neg) | 6/11 = 54.5% [23.4%–83.3%]; upper 95% 80.0% | 35/82 = 42.7% [31.8%–54.1%]; upper 95% 52.4% | 0/11 = 0.0% [0.0%–28.5%]; upper 95% 23.8% | 93/93 = 100.0% [96.1%–100.0%]; upper 95% 100.0% |

### stratum CI green (50 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 24 (0 pos / 24 neg) | — (n=0) | 0/24 = 0.0% [0.0%–14.2%]; upper 95% 11.7% | — (n=0) | 24/24 = 100.0% [85.8%–100.0%]; upper 95% 100.0% |
| lastgreen | 24 (0 pos / 24 neg) | — (n=0) | 0/24 = 0.0% [0.0%–14.2%]; upper 95% 11.7% | — (n=0) | 17/24 = 70.8% [48.9%–87.4%]; upper 95% 85.4% |
| naive_always | 24 (0 pos / 24 neg) | — (n=0) | 0/24 = 0.0% [0.0%–14.2%]; upper 95% 11.7% | — (n=0) | 24/24 = 100.0% [85.8%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 24 (0 pos / 24 neg) | — (n=0) | 0/24 = 0.0% [0.0%–14.2%]; upper 95% 11.7% | — (n=0) | 24/24 = 100.0% [85.8%–100.0%]; upper 95% 100.0% |

### renovate (125 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 56 (3 pos / 53 neg) | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 0/53 = 0.0% [0.0%–6.7%]; upper 95% 5.5% | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 19/56 = 33.9% [21.8%–47.8%]; upper 95% 45.7% |
| lastgreen | 56 (3 pos / 53 neg) | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 0/53 = 0.0% [0.0%–6.7%]; upper 95% 5.5% | 2/3 = 66.7% [9.4%–99.2%]; upper 95% 98.3% | 27/56 = 48.2% [34.7%–62.0%]; upper 95% 60.0% |
| naive_always | 56 (3 pos / 53 neg) | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 43/53 = 81.1% [68.0%–90.6%]; upper 95% 89.4% | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 56/56 = 100.0% [93.6%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 56 (3 pos / 53 neg) | 1/3 = 33.3% [0.8%–90.6%]; upper 95% 86.5% | 23/53 = 43.4% [29.8%–57.7%]; upper 95% 55.6% | 0/3 = 0.0% [0.0%–70.8%]; upper 95% 63.2% | 56/56 = 100.0% [93.6%–100.0%]; upper 95% 100.0% |

### dependabot (125 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 61 (8 pos / 53 neg) | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 0/53 = 0.0% [0.0%–6.7%]; upper 95% 5.5% | 2/8 = 25.0% [3.2%–65.1%]; upper 95% 60.0% | 25/61 = 41.0% [28.6%–54.3%]; upper 95% 52.3% |
| lastgreen | 61 (8 pos / 53 neg) | 4/8 = 50.0% [15.7%–84.3%]; upper 95% 80.7% | 0/53 = 0.0% [0.0%–6.7%]; upper 95% 5.5% | 2/8 = 25.0% [3.2%–65.1%]; upper 95% 60.0% | 39/61 = 63.9% [50.6%–75.8%]; upper 95% 74.2% |
| naive_always | 61 (8 pos / 53 neg) | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 39/53 = 73.6% [59.7%–84.7%]; upper 95% 83.3% | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 61/61 = 100.0% [94.1%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 61 (8 pos / 53 neg) | 5/8 = 62.5% [24.5%–91.5%]; upper 95% 88.9% | 12/53 = 22.6% [12.3%–36.2%]; upper 95% 34.1% | 0/8 = 0.0% [0.0%–36.9%]; upper 95% 31.2% | 61/61 = 100.0% [94.1%–100.0%]; upper 95% 100.0% |

### npm only (lastgreen comparable) (133 cases)

| tool | determinate | false exoneration (of all confirmed regressions) | false accusation | abstains on regressions | coverage |
|---|---|---|---|---|---|
| signal | 66 (7 pos / 59 neg) | 0/7 = 0.0% [0.0%–41.0%]; upper 95% 34.8% | 0/59 = 0.0% [0.0%–6.1%]; upper 95% 5.0% | 2/7 = 28.6% [3.7%–71.0%]; upper 95% 65.9% | 28/66 = 42.4% [30.3%–55.2%]; upper 95% 53.3% |
| lastgreen | 66 (7 pos / 59 neg) | 4/7 = 57.1% [18.4%–90.1%]; upper 95% 87.1% | 0/59 = 0.0% [0.0%–6.1%]; upper 95% 5.0% | 0/7 = 0.0% [0.0%–41.0%]; upper 95% 34.8% | 66/66 = 100.0% [94.6%–100.0%]; upper 95% 100.0% |
| naive_always | 66 (7 pos / 59 neg) | 0/7 = 0.0% [0.0%–41.0%]; upper 95% 34.8% | 42/59 = 71.2% [57.9%–82.2%]; upper 95% 80.7% | 0/7 = 0.0% [0.0%–41.0%]; upper 95% 34.8% | 66/66 = 100.0% [94.6%–100.0%]; upper 95% 100.0% |
| naive_base_ci | 66 (7 pos / 59 neg) | 4/7 = 57.1% [18.4%–90.1%]; upper 95% 87.1% | 15/59 = 25.4% [15.0%–38.4%]; upper 95% 36.4% | 0/7 = 0.0% [0.0%–41.0%]; upper 95% 34.8% | 66/66 = 100.0% [94.6%–100.0%]; upper 95% 100.0% |

## Red baseline (Signal's differentiating scenario)

Determinate red-baseline cases: 15 (REG_ON_RED 2, PRE_EXISTING 12, CHANGED 0, FIXED 1).

- Exact verdict agreement: 14/15 = 93.3% [68.1%–99.8%]; upper 95% 99.7%
- False exonerations: 0/2 = 0.0% [0.0%–84.2%]; upper 95% 77.6%
- False accusations: 0/13 = 0.0% [0.0%–24.7%]; upper 95% 20.6%
- "Fails differently" detected: — (n=0)

## Per-test agreement (secondary)

5 positives with per-test evidence where Signal accused the update: TP 9, FP 0, FN 0; precision 9/9 = 100.0% [66.4%–100.0%]; upper 95% 100.0%; recall 9/9 = 100.0% [66.4%–100.0%]; upper 95% 100.0%.

## Attribution errors (every one)

None.

## Time

Signal job (minutes): {"n":249,"median_min":0.4,"p90_min":5.6,"total_min":470}. lastgreen job: {"n":133,"median_min":0.5,"p90_min":6.9,"total_min":485}.


---

## Independent verification

A separate agent re-derived the main numbers from the raw archive with its own classifier, without using
`analyze.mjs`. It confirmed:
- the 8 positives and each tool's answer on them;
- 99 negatives with 0 Signal accusations;
- the 14 red-baseline cases and 14/14 agreement;
- a random spot-check of 10 negatives;
- every interval.

Judgement calls it flagged (none changes a conclusion):
- `dependabot-red-041` counts as PRE_EXISTING. Its suite-error message varies within each side; a stricter reading
  makes it indeterminate, giving 98 negatives and 13/13.
- `dependabot-red-051` and `renovate-red-029` are probably real regressions: Jest suites fail to load only with the
  update. They are indeterminate by rule, because the ids do not match. This works against Signal, which answered
  `regression` on both.

## Findings beyond the metrics

Defects in Signal at `a95a3ea` exposed by the run. Not fixed, because the benchmark froze the tool.
1. **Crashes on Node < 22.12:** "Cannot use import statement outside a module". 3 cases (Node 18.20, 20.11, 21.7)
   got no answer. The Action's documented minimum of Node 20 is wrong.
2. **"No dependency change" on real dependency PRs:** 3 cases (pnpm workspace and npm subdirectory lockfiles); the
   lockfile parsing misses them.
3. **Test ids prefixed with `<project>`** when the project is in a subdirectory. Cosmetic; comparisons are
   unaffected.
4. **Signal's own environment can differ from the project's.** In `dependabot-red-077` its baseline failed where
   the reference base passed (the suspected cause is no `.git`, or the allowlisted environment). The CI
   cross-check turned a would-be false exoneration into `inconclusive`.

Flaws in the benchmark harness:
- Node ranges resolved differently per runner (deviation 2).
- 18 "install regressions" are mostly npm `ERESOLVE` peer conflicts under strict `npm ci`; some projects' CIs use
  looser installs.
- 50 cases are red on both sides without per-test evidence, so they cannot be judged. Signal said `pre_existing`
  on 30 of them; that is unverifiable here.
