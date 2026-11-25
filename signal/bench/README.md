# Real-PR benchmark (prepared, NOT run)

**Goal.** Measure Signal on real red Renovate PRs from public projects, against oracles taken from each project's
own history, never from Signal's logic.

- **Base oracle:** the project's original CI conclusion on the base commit, i.e. "main was already red".
- **Update oracle:** its original CI on the bot's commit.
- **Maintainer oracle:** whether maintainers had to add code commits to the PR ("the update needed code changes").

**Cases.** [`candidates.json`](candidates.json) holds 120 PRs (90 red, 30 green), one per owner, opened October to
November 2026. They were drawn at random (seed 42) from the Renovate PRs collected for the network experiment; none
were chosen by looking at Signal's output.

**Status: not run.** Running it executes about 110 third-party projects' install scripts and tests. It would happen
on GitHub-hosted runners with no token permissions and no secrets, but the session's safety policy requires Fer's
explicit authorization. The workflow is kept here, outside `.github/workflows/`, so it cannot be triggered by
accident.

**To run it, once authorized:**
1. Copy [`signal-bench.workflow.yml`](signal-bench.workflow.yml) to `.github/workflows/signal-bench.yml` on
   `goat/signal`.
2. Dispatch it from the Actions tab.
3. Download the `result-*` artifacts and the `cases` artifact.

**Planned metrics:**
- attribution precision and recall for "update-caused" against the oracles;
- false accusations;
- inconclusive rate;
- agreement on re-runs (20 repeated cases);
- extra CI time per red PR.

Every metric is to be reported split by case type (red base, green base, grouped, single update) and with Wilson
90% intervals.
