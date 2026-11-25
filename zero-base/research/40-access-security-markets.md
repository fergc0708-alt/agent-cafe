# 40 - Access, security and new markets created by autonomous agents

Date: 2026-11-25. Method: web search/fetch + GitHub issue search by reactions. Labels: [FACT] = in a cited source; [INFERENCE] = mine. Many pages were fetched through a summarizing model, so figures are as reported and not re-verified against the originals. Vendor blogs are marked as vendor-biased.

Red lines: CAPTCHA-solving and bot-evasion services (Capsolver integration requests, "stealth" modes, residential-proxy evasion) are evidence of Problem 1 only. They are not product candidates.

Ordering is by STRENGTH OF EVIDENCE. The reasoning for each rank is in the "Why this rank" line.

---

## 1. Agents are blocked or degraded by anti-bot systems, and platforms are making blocking the default

- Description: agent browsers are flagged on network, TLS, headless-environment, behavior and identity signals. [FACT] Site owners are also moving to block agents by policy, not only by accident.
- Who suffers: every builder of browser agents, and every end user whose agent must act on a third-party site.
- Frequency [FACT]:
  - Headless Chromium got 403/429/503 on 15.2% of the top 10k sites, versus 6.8-7.2% for headed browsers (Bamberg crawl, via ScrapingBee).
  - Akamai: over 98% of agentic-browser requests carried little or no mouse movement.
  - In one small test, headed Browser Use passed a Cloudflare managed challenge from a home connection (5 of 6) but failed from a cloud server (0 of 3). ScrapingBee sells a stealth product, so treat this as biased.
  - Cloudflare reported blocking 416 billion AI-bot requests from July to early December 2025.
  - Since July 2026, Cloudflare blocks "user-directed agents" by default on ad-supported pages for new domains and free-tier accounts. Site owners have no opt-in to allow agents yet (PYMNTS, Sept 2026).
  - eBay barred unauthorized agentic bots from Feb 2026.
- Cost: no sourced dollar figure. What is sourced is task failure plus the price of stealth infrastructure: ScrapingBee Stealth costs 75 credits per request. Browser-use #221 ("human-in-the-loop"): a commenter says agents "are dead" at Cloudflare or a CAPTCHA (18 reactions, 24 comments). Other CAPTCHA and stealth issues have 5-9 reactions each (#652 Capsolver, #3074 stealth).
- Today's solutions: managed browser clouds (Browserbase, Kernel, Steel, Browser Use cloud), residential proxies, human takeover. Web Bot Auth signing is now the sanctioned route.
- Why insufficient [FACT]: the evasion route is an arms race, and a declared agent is still refused. Akamai refused a declared token 3 of 3 times in ScrapingBee's test while HUMAN accepted it 3 of 3. Cloudflare's new default blocks agents even when honest.
- Who attacks it: Cloudflare (Web Bot Auth, signed agents, Monetization Gateway, AI Crawl Control), the model providers (OpenAI, Google and AWS sign their agents), and the browser clouds.
- Links: https://www.scrapingbee.com/blog/bots-blocking-bots-in-llm-driven-browsers/ ; https://www.pymnts.com/?p=4204337 ; https://blog.cloudflare.com/agentic-web/ ; https://github.com/browser-use/browser-use/issues/221
- Why this rank: several independent sources, measured rates, and a platform behavior change. Note that the largest supplier, Cloudflare, is also the one creating the problem, and it ships the official fix.
- Opportunity read [INFERENCE]: not a product for a small team. Any independent bypass is a red line, and the legitimate fix is owned by the infrastructure players.

## 2. Credentials, login, 2FA and session state for agents

- Description: agents need logins, TOTP, email/SMS codes and persistent sessions without seeing raw passwords. [FACT] Browser Use's own write-up lists the problem as unsolved by default: sessions, credentials, 30-second TOTP, and codes landing in inboxes the agent cannot read.
- Who suffers: anyone building agents that act inside a user's authenticated accounts.
- Frequency: recurring in issues. Browser-use #404 "manually entered data (login/MFA)" has 11 reactions. #702 (reuse storage_state) has 8. #2799 (cookies injected with storage_state) has 23 comments. Claude Code #78160, about the hard block on typing passwords, has 38 reactions and 25 comments.
- Cost: no dollar figure. Cost is task failure and manual handoff.
- Today's solutions [FACT]: cookie/profile sync, 1Password service accounts (Browserbase and Browser Use partnerships), TOTP generation (Browser Use, Kernel, Steel), AgentMail inboxes polled for codes.
- Why insufficient: four vendors, four different approaches, with Steel's Credentials API still in beta. Each stores credentials in a different place. Sites still challenge a new device.
- Who attacks it: 1Password (agentic autofill), Browserbase, Kernel, Steel and Browser Use. All ship it natively.
- Links: https://browser-use.com/posts/web-agent-authentication ; https://github.com/browser-use/browser-use/issues/404 ; https://browserbase.com/blog/1password-agentic-autofill
- Why this rank: clear repeated demand and multiple workarounds, but demand is already being served natively by the providers.
- Opportunity read [INFERENCE]: fragmentation exists, but providers bundle it free into the browser product.

