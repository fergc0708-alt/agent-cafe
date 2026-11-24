# Validation plan and results so far

Every number below comes from a script in `experiments/v2/` and a file in `experiments/v2/results/`. Nothing here is simulated unless it says **SYNTHETIC**. Previous experiments (E1, E1b, E2, E4 in `experiments/`) are kept unchanged.

## The thesis being tested

> Agents waste time and fail on problems another agent already solved *in a specific environment*. A shared, executable, environment-scoped record of fixes (capsule + signed replays + negative results) makes the next agent faster or more correct, in a way that votes and text answers cannot.

It is **refuted** if: (a) agents solve these problems equally well without it (no utility), (b) the evidence can be faked cheaply (no trust), or (c) nobody outside us submits or replays (no network).

## Results

### A — search → fetch → local replay (IMPLEMENTED, TESTED) · `run-acd.ts` · `results/A-search-replay.json`
10 queries written as pasted error messages (not capsule titles), against the in-process registry with the 24 capsules.
- Correct capsule ranked #1 in **9/10**; the 10th (`0.1 + 0.2 rounding error in invoice total`) ranked #6.
- Replayed locally after fetching: **9/10 PASS**. The miss is informative: `py-distutils-removed` did not reproduce on the machine's system Python 3.12 because Debian ships a setuptools `distutils` shim (see C).
- Caveat: 24 capsules is a toy index; ranking quality at scale is unknown.

### B — anti-vacuity and abuse (IMPLEMENTED, TESTED) · `run-b.ts` · `results/B-adversarial.json`
19 adversarial variants of a real capsule.

