# Does other projects' experience predict yours? (GOAT 5 benchmark, 2026-11-24)

**No, not better than what already exists. The cross-repository network is a NO-GO as a data advantage.**

## Data (public, reproducible)

- **Source:** Renovate PRs on GitHub, collected with the search API's `status:` qualifier.
- **Packages:** typescript, vite, vitest, eslint, @types/node, pytest and ruff. `next`, `typescript-eslint` and
  `@playwright/test` were planned but cut because of GitHub's secondary rate limits.
- **Sampling:** stratified by package × ISO week × CI status, keeping the newest 100 PRs per stratum. Each stratum's
  true total is kept, so every metric is **weighted** back to the real mix.
- **Size:** 4,883 PRs from 3,180 repositories and 2,087 owners, opened 2026-08-31 to 2026-11-22. Grouped updates are
  dropped, records are de-duplicated per repo and transition, and from == to is dropped.
- **Files:**
  - `signal/seed/prs-all.jsonl`: raw structured fields only.
  - `signal/seed/totals_*.json`: stratum sizes.
  - `signal/seed/observations.json`: the shipped seed.
- **Discarded first collection:** failures and successes were sampled by separate queries, so the version leaked the
  label and inflated the network AUC to 0.91. It is kept in `seed/raw-v0` with a note.

## Protocol (`signal/bench/predict.ts`)

- **Temporal split:** the evaluation set is every PR opened on or after 2026-10-19 (n = 2,123).
- **Evidence cutoff:** evidence for a test PR comes only from **earlier weeks**. Inside a week the sample keeps the
  newest PRs, so same-week timing could leak the label.
- **Project holdout:** network evidence excludes the PR's own owner. The local baselines may use the repository's own
  earlier PRs, which is what a team has without any network.
- **Uncertainty:** 90% intervals come from a bootstrap clustered by owner (B = 1000, mulberry32).
- **Existing indicators:**
  - Mend Merge Confidence: public badge, levels identified by image hash.
  - Dependabot compatibility score: public badge.
  - **Both are read today**, so they include information that arrived after the PR. That is an advantage for them.

## Results (evaluation set, weighted; failure share 15.5%)

| predictor | AUC | 90% CI | coverage |
|---|---|---|---|
| **Café Signal network** (other owners, same target version, earlier weeks) | **0.614** | 0.586–0.642 | 99% |
| package base rate | 0.621 | 0.593–0.648 | 100% |
| semver major bump | 0.675 | 0.651–0.699 | 100% |
| Mend Merge Confidence | 0.680 | 0.652–0.706 | 100% |
| Dependabot compatibility score | 0.705 | 0.676–0.732 | 93% |
| **the repository's own earlier PRs** (local, no network) | **0.910** | 0.881–0.933 | 31% |

- **Head-to-head** on the 633 rows where every indicator exists: network 0.539, Mend 0.567, Dependabot 0.615,
  semver 0.611, own history 0.915.
- **Added value over local data:** a logistic model on local features only (own history, its size, semver) scores
  AUC 0.777. Adding the network gives 0.779, a gain of **[−0.008, +0.013]** (90% CI). That is **no measurable
  gain**.
- **Calibration:**
  - The network's CI-status estimate has a Brier score of 0.150, worse than predicting the base rate (0.133).
  - Rows the network put at 0.6–0.8 failed 15% of the time.
  - The product therefore no longer shows a percentage for CI-status-only evidence, only counts.
- **Warnings per 100 upgrades:**
  - Engine verdicts: 0.02% of updates warned. The thresholds are conservative on purpose (Sybil resistance), so
    recall is ~0.
  - "Network estimate > 50%": precision 0.29, recall 0.20, 7.4 false warnings per 100 upgrades.
  - Mend "low": 0.39 / 0.45 / 10.8.
  - Own history > 50%: 0.48 / 0.81 / 9.8.
- **Timing is not the problem.** For each target version with 5+ owners, 86% of PRs were opened more than 7 days
  after the first PR we saw. This is an upper bound because of newest-first sampling, but a warning would usually
  arrive in time. The signal simply does not discriminate.

## What this means

1. **Public CI-status outcomes from other projects predict a new project's outcome worse than signals that already
   exist.** That includes Mend, Dependabot and even a semver-major flag. They add nothing to local data. The network
   effect is **not established** with observational data. A related study reportedly found the same pattern
   (arXiv 2403.09012: crowd score AUC 0.62 vs the client's own history 0.76). UNVERIFIED by us: relayed by a research
   agent, the page could not be fetched in this session.
2. **The dominant signal is local.** Repositories whose bot PRs were red before are red again (AUC 0.91). The cause
   of a red bot PR is mostly a property of the project and its CI, not of the update. That is exactly what a paired
   baseline/candidate run identifies on the spot, without any network.
3. **Not tested, and not claimed:**
   - whether *paired* (causal) observations would predict better. None exist publicly; it needs real users.
   - same-week evidence. No package-week in the evaluation window was small enough to be unsampled.
