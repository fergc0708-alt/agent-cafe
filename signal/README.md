# Signal — was it the dependency update?

A Renovate or Dependabot PR is red. Signal re-runs your tests **with** the update and, only if they fail,
**without** it. Without means the same commit with only the lockfile and manifest reverted, exported to its own
directory (no `.git`), with a fresh install, a fresh HOME, no tokens, and the same runner. Then it compares **which tests** fail. The answer lands in the PR's job
summary:

```
❌ chalk 4.1.2 → 5.3.0 breaks 1 test
The other 2 updates pass the tests once chalk is reverted, so they can be merged on their own.
Merge: Do not merge: the update breaks tests that pass without it.
Next step: Fix the code for chalk 5.3.0, or keep chalk at 4.1.2 … and merge the other updates separately.
Confidence: high. With the update: failed 3/3 runs (1 failing test identified). Without it (same commit, only
package-lock.json, package.json reverted, fresh install, same runner): passed 3/3.

Tests that fail only with the update (1)
- test/app.test.js > banner contains the text — chalk.bold is not a function
```

*(Real output from [`examples/signal/grouped`](../examples/signal/grouped), verified in CI by
[`signal-e2e.yml`](../.github/workflows/signal-e2e.yml).)*

## What it tells you

| verdict | meaning | what to do |
|---|---|---|
| ❌ **regression** | tests that pass without the update fail with it, reproducibly | don't merge; fix or hold back the named package |
| ❌ **regression_on_red** | the base branch already fails some tests, and the update breaks **others**, or makes an already-failing test fail with a **different error** | don't merge; the new failures are listed apart from the old ones |
| ⚪ **pre_existing** | the same tests fail the same way without the update | not the update's fault; fix the base branch, the PR can go in |
| 🟡 **flaky** | identical runs disagreed, or a different set of tests failed in each run | not attributable; re-run and fix the flaky test |
| ✅ **compatible** | the tests pass with the update | merge (only what your tests cover was checked) |
| ❔ **inconclusive** | install failed, timeout, network or disk errors, tampering detected, or Signal's result disagrees with your CI | Signal does not guess |

**Cross-check with your CI.** Before running any project code, a separate step reads what your own CI reported
for the base commit and for this PR (`checks: read`, with the job token; the step that runs your code never gets
the token). Signal uses it to refuse confident answers it cannot back:
- the baseline fails here but your CI is green on the base commit → **inconclusive** (Signal is not reproducing
  your CI: a missing build step, service or variable);
- the tests pass here but your CI failed on this PR → **inconclusive**, not "compatible";
- "pre_existing" is **high** confidence only when your CI also reports the base commit red.

In a **grouped PR**, Signal searches for the responsible update with delta debugging over the declared
dependencies, then confirms the result both ways:
- **sufficient:** the old dependencies plus that one update reproduce the failures;
- **necessary:** the update with that one reverted no longer has them.

Anything weaker is reported as weaker: "only fails together" (an interaction), "not explained by the declared
updates" (transitive lockfile changes), or "not isolated within the budget". A single package is blamed only when
both directions hold.

## Install (one workflow file)

```yaml
# .github/workflows/signal.yml
name: Signal
on: pull_request
permissions:
  contents: read
  checks: read     # only for the CI cross-check step
  statuses: read
jobs:
  signal:
    if: github.event.pull_request.user.login == 'renovate[bot]' || github.event.pull_request.user.login == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2              # Signal compares the PR merge commit with its first parent
          persist-credentials: false  # required: the project's code must not see a token
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: fergc0708-alt/agent-cafe/signal@<full-commit-sha>
```

