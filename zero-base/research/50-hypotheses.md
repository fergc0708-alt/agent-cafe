# Hypotheses (Opus), from research 00–40

Gate, from `00-audit-past.md`. A hypothesis survives only if all of these hold:
- There is public, unprompted evidence of the problem, with a size.
- A payer can be named.
- The incumbent or native feature is known.
- The control arm (a frontier agent without our tool) does not already solve it.
- The experiment needs no new spend and no third-party contact.

Abbreviations: **N** = being absorbed natively by model or platform providers. **C** = crowded with funded
vendors. **E** = evidence weak or vendor-only. **R** = repeats a refuted past thesis. **S** = needs spend, outreach
or capital we do not have.

| # | hypothesis | strongest evidence (file §) | fate | reason |
|---|---|---|---|---|
| 1 | Shared cross-agent "resolution cache" (error signature → verified fix) | 30 §6 | KILL | R: Evidence Network AUC 0.614 < base rate; no demand signal for cross-org caches (30 "lacks evidence") |
| 2 | Verified project-knowledge files (AGENTS.md generator/curator) | 30 §6, #6235 6.7k reactions | KILL | N: auto-memory, AGENTS.md support shipped; evidence of savings mixed (+19% cost in ETH study); R: café eval slower |
| 3 | MCP context compressor / output summarizer | 30 §3, §5 | KILL | N: Tool Search, Code Mode; negative result: compression raised billed cost 6.8% |
| 4 | Another MCP/tool registry with health checks | 20 §6 | KILL | N: official registry upstream; mandate excludes directories |
| 5 | OAuth refresh broker for MCP clients | 20 §1 | KILL | the bug is in clients; vendors fix it; no payer |
| 6 | Multi-account connector manager | 20 §2, 708+1,467 reactions | KILL | N: client feature Anthropic/OpenAI will ship |
| 7 | Enterprise IAM for MCP (SSO, audit) | 20 §5 | KILL | C/N: Okta XAA, ID-JAG, Keycard $38M, NewCore $66M |
| 8 | Agent payments rails / x402 tooling | 20 §7, 40 §6 | KILL | E: 0.6–7.5% of x402 volume agentic (~$5–11k/mo); C: Stripe, Visa, Coinbase |
| 9 | Agent-native checkout for merchants | 40 §6 | KILL | N: ACP; OpenAI dropped Instant Checkout (demand thin) |
| 10 | A2A coordination layer | 20 §9 | KILL | E: thin production use |
| 11 | Multi-agent orchestration framework | 10 §7, 20 §8 | KILL | C/N: Managed Agents orchestration, SDKs; failure is model-level |
| 12 | Approval-policy engine (cut approval fatigue) | 10 §6, 20 §4 | KILL | N: Claude Code auto mode default; 93% accept rate is the provider's metric |
| 13 | Agent sandbox / compute | 40 §10 | KILL | C: 14–15 providers, Modal $355M, Daytona $60M, E2B |
| 14 | Durable execution / resume for long runs | 10 §4 | KILL | C/N: Temporal ext. for Agents SDK, Inngest, Restate, DBOS, MCP Tasks |
| 15 | Browser-agent reliability layer | 10 §9, 40 §1 | KILL | C: Browserbase, Steel, Kernel, Browser Use; E: thin issue demand |
| 16 | Agent identity: inboxes/phones for signups | 40 §7 | KILL | C: AgentMail $6M; legal grey zone |
| 17 | Credential/2FA vault for browser agents | 40 §2 | KILL | C/N: 1Password + Browserbase/Kernel/Steel |
| 18 | Anti-bot "agent passport" for websites | 40 §1 | KILL | N: Cloudflare Web Bot Auth / signed agents; bot evasion is a red line |
| 19 | Pay-per-crawl for publishers | 40 §1 | KILL | N: Cloudflare Pay Per Use / Monetization Gateway |
| 20 | Secrets scanner for agent/MCP configs | 40 §3 (12% literal secrets) | KILL | C: GitGuardian, TruffleHog, Hush $30M, Infisical $40M |
| 21 | Prompt-injection firewall | 40 §4 | KILL | N/C: model-level defenses (13.8%→2%), Lakera-class vendors; arms race |
| 22 | Agent-action insurance / liability | 40 §5 | KILL | S: regulated, capital-heavy |
| 23 | Audit/compliance ledger for agent actions | 40 §9 | KILL | E: weakest-ranked evidence; C: observability vendors |
| 24 | Human-in-the-loop task market for agents | 40 §8 | KILL | E: no measured demand; S: two-sided marketplace |
| 25 | Model router for cost | 30 §2 | KILL | C: OpenRouter, Martian, NotDiamond, gateways |
| 26 | LLM gateway with budgets | 10 §2, 30 §2 | KILL | C: LiteLLM, Portkey, Helicone, Cloudflare AI Gateway |
| 27 | Eval platform for small teams (repeated-run comparison) | 10 §3 | KILL | C: Braintrust $80M, Langfuse→ClickHouse; the audit says benchmarks ≠ value |
| 28 | Trace data marketplace ("discarded data") | 10 §10 | KILL | E: lowest evidence; R: data-moat assumption refuted |
| 29 | Docs/API freshness for coding agents | 30 §8 | KILL | C: Context7, Mintlify; llms.txt 97% zero requests |
| 30 | Memory-quality auditor (junk memories) | 30 §7 | KILL | E: single-user case; N: provider memory curation ("dreaming") |
| 31 | Slopsquatting / agent package-install firewall | not researched | KILL | C: Socket Firewall et al.; R: dependency domain again |
| 32 | **Prompt-cache economics optimizer for third-party agent harnesses** | 30 §1: cache creation+reads ≈80% of billed cost (2,848 runs); TTL cut 1h→5m outrage (#46829, 341) | **FINALIST A** | the largest measured cost driver; every non-provider harness re-implements caching; offline experiment possible on public traces without spend |
| 33 | **Hard runtime spend governor (per task/agent, cross-provider, sub-minute)** | 10 §2: billing lags up to 24h; Uber's annual budget gone in 4 months; IDC: 67% exceed budgets by >10%, 45% have real-time dashboards | **FINALIST B** | evidence strong and economic; incumbents meter but may not stop runaway tasks in real time |
| 34 | **Independent outcome verification for non-code agent actions** | 10 §1: 52% had a feature pass tests and fail customers; 17% trust automated evals | **FINALIST C** | strongest "pain" signal; native graders are self-grading |

Next: one independent critic per finalist, whose only job is to show why we should not build it. Critics get the
thesis and the research files, not this table's reasoning.
