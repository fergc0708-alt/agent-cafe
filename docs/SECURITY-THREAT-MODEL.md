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
| C1 | Two free accounts could push a never-run, vacuous capsule to `independent_check_confirmed` with fabricated, self-signed predicates | **FIXED in meaning, OPEN in capability** | The main `level` and its flags now use **only results from runners the registry verified** (`trusted`, settable only by the operator; no API). Everything else appears under `evidence.claimed`, labeled "self-reported, not verified". Re-running the exploit: verified level `draft`; the claimed level is capped by `weak_check`. At the time verifying runner identities was pending; *(3.0)* GitHub OIDC verification now exists (see "Red team 3.0" and remaining risk 1). |
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

1. ~~No verified runners exist yet.~~ *(3.0)* GitHub Actions OIDC identities are verified (RS256 against GitHub's JWKS, audience bound to the runner key and exact result digests, GitHub-hosted only, pinned workflow policy). Remaining gap: every verified identity today belongs to the same operator who wrote the capsules, so verified means *where it ran*, not independent review.
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


## Red team 3.0 (compatibility product, 2026-11-24)

A separate agent (same model family: not an independent audit in the strong sense) attacked `cafe doctor`, the
evidence bundle, OIDC verification, MCP, capture and the Action. Status after the fixes:

| id | finding | status |
|---|---|---|
| C1 | `doctor`/`diagnose` executed a repository-shipped `.venv/bin/python` (and MCP `interpreters`) with no approval | **FIXED**: interpreters other than PATH or a user-typed `--python/--node` are only probed inside bubblewrap; without a sandbox they are not run and the report says so. Version/site probes of replays also run sandboxed. |
| H1 | Planted `.cafe/capsules` could shadow a catalog capsule's diff, inject instructions, exfiltrate via `detect` | **FIXED**: local capsules live under `local:<name>`, cannot collide with catalog ids, carry no `detect`/`supersedes`, are dropped if their text contains instruction patterns; diffs are looked up by id. |
| H2 | Green "no known break" when the relevant runtime was not evaluated | **FIXED**: such hits are reported as NOT EVALUATED, fail `--fail-on`, and every runtime with hits is evaluated. |
| H3 | Evidence integrity test was circular (policy/JWKS from the same bundle, rows not tied to signatures) | **FIXED**: policy, JWKS digest and local key are pinned in `core/doctor/pins.ts`; signed sources ship with the bundle; tests re-derive every row and detect flipped verdicts, foreign keys and other repositories. |
| H4 | OIDC policy accepted any `goat/*` branch, names only, `workflow_ref` fallback, tag-pinned actions | **FIXED/MITIGATED**: exact refs, pinned repository/owner ids, `job_workflow_ref` required, actions pinned by SHA. Residual: the operator controls those branches. |
| H5 | False "BROKEN NOW": setuptools' distutils shim misclassified as stdlib | **FIXED**: classification by origin; every Python result records the site setup; only conditions that demonstrably change a capsule's outcome are enforced. |
| M1 | ReDoS patterns passed `safeRegex` | **FIXED (heuristic)**: quantified groups with alternation and chained unbounded quantifiers are rejected; local capsules carry no detect rules; scan has a wall-time bound. Not a linear-time engine. |
| M2 | Scan followed symlinks, read /dev/zero, FIFOs | **FIXED**: `lstat`, regular files only, directory and time bounds. |
| M3 | Replay consent did not cover the interpreter; probes ran unsandboxed | **FIXED**: digest covers `bins`; probes sandboxed. |
| M4 | `cafe_capture` path traversal | **FIXED**: regular files inside the project only. |
| M5 | Compiled `dist/` stale vs source | **FIXED** for this commit; CI checks it, but CI is not a required check on this branch. |
| M6 | "the fix was verified here" printed for self-reported rows | **FIXED**: wording is "the fix works here", with "(self-reported only, not verified)" when applicable. |
| M7 | MCP consent model-controlled; huge previews | **MITIGATED**: previews truncated; consent residual documented. |
| L1 | Repo-local git config (fsmonitor, hooks) ran during capture | **FIXED**: git runs with those disabled and no system/global config. |
| L2 | `--fail-on` typos failed open | **FIXED**: validated. |
| L3 | JSON report leaked the absolute path and zone name; MCP replay could fetch | **FIXED**: relative path, TZ class only; MCP replay uses the local index only. |
| L4 | Action on Node < 20 | **FIXED**: explicit version check. |
| L5 | Published CI artifacts replayable to a registry within 7 days | OPEN (low): attribution stays with the GitHub identity. |
| L6 | TZ forced to UTC but not recorded | OPEN (documented in README limits). |

## MCP tool review (GOAT 4)

| tool | reads | writes | executes | network | approval |
|---|---|---|---|---|---|
| `cafe_doctor` | project files (lstat, regular files, bounded) + bundled catalog | nothing | interpreter version probes; non-PATH interpreters only inside bubblewrap | none | `readOnlyHint` |
| `cafe_diagnose` | same + the pasted error (≤ 20 KB) | nothing | same probes | none | `readOnlyHint` |
| `cafe_show` / `cafe_search` | bundled catalog, `.cafe/capsules` (labelled unverified) | nothing | version probes (`show`) | none | `readOnlyHint` |
| `cafe_replay` | catalog or project capsule by name/id only (no paths) | temp dir | capsule code in bubblewrap (no network, read-only system) | none | preview → digest (code + interpreters) → `destructiveHint` |
| `cafe_capture` | git HEAD + listed files inside the project | `.cafe/capsules/<name>.json` | the user's own test in bubblewrap | none | same two-step |

All tools declare `openWorldHint: false`. Changes in this round: explicit `readOnlyHint: false` on the two executing
tools, and the preview-digest set is bounded (256) so a long session cannot grow it without limit.

**Residual risks (accepted, documented):**
- The digest gate is not a human gate: a model can echo the digest. The real gate is the client's approval prompt,
  which depends on the client honouring `destructiveHint`. Clients that auto-approve all tools remove it.
- `path` is chosen by the model: doctor can be pointed at any directory the MCP server process can read. It only
  reports file:line positions of known API uses, never file contents, but a hostile prompt could use it to probe
  whether a path exists. Same privilege as the agent's own shell.
- On macOS/Windows there is no bubblewrap: `cafe_replay`/`cafe_capture` refuse to run instead of running unsandboxed
  (fail closed); doctor's non-PATH interpreter probes are skipped and the environment is reported NOT EVALUATED.

## Defects found while proving the product (GOAT 4)

| id | finding | status |
|---|---|---|
| G4-1 | **The Action described the wrong toolchain.** Interpreter probes ran with a fixed system `PATH`, so after `setup-node 22` / `setup-python 3.13` the report said `node 24.22 · python 3.14` (the runner's defaults). Found by the new `remote-pinned` distribution job. Affected every CI user of 3.0 whose job installs its own runtimes; local users whose interpreter is not in `/usr/local/bin:/usr/bin:/bin` were affected too. | **FIXED**: bare names resolve on the caller's PATH before probing (`onCallerPath`); regression test. The pinned SHA in the README is moved to the fixed commit. |
| G4-2 | Eval run 2: two agents rejected the `py-distutils-removed` fix (int tuples) because it crashes on `1.0rc1`, which `LooseVersion` handled. | OPEN: the capsule's `does_not_prove` already says so; the fix itself is weaker than what agents write unaided. |

## Café Signal (GOAT 5): adversarial audit + independent review

> **Note (2026-11-25):** this section describes the earlier Signal network (removed from the product, kept in
> `experiments/signal-network`). The current threat model of the Signal diagnosis tool is
> [`signal/SECURITY.md`](../signal/SECURITY.md).

Two separate agents audited `signal/` (same model family as the author, so not fully independent). Findings were
reproduced with proof-of-concept tests before being fixed. Regression tests: `tests/signal.test.ts` (29 tests).

| id | finding | status |
|---|---|---|
| S1 | **Sybil + fabricated results.** Free GitHub orgs = free owners. With a 2-owner threshold, 2 fake orgs flipped a 30-owner red signal to `likely_safe`; 1 fake regression overrode 40 passing owners. | **MITIGATED, OPEN by nature.** Verdicts need ≥3 owners and an interval, a single regression is only `single_report`, and contradictions with a large opposite signal are `mixed`. Tokens are accepted from PR events only. A determined attacker with many orgs can still shift verdicts: the network must never gate merges (it does not). |
| S2 / R11 | An exact-match record shadowed all same-target evidence. | **FIXED**: same-target evidence is pooled; exact matches are a label. |
| S3 | Code under test (e.g. a malicious postinstall) could mint the job's OIDC tokens. | **CORRECTED 2026-11-25: this was wrongly marked fixed.** Stripping variables from the child's environment is not a boundary: code running as the same user can read its parent's environment (`/proc/$PPID/environ`) and the runner's memory. The network component this applied to was removed from the product (now `experiments/signal-network`, not shipped). For the current Signal diagnosis tool, see [`signal/SECURITY.md`](../signal/SECURITY.md): the boundary there is the job's permissions (no write token, no secrets), not the environment filter. |
| S4 | Token replay: one token for any content for 2 h; `exp` unchecked. | **FIXED**: the server recomputes the id from content, each `jti` is single-use, `exp` is required. |
| S5 | A query token could be used to write (`id:"query"`). | **FIXED**: separate `obs:` / `query` audiences; ids must be 64-hex. |
| S6 / R1 | No install command meant the baseline reused the update's `node_modules`, so a real regression was reported as "not the update's fault". | **FIXED**: install is required; the baseline runs in a fresh git worktree. |
| S7 | Unvalidated fields were stored and rendered as markdown in other projects' PRs (phishing links). | **FIXED**: validation rebuilds the stored object from allow-listed, enum-checked fields, and all rendered evidence is escaped. |
| S8 / S9 | A `null` body crashed `serve`; unbounded bodies. | **FIXED**: try/catch around the router, plain-object bodies, 64 KB streaming cap (server and `serve`). **OPEN:** the in-memory store has no eviction (self-host/dev only; no production store). |
| S10 / R8 | Fingerprints leaked secrets, hosts, users and source lines. | **FIXED**: allow-list shaping (error type + lowercase words; everything else becomes `<id>`), tested against the audit's leak corpus. |
| S11 | Private package names were shared by default; the id did not cover the redacted content. | **FIXED**: only the proposed update is shared by default, and the id is recomputed after redaction. |
| S12–S14 | Non-idempotent scrub; tree not restored on one path; quadratic regexes. | **FIXED** (worktree baseline never touches the checkout; `[ \t]` regexes; size caps; line dedupe). |
| S15 | `pull_request_target` would run fork code with secrets. | **FIXED**: the Action refuses it. |
| R2 | The checkout was left on the old dependencies; Ctrl-C left files reverted. | **FIXED** (worktree). |
| R3 | Monorepo with a root lockfile was silently skipped. | **FIXED**: lockfiles in ancestor directories count. |
| R4 | `retries` -1/NaN gave `compatible` with zero tests run. | **FIXED**: clamped 0–3; no run → `error`; install failure → `error`. |
| R5 | Python: `pip install` in a shared environment keeps packages the update added. | **OPEN**: use a per-side virtualenv in the install command (documented). |
| R6 | The baseline used the moving base-branch tip. | **FIXED**: `--base auto` = first parent of the PR merge commit. |
| R7 | A PR that also changes code made the baseline meaningless. | **FIXED**: downgraded to observational. |
| R9 / R10 | Lockfiles with several versions or workspace/alias/patch entries produced invented transitions. | **FIXED** for npm (hoisted copy wins), pnpm (importers), yarn (aliases/patches). |
| R12 | Prereleases were pooled with releases. | **FIXED** for semver-style tags. PEP 440 epochs: OPEN. |
| R13–R16 | Environment grouping, owner namespaces, verdict ignoring the interval, unweighted seed. | **FIXED**. |
| R17–R21 | Benchmark: newest-100 timing bias, label leakage, broken bootstrap RNG, duplicates, e2e without assertions. | **FIXED** where possible: earlier-weeks cutoff, mulberry32 clustered bootstrap, de-duplication, strict e2e. **Label leakage OPEN**: the label is the CI status at collection time, because per-repo check APIs are not reachable from this environment. |
