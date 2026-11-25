# 30 - Memory, context, token consumption and cost of AI agents

Date of research: 2026-11-25. Method: GitHub search API (reaction counts), WebSearch/WebFetch. Several fetches were blocked by a permission prompt that nobody answered (GitHub issue #46829 body, claude.com context-management article, getzep blog, one dev.to paper summary); those items rely on search-result titles or on secondary coverage, and are marked.
Convention: FACT = in a cited source. INFERENCE = my reading. Vendor-authored numbers are flagged "(vendor)".

## Verdict (short)
The pain is real and heavily documented, but the biggest pieces (tool-definition bloat, memory across sessions, context clearing, cache pricing) are being absorbed by the model/harness providers themselves. The least-covered gaps are cross-agent / cross-organization sharing of what agents learn, and cost observability; both have thin direct evidence of paid demand.

## Why the ordering below (strength of evidence)
Ordered by: (1) independent measurement with sample sizes, (2) large reaction/comment counts or provider acknowledgement, (3) multiple independent sources agreeing, (4) paying market already visible. Vendor-authored numbers rank lower. Problems whose evidence is mostly one vendor's blog sit lower regardless of how plausible they sound.

---

## Problems, strongest evidence first

### 1. Usage limits / quota burn and prompt-cache economics in coding agents
- Description: Users on flat-rate plans and API see budgets vanish faster than expected; the main driver is cache behavior on large, long contexts, not output.
- Who suffers: heavy Claude Code / Codex users, teams on subscriptions.
- Frequency: very high. GitHub (anthropics/claude-code): #16157 "Instantly hitting usage limits" (728 reactions, 1499 comments, Jan 2026); #38335 "session limits exhausted abnormally fast since March 23, 2026" (545 reactions, 878 comments); #46829 "Cache TTL silently regressed from 1h to 5m" (341 reactions); #40524 "Conversation history invalidated on subsequent turns" (223). openai/codex: #28879 "rate-limit cost per token jumped ~10-20x since June 16" (557 reactions, 211 comments); #14593 "Burning tokens very fast" (307 reactions, 630 comments, closed with no stated cause).
- Cost (sourced): The Register (Apr 2026): cache write 5m = +25% over base, 1h = +100%, read ~10% of base; a Claude Code lead said a stale-session resume on the 1M window "is often a full miss". Independent study of 2,848 runs (arXiv 2607.12161 via alphaxiv): cache creation 44.3% and cache reads 35.4% of billed cost; tool outputs only ~3.3%.
- Today's solution: manual /clear, shorter sessions, staying within 5-minute windows, auditing logs with small scripts (several dev.to posts).
- Why insufficient: cost is driven by provider-side TTL/pricing that users cannot control; the same issue flipped between plans silently.
- Who attacks it: Anthropic/OpenAI directly (they own TTL, pricing, default context size - Anthropic said it was investigating a 400k default).
- INFERENCE: demand is real, but any third-party fix is hostage to provider pricing changes. Central risk: one pricing/TTL change erases or creates the problem overnight.
- Links: https://github.com/anthropics/claude-code/issues/16157 , https://github.com/anthropics/claude-code/issues/38335 , https://github.com/anthropics/claude-code/issues/46829 , https://github.com/openai/codex/issues/28879 , https://www.theregister.com/2026/04/13/claude_code_cache_confusion/ , https://www.alphaxiv.org/abs/2607.12161

### 2. Agentic bill growth and lack of cost visibility in production
- Description: Per-token prices fell but total bills rose because agents resend growing history and run many turns; teams cannot forecast or attribute cost per task.
- Who suffers: companies running agents in production; finance/platform teams.
- Frequency: broad survey data.
- Cost (sourced): IDC (Aug 2026): 67% of enterprises exceeded agent budgets by >10% in 12 months; average monthly inference+orchestration spend $117,558 among those with visibility; only 45.4% have real-time token dashboards. Elastic blog: 2026 audit of 30 engineering teams attributed 62% of the inference bill to resent history; same task cost varied up to 30x between runs; agentic = 5-30x chatbot tokens (secondary claims, original audit not verified).
- Today's solution: LLM observability/gateway products, manual logging, budgets.
- Why insufficient: only 8% have implemented LLM observability per the Elastic-cited survey; attribution to a completed task is hard.
- Who attacks it: large observability/gateway vendors and cloud providers (crowded).
- INFERENCE: the problem is real but the solution space is crowded with funded vendors; a 1-2 person team has no obvious edge.
- Links: https://www.idc.com/resource-center/blog/the-agent-economy-is-scaling-faster-than-it-can-be-metered/ , https://www.elastic.co/blog/token-costs-ai-bills

### 3. MCP tool-definition and tool-response bloat (largely solved natively for definitions)
- Description: Tool schemas loaded up front eat the window; large responses (browser snapshots, issue lists) eat it during work.
- Who suffers: anyone running several MCP servers.
- Cost (sourced): Unblocked (May 2026): 7-server setup ~71,300 tokens (~35% of 200k); GitHub MCP ~42k-55k; Playwright snapshot ~56 KB; 20 GitHub issues ~59 KB; a tool-search subagent cut 51k to 8.5k. Claimed MCP 4-32x costlier than CLI (OnlyCLI benchmark, Scalekit replication: $3.20 vs $55.20 per 10k ops) - secondary, unverified.
- Today's solution: pruning servers, CLIs instead of MCP, output-filtering proxies (context-mode, RTK, Headroom).
- Why insufficient: filtering responses saves tokens but not necessarily money - see problem 5.
- Who attacks it: Anthropic shipped MCP Tool Search (Jan 15 2026): ~134k -> ~5k tokens in Anthropic internal testing, auto-activates when tool descriptions exceed 10% of window (VentureBeat).
- INFERENCE: definition bloat is mostly gone for Claude Code users; response bloat remains and is harness-level.
- Links: https://getunblocked.com/blog/mcp-token-budget-autopsy/ , https://venturebeat.com/orchestration/claude-code-just-got-updated-with-one-of-the-most-requested-user-features

### 4. Long-context degradation ("context rot") and long-session decay
- Description: Quality falls as input grows; sessions need compaction or resets.
- Who suffers: all long-running agent users.
- Evidence: Chroma (Jul 2025): 18 models tested, reliability drops with length; on LongMemEval a ~300-token focused prompt beat a ~113k-token full prompt for every model family. Claude Code #42796 "unusable for complex engineering tasks with the Feb updates" has 3,286 reactions and 583 comments (title only checked; cause may be model behavior rather than context - do not over-read). Letta #3270: compaction "performs full context wipe" instead of honoring a percentage.
- Today's solution: /compact, /clear, subagents, context editing, handoff notes.
- Why insufficient: compaction is lossy; no standard way to verify what was lost.
- Who attacks it: model labs (longer, better long-context models) and harnesses (compaction, context editing in the API).
- Caveat: Chroma data predates 2026 models. INFERENCE: a model update could shrink this materially.
- Links: https://trychroma.com/research/context-rot , https://github.com/anthropics/claude-code/issues/42796

### 5. Token compression does not reliably reduce cost (negative result worth knowing)
- Description: Tools that shrink tool output/context often fail to cut the bill.
- Evidence: arXiv 2607.12161, 2,848 runs, 103 tasks, 7 repos, one provider: RTK-ML cut tool-output tokens 38.4% yet billed cost rose 6.8%; Headroom raised billed cost 48.4%; token-vs-cost correlation r=0.15; tool outputs ~3.3% of cost. Compression changed agent behavior (more re-retrieval).
- Implication (INFERENCE): "compress outputs" is a weak product thesis; the real cost is cache creation/reads, i.e. number of turns times context size. Value lies in avoiding exploration turns, not trimming outputs.
- Caveat: single agent/provider; Codex replication was mixed (cost -12.5% but wall time +238%).
- Link: https://www.alphaxiv.org/abs/2607.12161

### 6. Agents re-explore the same repository / API every session; knowledge generated then discarded
- Description: Each new session or subagent re-reads files and re-derives structure.
- Who suffers: every coding-agent user; worse with more agents/subagents.
- Evidence: one vendor (vexp) measured ~180k tokens per task of which ~50k relevant, 23 tool calls, FastAPI repo, 42 runs; vendor claims 58% cost cut ($0.78 to $0.33) - vendor-authored, small sample. Independent: AGENTS.md study (arXiv 2601.20404, 124 PRs, Codex) found median runtime -28.6% and output tokens -16.6% with an AGENTS.md, but total tokens barely changed (-1.3%). ETH Zurich study (via InfoQ, Mar 2026): LLM-generated context files lowered success ~3% and raised cost >20%; human-written files raised success ~4% and cost up to 19%.
- Today's solution: hand-written AGENTS.md/CLAUDE.md (GitHub #6235 "Support AGENTS.md" 6,696 reactions - the single most-reacted request; #31005 660 reactions), repo indexers, claude-mem (65k-74k stars per Augment pages, not verified firsthand), Claude Code native auto-memory (Feb 2026).
- Why insufficient: context files add steps/cost; auto-generated ones can hurt; knowledge stays per-repo and per-machine.
- Who attacks it: Anthropic (auto memory, per-project MEMORY.md), OpenAI, Cursor/Augment-style indexers.
- INFERENCE: demand for persistence is strongly evidenced (reaction counts, star counts), but proof that it saves money is weak and mixed. Cross-repo/cross-org sharing has no direct evidence.
- Links: https://github.com/anthropics/claude-code/issues/6235 , https://arxiv.org/html/2601.20404 , https://infoq.com/news/2026/03/agents-context-file-value-review/ , https://dev.to/nicolalessi/i-tracked-every-token-my-ai-coding-agent-consumed-for-a-week-70-was-waste-465 (vendor)

### 7. Memory-layer quality: stored memories are mostly junk
- Description: Automatic memory extraction pollutes stores, then pollutes future context.
- Evidence: mem0 issue #4573 (Mar 2026, n=1 user, 10,134 entries, one agent, 32 days): 97.8% junk; 52.7% of junk were restated boot files; 808 entries asserted a false "prefers Vim" through a feedback loop. Single audit, 7 reactions - isolated, but specific and measured. Graphiti #1275: all graph nodes sent to the LLM, O(n) growth failing at scale. Letta/Zep/mem0 all argue markdown is insufficient (vendor marketing).
- Market: Mem0 raised $24M Series A (Oct 2025, TechCrunch). Several memory vendors exist.
- Who attacks it: mem0, Zep, Letta, Supermemory, plus lab-native memory (Claude memory merged across chat and Cowork; Claude Code auto memory).
- INFERENCE: a funded, crowded category; one audit is not demand for a new entrant.
- Links: https://github.com/mem0ai/mem0/issues/4573 , https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps

### 8. Docs/API retrieval for coding agents (stale APIs)
- Description: Models use outdated library APIs; agents fetch whole doc pages to fix it.
- Evidence: Context7 (vendor, May 2026): vs web search, cost/query $0.22 vs $0.14 (-34.6%), total tokens ~136.6k vs ~84.3k, 100 queries, Opus 4.7; no accuracy measured. Context7 GitHub issues have low reactions (top: 17) and reports of rate limits (#808) and duplicate-library cleanup (#339, 99 comments) - small engagement.
- Today's solution: context7, Docs7 (Mintlify-compatible host, per a runtimewire headline - not verified), llms.txt, vendor MCP doc servers, Mintlify. Ahrefs (May 2026, 137,210 sites): ~28% publish llms.txt but 97% of those got zero requests.
- Why insufficient: llms.txt is largely not read; retrieval returns variable-size chunks.
- Who attacks it: Upstash/context7, Mintlify, doc hosts adding MCP, browser/search tools in agents.
- INFERENCE: the saving per query is real but small (cents); incumbents are established. Not a gap for a new entrant.
- Links: https://upstash.com/blog/context7-vs-web-search-benchmark , https://ahrefs.com/blog/llmstxt-study/

### 9. Local-process memory bloat in agent harnesses (not token related)
- opencode "Memory Megathread" #20695 (173 reactions): sessions of 1.5-2.5 GB RAM, some tens of GB. This is engineering debt in one harness, listed only to separate it from token/context memory. Maintainer says fixed in opencode2.
- Link: https://github.com/anomalyco/opencode/issues/20695

---

## Looks big but lacks evidence
- Cross-agent / cross-organization shared cache of "what agents learned" (repo structure, API quirks, doc fixes): I found no issue, survey or product showing paying demand. It is an inference from problem 6 (re-exploration), not an observed need. Privacy/trust of sharing code-derived knowledge across organizations is an unaddressed barrier.
- llms.txt as a standard for agent-readable docs: 97% of files receive no requests (Ahrefs, May 2026).
- Output compression proxies as a cost saver: contradicted by the 2,848-run study (problem 5), except as context-window relief.
- "70% of tokens are waste" claims: vendor-authored, 42 runs on one repo.
- Memory-store hygiene products: one n=1 audit; a vendor-crowded space.
- MCP-vs-CLI "32x cost" claims: secondary sources, unverified.
- Market growth stats (agent counts to 2030): category growth, not an opportunity for a small team.

## Already solved or being solved natively
- MCP tool-definition bloat: Claude Code MCP Tool Search (Jan 2026), ~85% reduction in Anthropic testing.
- Cross-session memory in the harness: Claude Code auto memory, MEMORY.md per project (Feb 2026); Claude memory merged across chat and Cowork; Codex also has memories (title seen in search, not examined).
- Context clearing/editing and a memory tool in the Claude API (Anthropic context-management announcement; page fetch was blocked, so details not verified here).
- AGENTS.md convention: widely adopted; the most-reacted Claude Code request (#6235, 6,696) asks for support.
- Cache TTL/pricing: owned by providers; Anthropic said it was investigating a 400k default context.

## Central risks for any idea in this domain
1. A provider changes cache TTL, pricing, default context size, or ships native memory/compaction, erasing the gap (already happened for tool search, auto memory).
2. Evidence that cost savings are real is weak: the one independent large study found compression often raised cost.
3. Most quantitative "waste" numbers are vendor-authored with small samples.

## Gaps in this research
- No Hacker News/Reddit threads were read directly (search only returned dev.to and blogs); reaction counts come from GitHub only.
- Funding data only for Mem0 ($24M, Oct 2025); no pricing pages checked.
- claude-mem star counts come from Augment pages, not GitHub.
