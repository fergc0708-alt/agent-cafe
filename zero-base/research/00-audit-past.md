# 00 - Audit of past iterations (blunt)

Auditor, not defender. Sources: git history of /home/claude/agent-cafe (branches main, goat/experiments, goat/evidence-network, goat/prove, goat/signal, goat/signal-bench), docs/GOAT-VERDICT-2.md, docs/PRODUCT-DECISION.md, bench/RESULTS.md, /home/claude/research/critic-v2.md. All commits fall between 2026-11-24 12:38 and 2026-11-25 17:45 (-0300): roughly 29 wall-clock hours, ~45 commits, ~210k inserted lines on goat/signal-bench vs the first commit (a lot of it data/logs; ~9.5k in bench/ alone).

"Café Doctor" = `cafe doctor` CLI command (environment fingerprint + project scan + env-aware capsule engine), commits c8c5223 (16:07) and 7eb5aea (16:20) on 11-24. It is a feature of iteration 2/3, not a separate product.

## 1. Timeline

| # | Iteration (branch, commits) | What it tried to be | Engineering | Demand evidence BEFORE building | How it ended |
|---|---|---|---|---|---|
| 1 | Agent Café v0.1 (main: bbba394, 9432ce4, d4129b5; 11-24 12:38 onward) | A web "library/café" for AI agents: validated entries (2-provider confirmation), logbook, open problems; MCP server w/ 16 tools, skill.md, llms.txt, OpenAPI, Postgres, deployed to Vercel | ~69 files, REST+MCP+Next.js+Postgres+security model, launch plan (docs/LANZAMIENTO.md) | None. VISION.md itself says "Primero hay que atraer tráfico de agentes; la monetización se ve después" and admits "'Llevar tráfico de agentes' no pasa solo". 20 seed entries written by the builder. No user, no interview, no query data | Never got users. Superseded by GOAT experiments within hours (c1d14c1 13:34). E2 (synthetic) showed the v1 validation rule let 23/30 sybil entries through and confirmed 13-36% of false ones |
| 2 | Evidence network / Fix Capsules (goat/evidence-network: c1d14c1 .. c1eb37e; 11-24 13:34-~16:20) | Replayable, signed "fix capsules" with environment matrix; DSSE attestations, OIDC runner identity, bubblewrap sandbox, 24 then 18 capsules, `cafe doctor/diagnose/capture`, GitHub Action | ~348 files, +30.7k lines vs main; 3 red-team rounds; 184 signed runs | None external. GOAT-VERDICT-2: "0 external users, 0 sales conversations". Pilot F (utility) showed 3/3 vs 3/3, café arm ~7% more tokens, ~16% more time | Own verdict: "en problemas conocidos, el modelo no nos necesita"; "verified levels 24/24 draft", no verified runners existed |
| 3 | Café Prove (goat/prove: 042437e .. 676d8d6; 11-24 ~16:30-17:10) | Same product re-aimed at "upgrade breaks" with pre-registered eval and a 32-break real benchmark | Eval harness, Action fixes (G4-1), distribution tests | Own pre-registered eval: 6/6 vs 6/6 success, café arm +61% slower on wedge tasks (experiments/eval/RESULTS.md). Bench: found 4/32 vs free tools 9/32, 1 unique case (Node ships a codemod) (experiments/bench/RESULTS.md). 127 public issues surveyed; 69% of breaks invisible to static tools | docs/PRODUCT-DECISION.md: "Stop developing ... Do not seek users for it." Three independent measurements negative. 0 installs, 0 conversations |
| 4 | Café Signal v1 (goat/signal: 747cba2, 8c0f1c1, 5368d0f; 11-24 18:23-19:42) | Cross-repository "network" predicting whether a dependency update will break your repo; owner-level evidence engine, OIDC ingestion, Action | Whole engine + Sybil thresholds + 4,883-PR dataset | Built on the idea from the Prove decision, no customer contact | 5368d0f: "network NO-GO". Network AUC 0.614 vs package base rate 0.621; gain over local data [-0.008,+0.013]; Mend 0.680, Dependabot 0.705, own history 0.910. The data-accumulation thesis lost to a repo's own history |
| 5 | Signal v2 "diagnosis tool" (goat/signal: 8c50616, df9e339, a95a3ea; 11-25 02:29 onward) | Rebuilt from scratch: baseline-vs-update test attribution for red Renovate/Dependabot PRs; "was it the update?" | New engine, hardened execution layer; two further red-team rounds (second found 4 wrong *confident* verdicts) | critic-v2: lastgreen, Drift, dep-bisector, ncu --doctor already exist; GitHub/GitLab ship fix agents; "Not a business". Pain was asserted from BUMP paper and GitHub search counts, not from users | Benchmarked rather than sold |
| 6 | Signal real-PR bench (goat/signal-bench: 1db9d3e .. cb0584f; 11-25 13:23-17:45) | Pre-registered 250-PR benchmark of attribution correctness | 250 cases, 879 CI jobs, independent verification | The bench itself is the first honest measurement of demand-adjacent facts | bench/RESULTS.md: PIVOT. 0 attribution errors, but coverage 39.3% (42/107), only 8 confirmed regressions in 200 red bot PRs (CI-red stratum: 83 determinate, 8 pos / 75 neg), 50 cases red on both sides without per-test evidence, 28 Node-mismatch, 26 base-install failures. 4 defects in Signal found by the run itself |

