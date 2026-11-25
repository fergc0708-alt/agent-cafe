# 20 - Coordination, interoperability, discovery, identity/auth and payments for AI agents

Research date: 2026-11-25. Method: GitHub search API (reactions/comments), WebSearch/WebFetch of primary posts, vendor forums, papers. Notes: per-repo REST blocked; one GitHub issue page (claude-code #27302) was not fetchable (permission prompt unanswered), so its figures come from the search API only. Funding figures come from search-result headlines, not from reading the articles. Several sources are vendors who sell the fix (flagged). Quotes < 15 words.

Legend: [V] verified in a source I read; [S] seen only in a search snippet/headline; [I] my inference.

## Problems ordered by strength of evidence
Ordering rationale: first, problems with many independent reporters across multiple vendors' own forums/issue trackers plus a vendor admission; then problems with one rigorous measurement; then problems evidenced mainly by vendor blogs or funding.

### 1. OAuth token lifecycle for MCP connectors breaks in clients (refresh not used, session loss, re-auth loops)
- Description: access tokens expire (~15-60 min) and clients fail to refresh or lose MCP sessions, forcing manual re-auth mid-task.
- Who suffers: every developer/user of remote MCP (Claude Code, Cursor, ChatGPT, Codex, Windsurf, VS Code) and server vendors.
- Frequency [V]: Cursor staff acknowledged they store refresh tokens but do not use them; reporter shows ~15-20 min failures (Cursor 2.4.7, Jan 2026) https://forum.cursor.com/t/cursor-does-not-refresh-oauth-tokens-for-mcp-servers/149511 . Atlassian Rovo MCP thread: >=18 named users, 9+ clients affected, Jan-Mar 2026 with repeated "fixed" releases that did not fix; Atlassian itself blames clients that mishandle refresh (logout ~every 55 min) and cancelled-mid-refresh stale tokens https://community.atlassian.com/forums/Atlassian-Remote-MCP-Server/constant-authorization-timeouts/m-p/3197282 . OpenAI forum: ChatGPT connector refreshed token and opened new MCP session before every tool call; staff said "internal caching issue", loop reportedly returned after redeploys https://community.openai.com/t/chatgpt-mcp-connector-refreshes-token-on-every-tool-call-and-doesnt-persist-sessions/1377210 . GitHub: claude-code #3433 (GitHub remote MCP OAuth) 154 reactions/58 comments, still open [S]; openai/codex #31573 OAuth issuer validation fails, #48237 401 (105 reactions) [S].
- Agent-side failure modes [V, vendor blog by Scalekit, sells auth]: silent 401->empty result treated as "no results", concurrent refresh race producing invalid_grant, rotation conflict, silent revocation https://www.scalekit.com/blog/oauth-token-refresh-long-running-agents
- Cost: no dollar figure. Cost is lost/partially completed runs and repeated human re-auth. Per-request token TTL math: Google 60 min => 12 refreshes in a 12 h run.
- Today: restart/reconnect manually; mcp-remote shim; API tokens (Atlassian requires org admin); auth-as-a-service vendors (Scalekit $5.5M [S], Arcade, WorkOS, Descope, Composio).
- Why it falls short: bug is in each client implementation, not the spec; fixes ship per client.
- Attackers: client vendors (will likely fix themselves), auth vendors, MCP spec Agent Identity WG (formed Aug 2026) [V via WorkOS].
- Inference [I]: the durable gap is a conformance/test harness for clients+servers, but that is a small tooling niche and the fixes are controlled by the clients.

### 2. Multiple accounts for the same connector/identity are unsupported
- Description: users can't connect two accounts (work/personal, client A/client B) to the same connector/MCP server.
- Frequency [S, search API counts]: anthropics/claude-code #27302 "Support multiple Connector accounts" 708 reactions, 327 comments, open (created 2026-02-21); #18435 multiple Claude accounts in Desktop 1467 reactions/255 comments, open; openai/codex #20500 multiple named accounts per app/connector 147 reactions, open; codex #4432 --auth-profile 156 reactions.
- Who: freelancers/agencies/consultants (directly relevant to the user's profile) and anyone with split work/personal identities.
- Today: separate profiles/containers, multiple MCP config entries with different names, hand-managed tokens.
- Why short: native clients assume one identity per connector. Likely to be fixed natively by Anthropic/OpenAI given reaction counts [I].
- Strength note: highest raw reaction counts I found, but demand is for a client feature, not a third-party product.

### 3. Tool-definition bloat and tool-selection degradation as tool count grows
- Description: every connected MCP server injects schemas each turn; accuracy degrades with tool count.
- Evidence [V via Unblocked, which sells a context layer, mostly secondary figures]: ~300-600 tokens per tool; a 3-server setup cited at ~143k of 200k tokens; RAG-MCP cited accuracy 43% -> <14% with many tools; Cloudflare Code Mode cited 1.17M -> ~1,000 tokens https://getunblocked.com/blog/mcp-tool-overload/ . Anthropic issue claude-code #23787 [S]. MCP issues SEP-1300 tool filtering 30 reactions/60 comments [V counts].
- Gets worse with scale: yes, linear in servers.
- Today: Anthropic Tool Search (deferred loading), Cloudflare Code Mode, allow-lists, Stacklok optimizer, gateways.
- Killed natively: Anthropic tool search, OpenAI/Cloudflare code-mode approaches. Idea space is largely closed for small teams [I].

### 4. Human approval fatigue / avoidable approval prompts
- Evidence [V]: Anthropic reports users accept 93% of manual permission prompts; auto mode (classifier) cut this; false positive 0.4% but it missed 17% of real overeager actions (n=52) and 5.7% of synthetic exfiltration (n=1,000) https://www.anthropic.com/news/claude-code-auto-mode (2026-03-25). Reports that auto mode went default [S, devops.com headline].
- Interpretation: 93% approvals = prompts are mostly noise, yet 17% miss rate means automation is not safe for high stakes. The unsolved part is authorization policy that is scoped/delegable, not click reduction.
- Attackers: Anthropic (native), OpenAI, Microsoft. Natively addressed; a startup would sit above a moving native feature.

### 5. Enterprise MCP authorization does not fit enterprise IAM (anonymous DCR, backend-as-auth-server, no audit)
- Evidence: spec-level debate: modelcontextprotocol #205 (make MCP server a resource server) 150 reactions/88 comments, closed (spec changed June 2025) [V counts]; #991 CIMD client registration 36 reactions, closed; #1299 session-bound authorization 25/30. Solo.io: "enterprises don't allow anonymous DCR" [V, Solo sells gateway]. Doyensec (2026-03-05) lists CVEs and gaps in the new enterprise-managed grant: no revocation story, no jti replay requirement, unspecified client credential lifecycle [V]. MCP roadmap (March 2026) names audit/observability, enterprise-managed auth (Cross-App Access), gateway semantics, config portability as gaps; Aug 22 2026 roadmap adds Agent Identity WG with DPoP, Workload Identity Federation (SEP-1933), ID-JAG, RFC 8693 [V via WorkOS].
- Who attacks: Okta Cross App Access, Microsoft Entra, WorkOS, Descope, Keycard, Scalekit, gateways. Funding signals [S, headlines only]: NewCore $66M seed (2026-06-15), Keycard $38M, Hush Security $30M Series A (2026-07-28), Infisical $40M Series B at $600M, Defakto $30.75M, Obsidian $85M. Heavily funded - not a space for a 1-2 person team to out-compete.

### 6. Unreliable / unusable MCP server endpoints and registry hygiene
- Evidence [V, single author, snapshot 2026-07-29, corrected 2026-08-24]: of 10,716 remote endpoints in the official registry, 18-25% hard-unusable (9.7% 404, 4.2% DNS fail, 2.2% 5xx); only 43-46% completed anonymous handshake (rest auth-gated or failed) https://dev.to/theopslog/i-checked-every-mcp-server-in-the-official-registry-about-1-in-10-is-broken-1ehj . Caveat: anonymous handshake lower bound, not uptime.
- Today: official registry (won as upstream per headline [S]); aggregators scrape it. "Another directory" is excluded by brief; this evidence shows the gap is hygiene/health monitoring, which registry operators can add [I].

### 7. Agent payments: low real usage; the problem is demand and attribution, not rails
- Evidence [V]: TRM Labs (2026-09-09): ~$52.7M over 198.9M x402 transactions since May 2025; ~half not commerce; only 0.6-7.5% of screened commerce looks agentic; monthly agent volume ~$5k-11k; agent-registry ownership claims "voluntary and mostly unused" https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain . Forkast 2026-07-10: Artemis estimates ~50% artificial; ~$28k/day real [V; their figures not reconciled]. Forrester (2026-04-09): OpenAI discontinued Instant Checkout in March 2026; Walmart in-chat conversion ~1/3 of click-out; Visa pilots "hundreds" of transactions; Stripe admits "overhyped too early" [V].
- Real problems visible: no human approval point, controls that assume humans don't work, payments too small for value thresholds but too numerous for count thresholds [V TRM].
- Attackers: Stripe (ACP, MPP with Tempo), Google (UCP, AP2), Visa/Mastercard, Coinbase/Cloudflare x402 Foundation (Linux Foundation, Apr 2026). Crowded by incumbents; evidence that demand is the bottleneck.

### 8. Multi-agent coordination fails frequently; not fixed by protocols
- Evidence [V]: MAST paper (NeurIPS 2025): 7 open-source MAS frameworks fail 41%-86.7% of tasks across 1,642 traces; failures are design/inter-agent misalignment/verification; protocol fixes alone insufficient https://arxiv.org/html/2503.13657v3 . Role clarification +9.4%, verification step +15.6% on specific systems.
- Who suffers: builders of orchestrated multi-agent systems. Solved today by: avoid multi-agent, single agent with tools [I].
- Weakness for opportunity: research is 2025 data on older models; I did not find 2026 re-measurement.

### 9. A2A: broad "support", thin evidence of production use; open parts (identity, discovery, billing) unsolved
- Evidence: Linux Foundation claims 150+ orgs (April 2026) [V via glukhov.org, which says it's unverified, no named deployments]; A2A moved to a foundation (Axios 2026-08-17 [S]). GitHub: A2A #153 confused deputy 12 reactions open; #297 registrar proposal 6 reactions open; #1990 epic on auth/credential discovery in AgentCard open 2026-06 (2 reactions) [V counts]. Low reaction counts = low developer pull relative to MCP.
- Marketplaces need identity, reputation, billing, dispute resolution that A2A doesn't provide [V via glukhov; commentary].

## Looks big but lacks evidence
- Agent-to-agent payments / "agent economy" marketplace: volume small and partly wash trading (TRM, Artemis); Forrester expects B2B first.
- Agent registry/reputation network: A2A registrar issue has 6 reactions; ERC-8004 registry ownership "mostly unused" (TRM).
- Generic "agent identity" startup: large funding (see #5) proves category interest, not an open niche for a small team.
- MCP directories/marketplaces: official registry is upstream; only health/hygiene gap shown.
- A2A as a standard: counts of supporters, not usage.

## Already solved / being solved natively
- Context bloat: Anthropic Tool Search, Cloudflare Code Mode.
- Approval fatigue: Claude Code auto mode (default per headline, Aug 2026 [S]).
- Enterprise SSO for MCP: Okta Cross App Access, Claude Enterprise IdP integration, MCP ID-JAG/EMA (InfoQ 2026-07 [S]).
- Client registration: CIMD (SEP-991) adopted; Scalekit announced support [S].
- Stateless transport/horizontal scaling: SEP-1442 (72 reactions, 92 comments) and 2026 roadmap [V].
- In-chat checkout: OpenAI dropped Instant Checkout (Mar 2026) - an example of a native feature killed.

## Gaps in this research
- Did not read Reddit/HN threads directly (search returned vendor/community forums). No hard dollar cost of any failure was found anywhere; costs are in tokens, time, or failure %.
- GitHub reaction counts are from the search API and not independently opened; claude-code #27302 content not read.