Pin the Action to a full commit SHA, run it on `pull_request` (Signal refuses `pull_request_target`,
`workflow_run` and comment/review events, which carry the base repository's secrets), and keep it the **last
step** of its job: steps after it run on a workspace the project's code has touched.

That is the whole setup for npm, pnpm and yarn projects. Install and test commands are detected from the lockfile
and the `test` script. To remove it, delete the file: Signal leaves nothing behind. It never modifies the checkout, commits,
comments or calls a server of its own. Its outbound requests are the GitHub API (read-only CI status, turn off
with `ci-context: "false"`) and the npm registry, for public package metadata (changelog links; `offline: "true"`
turns that off). Your install and tests of course make whatever requests they make in your normal CI.

**Cost.** When the update passes, Signal runs your tests once. Only a failure costs more:
- the update is re-run `retries` times (default 2) to tell flaky tests from real failures;
- the baseline is installed and run `1 + retries` times (a single green baseline run is not enough to blame the
  update when a test is 50% flaky);
- isolation adds up to `isolate-budget` runs (default 8), only for grouped PRs that regress.

A regression therefore costs about 6 test runs plus 2 installs. With `retries: 0` it costs 2, and the confidence
is capped at medium.

To pay nothing on green PRs, run it as a second job with `needs: test` and `if: failure()`.

| input | default | |
|---|---|---|
| `install` / `test` | detected | e.g. `pnpm install --frozen-lockfile` / `pnpm test -- --run` |
| `working-directory` | `.` | monorepo sub-project; a lockfile at the root is found |
| `junit` | — | path of a JUnit XML your tests write (exact test names for any runner) |
| `base` | `auto` | ref to compare with (auto = the PR merge commit's first parent) |
| `retries` | `2` | re-runs of a failing side; the baseline runs `1 + retries` times |
| `ci-context` / `github-token` | `true` / job token | cross-check with your CI's own results (read-only, separate step) |
| `timeout-minutes` | `20` | per command |
| `isolate` / `isolate-budget` | `true` / `8` | culprit search in grouped PRs |
| `fail-on` | `never` | `regression` fails the job on a **high-confidence** regression only |
| `keep-env` | — | env vars your tests need that look like secrets (`GITHUB_TOKEN` and `ACTIONS_*` are never passed) |
| `redact` | `false` | show error shapes instead of messages (public repositories) |
| `offline` | `false` | no npm registry lookups for changelog links |

Outputs: `verdict`, `confidence`, `culprit`.

Locally: `node dist/cli/cafe.js signal diagnose --base main` on the update branch (`--help` for options).

## When to use something else

- **Before the bot opens a PR**, to know which upgrades are risky and where your code uses the changed API:
  [Drift](https://github.com/trydrift/drift) computes API diffs and call sites.
- **Your main branch is green and you want "which bump broke it" across days or machines**:
  [lastgreen](https://github.com/MarioACo/lastgreen) compares against a recorded green environment and also covers
  Node versions and env vars.
- **A risk score with zero compute**: Mend Merge Confidence and Dependabot compatibility scores.

Signal's distinct case is the **red PR when the base branch is red or flaky too**, which is where a comparison
against "the last green" has no answer:
- it needs no recorded state;
- it compares individual tests, so the update's new failures are separated from the ones `main` already had;
- it treats flakiness, install errors and infrastructure noise as such instead of attributing them.

## Limits (read these)

- **Scope:**
  - Only your runner's OS, architecture and Node version are tested, and only what your test command runs.
    "Compatible" is not universal compatibility.
  - JavaScript (npm, pnpm, yarn) works out of the box.
  - Python works with explicit `install`/`test` that create a fresh virtualenv per side, and without culprit
    isolation.
- **Test identification:**
  - Failing tests are named from vitest, jest, node:test (TAP/spec), mocha, pytest or JUnit output.
  - When they cannot be named, the confidence drops, and "pre-existing" becomes low-confidence because a new
    failure could hide behind old ones.
- **Isolation:**
  - It installs the requested versions on top of the baseline install, so transitive versions can differ slightly
    from the PR's lockfile. Signal checks that each requested version actually installed.
  - Removed dependencies are not isolated.
- **A branch that also changes code** keeps that code on the baseline side. The report says so.
- **Security, in short:** the project's code runs as in your normal CI, as the same OS user, without tokens, without
  `.git`, with a fresh HOME, and each command's process group is killed when it ends. That is not a sandbox: a
  malicious update can still read the runner's process memory, forge its own test results, and therefore forge
  Signal's verdict. The verdict is advice, never a security control. See [SECURITY.md](SECURITY.md).
- **Evidence:**
  - Verified on the bundled examples with real npm packages, in GitHub Actions.
  - **Not yet measured on a corpus of real third-party PRs.** The harness is ready (`bench/`), but running other
    projects' code needs explicit authorization.
