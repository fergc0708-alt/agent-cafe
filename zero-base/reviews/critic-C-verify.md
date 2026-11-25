# Critic C: why a 1-2 person team should NOT build "independent outcome verification for non-code agent actions"

Date: 2026-11-25. Adversarial by assignment; honest about what I could not kill (section 9).
Method: WebSearch/WebFetch, GitHub repo search. Nothing contacted. Fetch results are summaries from a small model; where noted I did not see raw text.

## Verdict
No. The survey does not measure this problem, the check itself is a cheap per-integration read-back that builders already write in-house or get from the integration/observability layer, and the buyer who would pay for "independent" needs the most trust, the broadest read credentials, and a sales cycle a 1-2 person team cannot survive.

## 1. The cited survey does not support THIS problem
Fetched https://venturebeat.com/vb-pulse-agentic-reliability-and-evals-report-september-2026 and asked directly.
- n=103 qualified of 115 responses; self-selected readers; ~10 pt margin; 46% answered about a *client* org, not their own; mostly 100-250 employee firms.
- "Failure" is undefined: "an incorrect output, a broken workflow or a quality incident." The 52% counts bad answers and quality incidents, not "agent said sent, nothing was sent."
- The report "does not ask about verifying the actions agents take in external systems" and does not mention external-state verification at all.
- The 17% "trust automated evaluation" is about eval tooling (LLM judges, test suites), not about state read-back, which is deterministic and a different thing. Distrust of judges is an argument *against* an LLM-rubric product, and does not demonstrate demand for a state-checking one.
- 80% vs 36% (skip human review vs require it) is n=40/36 and the report itself says it is not causal.
- Top vendor-selection factor: ease of integration 41%, ahead of accuracy 18%. Buyers want it inside the tool they already have (OpenAI Developer Platform 32%, Claude Console 17%, Braintrust 17%, LangSmith 11%).
- The strongest evidence in the project's own research file (10-exec-reliability.md section 1) is about *code* agents (Momentic's test audit, SWE-bench). The non-code claim is tagged "[I] my inference" in that file. The thesis rests on an inference.

