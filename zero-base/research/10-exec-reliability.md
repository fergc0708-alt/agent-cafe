# 10 - Execution, verification, reliability and evaluation of AI agents

Date of research: 2026-11-25. Scope: coding agents, browser/computer-use agents, tool-calling agents, autonomous workflows.
Method: GitHub issue search (reactions/comments), web search + page fetches, papers, vendor posts. No one contacted, nothing run.

Conventions: [F] = verified fact from a source I read; [I] = my inference. "Vendor" = source sells a fix, so numbers are suspect.
Reaction counts on GitHub are a weak signal: huge counts often come from provider-quota or model-quality complaints, not infrastructure gaps.

Caveats on my own work:
- I read only the pages named. Several search results (DEV Community posts, aiweekly summaries) were seen as titles only and are NOT used as evidence.
- Per-repo REST is blocked, so I could not read comment threads, only issue bodies via search. Comment themes are not characterized.
- I did not fetch Reddit/HN threads directly (one secondary roundup of Reddit threads only). Community-demand evidence is therefore thinner than the academic/vendor/survey evidence.

---

## Ordering rule (why strength of evidence ranks this way)
Highest = independent measurement + multiple unrelated source types (survey, paper, provider admission, issue tracker, paying vendors) that agree.
Middle = one good measurement or many complaints but from one source type, or a vendor-only claim.
Lowest = plausible, a handful of complaints, or mostly my inference.

---

## 1. Agents say "done" and are wrong; self-verification and automated evals are not trusted (STRONGEST)

