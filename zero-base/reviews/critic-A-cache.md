# Critic A - Prompt-cache optimizer for third-party harnesses. Case AGAINST building.
Date: 2026-11-25. Method: WebFetch/WebSearch, GitHub search API. Nothing executed, no contact.

## Verdict
Do not build. The core mechanic (place breakpoints, pick TTL, keep prefix stable) has been absorbed by the provider API, by every major gateway, and by free open-source hacks. What is left is a feature, with no payer.

## 1. Providers made the mechanic a one-line flag
- Anthropic docs: top-level `cache_control` = "automatic caching": the system places the breakpoint on the last cacheable block and moves it forward as the conversation grows. Also: 1h TTL, `max_tokens:0` pre-warming, "cache diagnostics" that report where a prefix diverged, usage fields split by TTL. Cache reads are now 0.05x on Opus 5.5 / Sonnet 5.5 and 0.025x on Fable/Mythos 5.x; minimum cacheable prompt dropped to 512 tokens on newer models. https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- The only documented hole: Bedrock rejects top-level cache_control (400). That hole is narrow and the gateways below already patch it.
- OpenAI, Google, DeepSeek cache implicitly (no engineering at all). OpenRouter lists OpenAI, Grok, Moonshot, Groq, DeepSeek, Z.AI, Gemini 2.5+ as automatic, and OpenAI GPT-5.6+ now has `prompt_cache_breakpoint`. https://openrouter.ai/docs/guides/best-practices/prompt-caching.md
- Lesson: the provider moved the problem to "set one field" within the span of this research. Any rewrite-layer's advantage is erased by the next API revision, and the revisions are visibly coming every few months.

## 2. Gateways already ship exactly this
- Vercel AI Gateway: `caching: 'auto'` injects cache_control at the last message and the pre-last-user message, `cache_ttl: '1h'`, `cache_anchor_items` for harnesses that compact/prune middle history (the precise "compaction timing" niche), and `x-session-affinity` for cache locality. Last updated 2026-09-11. https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching
- OpenRouter: translates cache_control across providers, sticky routing to the provider holding the cache (60 min), `cache_write_tokens`/`cache_discount` reporting. Same link as above.
- LiteLLM: has a cache_control injection hook (`AnthropicCacheControlHook`) and active PRs ("inject cache_control breakpoints natively" in Rust, prompt-caching test button on a "cost optimization tab"). https://github.com/BerriAI/litellm/pull/47284 , https://github.com/BerriAI/litellm/pull/41671 ; docs https://docs.litellm.ai/docs/tutorials/prompt_caching ; Helicone documents it too https://docs.helicone.ai/gateway/concepts/prompt-caching
- Your wedge is therefore "gateway feature that three well-funded/entrenched gateways already have, plus Anthropic native."

## 3. Free OSS already covers the long tail (and shows nobody pays)
- Keep-warm: at least six repos: yujiachen-y/claude-code-cache-keepalive (20 stars), demouo/... (28), lllq-123/... (16), romantcig/... (11), santiquiroz/..., federbenjamin/cache-keepalive, Pan1127/cc-cache-keepalive. Search: `gh search repos "claude code cache keepalive"`.
- Proxies: SerenQi/llm-cache-gateway ("maximizes Anthropic prompt cache hits - 99.16% measured on real traffic"), mikemartincode/cc-cache-shim, jianzhichun/permafrost ("64% cheaper on real Claude Code traffic"), Tunasmelt/Cachify (explains why a cache missed, byte-exact diff). All 0-25 stars: the repos exist and nobody cares enough to star them, let alone pay. The tiny-star count is itself evidence of low demand for this as a product.
- Anthropic's own "cache diagnostics" now does Cachify's headline feature natively.

