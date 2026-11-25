# Signal real-PR benchmark: pre-registered protocol

Status: **frozen before execution.** The commit that adds the frozen case list (`bench/cases.json`) together with
this file is the pre-registration. Its SHA is recorded in `bench/PREREGISTRATION`, and the execution runs record it.
Changes after that commit are listed in "Deviations" at the end, with their reason and date. No threshold,
classification rule or case may be changed after any benchmark result is seen.

Authorization: Fer authorized this experiment on 2026-11-25, for executing third-party code only in disposable,
isolated GitHub-hosted runners under the conditions below. Deploying, publishing, merging and contacting anyone
are not authorized.

## 0. Question

On real dependency-update PRs from Renovate and Dependabot, does Signal attribute test failures correctly?
1. When the update causes a regression, how often does Signal **exonerate** it (false exoneration)?
2. When it does not, how often does Signal **accuse** it (false accusation)?
3. When the base branch is already red (Signal's differentiating scenario), does it separate new failures from
   failures that already existed?

The tool under test is Signal at commit `a95a3ea` (the `dist/` in this branch). No Signal feature is added during
the benchmark.

## 1. Cases: population, selection, exact list

**Population.** Public pull requests opened by `renovate[bot]` or `dependabot[bot]` between 2026-10-01T00:00Z
and 2026-11-15T00:00Z that update npm-ecosystem dependencies.

**Strata.** Bot × CI outcome of the PR head: *red* (at least one failed check run or commit status) or *green*
(every check succeeded). Quotas: 100 Renovate red, 100 Dependabot red, 25 Renovate green, 25 Dependabot green.
The green strata exist to measure false accusations where the update most likely broke nothing.

**Sampling** (`bench/sample.mjs`, seed `20261125`):
- The window is cut into 30-minute slices, visited in shuffled order.
- For each slice and stratum, the GitHub search (`is:pr is:public author:app/<bot> status:<failure|success>`)
  returns the PRs, which are shuffled with the same generator.
- PRs are screened in that order, one PR per repository owner across the whole sample.
- Each stratum is oversampled (115 / 30) because the CI snapshot (below) may not confirm a stratum.

**Eligibility.** These rules are mechanical, applied before any execution, and logged per PR with a reason in
`bench/frame.jsonl`:
- The PR head ref is fetchable over public git.
- The head commit has a single parent and is authored by the bot.
- The parent is already on the repository's default branch, so the PR has exactly one bot commit on top of its
  base. The base must be newer than 2026-06-01.
- Every changed file is a `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml` or
  `yarn.lock`.
- Exactly one lockfile changed. The project directory is the lockfile's directory, and no `package.json` changed
  outside it.
- The project has a `test` script that is not npm's placeholder.
- The checkout has at most 20,000 files.

**CI snapshot** (`bench/freeze-ci.mjs`, run in a workflow that executes no project code):
- It records the check runs and statuses of the head and of its parent.
- A candidate is kept only if the snapshot confirms its stratum.
- In sampled order, the first 100 / 25 confirmed per stratum form `bench/cases.json`.
- The next confirmed ones (2, 2, 1, 0) form `bench/pilot.json`, used only to test the plumbing and never analysed.
- `bench/freeze-log.json` lists every decision.

**SHAs.** Each case records `head_sha` (the bot commit) and `base_sha` (its parent). Every execution fetches
exactly these SHAs. If a SHA is no longer fetchable, the case is `INDET_ENV`; it is not replaced.

Known limits of the sample:
- Only what the search returns.
- No repository-size data (the proxy available to the sampler serves git, not the REST API), hence the file-count
  rule.
- npm ecosystem only, because Signal's zero-config path is JavaScript-only.

## 2. Ecosystem, lockfiles, execution environment

Commands are frozen per case from the head commit (`bench/sample.mjs`, `commandsFor`). The same commands are used
by the reference oracle and by Signal:

| lockfile | install | test |
|---|---|---|
| `package-lock.json` / `npm-shrinkwrap.json` | `npm ci --no-audit --no-fund` | `npm test` |
| `pnpm-lock.yaml` | `npx --yes pnpm@<v> install --frozen-lockfile` | `npx --yes pnpm@<v> test` |
| `yarn.lock`, classic | `yarn install --frozen-lockfile --non-interactive` | `yarn test` |
| `yarn.lock`, berry | `yarn install --immutable` (yarnPath) or `npx --yes corepack@0.36.0 yarn install --immutable` | `yarn test` or `npx --yes corepack@0.36.0 yarn test` |

`<v>` comes from `packageManager`; otherwise the lockfile version decides (9.x → pnpm 9, 6.x → 8, 5.x → 7).

**Node.js version.** The first that applies: `.nvmrc`, `.node-version`, `.tool-versions`, `volta.node`,
`engines.node`, otherwise 22. It is installed by `actions/setup-node` (no cache). If it cannot be installed, the case
is `INDET_ENV`. The exact version used is recorded.

**Runner.** `ubuntu-24.04`, GitHub-hosted. The image version is recorded per job.

### Execution environment (security requirements, all enforced in the workflow files)

| requirement | how |
|---|---|
| GitHub-hosted ephemeral runners only | `runs-on: ubuntu-24.04`; `sandbox.sh` refuses to run unless `RUNNER_ENVIRONMENT=github-hosted` |
| `permissions: {}` | at workflow level in every bench workflow |
| no secrets, credentials, write token, OIDC, private services | no `secrets.*` referenced; `permissions: {}` gives the job token no scopes and no `id-token`; the third-party repo is fetched anonymously over public git |
| `persist-credentials: false` | on every `actions/checkout` |
| `pull_request`, never `pull_request_target` | `on: pull_request` (a PR from `goat/signal-bench` into `goat/signal`, never merged) |
| one PR per independent environment | one matrix job, a fresh VM, per case and per mode |
| no shared caches, directories or processes | no `actions/cache`, no `setup-node` cache; each job is a new VM; each case runs under a new user with a new HOME |
| no workflows from evaluated repos | only this repository's workflows run; evaluated repos are fetched as data and only their install/test commands run |
| destroy the environment after each run | the VM is discarded by GitHub after the job; before that, all sandbox processes are killed and the user deleted |
| otherwise do not run the case | `sandbox.sh` exits without running if the runner is not GitHub-hosted, the sandbox user cannot be created, or it is privileged |

**Additional isolation inside the VM** (`bench/sandbox.sh`):
- Third-party code runs as a separate Linux user `sbx`: no sudo, not in `docker`/`adm`, launched with `env -i` and
  a minimal environment.
- It cannot read the runner user's processes, files (`/home/runner` is set to 700) or the job's internal runtime
  token, which only the runner user's processes hold.
- The cloud instance-metadata address `169.254.169.254` is blocked.
- Actions are pinned to commit SHAs.

**Residual risks** (accepted, documented, not eliminated):
1. **Network.** The code under test has unrestricted outbound internet. It can attack or abuse any reachable
   service, use the runner's IP, or download more code. Mitigation: none beyond GitHub's own abuse controls; jobs
   are time-limited (60 min).
2. **Kernel and VM escape.** It runs as an ordinary user on a VM that GitHub discards afterwards. A kernel exploit
   would give it root on that VM. It would still not have repository secrets, because there are none.
3. **Results integrity.** Everything the harness writes for a case is written next to that case's code, as the
   same `sbx` user. A malicious case can forge its own results (reference or Signal). It cannot write another
   case's results: other cases run on other VMs, and artifact upload happens as the runner user after `sbx` is
   killed.
4. **Resource abuse.** Crypto-mining or similar for up to 60 minutes per job.
5. **The job token.** It exists in the runner's memory with no permissions (`permissions: {}`). It is not reachable
   by `sbx` unless the VM's kernel is compromised.
6. **Supply chain of the harness.** `npx --yes pnpm@…`, `corepack`, `lastgreen@0.3.0` and the projects' own
   dependencies come from the npm registry at execution time.

## 3. What runs per case

Four independent jobs, each a fresh VM:

- **`ref-base`, reference oracle on the base commit.** Install, retrying once after cleaning `node_modules`. Then
  the test command 5 times (each run timeout 10 min; at least 3 runs required).
- **`ref-head`, the same on the head commit.**
- **`signal`.** Signal at `a95a3ea` on the head checkout:
  - Command: `signal diagnose --base <base_sha> --install <frozen> --test <frozen> --retries 2 --timeout-minutes 10 --offline --ci-context <frozen CI snapshot>`.
  - Signal is configured as its README recommends, with the CI cross-check. The context comes from the frozen
    snapshot of the head and of its parent; the shipped Action reads the PR's base, which this snapshot
    approximates.
- **`lastgreen`.** Only for npm lockfiles, the only format it supports. `npm ci` on the head, then
  `lastgreen@0.3.0 why --from-git <base_sha> -c <test> --json --repeat 3 --max-runs 30 --timeout 600`. `--repeat 3`
  matches Signal's 3 runs per side.

Job limit: 60 minutes. A job that does not finish is recorded as missing: reference → indeterminate, tool →
abstention.

## 4. Reference truth (independent of Signal and of CI)

The reference is a **controlled experiment by a separate harness** (`bench/case.mjs`, which shares no code with
Signal):
- base commit vs head commit, which differ only in dependency files (checked at selection);
- separate VMs per side;
- 5 runs per side, where Signal does 3;
- per-test results read from the test runner's own JSON reporter, not from console output.

**Per-test evidence** exists when all of these hold:
- the test script is a single `jest` or `vitest` call;
- it is the same at base and head;
- there is no `pretest`/`posttest` hook (the direct call would skip it);
- it is not Yarn Plug'n'Play.

The oracle then runs the binary directly with `--json --outputFile` (jest) or `--reporter=json --outputFile`
(vitest). A side has per-test evidence only if every run produced a report and every failing run names at least
one failing test. Otherwise only suite-level evidence (exit codes) exists.

The CI state is **not** used for truth. It is a covariate, an input to Signal's cross-check, and the input of the
naive comparators.

**Classes** (`bench/analyze.mjs`, `truth`). Let `newStable` be the tests that fail in all head runs and pass in all
base runs.

| class | condition | counts as |
|---|---|---|
| `REG_GREEN` | base passes all runs; head: some test in `newStable` (per-test), or fails all runs (suite-level) | **positive** |
| `REG_ON_RED` | base fails every run; head has a test in `newStable` | **positive** |
| `REG_FLAKY_BASE` | base mixed; head has a test in `newStable` | **positive** |
| `COMPATIBLE` | both sides pass every run | negative |
| `PRE_EXISTING` | both fail every run; no new or newly-flaky failing test; the same errors | negative |
| `FIXED` | base fails every run, head passes every run | negative |
| `FLAKY_NOT_UPDATE` | mixed results, and no test fails only with the update | negative |
| `CHANGED` | a test fails in every run on both sides, with a constant error per side that differs between sides | separate (reported apart) |
| `INSTALL_REG` | base installs, head does not, after two attempts each | separate (reported apart) |
| `INDET_*` | missing/env/base-install/timeout; red baseline without per-test evidence; a test failing in only some head runs and never in base (`INDET_FLAKY_NEW`); unmatched ids | **indeterminate**: never counted as hit or miss |

Error messages are compared after normalization: the first 4 non-empty lines that are not stack frames (jest's first line is generic; the expected/received values follow), ANSI removed, run directory → `<root>`,
`:line:col` → `:L:C`, durations → `<dur>`.

**Baseline segment** of a case: green (base passed all runs), red (failed all), flaky (mixed), unknown (no
completed base side).

## 5. Metrics, intervals, decision rule

Tool decisions:
- **accuse:** `regression`, `regression_on_red`.
- **exonerate:** `pre_existing`, `compatible`, `flaky`.
- **abstain:** `inconclusive`, no result, timeout.

lastgreen statuses:
- **accuse:** `found`.
- **exonerate:** `not-in-env`, `not-reproduced`, `flaky`.
- **abstain:** everything else.

Naive comparators, from the frozen CI snapshot, without execution:
- `naive_always` accuses every CI-red PR;
- `naive_base_ci` accuses a CI-red PR unless its parent's CI is also red.

Primary metrics, per tool and per segment (all, baseline green/red/flaky, CI stratum, bot, npm subset):
- **False exoneration rate** = positives the tool exonerates / **all confirmed positives**, the denominator Fer
  defined. It is also reported among conclusive answers.
- **False accusation rate** = negatives the tool accuses / all confirmed negatives.
- **Abstention** on positives and on negatives, reported separately. An abstention is not an error, and it is not
  a success.
- **Coverage** = conclusive answers / determinate cases (positives, negatives and `CHANGED`).
- **Red baseline:**
  - exact agreement of Signal's verdict with the expected one (`REG_ON_RED` → `regression_on_red`; `PRE_EXISTING`
    → `pre_existing`; `CHANGED` → `regression_on_red`; `FIXED` → `compatible`);
  - false exonerations and false accusations inside that segment.
- **Secondary, per test:** precision and recall of Signal's "new failures" against `newStable`, matched by test
  title, on positives with per-test evidence.

**Uncertainty.** Every proportion is reported with a Clopper–Pearson exact 95% interval, plus the one-sided 95%
upper bound.
- With 0 errors in *n* positives, the upper bound is `1 − 0.05^(1/n)`: **1.49% for n = 200, 2.95% for n = 100**.
  About 299 confirmed positives with no error are needed before "< 1% at 95%" can be claimed.
- This sample is not expected to reach that. **The report will not claim a false-exoneration rate below the upper
  bound actually obtained.**

**Decision rule** (`decide()` in `bench/analyze.mjs`, frozen):
- **KILL** if any of these holds:
  - false exoneration > 5%, with at least 20 positives;
  - false accusation > 15%, with at least 20 negatives;
  - coverage < 25%;
  - red-baseline agreement < 50%, with at least 10 determinate red-baseline cases;
  - 2 or more false exonerations with a red baseline.
- **CONTINUE** (to controlled pilots with real teams; this says nothing about a business) if all of these hold:
  - at least 20 positives and a false-exoneration upper bound ≤ 10%;
  - at least 20 negatives and a false-accusation upper bound ≤ 15%;
  - coverage ≥ 50%;
  - at least 10 determinate red-baseline cases, with an agreement lower bound ≥ 60% and no red-baseline false
    exoneration;
  - no more false exonerations than lastgreen on the shared npm cases.
- **PIVOT** otherwise. This includes the case where the differentiating scenario, a red baseline, cannot be shown
  with enough cases: then Signal's distinctive value is undemonstrated.

A good aggregate cannot override the red-baseline conditions: they are separate clauses in both KILL and CONTINUE.

## 6. Comparators

**Executable:**
- `lastgreen@0.3.0` (MIT), on npm-lockfile cases;
- `naive_always`;
- `naive_base_ci`.

Signal is also reported restricted to the npm cases for a like-for-like comparison with lastgreen.

**Not executable, and why:**
- **Drift:** its verdicts come from an upgrade-analysis pipeline and an agent, and its CI mode posts with a write
  token. There is no accuse/exonerate output for an existing red PR that can be run under `permissions: {}`
  without an LLM key.
- **dep-bisector:** no published code, only a README.
- **`ncu --doctor`:** it upgrades to the latest versions itself instead of testing the PR's versions, which is a
  different question.
- **Mend / Dependabot compatibility scores:** they predict risk without running anything, and there is no
  per-PR public API without credentials.

## 7. Reproducibility and records

- **Frozen inputs:** `bench/cases.json` with SHAs, commands, Node spec and CI snapshot; `bench/frame.jsonl`;
  `bench/freeze-log.json`; the workflow files; `bench/case.mjs`; `bench/analyze.mjs`; Signal's `dist/`, whose hash
  is logged per job.
- **Per job:** `result.json`, with commands, exit codes, durations, per-test results, versions and errors. Logs are
  truncated to their last 1 MB. Everything is uploaded as artifact `res-<mode>-<case>` and kept 30 days.
- **After the run:** all `result.json`, `signal.json` and `lastgreen.json` files are committed to
  `bench/results/`. Logs stay in the artifacts.
- `node bench/analyze.mjs bench/cases.json bench/results bench/out` reproduces every number in the report.
- The workflow run IDs are recorded in `bench/RUNS`.
- The analysis code is tested on synthetic fixtures only (`bench/analyze.test.mjs`, labelled synthetic).

## Deviations

(none yet)