**Description.** Coding/workflow agents report completion without end-to-end proof; the tests they write check their own assumptions; teams ship and customers find the failure.
**Who suffers.** Any team letting agents ship code or take actions; reviewers who become the verification step.
**Frequency / cost signals [F]:**
- VentureBeat Pulse survey (Sept 2026, n=103 qualified, ~+/-10 pts, self-selected readers): 52% of enterprises that test before release had an AI feature pass tests then fail customers in the past 12 months; 30% more than once. 80% of those letting agents skip human review reported such a failure vs 36% of those requiring review (report itself says not causal). Only 17% trust automated evaluation today; only 28% have production monitoring on live-output quality; 12% don't track these failures or can't say. https://venturebeat.com/vb-pulse-agentic-reliability-and-evals-report-september-2026
- Momentic (a vendor, so biased) audited 1,000 AI-written unit tests in its own monorepo: only 9.6% were useful verification checks. Cites an experiment over 111 tasks where agents writing their own tests succeeded 65.3% vs 66.2% without. https://stackoverflow.blog/2026/11/13/your-coding-agent-shouldn-t-grade-its-own-homework/
- MAST (academic, 1,642 annotated traces, 7 open-source multi-agent frameworks): 41%-86.7% failure rates; task-verification failures ~23.5% of failure modes (incorrect verification 9.1%, missing/incomplete 8.2%, premature termination 6.2%). https://arxiv.org/html/2503.13657v3
- OpenAI (Feb 23 2026) stopped reporting SWE-bench Verified: of 138 hard problems audited, 59.4% had material test/description flaws. https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/
- Single-author experiment (n=1, Claude Code/Opus, self-reported): "completed" phases had 68% of planned E2E tests, 13% of background jobs with retry logic; adding self-audit steps often did nothing or regressed. https://dev.to/krzysztofdudek/ai-agents-say-completed-after-doing-80-of-the-job-i-have-the-numbers-lko (weak source; directionally consistent with the rest)
**Today's fix.** Human review; separate verifier agent; E2E browser tests; LLM-as-judge; rubric graders.
**Why it falls short [F/I].** Judges share blind spots with the producer (Momentic argument); VB shows only 17% trust automated eval; auto-evaluators for web tasks disagree with humans 20-40% (Emergence paper, see #3). [I] The unsolved part is verification of *non-code* actions (did the refund/booking/config change actually take effect as intended) because there is no test suite.
**Already attacked by.** Momentic ($15M Series A, Nov 2025, TechCrunch), Braintrust ($80M Series B Feb 2026), Arize, LangSmith, Galileo; Anthropic Managed Agents "Outcomes" (separate grader in own context, rubric-based; Anthropic's own testing claims up to +10 pts). https://sdtimes.com/ai/new-in-claude-managed-agents-dreaming-outcomes-and-multiagent-orchestration/
**Verdict.** Problem is real and well evidenced. It is also the most crowded; providers are building it natively.

## 2. Runaway and opaque spend: loops, token burn, no enforceable budget

**Description.** Agents burn tokens/compute in loops, retries, compaction cycles or overeager provisioning; budget controls alert after the fact; subscription limits drain unpredictably.
**Who suffers.** Heavy Claude Code/Codex users, enterprises rolling out agents, small teams with cloud credentials.
**Signals [F]:**
- Fortune (May 26 2026): Uber reportedly exhausted its entire 2026 AI-coding budget in 4 months; COO said the link to features "is not there yet". https://fortune.com/2026/05/26/uber-coo-ai-spending-tokens-claude-code/
- InfoQ (July 2026): AWS incidents; $14,000 single-day charge on an agency normally paying $10-15/month; $6,531 from an agent provisioning instances (reduced to $1,894 by AWS). Cost Explorer lags up to 24h so budget actions fire after spend. https://infoq.com/news/2026/07/ai-agents-billing-guardrails/
- GitHub: Codex #14593 "Burning tokens very fast" (307 reactions, 630 comments); Codex #28879 per-token limit cost jumped ~10-20x (557 reactions, 211 comments, June 2026); Claude Code #16157 instant usage limit hits (728 reactions, 1,499 comments); #38335 (545 reactions, 878 comments); #97074 headless `claude -p` uses ~1.8x more of the 5-hour window per token than interactive (219 reactions); a user with 7 Max plans filed #107134 asking refunds.
- CrewAI #6414 (July 2026, 55 comments, 0 reactions): delegation ping-pong and tool loops "burning thousands of dollars" before a blunt max_iter; asks for deterministic trajectory-hash guardrail.
- Codex #35226 (Jul 2026): compaction loop rereads files and consumes paid credits (only 6 reactions).
**Today's fix.** max_iter/recursion limits, cloud budgets/SCPs, gateway metrics (25% of surveyed teams per VB), kill switches, ad-hoc scripts.
**Falls short.** Blind iteration caps kill valid long runs; cloud billing lags; no cross-provider per-task/per-agent hard budget with semantic loop detection.
**Attackers.** LLM gateways/observability (cost tracking), cloud-native budgets, provider usage-based pricing shift (Anthropic moved to usage-based charging per Fortune).
**Caveat.** [I] Much of the huge GitHub engagement is about *provider quota/pricing opacity*, which a third party cannot fix. The fixable slice (per-task loop detection and hard spend caps across tools) has a handful of complaints (#6414) and several anecdote blog posts I could not verify.

## 3. Evaluation is noisy and benchmarks do not predict production

**Signals [F]:**
- Sierra tau-bench: success dropped from <50% single-run to ~25% when the same task was repeated 8 times (pass^k); Anthropic model cards now cite pass^k. https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents
- Jarmak monograph (Aug 2026, structured not exhaustive): across 60,000 SWE-bench-Verified trajectories pass@1 varied 2.2-6.0 pts per run; at temp 0 SD >1.5 pts from infra nondeterminism; author's own +0.054 single-run gain shrank to +0.0035 over 3 repeats. https://arxiv.org/pdf/2608.13867
- Emergence WebVoyager: Operator scored 68.6% vs 87% claimed; success 100% on apple.com to 35% on booking.com; auto-evaluators disagree with humans 20-40% (citing prior work). https://arxiv.org/html/2603.29020
- VB: 68% plan to adopt a new or additional eval platform within 12 months; 12% use no dedicated tool; satisfaction with primary 4.12/5 (so tools are liked, but 17% trust the outputs).
**Who suffers.** Anyone choosing models, prompts or harness changes without statistical power; evaluators of browser agents.
**Fix today.** Braintrust, LangSmith, Confident AI, in-house; repeated runs by hand.
**Attackers.** Braintrust ($80M Series B, Feb 2026, reported ~$800M valuation per Axios URL), Langfuse acquired by ClickHouse (Jan 2026), Arize, Datadog etc. [I] Eval tooling is the most funded segment of this domain; the unmet part is *cheap, statistically sound, repeated-run comparison for small teams*, which evidence only indirectly supports.

## 4. Long-run state loss: context compaction, sandbox crashes, resume

**Signals [F]:**
- Claude Code #42796 (Apr 2026; 3,286 reactions, 583 comments): a team analysed 6,852 session files / 234,760 tool calls and tied a quality regression to thinking-redaction; observed shift from research-first to edit-first. This is mostly a *model/provider behavior* complaint, not infrastructure. https://github.com/anthropics/claude-code/issues/42796
- Codex #35226: compaction loop loses progress, rereads files (weak engagement).
- Temporal (Apr 16 2026, vendor): sandbox agents can lose sandbox, conversation and work on crash; idle sandboxes waste compute. https://temporal.io/blog/introducing-temporal-and-agentic-sandboxes-openai-agents-sdk
- LangGraph #5672 (2025): cancelled run loses streamed state not yet checkpointed (9 reactions, 53 comments). LangGraph #8531 (Aug 2026): need safe prune for Postgres checkpoints.
- Chroma "Context Rot" (via Stack Overflow article): one model 89% to 38% accuracy as context grew 300 to 113k tokens.
- MAST: step repetition 15.7%, context loss 2.8% of failure modes.
**Fix today.** Compaction, memory files/CLAUDE.md, checkpoints, Temporal/Inngest/Restate/DBOS durable execution.
**Falls short.** Compaction is lossy and users report loops; checkpointing != durable execution (Restate argues this, vendor).
**Attackers.** OpenAI Agents SDK + Temporal (April 2026); Claude Managed Agents (May 2026; "dreaming" memory curation); Inngest, Restate, DBOS, Airflow (OpenAI SDK issue #6071 requests Airflow in durable-execution docs, 70 reactions).
**Verdict.** [I] Real, but infra layer is being filled by well-funded vendors and providers; the messy part (what to keep across compaction) is model-dependent.

## 5. Loops and repetition in tool-calling/multi-agent runs

**Signals [F].** MAST step repetition is the largest single failure mode (15.7%); Arize (vendor, no rates) lists recursive polling loops; CrewAI #6414; LangGraph #6731 (infinite loop until recursion limit, 30 comments); browser-use #951 and #839 (2025, 14 reactions/41 comments for "stuck, needs manual intervention").
**Fix today.** Hard iteration caps; prompt exhortations (which the CrewAI issue says fail).
**Falls short.** Caps are blind; [I] this is mostly a feature inside each framework and gateway rather than a standalone product.
**Evidence strength.** Consistent across paper + issues, but per-issue engagement is low (single digits to 14 reactions).

## 6. Permission fatigue and overeager destructive actions

**Signals [F].**
- Anthropic: users approve ~93% of permission prompts; auto mode classifier has 0.4% false positive on 10,000 real calls but lets through 17% of 52 real overeager actions; "not a drop-in replacement" for careful review on high-stakes infra. https://anthropic.com/engineering/claude-code-auto-mode (auto mode became default for paid plans Aug 14, 2026 per press).
- Claude Code issues on prompt friction: #27957 (74 reactions), #11380 (64), #30435 (40), #43713 bypass of autoAllowBashIfSandboxed (84).
- Codex #59060 (3,492 reactions, 440 comments, Nov 2026): user says a reboot request led to wrecked systemd/containers; title claims $10,000+ cost. The body is an angry rant with no reproducible detail; amount unverified. Treat as a demand/emotion signal, not evidence of cost.
**Fix today.** Sandboxes, allowlists, auto mode, per-agent cloud roles/SCPs.
**Falls short.** Classifier blind to provenance (cannot tell if an ID was fabricated), 17% miss on overeager actions.
**Attackers.** Anthropic auto mode (native), OpenAI/Codex sandboxes, E2B/Daytona/Modal sandboxes, policy-layer startups.

## 7. Problems that worsen with number of agents (coordination error amplification)

**Signals [F].** Google/MIT (Dec 2025): on strictly sequential planning all tested multi-agent variants were 39-70% worse than a single agent; independent agents amplified errors up to 17.2x vs 4.4x with a central orchestrator. https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/ MAST: inter-agent misalignment ~32.4% of failure modes. Codex #28058 (155 reactions): encrypted multi-agent messages removed the readable audit trail.
**Falls short.** Academic benchmarks; I found little production-operator complaint volume beyond audit-trail and cost.
**Attackers.** Claude Managed Agents multiagent orchestration with traces in Console; LangGraph/CrewAI/OpenAI Agents SDK.
**Strength.** Moderate: solid papers, thin practitioner demand.

## 8. Tool-call, schema and long-running-operation failures

**Signals [F].** n8n: #13440 "Received tool input did not match expected schema" (49 comments), #11886 AI nodes time out after 5 min (17 reactions, 52 comments), #21500 MCP client sends extra parameter, #14361 agent does not store tool usages in memory (33 reactions, 57 comments); openai-agents-python #325 retry for ModelBehaviorError; MCP spec: SEP-1391 long-running operations (90 comments) and SEP-1686 Tasks (70 comments), MCP #3003 tool-execution errors lack schema-governed signal (2026). Reddit roundup: Qwen 3.5 tool-calling fixes thread (~52 pts, Apr 2026), agents breaking when APIs change (~6 pts). Arize (vendor): hallucinated tool arguments, 500s treated as success.
**Fix today.** Retries, schema validation, middleware, MCP Tasks primitive.
**Attackers.** MCP Tasks (native in spec), framework updates. [I] Each framework fixes its own; low reaction counts (<35) show scattered pain, not concentrated demand.

## 9. Browser/computer-use agent reliability

**Signals [F].** Emergence numbers above (35% on booking.com); browser-use #839/#1020/#1137 (2025: stuck Chromium, blank page; 13-14 reactions), #221 human-in-the-loop (18), #652 CAPTCHA solver (9), #3074 stealth (5); 2026 browser-use issues are mostly dependency pinning and a supply-chain report (#4505, malicious litellm 1.82.8 pulled by install script, 9 reactions). Playwright MCP 2026 issues: heartbeat kills sessions (#1646), extension crashes (#1569), all 1-4 reactions. Stagehand 2026 issues: tiny.
**Verdict.** [I] Reliability is clearly imperfect (benchmark-level) but I found weak 2026 issue-tracker demand; the pain may live in closed-source/commercial users (Browserbase, etc.) I could not see.
**Attackers.** Browserbase, browser-use cloud, Stagehand caching/self-heal (Stagehand #404 asked for XPath caching 2025), OpenAI Operator/Anthropic computer use, Playwright MCP.

## 10. Valuable data generated then discarded (traces, failures, corrections) - LOWEST EVIDENCE

**Signals.** VB: only 28% have real-time quality checks on live output; 25% rely on trace logging; 12% don't track failures. Anthropic "dreaming" (May 2026) productizes mining sessions for recurring mistakes, i.e. the provider treats this as a gap. ClickHouse bought Langfuse (Jan 2026) explicitly around the "AI feedback loop". Codex #28224 shows opposite problem (feedback logs writing ~640 TB/year).
**Gap.** [I] I found no direct user complaint that says "I lose valuable agent data". This is inferred from vendor moves. Cross-agent/cross-team shared learning has no evidence of demand beyond vendor positioning.

---

## Problems that look big but lack evidence
- "77% of agents never reach production" and "80% demo-to-production failure" headlines (DEV/aiweekly titles): I saw only titles/secondary posts; no method. Not used.
- Arize "millions of decision paths" failure taxonomy: no rates, vendor sales piece.
- Inngest compounding-reliability math (5 steps at 99% = 95%): illustrative, not measured; "durable execution crossed the chasm" has no adoption numbers.
- The "$47,000 agent loop" story: appears in many DEV posts that look like retellings of one anecdote; I could not trace a primary source. The InfoQ AWS numbers are the better-sourced cost evidence.
- Claude Code #42796 (3,286 reactions) and Codex #59060 (3,492 reactions): huge engagement, but #42796 is about provider model-behavior regression and #59060 is an unspecific rant. They show frustration with agent control, not a specific buildable gap.
- Quota/pricing complaints (#16157, #28879, #14593): provider-owned; not fixable by a third party.
- Agent governance (r/grc, r/AI_Agents threads): 9-19 pts each.
- Gartner $207B AI-agent software spend: category growth, not evidence of an unmet need for a small team.
- Multi-agent scaling (item 7): strong paper, no operator-demand evidence found.
- Browser-agent reliability in 2026 issue trackers (item 9): benchmark evidence yes, current-demand evidence thin.

## Already solved or being solved natively by providers
- Permission prompts / autonomy: Claude Code auto mode (default for paid plans Aug 14 2026), sandboxed modes. Residual: 17% overeager miss.
- Rubric grading + revise loops: Claude Managed Agents "Outcomes" (May 6 2026 preview; Anthropic's test: up to +10 pts).
- Memory curation across sessions: Managed Agents "dreaming".
- Multi-agent orchestration with traces: Managed Agents multiagent; OpenAI Agents SDK handoffs.
- Sandboxes + durable execution: OpenAI Agents SDK sandbox (Apr 15 2026) with Temporal extension (Apr 16); Inngest/Restate/DBOS; E2B ($21M A), Daytona ($60M B at $1B per headlines), Modal ($355M C at $4.65B, May 2026).
- Long-running tool calls: MCP Tasks (SEP-1686) in the spec.
- Eval/observability platforms: Braintrust, Langfuse(ClickHouse), Arize/Phoenix, LangSmith, Confident AI.
- E2E AI verification of apps: Momentic and similar QA vendors.
- Loop caps: every framework has recursion/max_iter; deterministic guardrail requested (CrewAI #6414) but not shipped as of my read.

## Cross-cutting inferences [I]
1. Evidence is strongest where independent measurements agree (verification, eval noise, cost). Those are also where capital and providers are already concentrated.
2. The least-served evidence-backed slices are narrow: provenance-aware verification of non-code actions; hard per-task spend/loop caps across heterogeneous agents; statistically sound repeated-run comparison for small teams. Each needs further demand validation (I found no paying-customer signal for them).
3. Nothing here shows a problem that grows with agent count AND has operators complaining about it; that remains a hypothesis.

## Source index (main)
- VB Pulse Sept 2026: https://venturebeat.com/vb-pulse-agentic-reliability-and-evals-report-september-2026
- Stack Overflow blog Nov 13 2026: https://stackoverflow.blog/2026/11/13/your-coding-agent-shouldn-t-grade-its-own-homework/
- MAST: https://arxiv.org/html/2503.13657v3 ; Google scaling: https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/
- OpenAI SWE-bench Verified: https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/
- Jarmak: https://arxiv.org/pdf/2608.13867 ; Emergence WebVoyager: https://arxiv.org/html/2603.29020 ; Sierra: https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents
- Anthropic auto mode: https://anthropic.com/engineering/claude-code-auto-mode ; Managed Agents: https://sdtimes.com/ai/new-in-claude-managed-agents-dreaming-outcomes-and-multiagent-orchestration/
- Temporal x OpenAI: https://temporal.io/blog/introducing-temporal-and-agentic-sandboxes-openai-agents-sdk
- Cost: https://fortune.com/2026/05/26/uber-coo-ai-spending-tokens-claude-code/ ; https://infoq.com/news/2026/07/ai-agents-billing-guardrails/
- GitHub: anthropics/claude-code #42796, #16157, #38335, #97074, #27957, #11380; openai/codex #59060, #14593, #28879, #35226, #28058, #28224; crewAIInc/crewAI #6414; langchain-ai/langgraph #6731, #5672, #8531; n8n-io/n8n #13440, #11886, #14361; modelcontextprotocol #1686, #1391; browser-use #839, #4505; microsoft/playwright-mcp #1646.
- Funding: Braintrust https://siliconangle.com/2026/02/17/braintrust-breaks-80m-series-b-funding-round-become-observability-layer-ai/ ; Modal https://dealroom.co/news/129203-modal-raises-355m-series-c-at-4-65b-valuation/ ; Langfuse/ClickHouse https://www.orrick.com/en/news/2026/01/open-source-llm-observability-langfuse-acquired-by-clickhouse-inc ; Momentic https://techcrunch.com/2025/11/24/momentic-raises-15m-to-automate-software-testing