Net: six artifacts in ~29 hours, zero external users, zero customer conversations, zero revenue, zero deploys beyond the iteration-1 Vercel site. Four of six produced a self-written kill verdict, each within hours of the previous build.

## 2. Suspected errors: verdicts

### E1. Building before proving problem size - PRESENT (all iterations)
- Iteration 1: VISION.md plans traffic first, monetization later; no problem sizing. 20 self-written seed entries.
- Iteration 2: GOAT-VERDICT-2 table: "People will use / pay for it - NOT tested - 0 external users, 0 sales conversations."
- Iteration 4: the network NO-GO (5368d0f) was measured only after the engine, OIDC ingestion, Sybil thresholds existed (747cba2 -> 8c0f1c1 -> 5368d0f).
- Iteration 5: problem size for "red bot PR needs diagnosis" was only measured by bench (8 regressions / 200 red PRs, i.e. 4%). A 5-minute GitHub search + a look at 30 red PRs would have shown most red PRs fail for non-test reasons.
- Prove PRODUCT-DECISION: "No team has asked for it", and outreach was never done.

### E2. Confusing technical differentiation with competitive advantage - PRESENT
- Capsules with signed replay matrices and OIDC identity were genuinely novel, and the red team's sharpest point (GOAT-VERDICT-2): "without trusted runners, accumulated attestations are claims... That is content, about as defensible as a good answer with a test attached."
- Signal v2's one differentiator over lastgreen was per-test diff on a red base (critic-v2 section 1). The bench confirms it works (14/14 on red baseline, lastgreen 2/2 false exoneration), but only 14 of 250 cases exercised it (5.6%).
- "Signal 0.0% false exoneration vs lastgreen 60.0% on shared npm cases" is a win on n=5 npm positives; it does not translate into customers.

### E3. Confusing working infrastructure with valuable product - PRESENT (strongest pattern)
- Iteration 2: 184 signed runs, 9 keys, 184/184 signatures verified, 44 tests - and the product did not make agents better (F: 3/3 vs 3/3).
- Iteration 3: pre-registered eval 8/8 vs 8/8 both runs, +56-61% slower. PRODUCT-DECISION: "The executed-evidence layer ... is technically sound, but it guarantees the quality of fixes for problems that are already well documented. Neither agents nor teams lack that."
- Iteration 1: 16 MCP tools, llms.txt, OpenAPI, JSON-LD, registry metadata: distribution plumbing for an audience nobody confirmed.

