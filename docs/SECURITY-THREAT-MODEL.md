# Security threat model — Replayable Fix Capsules

Legend: **FIXED** (code + test or re-run exploit) · **MITIGATED** (risk reduced, not removed) · **OPEN**.
Red-team scripts live outside the repo (scratch); each fix below has a regression test in `tests/capsule.test.ts` or a re-run noted here.

## Assets and actors

| asset | why it matters |
|---|---|
| the user's machine when they replay | a capsule is third-party code |
| the meaning of an evidence level | the product *is* this signal; if it can be faked cheaply it is worthless |
| runner private keys | signing results under someone else's name |
| agents reading capsule text (via MCP) | prompt injection |
| user privacy when publishing | code, env, hostnames, paths |

Actors: a malicious capsule author; a Sybil operator with many accounts and keys; a griefer; a compromised or malicious registry (the CLI must not trust it blindly).

## Design rules (from the mandate)

1. The registry **never executes** capsule code.
2. Replays run on the user's machine or CI, **inside an existing sandbox** (bubblewrap), never a home-made one.
3. A signature identifies a key holder; it **never** makes a result true. Self-reported results are labeled as claims.
4. Nothing leaves the user's machine without an explicit confirmation that shows exactly what is published.

## Red team (independent auditor agent, 2026-11-24)

The auditor found 4 critical, 4 high, 4 medium and 4 low issues and reproduced 13 of them against the real code. Status after the fixes in commit `82ba7b6`:

| id | finding | status | what changed |
|---|---|---|---|
| C1 | Two free accounts could push a never-run, vacuous capsule to `independent_check_confirmed` with fabricated, self-signed predicates | **FIXED in meaning, OPEN in capability** | The main `level` and its flags now use **only results from runners the registry verified** (`trusted`, settable only by the operator; no API). Everything else appears under `evidence.claimed`, labeled "self-reported, not verified". Re-running the exploit: verified level `draft`; the claimed level is capped by `weak_check`. Verifying runner identities (Sigstore/GitHub OIDC) is **PENDING**, so today no capsule has a verified level above `draft`. |
| C2 | `cafe replay` let fix files run arbitrary code as the user (read SSH keys and the runner key, persist in `.bashrc`, leave background processes, leak key bits through timing/exit codes), the prompt hid fix-file contents, and isolation fell back silently to none | **FIXED (for bubblewrap-capable Linux)** | The default isolation is **bubblewrap**: no network, read-only `/`, `/home`, `/root` and `/tmp` replaced by empty tmpfs, only the replay dir writable, `--die-with-parent` + PID namespace kill stray processes. **Fails closed**: without bubblewrap the runner refuses unless the user explicitly picks `--isolation net-only` or `none`. The confirmation shows **every executable file** (before, after, check). Published predicates carry only `passed`/`timed_out` (no exit codes, timings, stdout hashes or kernel). Re-running the exploit inside the sandbox: no home/SSH/key read, `.bashrc` untouched, no surviving process, nothing leaked. On macOS/Windows there is no sandbox yet: replay needs a VM/container and an explicit `--isolation none`. |
| C3 | Same-author checks that defeat mutation testing: canary export, tautology, text inspection via string tricks, inline `node -p`, `json.py` shadowing the stdlib, `python -m pytest` with a plugin in `pyproject.toml` | **PARTLY FIXED** | `check.run` must be exactly `[interpreter, <check file>]` (no flags, no `-m`, `-p`, `-c`, `--import`); Python files that shadow stdlib modules, `pyproject.toml`, `setup.py`, compiled/native files and case variants (`Conftest.py`) are rejected; the "empty file" mutant was removed and a PASS needs ≥ 50% of line-deletion mutants caught; five lint findings now cap the level; optional `problem.symptom_regex` makes the *before* failure match the declared symptom. **OPEN:** a determined author can still write a tautological or canary check that passes mutation testing. The only real defense is a check written by someone else (`independent_check_confirmed`), which is why that level exists. |
| C4 | Anyone could register a published public key and claim all its published results | **FIXED** | Registering a runner requires **proof of possession**: an Ed25519 signature over `agent-cafe/runner-registration/v1\n<handle>\n<public_key>`. Re-running the exploit: 0/104 envelopes credited to the squatter. |
| H1 | MCP `confirm=true` was a model-set boolean; the registry could swap code between preview and run; no hash check | **FIXED / MITIGATED** | The CLI verifies that fetched capsules hash to the requested id. MCP `cafe_replay` accepts ids only (no local paths), requires `confirm_digest` from a preview issued **in the same server process**, validates interpreter overrides (absolute paths to known interpreters) and declares `destructiveHint` so clients ask the human. **MITIGATED, not fixed:** a model can still echo the digest; the real human gate is the client's tool-approval UI. MCP elicitation is PENDING. |
| H2 | One fabricated FIX_FAILS could mark any capsule "contradicted"/"regressed" | **FIXED** | Flags on the main evidence come from verified runners only; unverified negatives are kept under `claimed` (negative data is not lost). |
| H3 | Anyone could declare that their capsule supersedes someone else's | **FIXED** | `superseded_by` only lists capsules from the same author; others appear as `replacement_claims`. |
| H4 | The same envelope could be submitted again and again; old envelopes looked fresh | **FIXED** | Duplicate payloads are refused (409); `predicate.started_at` must be within the last 7 days. |
| M1 | Capsule text reached agents without the injection screening that notes get; `conditions` accepted nested objects | **FIXED** | All capsule text **and file contents** go through the same secret and injection screen (secrets → 422, injection → rejected); `conditions` must be a flat string map. |
| M2 | Keyword spam outranked executed capsules | **MITIGATED** | Search ranks by verified level, then claimed level, then text; an author's 4th+ results go after everyone else's. With no verified runners yet, claimed levels can still be self-inflated. |
| M3 | Storage/compute inflation (huge envelopes stored verbatim, evidence recomputed over all siblings on every read) | **MITIGATED** | Envelopes are stored in canonical minimal form, payload ≤ 16 KB, ≤ 4 signatures; siblings capped at 20. Evidence is still computed on read (caching PENDING). |
| M4 | Per-IP limits trusted the client-supplied first `X-Forwarded-For` | **FIXED** | Platform headers (`x-vercel-forwarded-for`, `cf-connecting-ip`, `x-real-ip`) first, otherwise the last hop. |
| L1 | Inline-code bypasses of "must run a file" | **FIXED** (exact argv shape) |
| L2 | Docs didn't match code (this file was missing) | **FIXED** (this file; EVIDENCE-MODEL updated) |
| L3 | MCP publish without confirmation; local paths; model-steerable interpreter paths | **FIXED** (preview + digest for `cafe_submit_attestation`; ids only; interpreter allowlist) |
| L4 | Predicate leaked timing, kernel version and stdout hash | **FIXED** (coarse predicate) |

Found while re-testing: passing an unknown isolation value (e.g. `true`) to the runner ran code **without** isolation. **FIXED**: unknown modes throw.

## Remaining risks (honest list)

1. **No verified runners exist yet.** Until CI identities are verified (Sigstore keyless / GitHub OIDC tied to a pinned workflow), the network has *claims*, not *evidence*. This is the biggest gap and it is product-defining.
2. **Same-author check quality** (C3 residual). Mutation testing measures sensitivity to the fix's text, not that the check tests the stated problem.
3. **Sandbox coverage.** bubblewrap is Linux-only and a kernel exploit escapes any namespace sandbox. Hosted or VM-based replay (E2B, Firecracker) is not built.
4. **The local MCP cannot force a human decision**; it depends on the client's approval UI.
5. **Correlated "independent" checks** written by models of the same family.
6. **Registry compromise**: the CLI verifies content hashes, but a compromised registry can still serve a *different valid capsule* under a misleading title in search results. Users must read what they run (the prompt shows it all).

## Privacy

- The CLI publishes only on `push`/`submit` (and MCP `cafe_propose_capsule publish=true` / `cafe_submit_attestation` with digest), each showing what leaves the machine.
- The runner label defaults to `runner`, not the hostname.
- Predicates contain runtime, version, OS/arch and the conditions the user set. No hostnames, paths, kernel versions, env vars or output.
- Capsule files are scanned for secrets before they are stored (422 on detection).