## 3. Secrets handling: keys leak through agents, MCP configs and chat context

- Description: API keys end up in prompts, transcripts, `.env` files and MCP configs. [FACT]
- Who suffers: all developers, especially non-engineers using coding agents.
- Frequency and cost [FACT]:
  - GitGuardian 2026 (2025 data): 28.65M new hardcoded secrets in public GitHub commits, up 34%. AI-service secrets leaked: 1,275,105, up 81%.
  - Claude Code-assisted commits leaked at 3.2% versus a 1.5% baseline. The report attributes this to human workflow, not only tool failure.
  - 24,008 unique secrets in MCP-related config files, 2,117 of them valid.
  - Over 64% of credentials confirmed valid in 2022 were still valid in Jan 2026.
  - Hush Security (Sept 2026): across ~82,000 public MCP config files, 12% of credential slots held a literal secret. 24% of the literals were broad-scope and non-expiring.
  - No sourced dollar loss.
- Today's solutions: Doppler, 1Password CLI, secret scanners, `.env` conventions.
- Why insufficient: Claude Code #29910 (52 reactions) says none of these cover "never put the secret in the model context" for non-engineers. It requests a native secret manager.
- Who attacks it: Anthropic is the named target of the request, GitGuardian and 1Password already sell detection, and the MCP spec has open SEPs (#1560 secretHint, #2779 credential references).
- Links: https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/ ; https://www.helpnetsecurity.com/2026/09/18/hush-security-mcp-credential-exposure-report/ ; https://github.com/anthropics/claude-code/issues/29910
- Why this rank: strong, measured, independent numbers from a vendor with an interest (GitGuardian sells detection) and a second source (Hush, also a vendor).
- Opportunity read [INFERENCE]: very real, but the likely owners are the agent vendors and the secrets-management incumbents.

## 4. Prompt injection / tool poisoning against agents with real permissions

- Description: attacker-controlled text steers agents that hold secrets or write access.
- Who suffers: teams running coding agents in CI, browser agents with signed-in sessions, and MCP users.
- Frequency [FACT] (OWASP GenAI Q2 2026 roundup):
  - "Comment and Control" (Apr 2026): PR titles and comments redirected Claude Code Security Review, Gemini CLI Action and Copilot Agent, with token disclosure demonstrated.
  - Sentry "agentjacking" (June 2026): fabricated error events through a public DSN. 85% success across more than 100 controlled runs against Claude Code, Cursor and Codex.
  - LayerX "BioShocking" browser-agent context manipulation (June 2026).
  - Anthropic's own browser-agent attack rate fell from 13.8% to ~2% with safeguards (Nov 2025). Anthropic says even 1% "still represents meaningful risk."
- Cost: the roundup quantifies no financial loss for any of the six cases. Most are research demonstrations.
- Today's solutions: model-level training, permission prompts, sandboxing, vendor guardrail products.
- Why insufficient: the problem is architectural (an agent with secrets and an outbound channel reads untrusted text), and rates stay above zero.
- Who attacks it: model providers (Anthropic, Microsoft), the MCP security working group, and many startups.
- Links: https://genai.owasp.org/2026/07/08/genai-and-agentic-ai-exploit-roundup-q2-2026/ ; https://www.anthropic.com/research/prompt-injection-defenses
- Why this rank: severity and breadth are well documented, but there is no evidence of realized monetary loss, and the evidence is research demos. Strong on "problem exists," weak on "someone pays to fix it with a third-party product."
- Opportunity read [INFERENCE]: crowded, and the fix is mostly inside the models and runtimes.

## 5. Insurance and liability gap for agent actions

- Description: insurers are moving from silent AI cover to explicit exclusions, so agent losses may land uninsured on the deployer. [FACT]
- Who suffers: companies deploying agents that act with money or data.
- Facts:
  - AIUC report (via Insurance Business, July 2026): over 90% of insurers' AI-agent exposure may sit in conventional policies not designed for AI.
  - ISO generative-AI CGL exclusions effective January 2026. Chubb, Travelers and Berkshire sought state approval for AI exclusions. W.R. Berkley filed an absolute AI exclusion.
  - Testudo (Lloyd's coverholder) offers standalone gen-AI liability up to $10M per insured.
  - Gallagher survey: one in five insurance professionals say their insureds already had AI-linked losses. Gallagher Re: US gen-AI lawsuits up 978% from 2021 to 2025.
- Cost: no sourced per-incident agent loss. The sourced losses are older and indirect (Arup, $25M deepfake fraud, 2024).
- Today's solution: negotiated affirmative endorsements and standalone Lloyd's programs.
- Why insufficient: capacity is small, and the key report was written by AIUC, which sells AI cover (the article notes it).
- Who attacks it: AIUC, Testudo, CFC, Munich Re and others.
- Links: https://www.insurancebusinessmag.com/us/news/breaking-news/insurers-face-hidden-ai-liability-as-agent-risks-multiply-582433.aspx ; https://www.insurancebusinessmag.com/us/news/professional-liability/why-your-clients-probably-arent-covered-for-ai-597354.aspx
- Why this rank: independent insurer actions (filed exclusions) are strong facts. The agent-specific loss data is thin, and this is a regulated, capital-heavy business.
- Opportunity read [INFERENCE]: not for a 1-2 person team.

## 6. Agent payments and agentic checkout: protocols exist, real demand is thin

- Description: agents buying things hits fragmentation, unreliable merchant data, unclear dispute/chargeback rules and no way to tell an agent from a script.
- Facts:
  - TRM Labs (Sept 2026): x402 volume was about $52.7M across ~199M transactions since May 2025. About half disappears after screening. Only 0.6-7.5% of the screened commerce looks agentic. Agent payment volume was roughly $5k-11k per month.
  - Payments Dive (Jan 2026): merchants cite fragmentation across Visa, Mastercard, Google and OpenAI/Stripe protocols, unreliable product data and unanswered chargeback questions. Gr4vy expects to discard about half its agentic protocol work by end of 2026. Analysts expect broad autonomous payments in late 2027 or 2028.
  - Coinbase's x402 claims over 100M transactions on Base. TRM's analysis suggests that headline overstates real commerce.
- Cost: no sourced loss. The evidence is low usage, not a measured cost.
- Who attacks it: Stripe (ACP with OpenAI, Agentic Commerce Suite), Visa, Mastercard, Coinbase, Cloudflare (Monetization Gateway over x402, closed beta).
- Links: https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain ; https://www.paymentsdive.com/news/bot-payments-lag-in-agentic-commerce-ai-shopping-retail/810815/
- Why this rank: well-sourced, but the sourced finding is that the problem is mostly forecast, not yet a recurring cost.
- Opportunity read [INFERENCE]: the rails are owned by giants. The real gap (attribution, approval controls, monitoring) is a thin layer under their control.

## 7. Agent identity and inboxes (email/phone) for signups and verification

- Description: agents need their own addresses to receive codes and sign up for services. [FACT]
- Facts: AgentMail raised a $6M seed (Mar 2026), with 500+ B2B customers and hundreds of thousands of "agent users." User count tripled the week OpenClaw launched. Free-tier agent inboxes send 10 emails a day unless a human authenticates them.
- Related friction [FACT]: Claude Code #34229 "Phone verification" has 893 reactions and 742 comments. Users in many countries cannot complete SMS verification. This is about human accounts, not agents, but it shows that phone verification is a hard wall.
- Today's solution: AgentMail, plus vendor inboxes in browser clouds.
- Why insufficient: abuse controls limit the free tier, so the supplier itself restricts agent signups.
- Who attacks it: AgentMail is the incumbent, and it is already funded.
- Links: https://techcrunch.com/2026/03/10/agentmail-raises-6m-to-build-an-email-service-for-ai-agents/ ; https://github.com/anthropics/claude-code/issues/34229
- Why this rank: one funded company, one growth spike linked to a viral product, and no measured cost data.
- Opportunity read [INFERENCE]: already taken, and the phone side runs into abuse-prevention territory.

## 8. Human-in-the-loop for verification and physical tasks

- Description: agents stall at CAPTCHAs, logins, approvals and physical-world tasks, and the human fix is not reusable.
- Facts: browser-use #221 (18 reactions, 24 comments). Commenters note that after a human fixes it, "the agent learns nothing" (paraphrased) and the same wall returns, and that real deployments need custom channels such as SMS. Several vendor links appear in the thread (needhuman.ai, humanlayer, KiLu), so there are competing small tools. RentAHuman reports 11,000+ job ads (Semafor, Feb 2026), but completed tasks, payouts and quality problems are not reported.
- Today's solution: LangGraph interrupts, humanlayer, ad hoc Slack/SMS handoffs.
- Who attacks it: the agent frameworks themselves. Pause/resume already exists in browser-use.
- Links: https://github.com/browser-use/browser-use/issues/221 ; https://semafor.com/article/02/18/2026/ai-agents-turn-to-humans-for-manual-labor-tasks
- Why this rank: a repeated pattern in one repo, with no cost data and no evidence of money changing hands.
- Opportunity read [INFERENCE]: a feature in frameworks, not a business, unless the physical-task marketplace shows real completed volume (unproven).

## 9. Audit and compliance logging for agent actions

- Description: EU AI Act Article 12 requires automatic event logs for high-risk systems (Annex III obligations from Aug 2, 2026, with a Digital Omnibus delay to as late as Dec 2027 proposed and unresolved as of the cited April article). [FACT]
- Gaps [FACT, from a vendor founder's article]: no format prescribed, no finalized standard (prEN 18229-1, ISO/IEC DIS 24970 incomplete), application logs can be altered without detection. Penalty up to EUR 15M or 3% of turnover.
- Many dev.to posts claim most teams are not ready. These are low-quality, vendor-adjacent sources, so I give them no weight.
- Who attacks it: observability and GRC incumbents, Dataiku and Arize, plus the logging startups.
- Link: https://www.helpnetsecurity.com/2026/04/16/eu-ai-act-logging-requirements/
- Why this rank: a real legal driver, but evidence of an actual repeated cost or paying buyer is thin. Only agents in Annex III areas are in scope.
- Opportunity read [INFERENCE]: sales cycles and regulatory risk make this poor for a small team.

## 10. Compute/sandbox access for agents (mostly solved)

- Facts: Upstash compared 15 providers in 2026. Most wall-clock providers sit at $0.04-0.05 per vCPU-hour (Daytona and E2B both $0.0504). Runloop is winding down, and Daytona's open-source repo is archived (as reported).
- Read [INFERENCE]: price convergence and a consolidating field. This is a commodity, not an open problem.
- Link: https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026.md

---

## Looks big but lacks evidence

- "Agent economy" volume: x402 headline numbers (100M+ transactions) versus TRM's screened 0.6-7.5% agentic share and $5-11k per month. Category growth is not demand.
- Agentic commerce size: BCG's $1.3T and McKinsey's $1T to $5T are survey and forecast figures. Payments Dive says broad adoption is expected in 2027-28.
- Systemic AI insurance loss ("$100 billion"): a scenario by AIUC, a seller of cover, not a measured loss.
- Prompt-injection "crisis": demonstrations with no quantified criminal losses in the Q2 roundup.
- RentAHuman: 11,000 job ads and a 500,000-human signup claim from a secondary source, but no completed-task or payout data.
- EU AI Act agent logging: the deadline is real, but "most teams aren't ready" claims come from vendors and low-quality posts.
- Pay-per-crawl for small publishers: Cloudflare's own post says Pay Per Use and Monetization Gateway are betas, and the gateway is a closed beta for eligible US customers. No payout figures were found.

## Already solved or being solved natively (idea killers)

- Verified agent identity at the web layer: Cloudflare Web Bot Auth and signed agents (OpenAI, Google, AWS sign requests). Kills "agent passport for websites" as a standalone product.
- Charging agents for content: Cloudflare Pay Per Use and Monetization Gateway (HTTP 402 over x402). Kills small pay-per-crawl intermediaries.
- Agent checkout: Stripe plus OpenAI ACP and Agentic Commerce Suite, Visa and Mastercard programs, Coinbase x402.
- Agent logins and 2FA: 1Password with Browserbase, Browser Use, Kernel and Steel credential and TOTP features.
- Agent inboxes: AgentMail, funded and shipping.
- Prompt-injection mitigation inside the model and runtime: Anthropic's browser-agent safeguards cut attack success from 13.8% to ~2%. Third-party guardrails compete against free built-ins.
- Sandboxes: 14-15 providers with converging prices.

## Cross-cutting observations [INFERENCE]

- Problems that worsen with more agents: blocking (Cloudflare defaults are tightening), secret sprawl (AI-service leaks up 81%), and silent insurance exposure. Network effects mostly accrue to the infrastructure owners (Cloudflare, Stripe, model vendors).
- The pattern of "every developer rebuilds it" is real only for login/2FA/secrets glue and human-handoff channels. Both are being absorbed by the browser clouds and the agent products.
- Gaps I could not fill: no sourced dollar cost per failed agent task anywhere, and no count of GitHub issue reactions beyond the repos checked (browser-use, stagehand, playwright-mcp, skyvern, langgraph, claude-code, MCP spec). Stagehand and Playwright MCP returned almost nothing relevant by reactions.

## Confidence

Medium on the existence and direction of problems 1-4 (multiple independent sources, though several are vendor-authored). Low on any cost estimate, because none is sourced. Low-medium on 5-9, which rest on a few articles.
