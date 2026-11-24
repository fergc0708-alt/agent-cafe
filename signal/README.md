# Café Signal: was it the update?

A Renovate or Dependabot PR is red. Did the update break your tests? Was `main` already red? Is a test flaky?
Today someone opens the logs to find out. **Café Signal answers it in the same CI job, with an experiment:**

- **candidate**: your branch as-is (the update);
- **baseline**: a separate `git worktree` of the same commit with *only* the dependency files reverted, installed
  from scratch. Same runner, OS, runtime, source code and test command;
- a failing side is re-run once, to catch flakiness.

| baseline | candidate | verdict in the PR summary |
|---|---|---|
| pass | fail (twice) | ❌ **regression**: the update breaks the tests here |
| pass | pass | ✅ compatible |
| fail | fail | ⚪ **baseline red**: not the update's fault; `main` already fails on this runner |
| pass | fail then pass | 🟡 **unstable**: flaky, not attributable |
| fail | pass | ✅ the update fixes a failure |

If the PR also changes code (for example adapting to a new API), the baseline would run new code on old
dependencies. The result is then downgraded to *observational* instead of being presented as causal.

The summary also lists the **error signatures that appear only with the update**. Each one keeps just the error type
plus the shape of its message (`TypeError: <id> is not a function`); your logs never leave the runner.

## Use it (GitHub Actions)

```yaml
on: pull_request
permissions: { contents: read }
jobs:
  signal:
    if: startsWith(github.head_ref, 'renovate/') || startsWith(github.head_ref, 'dependabot/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: fergc0708-alt/agent-cafe/signal@<commit-sha>   # pin a full SHA
        with:
          install: npm ci
          test: npm test
          # working-directory: packages/app     # monorepos: lockfile at the root is found
          # fail-on-regression: "true"          # fail only when the update is shown to be the cause
```

Locally: `node dist/cli/cafe.js signal run --install "npm ci" --test "npm test" --base main`.
Supported files: package-lock.json, pnpm-lock.yaml, yarn.lock, uv.lock, poetry.lock, pdm.lock and pinned
requirements*.txt. An install command is required, because without one the baseline would reuse the update's
packages.

## What other projects saw (optional, explicit)

`cafe signal lookup npm vite 6.3.5 7.0.0` queries observations, either the bundled public seed or a Signal
service (`--endpoint`).

- **Two kinds of evidence, never pooled.** *Paired* (causal) results and *CI status only* (observational, e.g.
  public bot PRs) are counted separately.
- **One owner = one voice.** Fifty repositories or retries of one organization count once.
- **No bare scores.** Every estimate shows the number of owners and a 90% credible interval (empirical-Bayes
  Beta prior from the package's history).
- **Conservative verdicts.** At least 3 independent owners are needed for any verdict; a single reproduced
  regression is shown as `single_report`; contradictions are shown as `mixed`.
- **Never blocks a merge on its own.**

Sharing is opt-in (`share: "true"` plus an `endpoint`). You see exactly what is sent with `cafe signal preview`:
- the proposed update and its runtime/OS;
- both results;
- the shaped signatures.

Transitive bumps and internal package names (`private-packages: "@acme/*"`) are never sent. The service:
- accepts only a GitHub Actions OIDC token whose audience is bound to that exact observation;
- accepts tokens from PR events only, each token once;
- recomputes the id and the attribution;
- takes provenance from the token, never from the client;
- keeps observations from private repositories visible only to their own organization (its "fleet" view counts
  repositories instead of owners).

Self-host: `node dist/cli/cafe.js signal serve --port 8787`, or mount `handleSignal` (already wired at
`/api/signal/v1/` in the app).

**Honest limits of the network.** A verified identity proves which repository ran the job, not that its tests are
meaningful. Free GitHub organizations make owners cheap (Sybil), so thresholds and contradiction rules limit what a
few accounts can do, but cannot make the network trustworthy against a determined attacker. See the benchmark below
for whether the network predicts anything at all.

## Benchmark: does other projects' experience predict yours?

**No, not better than existing indicators** ([`bench/RESULTS.md`](bench/RESULTS.md)). The test used 4,883 real Renovate
PRs from 2,087 owners, with a temporal split and owner holdout:

| predictor | AUC |
|---|---|
| the network | 0.614 |
| Mend Merge Confidence | 0.680 |
| Dependabot score | 0.705 |
| semver-major flag | 0.675 |
| the repository's own earlier PRs | **0.910** |

Adding the network to local signals gains nothing (90% CI −0.008 to +0.013). The network is therefore optional and
mainly useful *inside one organization* (fleet view). The product's value is the paired attribution on your own
runner.

For Python, use a fresh virtualenv per side in the install command (e.g.
`python -m venv .v && .v/bin/pip install -r requirements.txt`), so packages added by the update do not linger in the
baseline.