| attack | outcome |
|---|---|
| always-pass check / forged "5 passed" output / import-only / swallow-all-errors | `PROBLEM_NOT_REPRODUCED` → never evidence |
| always-fail check | `FIX_FAILS` |
| existence-only check | not evidence + lint `existence_only` |
| conftest.py / sitecustomize.py / `.pth` / `python -c` / `PYTHONPATH` | rejected by the validator |
| check needs network | `FIX_FAILS` offline (never a false PASS) |
| check reads host secrets | env is scrubbed: the secret was not visible |
| infinite loop | `ERROR` (timeout) |
| **text/grep check** | **PASS, 2/6 mutants killed → counted as evidence.** Partial detection. Fixed after the run: server-side lint now caps such capsules at `runner_replayed` (`weak_check`). |
| **overfitted fix (hardcodes the check's inputs)** | **PASS 5/5 against its own check.** Not detectable by one check. A blind independent check (E) caught it. |
| **check writes outside its temp dir** | **succeeded.** The runner is not a sandbox; documented, not fixed. |

### C — compatibility matrix (IMPLEMENTED, TESTED) · `run-acd.ts`, `summarize.py` · `results/C-matrix.md`
**184 signed runs** (104 local + 80 GitHub Actions): 138 PASS, 32 PROBLEM_NOT_REPRODUCED, 14 FIX_FAILS, 0 ERROR. Runtimes: Node 20.10, 20.18, 22.11, 22.23, 24.22, Bun 1.4.4, Python 3.10–3.13 (system and clean venv), bash 5.2, plus timezone conditions.
Things the matrix shows that a text answer would not:
- `node-require-esm`: reproduces on Node 20.x and 22.11, **not** on 22.23/24 (require(esm) landed). Locally it looked "vacuous"; CI showed it is version-scoped.
- `py-distutils-removed`: same Python 3.12, different result with/without system site-packages.
- `py-fromtimestamp-local-tz`: reproduces only when `TZ` is not UTC.
- TS type-stripping capsules: `FIX_FAILS` on Node < 22.18, correctly **outside** the claimed range (not reported as contradictions).
- Mutation testing caught a weak check in our own catalog (`node-esm-dirname`), fixed.

### D — regression detection (IMPLEMENTED, TESTED) · `results/D-evidence.json`, `results/E-ci-merged.json`
Both planted "OLD" capsules were caught with no human input:
- `py-imghdr-OLD`: `regressed` (3.12 → 3.13) + `contradicted` (claims `>=3.0`); `superseded_by: py-png-magic-bytes`.
- `node-json-import-assert-OLD`: `regressed` (Node 20.18 → 22.11, only visible after the CI runs) + `contradicted`; `superseded_by: node-json-import-with`.

### E — independence (IMPLEMENTED, TESTED, with caveats) · `run-e.ts`, `run-e-ci.ts` · `results/E-*.json`
- **Runner diversity:** 8 GitHub Actions jobs generated their own keys; **184/184 signatures verified offline**, 0 rejected; after merging, 23 capsules at `cross_runner_reproduced`, 1 at `runner_replayed`. **Caveat, stated before running:** the local machine and the CI jobs belong to the same operator, so this is the Sybil problem in action: it proves machine diversity, not operator independence.
- **Verifier independence:** a separate subagent wrote checks for 7 capsules seeing only the problem text and the fixed code. All 7 pass and catch all mutants → `independent_check_confirmed`. The blind check for `py-mutable-default` **failed the overfitted fix** from B (exit 1). **Caveat:** both check authors are Claude models (correlated blind spots), so this is author independence, not model independence. The subagent could technically read the repo; it reported it did not.

### F — utility pilot (EXPERIMENTAL, inconclusive) · `F-preregistration.md`, `grade-f.ts`, `F-results.json`
Pre-registered before launch. 3 tasks × {control, café} × n=1, graded by the capsule check on both target runtimes (agents never saw the grader).

| | first-attempt success | tokens (mean) | tool uses (mean) | wall time (mean) |
|---|---|---|---|---|
| control | 3/3 | 57,951 | 4.3 | 14.6 s |
| café | 3/3 | 61,907 | 4.3 | 17.0 s |

Per the pre-registered rule this is **inconclusive** (n=1, ceiling effect). Directionally the café arm used **~7% more tokens and was ~16% slower** with **no success gain**: reading capsules costs context, and a frontier model already knows these well-documented breaks. Both café agents correctly ignored the outdated capsule, and one explicitly avoided it *because* of its limitations note. **Honest reading: on easy, well-known problems the product has no measurable utility. The value would have to come from problems the model does not know: new releases after its cutoff, private or internal toolchains, environment-specific traps.** That is the hypothesis for the next test, not a result.

## What is still unproven (PENDING; cannot be done from this session)
- ≥ 5 external users replaying or submitting capsules; retention.
- Monetization conversations.
- Utility on problems outside the model's knowledge (the only case where F could plausibly win).
- Sybil-resistant identities for runners.

## 14-day plan (metrics fixed now, not to be moved after seeing results)

| days | do | pass/fail gate |
|---|---|---|
| 1–2 | Migrate the 3 tables on a Neon **branch**, deploy v2 to a **preview** URL (needs Fer's OK). Publish the CLI from GitHub (no npm publish without OK). | preview serves the 24 capsules + evidence |
| 3–5 | Build the "post-cutoff" task set: 15 breaks from releases after the model cutoff (Node 24.x/25, Python 3.14, TS 5.9+/6, Bun, pnpm 10, Vite 7…), each with a capsule. Two of them written by an outside contributor if possible. | 15 capsules at ≥ `cross_runner_reproduced` |
| 6–9 | Re-run F at n ≥ 10 per arm per task on that set, two model families (Claude + one other). Same grader, same pre-registration. | **+10 pp first-attempt success OR −15% median time**, else the utility thesis is rejected for this wedge |
| 6–12 | Outreach: 30 maintainers / agent-tool builders (Cursor/Cline/Aider plugin authors, CI-heavy OSS) ; offer "replay your breaking-change fixes in CI". | ≥ 5 external users who replay or submit; ≥ 2 return in week 2 |
| 10–14 | 5 monetization conversations (teams with private toolchains: "private capsule registry + CI runners"). | ≥ 1 says they would pay / pilot |

**Final gate (from the mandate):** MVP with CLI + MCP ✔ · ≥ 20 capsules ✔ (24) · no votes in evidence ✔ · trivial-check detection ✔ (partial: grep checks capped, overfit needs a 2nd check) · multi-environment results ✔ · comparison with/without ✔ (pilot, inconclusive) · **≥ 5 external users ✘ · retention ✘ · monetization conversations ✘ · utility target ✘ (not met in the pilot).**
