# DECISIONS

| date | decision | why | evidence |
|---|---|---|---|
| 2026-11-25 | Start from zero; no obligation to reuse Agent Café / Signal | Fer's mandate; Signal benchmark verdict PIVOT | goat/signal-bench: bench/RESULTS.md |
| 2026-11-25 | Adopt the audit's rules (research/00-audit-past.md §4) as gates for every hypothesis | All 7 suspected errors confirmed with evidence | research/00-audit-past.md |
| 2026-11-25 | "Named people describing the problem unprompted" is satisfied only by PUBLIC unprompted evidence (issues, threads, docs), since contacting third parties is not authorized; the gap to real customer conversations is reported, not hidden | Mandate §9 forbids contacting third parties; audit rule 1/10 needs outreach | mandate; audit |
| 2026-11-25 | Control arm for any experiment = frontier model/agent with no tool of ours | audit rule 5 | audit |
| 2026-11-25 | Finalists: A cache-economics optimizer, B runtime spend governor, C outcome verification; 31 others killed | research/50-hypotheses.md gate | research 10–40 |
| 2026-11-25 | KILL finalist A (cache optimizer) | provider automatic caching + gateway auto-caching (Vercel, OpenRouter, LiteLLM) + free OSS; the 80% is unavoidable cost, not waste | reviews/critic-A-cache.md |
| 2026-11-25 | KILL finalist C (outcome verification) | survey off-target; per-integration read-backs without leverage; Braintrust/Composio already there; DIY genre; standing read access to every system | reviews/critic-C-verify.md |
| 2026-11-25 | KILL finalist B (spend governor) | LiteLLM OSS hard budgets+session caps; OpenAI/Anthropic/Google/AWS hard limits shipped Jun–Aug 2026; Uber/IDC are forecasting/ROI, not runaway loops | reviews/critic-B-spend.md |
| 2026-11-25 | FINAL VERDICT: KILL the agent-infrastructure search; build nothing (no experiment/code: building would be the mediocre build the mandate forbids) | 34 hypotheses dead; 3 finalists killed by critics; independent reviewer KILL, no unfair kills; binding constraint: no outreach + no capital vs providers shipping fixes as quarterly features | reviews/verdict-independent.md |