## 4. Harnesses already do it, and the bugs are harness bugs fixed by the harness
- OpenHands shipped caching in 2024 (PR #3411 "Add prompt caching (Sonnet, Haiku only)"). Cline, Roo, Aider all have caching code paths and maintainers actively fixing them: Cline #15167 (breakpoint doesn't advance past last user message), #15307 (broken caching on tool calls, "cost spikes"), #13667; Aider #4676, #2961. Roo has dedicated Bedrock-cache PRs (#11984).
- Read this the other way: the failures are regressions in each harness's own message-assembly code (tool loops, retries, compaction). A proxy sees only the final request, so it cannot tell a retried stream from a legit turn or fix a harness whose history mutates. The maintainers who own the bug will fix it in their repo for free; they will not route their users' traffic through a third-party rewriter and add a dependency/latency/trust hop.
- Links: https://github.com/cline/cline/issues/15167 , https://github.com/cline/cline/issues/15307 , https://github.com/OpenHands/OpenHands/pull/3411 , https://github.com/Aider-AI/aider/issues/4676

## 5. The "80%" figure is misleading as a savings claim
Source check (alphaxiv summary of arXiv 2607.12161): cache creation 44.3% + reads 35.4% = ~80%. But:
- It is ONE agent (unmodified Claude Code) on one provider. The paper does NOT test caching strategies; "any claim that better caching would cut the bill goes beyond what this page supports." Limitations include "cost reconstruction relies on five-minute cache assumptions" and 8.7% unattributed.
- The share is a decomposition of cost, not waste. Cache reads (35%) are the cheapest way to pay for context you must send anyway: at 0.1x (now 0.05x) they are the already-optimized part. Cache creation is dominated by the new tokens each turn adds; it is not "avoidable" by breakpoint placement. In a healthy agent, ~80% of cost IS cache traffic; that is what a well-cached run looks like. With 117k read tokens vs 12k creation per run, hit rate is already ~90%+ at baseline in the first-party harness.
- The recoverable slice is only misses beyond baseline: idle gaps > TTL, mid-prefix mutations, TTL regressions. Realistic third-party gain is a fraction of a fraction, and the repos above report "99% hit" on already-working paths.
- Implication: the pitch number (80%) overstates addressable spend by roughly an order of magnitude. Nobody has measured the actual miss-waste in third-party harnesses.

## 6. Economics: who pays, how much
- Cache cost is borne per run by developers using (mostly) BYO-key harnesses; the harnesses' maintainers are volunteer/VC-funded open-source with no cost motive (users pay). The people with cost pain are end users on flat plans or API; their pain is TTL/pricing decisions made by Anthropic (Register: Claude Code client sets TTL itself; "no plans for a global setting"; cut 1h to 5m and said it "should not raise costs"). https://www.theregister.com/2026/04/13/claude_code_cache_confusion/ and the research doc's own #46829.
- A savings-share/SaaS model: if a user's bill is $200/mo and cache misses are, say, 10-15% of it, the addressable pie is $20-30/mo, of which you take a share. Enterprise buyers with real spend buy a gateway (Vercel, OpenRouter, LiteLLM, Portkey, Helicone) that bundles caching for free, so you compete with $0.
- Pricing moves the other way every few months: reads fell to 0.05x/0.025x, write premiums are stable at 1.25x/2x, min length fell to 512. Each cut shrinks the absolute savings from optimization. Meanwhile 1h TTL, if Anthropic re-flips it, deletes keep-warm entirely.
- Verdict on category: feature, not company. The best-case outcome is a PR into LiteLLM/Cline that the maintainers merge for free.

## 7. ToS / platform risk
- Anthropic (Feb 2026) explicitly bars third-party harnesses from using Claude subscription OAuth; enforcement and "walled garden" crackdowns followed. https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access , https://thenewstack.io/anthropic-claude-harness-restrictions/ . So the largest pool of cost-anxious users (flat-plan Claude Code users) is exactly the pool where a third-party proxy cannot legally/technically sit in the path, and where cost is set by the first-party client.
- A proxy that rewrites requests holds API keys and prompts, which makes it a trust/security liability for a 1-2 person team (enterprise procurement will refuse) and a latency/availability hop. Keep-warm pings can also be treated as abusive/automated usage and burn rate limits and money (each warm ping bills a read; "cache hits don't count against rate limits" is the only offset).

## 8. Speed of erasure
Observed within this one research window: automatic caching, cache diagnostics, prewarming, 1h TTL, 512-token minimums, OpenAI explicit breakpoints with 12h TTL, Vercel's anchor/compaction hint (Sept 2026). The cadence is a feature a quarter. A two-person team cannot out-run the provider roadmap, and the provider roadmap is directly aimed at this gap.

## What survives
Only narrow things: cross-provider observability of *why* a miss happened in custom agents (and Cachify/Anthropic diagnostics already do that), and Bedrock-specific patching (OpenRouter/Vercel already do it). Neither is a business.

## Weak points in my own attack (honesty)
- I did not measure actual miss-waste in third-party harnesses; nobody has. Cline's open issues suggest it is nonzero.
- Could not verify the gateways' real-world hit rates or customer counts; star counts of OSS repos are a weak demand proxy.
- Did not check Portkey/Bifrost/Cloudflare docs in detail; likely same story.

Confidence that "build it" is wrong for a 1-2 person team: ~88%.
