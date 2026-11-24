# Competitive research — where Replayable Fix Capsules sit

Research done in this session (Nov 2026) with web search; details and sources for the first round are in the GOAT Mandate 1 report. Where a source could not be opened (e.g. one Mozilla blog post needed an approval that never came) the claim is marked *(secondary)*. Nothing here is from a demo of the product itself unless stated.

## 1. Shared knowledge for agents (direct substitutes)

| product | what it is | trust mechanism | gap we target |
|---|---|---|---|
| **Stack Overflow for Agents** (2026) | Q&A content packaged for agents | owner/author reputation, votes | no execution, no environment scoping, no negative results |
| **cq (Mozilla AI)**, v0.4, "CQ Exchange" commons (May 2026) | local-first shared memory for coding agents via MCP: `query / propose / confirm / flag / reflect / status`; installs into Claude Code, Codex, Copilot, Cursor, OpenCode | confidence score that moves with confirmations/flags (+0.1 / −0.15) *(secondary)* | confirmations are opinions; nothing is replayed |
| **Context7** | up-to-date library docs served to agents via MCP | official docs as source | docs say what *should* work, not what fails in env X |
| Agent memory research (AWM, Memp) | procedural memory / workflows reused across tasks | task success in benchmarks | +8.9–14 pts in-distribution; transfer drops when the environment changes, which is exactly the variable we key on |

**Honest read:** cq is the closest and is ahead on distribution (MCP + IDE installs + Mozilla brand). Competing on "shared memory" is a losing fight. The only differentiated position is **executed, environment-scoped, falsifiable evidence**, which none of them provides. cq could add replay; our moat would then be the accumulated matrix and its negative data, not the format.

## 2. Compatibility evidence from CI (closest analogues to the matrix)

| system | lesson |
|---|---|
| **Dependabot compatibility score** — % of other repos' CI that passed with the same update | the right *idea* (evidence from executions elsewhere), but published work (Rombaut et al., 2024) finds most updates have no score and scores skew to 100% → sparse and uninformative unless coverage is engineered. Warning for us: coverage is the hard part. |
| **Renovate Merge Confidence** — Age, Adoption, Passing | combines execution signal with adoption; proprietary data is the moat |
| **MDN browser-compat-data + collector**, runtime-compat (WinterCG) | compatibility tables built from executed feature tests across runtimes; the closest model for our matrix (and it is open data) |
| **Rust crater** | ecosystem-wide regression testing, offline, before a release; proves "run everything on the new toolchain" is valuable to *toolchain owners*, a possible buyer |

## 3. Benchmarks and grading (anti-vacuity)

- **SWE-bench** FAIL_TO_PASS / PASS_TO_PASS: our `before`/`after` rule is the same idea.
- **Exploits of SWE-bench-style graders** (a 2026 analysis of agent benchmarks, "BenchJack"): a `conftest.py` hook or forged stdout markers can make a grader report success. We forbid hijack files and never parse stdout; Experiment B confirmed both.
- Mutation testing (line deletion) as a sensitivity gate is standard practice; we use the cheapest version.

## 4. Provenance

- **in-toto Statement v1 + DSSE**: our attestation format; there is an in-toto `test-result` predicate (v0.1) that we may align with.
- **Sigstore / GitHub artifact attestations**: keyless signing tied to a CI identity (OIDC) with a public transparency log. This is the natural answer to our Sybil problem for CI runners (PENDING).
- **SLSA**: build provenance levels. Useful vocabulary; our levels are about *test outcomes*, not builds.
- Lesson applied: "never trust a result because it is signed". A signature identifies the signer; it does not make the result true.

## 5. Sandboxes (why we do not build one)

E2B (Apache-2.0, Firecracker), Daytona (Apache-2.0), Vercel Sandbox (Firecracker), gVisor, Kata. Plain Docker is not considered a strong boundary for hostile code. If hosted replay is ever offered it should rent one of these. For the MVP, replay stays on the user's machine/CI, with an explicit "not a sandbox" warning.

## 6. Consensus is not verification

Correlated errors across LLMs are well documented (Kim et al., ICML 2025; "Consensus is Not Verification", 2026), and community-notes-style bridging is manipulable (ICML 2026, ~10% manipulation success reported). Hence: no level in our model is reachable by votes, and independent checks carry a same-model-family caveat.

## 7. Wedge

**Runtime/toolchain breaking changes for coding agents in JS/TS and Python**: new major versions after the model's knowledge cutoff, removed stdlib modules, module-system changes, runtime-specific behavior (Bun vs Node), environment traps (TZ, site-packages). These are (a) frequent, (b) cheap to capsule, (c) cheap to replay in CI, (d) exactly where model knowledge is stale. Experiment F says the wedge must be **post-cutoff or private**: on well-known breaks the model does not need us.

Possible buyers (unvalidated): teams with private toolchains (a private registry + their CI as runners), agent-tool vendors wanting a "known breaks" feed, toolchain maintainers wanting crater-like signal. **No customer conversation has happened yet.**