### E4. Assuming data accumulation is a moat - PRESENT (and measured false)
- 5368d0f / experiments/signal-network/bench/RESULTS.md: network AUC 0.614 vs package base rate 0.621; adding the network to local features gives +[-0.008,+0.013] AUC. The repository's own history gives 0.910 (coverage only 31%), i.e. the valuable data is private and local, not pooled.
- Capsule registry: with no verified runners the "matrix" is claims (GOAT-VERDICT-2 risk 2 and 8: "no moat beyond curated content").
- Iteration 1: validation by votes is gameable (E2 synthetic: 23/30 sybil entries validated).

### E5. Optimizing benchmarks that do not represent economic value - PRESENT
- Signal benchmark optimizes attribution *correctness* (false exoneration/accusation). Result 0 errors, but the economic question is "does a team pay to avoid X minutes of triage", never measured (critic-v2 section 6: "Triage time has no public measurement"; the 5 min x 300 PR/month = 25h figure is the critic's assumption).
- Naive baselines are strong: `naive_always` ("it's a regression") has 100% sensitivity; the benchmark exposes that the real choice is between a 75.8%-false-accusation naive and abstention, not between tools.
- The Prove bench scored whether a tool flagged lines changed by the fix (±3 lines) on 32 hand-collected cases, again a detection proxy. Only 12/32 were statically visible at all.
- Iteration 2's experiments A-E measured the system's internal integrity (replay PASS 9/10, signatures verified), not user outcomes. Only F measured outcomes, and it was negative.
- Mitigating: the pre-registered, independently verified Signal bench is honest about its limits and was the first to measure something outside the author's own catalog.

### E6. Shrinking the market to preserve a thesis - PRESENT
- Agent Café -> "fix capsules" -> "upgrade breaks wedge" -> "post-cutoff / private toolchains" -> "dependency PR diagnosis" -> "red base-branch scenario". Each step narrowed to the sub-segment where the previous negative did not strictly apply. GOAT-VERDICT-2: "pivot the wedge to post-cutoff/private" after F showed no utility on known problems; PRODUCT-DECISION then lists "Private Toolchain Intelligence: unproven, no signal" as the surviving direction.
- Signal's differentiating scenario (red base) is 84/250 cases and only 14 determinate; the headline segment is shrunk until the claim becomes true (red baseline: 14/14 agreement, 100% coverage).
- The benchmark pre-registration also adds segments (baseline green/red/flaky, CI-red/green, per-bot, npm-only), which gives many cuts in which something looks good (e.g. 14/14 and 100% coverage in the red-baseline cut).
- Note: this is partly legitimate narrowing, but the rule used was "find where we win", not "find where someone pays".

### E7. Too much engineering before demand - PRESENT (extreme)
- ~29 hours, 6 artifacts, 210k inserted lines on the final branch; 3 red-team rounds on iterations 2/3 and a 4th/5th on Signal (a95a3ea: "4 wrong confident verdicts, 4 medium, 7 low"), all hardening a product with 0 users.
- Heavy security investment (bubblewrap sandbox, DSSE, OIDC with job_workflow_ref pinning, ReDoS guard) for a registry nobody used.
- Counter-evidence: much engineering was driven by experiments, not features, which is why failures were found cheaply. But the experiments tested the builder's questions, not the customer's.

## 3. Other repeated errors

1. **Self-referential validation.** Builder writes seed content, builds the check, runs the experiment, and the author-agent reads the result. GOAT-VERDICT-2 admits "same operator, same model family"; eval ran only Claude agents; cross-family run "remains unperformed". The independent verifier on the Signal bench is the first break from this.
2. **Customer = an AI agent or a bot.** Iterations 1-3 had an AI agent as "user"; iteration 4-6 have a bot PR as the object. The paying human (platform team, OSS maintainer) never appears; critic-v2: "OSS maintainers will not pay. Platform teams ... already own test analytics and fix agents".
3. **Incumbent blindness until late.** Competitors (lastgreen, Drift, dep-bisector, ncu --doctor, Copilot/GitLab fix agents) were documented only after Signal v2 was built (critic-v2, signal-audit-v2) and platform owners ship the fix themselves (GitHub Apr/Jun 2026).
4. **Frontier model already knows the answer.** Iteration 2 F, iteration 3 eval (8/8 vs 8/8), and Signal's own failure modes share the cause: when the thing is documented, a generic agent is as good with fewer steps. Added tools cost time (+16%, +56-61%).
5. **Pivot every few hours, with sunk cost carried forward.** Each pivot reused the same codebase and identity ("Café"), keeping the engine rather than starting from the customer. Signal's rebuild (8c50616) was a full rewrite triggered by a critic, not by a user.
6. **Wrong-confident verdicts.** The tool's most dangerous failure (false exoneration "safe to merge") was found by critics each time (critic-v2 table of 8 verified false conclusions on 8c50616; second red team on a95a3ea). Even after the bench, 4 more defects (Node < 22.12 crash, lockfile parse misses) came out of real data, not unit tests.
7. **Authorization gates as excuse.** "Outreach needs Fer's OK", "contacting them needs authorization" appear in PRODUCT-DECISION; the one test that could find demand (talk to 30 candidates) was the only one never run, while ~45 commits of code were.
8. **Narrative overshoot.** GOAT-VERDICT-2 headlines "núcleo técnico funciona" before the line "no probado ... que le sirva a alguien". Positive framing of technical wins is persistent even in self-critical documents.

## 4. Rules for the next venture (each tied to an observed failure)

1. No code (beyond a throwaway script) until at least N real, named people in the paying role describe the problem and its cost unprompted. (Iterations 1-5 all built with 0 conversations.)
2. Size the problem with a cheap public-data count of *occurrences x cost* before any build. (Signal: 8 regressions in 200 red PRs only discovered at the end.)
3. Kill criteria and the pre-registered test come before the engine, and the test must measure a buyer outcome (time saved, money, a signed intent), not correctness of the tool. (E5; Signal bench measured correctness only.)
4. Name the paying human and the incumbent before day one; if the platform owner (GitHub, GitLab, an LLM vendor) can ship it as a feature, assume they will. (critic-v2; GitHub fix-with-agent.)
5. Test against "frontier model alone, no tool" as the control in the first hour. (F, eval: 6/6 vs 6/6.)
6. Do not claim a moat from pooled data without a held-out test that the pool beats a local baseline. (Network AUC 0.614 vs own history 0.910.)
7. A narrowing of the wedge must be driven by a segment where someone pays, not where the tool wins. Max one pivot per piece of external evidence. (E6.)
8. Cap pre-demand engineering: at most 1 day / a few hundred lines per hypothesis; security hardening only after a user exists. (E7: 5 red-team rounds, 0 users.)
9. Never self-validate: results must be re-derived by someone else, with a control arm of a different model family. (Self-referential validation.)
10. Schedule the outreach/interview step first and do the authorization request up front, so it is not the only unexecuted step. (Other error 7.)

## 5. Assets worth reusing (skeptical)

- **Method, not code:** pre-registered protocol with frozen cases, deviations log, Clopper-Pearson intervals, an independent re-derivation of results (goat/signal-bench: bench/PROTOCOL.md, bench/RESULTS.md). This is the one genuinely rare, reusable asset. Cost to reuse: low.
- **Honest-failure habit:** each branch records its own kill verdict (docs/PRODUCT-DECISION.md, GOAT-VERDICT-2). Keep.
- **Dataset of 250 labeled bot PRs with CI outcomes and a 4,883-PR Renovate sample** (signal/seed, bench/cases.json): only valuable if the next venture is in CI/dependency territory; otherwise discard. Moderate, narrow.
- **Isolation/execution harness for third-party code (bubblewrap, SHA-pinned actions, OIDC):** technically sound but reusable only if the next product executes untrusted code; do not let its existence steer the venture.
- **Not worth reusing:** Agent Café v0.1 site and MCP (no users, narrow concept); the capsule registry and evidence-level system (claims without verified runners; thesis negative); Signal engine itself (competitors exist, 39% coverage, 4 known defects); Doctor CLI (fed by capsules that did not help). Sunk cost; start from the customer.

Confidence: high on the timeline and on the presence of E1, E3, E4, E7 (direct numbers in the repo); medium on E5/E6 (judgement about intent); lower on the effort estimate (commit timestamps only, no time-tracking).
