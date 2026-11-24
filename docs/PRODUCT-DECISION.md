# Product decision after GOAT 4 (2026-11-24)

## Decision

**Stop developing Agent Café as a product of curated "known breaks" with executed evidence. Do not seek users
for it.** The code remains as a working, documented open-source tool on `goat/prove`. Nothing has been merged,
deployed or published.

## Why: three independent measurements, all negative

| question | evidence | result |
|---|---|---|
| Does it help an agent fix a break? | Pre-registered eval, run twice, the second time after fixing both defects ([`experiments/eval`](../experiments/eval/RESULTS.md)) | 8/8 vs 8/8 both times. Agents with Agent Café were 56% slower and spent 2 more tool calls. |
| Does it find real breaks that free tools miss? | 32 real breaks from public commits, collected blind ([`experiments/bench`](../experiments/bench/RESULTS.md)) | It found 4. mypy alone found 7; the free tools together found 9. Only 1 case was unique to us, and Node ships an official codemod for it. |
| Do the breaks teams hit fit what it does? | Same benchmark, plus 127 public issues opened Aug–Nov 2026 ([`experiments/adoption`](../experiments/adoption/)) | No static tool sees 69% of real breaks (behaviour, build, dependencies). The most common open pain is dependencies that do not install on the new version, which `pip install --dry-run --python-version X --only-binary=:all:` or `uv` already answers. |

The executed-evidence layer (capsules, OIDC, signatures) is technically sound, but it guarantees the quality of fixes
for problems that are already well documented. Neither agents nor teams lack that.

## The five directions in the mandate, against the evidence

| direction | verdict | reason |
|---|---|---|
| Upgrade Impact Analysis (static) | **no** | Type checkers with `--python-version` / `@types/node@N` already do it, with complete data maintained by others. |
| Compatibility Drift Detection | **no, as a product** | A CI matrix entry, Renovate's runtime PRs, or `setup-python` with `allow-prereleases` already do it. |
| Cross-Version Fix Engineering | **no** | A frontier agent fixes documented breaks unaided (eval). In the bench, the fixes that mattered were project-specific. |
| Evidence-Backed Migration | **no** | The evidence certifies what nobody doubts. Two agents rejected our distutils fix as weaker than their own. |
| Private Toolchain Intelligence (`capture`) | **unproven, no signal** | No team has asked for it. It cannot be measured without real users, and contacting them needs authorization. |

## The only signal worth a cheap test (not built)

Ten of the 30 most recent open issues are stdlib removals (`cgi`, `telnetlib`, `crypt`, `spwd`). mypy or pyright
would have flagged them in one line, yet those teams do not run them that way. The gap is **distribution, not
detection**.

A one-hour test is enough: an "upgrade preflight" Action that only *combines* free tools for the target version:
- differential mypy/pyright/tsc;
- pylint `deprecated-*`;
- pip/uv `--dry-run` for dependencies.

It would be a convenience wrapper with no moat, worth open-sourcing, not charging for. Pursue it only if problem
interviews with the [30 candidates](../experiments/adoption/candidates.json) (not contacted; outreach needs Fer's OK)
show that teams want a single pre-upgrade check.

## What was delivered in this round

- **Defects fixed and tested:**
  - G4-1: the Action described the runner's default runtimes instead of the job's. Found by the new distribution test,
    fixed, regression test added, verified in real CI.
  - Bounded MCP preview set; explicit tool annotations.
- **Safe distributable Action:**
  - The README pins a full commit SHA.
  - Every third-party action in the workflows is SHA-pinned.
  - A CI job consumes the action by SHA, exactly as an external repository would, and checks that the report describes
    the job's runtimes.
- **Clean install:** a fresh clone with no `npm install` works on Node 22 and 24 (CLI, doctor, MCP).
- **Real benchmark and competitor comparison:** `experiments/bench/`.
- **External users:** **0** installs, **0** returning users, **0** conversations. No external communication was sent.
