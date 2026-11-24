# Evaluation results (run 1, 2026-11-24)

Pre-registration: `PREREGISTRATION.md` (written before any run, unchanged). Raw data: `results/grades.json`,
`results/usage.jsonl` (time, tokens and tool calls from the harness; failed approaches and café assessments are the
agents' self-reports), `results/summary.json`. Reproduce: `./setup.sh`, run one agent per workspace with the prompt in
this file, then `node grade.ts` and `node report.ts`.

| task | arm | first-attempt success | median time (s) | median tokens | median tool calls |
|---|---|---|---|---|---|
| clean-venv-versions | control | 2/2 | 24.6 | 59426 | 6.5 |
| clean-venv-versions | cafe | 2/2 | 36.5 | 61689 | 8.5 |
| no-capsule-duration | control | 2/2 | 22.9 | 59312 | 7 |
| no-capsule-duration | cafe | 2/2 | 26.0 | 59639 | 7.5 |
| node24-gzip-stats | control | 2/2 | 21.3 | 59280 | 7 |
| node24-gzip-stats | cafe | 2/2 | 28.1 | 60593 | 6 |
| py313-plugins | control | 2/2 | 19.5 | 58567 | 6 |
| py313-plugins | cafe | 2/2 | 35.0 | 60802 | 9 |
| **wedge tasks** | control | **6/6** | **21.3** | 59250 | 6.5 |
| **wedge tasks** | cafe | **6/6** | **34.3** | 61142 | 8.5 |

## Verdict against the pre-registered rule: NOT SHOWN

- First-attempt success: no difference (ceiling: every run of both arms passed the hidden tests).
- Time: the café arm was **slower** (+61% median on the wedge tasks), not 15% faster.
- No-capsule task: +13.5% median time for the café arm, inside the pre-registered +15% tolerance; both café agents
  got a correct "no match" and debugged normally (correct rejection 2/2).

## What the agents reported about Agent Café (self-reports)

- Correct and directly used: `diagnose` + `show` on py313-plugins (2/2), `doctor` + `show` on node24-gzip-stats (2/2).
- **Misleading, product defects found by this evaluation:**
  1. clean-venv-versions (2/2): `doctor` gave a false all-clear. Root cause: the `distutils` detect rule did not match
     `from distutils.version import ...` (it only matched the bare module), and doctor could only evaluate interpreters on
     PATH, not the deploy venv named in the task.
  2. node24-gzip-stats r2: `diagnose` ruled out the right capsule as "probably not your cause" because it only checked the
     default Node on PATH (22.23, not affected) while the failure came from Node 24.

## Interpretation (honest)

On these tasks a frontier model already knows the fix, and the Node 22 deprecation warning or the Python error message
points straight at it. Consulting the tool added 2-3 tool calls and ~10 s without changing the outcome. This repeats
the earlier pilot (Experiment F). The tasks were chosen inside the wedge but were still well-documented breaks; the
case where the tool could plausibly win (breaks after the model's knowledge cutoff, private toolchains, a CI guard that
prevents the failure before any agent work) was **not** tested here. The single model family (Claude) is a further
limit: the cross-family run remains unperformed.

The two defects above were fixed after this run (see git history); the numbers above are from the code as it was when
the run started and are not re-run.
