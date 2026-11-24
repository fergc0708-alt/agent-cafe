# Evaluation: does Agent Café make a coding agent better on runtime-compatibility work?

Written 2026-11-24T19:08:41Z, **before any run**. Results go to `results/`; this file is not edited afterwards.

## Question
On tasks inside the product's wedge (known runtime/toolchain breaks, environment-specific traps) and on one task
where no capsule applies, does an agent with Agent Café (CLI: `doctor`, `diagnose`, `show`) succeed more often
on the first attempt, faster, or with fewer tokens/tool calls than the same agent without it?

## Tasks (`tasks/`)
| task | category (mandate) | what makes it hard |
|---|---|---|
| py313-plugins | known documented error | `imp` removed in 3.12; must keep 3.11 working |
| clean-venv-versions | environment-specific | `distutils` works on the system Python (setuptools shim) and fails only in the clean deploy venv |
| node24-gzip-stats | newer compatibility change, silent | Node 24 removed zlib `bytesRead`: no exception, just `NaN` |
| no-capsule-duration | no useful capsule exists | ordinary logic bug; measures overhead and correct rejection |

Not covered (honest): dependency-version conflicts (no package registry access here), previously-unknown failures,
and a dedicated "known fix no longer works" task.

## Arms
- **control**: TASK.md only.
- **cafe**: TASK.md + a short note listing the three CLI commands (same note for every task, including no-capsule).

Same model (the session's default subagent model, Claude), same prompt template, same machine, same runtimes.
**Only one model family is available here, so the cross-family experiment remains unperformed.**

## Sample size
2 repetitions × 4 tasks × 2 arms = 16 runs. This is **underpowered**: it can show large effects or their absence,
not small ones. No significance test will be claimed.

## Grading (agents never see it)
For each workspace, the agent's files plus a hidden test (`tasks/<t>/grader/`) are run with every interpreter in
`grade.json`. First-attempt success = all runs exit 0 on the agent's final state (agents get one attempt).

## Metrics
Primary: first-attempt success rate per arm. Secondary: wall time, tokens and tool calls (from the harness's
task notifications), failed approaches and whether café output was misleading (agent self-report, labelled as such),
correct rejection on no-capsule-duration (café said "no match" and the agent did not apply a capsule).

## Decision rule (fixed now, from the mandate)
Success if the café arm shows **+10 percentage points first-attempt success OR −15% median time** with no loss of
success, AND the no-capsule task shows **no more than +15% median time** for the café arm. Otherwise: not shown.

## Known confounds
Agents can technically read other directories (instructed not to). The tasks come from the catalog's domain, so this
tests the wedge, not general coding. n=2 per cell.

---
## Addendum, 2026-11-24T19:57:09Z, before run 2
Run 2 replicates run 1 unchanged (same tasks, prompts, arms, n=2, grader and decision rule) on the code after the
two defects found in run 1 were fixed (commit c1eb37e). Results go to `results-run2/`. Run 1 results are kept as-is.