## 2. Verification is inherently per-integration: no leverage
The oneuptime write-up (https://oneuptime.com/blog/post/2026-11-16-how-to-verify-ai-agent-tool-success-by-tracing-external-state-readbacks/view) shows the whole technique: define a predicate over external state, write op-id, read back from the authoritative source, handle `verified / mismatch / timeout / unavailable`. Per integration you need a write-matching read adapter, a predicate, consistency handling (caches return stale reads), and failure tests. Effort scales linearly with the number of systems and operations. A 1-2 person team ships a handful of connectors (Gmail, HubSpot, Stripe) against thousands of SaaS apps plus every customer's custom internal system. "Did the refund post as intended" differs per PSP, per ledger, per partial-refund rule. The intent predicate ("right person", "totals right") still must come from the customer, so the product is a predicate-authoring tool, which is the Braintrust scorer.
- The GoodBarber MCP post (https://dev.to/pierrelaurentmedori/your-mcp-write-returned-200-did-the-right-thing-actually-happen-38n0) argues the right place for verification is the *server side* of each system (read-your-writes read-back flags, version-bound writes, set-level change logs). Eventual consistency makes a third-party read-back falsely report failure ("a cached read returned a stale copy after a delete"). The party best placed to verify is the system owner, not an outsider.

## 3. The capability exists, is documented, and is free
- Braintrust: "stateful agent evals" with trace-scoped scorers asserting the agent "left the environment in the right state"; online scoring on production traffic. https://www.braintrust.dev/blog/stateful-agent-evals (the page shows no dedicated external-query feature; you write the scorer, which is the same work any new entrant would ask customers to do).
- LangSmith, Arize and Braintrust docs all cover agent trajectory/outcome evals: https://docs.langchain.com/oss/python/langchain/evals , https://www.braintrust.dev/articles/how-to-test-ai-agents , https://arize.com/?p=30198
- Composio logs every tool call at the proxy layer with outcome, HTTP status, user, timestamps, SIEM export, independent of the model trace. It does not do read-back, which is a one-feature gap for a funded vendor to add. https://composio.dev/blog/ai-agent-observability-tool-layer ; Arcade has execution tool logs: https://www.arcade.dev/blog/execution-tool-logs
- Salesforce ships Agentforce Testing Center for its own agents: https://www.salesforce.com/news/press-releases/2024/11/20/agentforce-testing-center-announcement/ . Every system-of-record vendor has the incentive and the access to build this natively.
- DIY is trivial and spreading as a blog genre: "Your agent said it worked: go check the world, not the sentence" (https://dev.to/saurav_bhattacharya/your-agent-said-it-worked-go-check-the-world-not-the-sentence-1m2f); "Your AI agent says done, who checks from outside the agent?" (https://dev.to/nexuslabzen/your-ai-agent-says-done-who-checks-that-from-outside-the-agent-3fe4); a refund-claim checker built in a weekend that matches claims to tool calls with no LLM (https://dev.to/rockyrockers/our-ai-agent-told-a-customer-it-processed-a-refund-it-didnt-25a3). When builders write the product as a tutorial, willingness to pay is near zero.
- The open-source layer is crowded with free tools: godkiller-mcp, x-harness, proof-loop, execution-proofs, axiom, stalegreen (GitHub search "verify agent claims done"; stars 4-30). Mostly code-agent oriented, but proves the cheap-DIY substitute exists and nobody has broken out.
- An n8n community thread documents the same failure and discusses homegrown fixes: https://community.n8n.io/t/has-your-agent-ever-claimed-it-did-something-that-didnt-actually-happen/316129

## 4. "Same vendor grading itself" is weaker than it sounds
- The Anthropic Outcomes grader (https://platform.claude.com/docs/en/managed-agents/define-outcomes) is a rubric grader over an *artifact* in a separate context window. The docs do not say it queries external systems. So it is not even the direct competitor; that actually helps me less than it sounds (see section 9), but it also shows the vendor's design choice: rubric on artifacts, not state probes. The vendor can add a tool-using grader with an MCP read tool any time; the grader already runs in the vendor's loop and the customer already granted MCP/tool credentials there.
- "Independence" from the model vendor is satisfied by a deterministic read of the system of record. That check needs no independent *company*, only independent *code*, which the customer writes in an afternoon (section 3).

## 5. Who pays: nobody identifiable in a 1-2 person motion
- Buyers of reliability tooling are eval/platform/AI-engineering teams who already hold Braintrust/LangSmith (68% plan to *add or replace* a platform, i.e. consolidate in the incumbents). Ease of integration beats accuracy 41% to 18%, which is a bundling signal.
- Compliance/trust buyers (CISO, risk) buy from security vendors with SOC 2, pen tests and references. Well-funded entrants already crowd "trust layer for agents": Baselayer $35M Series A (https://siliconangle.com/2026/09/22/with-35m-in-series-a-funding-baselayer-is-building-the-trust-layer-for-the-agentic-economy/), Nava $8.3M seed verification layer for financial agents (https://pulse2.com/nava-ai-8-3-million-raised-to-build-verification-layer-for-autonomous-financial-agents/amp/), Beltic $7.3M (https://dealroom.co/news/157963-beltic-raises-7-3m-seed-to-police-what-ai-agents-can-do/), Capsule Security $7M seed (https://fintech.global/2026/04/16/capsule-security-exits-stealth-with-7m-seed-round). Different sub-problems (identity, DeFi, runtime security), but the same buyer budget line and the same "trust layer" pitch against teams with 10x the capital.
- SMB agent builders (reachable for a small team) have the lowest willingness to pay and the highest DIY rate.

## 6. Security and permissions: the product is a standing read-everything credential
To verify "the CRM record really changed" and "the email went to the right person" the service needs read scopes to the customer's CRM, mailbox, ledger and sheets. That is a honeypot with the data-exfiltration blast radius of the agents it audits, sold by two people with no SOC 2. Mailbox/CRM read scopes also trigger the enterprise security review that kills small-vendor deals (months, questionnaires, DPA). The verifier is also a second prompt-injection surface if it uses an LLM to interpret system content. Customers will instead run the check inside their own VPC (back to DIY) or inside the integration vendor that already holds the OAuth tokens (Composio, Arcade, Zapier-type layers), which makes those vendors the natural owners of this feature.

## 7. Frontier models and harnesses already narrow the gap
- Readback is a documented pattern tool authors and MCP servers are adopting ("verified read-back" flags; plan-then-commit). Once write tools return authoritative post-state (Stripe-style objects returned on write), the "reported done but wasn't" failure converts into a normal API error the agent sees. The surviving failures are *intent* errors (right call, wrong target), which require customer-specific rubrics: the LLM-judge/eval space everyone distrusts and where incumbents already live.
- Agent harnesses (Managed Agents Outcomes, OpenAI AgentKit evals/graders: https://openai.com/index/introducing-agentkit/ ) are adding grader loops on a quarterly cadence. The self-check-then-retry loop is the product category the labs ship natively; the MAST data (https://arxiv.org/html/2503.13657v3) say verification failures are ~23.5% of failure modes, a minority, with step repetition and others the larger share.
- Contrary data point I should flag (hurts my case in the short term): Momentic reports self-written tests barely beat no tests (65.3% vs 66.2%). That says self-check passes are weak *for code*, not that a third party for non-code beats them.

## 8. Distribution
- No natural wedge: the integration surface (MCP, tool-calling) belongs to Composio, Arcade, Zapier, n8n, labs. A verifier that sits "before the agent reports done" must be inserted into the customer's agent loop (SDK change, latency, new failure point on every call), against vendors already inside the loop.
- Category is a free blog topic with an open-source long tail and no named winner: no demand pull to ride and no aggregator or marketplace to distribute through.
- Selling "trust" to a skeptical audience: 17% trust automated evals, so a new automated verifier starts with the very trust deficit it claims to cure.
- Evidence in this repo's own research of *paid* demand for non-code verification: none found. The file's own caveat: community demand evidence is thin; Reddit/HN not fetched.

## 9. What I could not kill (honest)
- The gap is real: Composio logs record that HTTP 200 came back, not that the record holds the intended value; the Outcomes grader does not document external probing. Failures like "told customer a refund was processed, never called the tool" are real, with documented anecdotes.
- A narrow niche could exist: a deterministic post-condition check for one high-stakes vertical (money movement, for example) sold as an add-on to an existing integration/orchestration layer. But that is a *feature* for Composio/Stripe/Braintrust to ship, a partnership or acquisition-target outcome, and is not a standalone company for two people.
- My search cannot see private demand (sales calls, paid pilots). Absence of public paid demand is not proof of none.

## Confidence
~80% that this should not be built as a standalone product by 1-2 people. Weakest link in my own case: lack of direct evidence on enterprise willingness to pay (cannot see private buying data).

## Sources not fully read
GitHub search was repo-search only (no issue search results retrieved). The GitHub output for 'verify agent claims done' was read from the head only. Funding-article summaries came from fetch-model summaries. I did not independently confirm Baselayer/Beltic/Capsule scope beyond titles and snippets.
