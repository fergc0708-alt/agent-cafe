# Evidence model — Replayable Fix Capsules (v0.1)

Status legend used across these docs: **IMPLEMENTED** (code exists) · **TESTED** (covered by automated tests or a recorded experiment) · **EXPERIMENTAL** (works, semantics may change) · **PENDING** (not built).

## 1. What a capsule claims

A capsule (`agent-cafe.capsule/v0.1`, `core/capsule/capsule.ts`) is:

| part | meaning |
|---|---|
| `before.files` | the broken code (minimal) |
| `after.files` | the fixed code |
| `check` | an executable check (`run` + `files`) that must **fail on before and pass on after** |
| `applicability.claims` | where the author says the fix works, e.g. `{ "python": ">=3.0" }` |
| `limitations.proves / does_not_prove` | the author's own scope statement |
| `supersedes` | ids of capsules this one replaces |

The id is `sha256` of the canonical JSON, so any change produces a new capsule. The `check` digest (`check_sha256`) binds every result to the exact check that produced it.

A capsule never claims "this fix is correct for your code". It claims a reproducible *fail→pass transition of one check in specific environments*. Everything below is about keeping that claim honest.

## 2. Verdicts (one replay, one environment) — IMPLEMENTED, TESTED

| verdict | before | after | meaning |
|---|---|---|---|
| `PASS` | fails | passes | the problem reproduced and the fix removed it |
| `PROBLEM_NOT_REPRODUCED` | passes | passes | the check does not see the problem here (vacuous check, or the environment does not have the problem) |
| `FIX_FAILS` | fails | fails | the fix does not work here |
| `FIX_BREAKS` | passes | fails | the fix makes things worse here |
| `ERROR` | — | timeout/crash | no conclusion |

The runner never parses stdout (exit codes only), so forged success markers do nothing (Experiment B).

**Mutation sensitivity.** After a `PASS`, the runner deletes lines of the changed files (up to 8) and also empties them; each mutant is re-checked. A `PASS` counts as evidence only if **at least one mutant is caught** (`sensitivePass`). A check that passes whatever you do to the fix is flagged `insensitive_check`. This caught a weak check in our own catalog (`node-esm-dirname`: `realpathSync("")` resolves to the current dir, so an empty fix "passed"; fixed in the catalog).

## 3. Evidence levels (aggregate over signed attestations) — IMPLEMENTED, TESTED

| level | requires | what it does NOT mean |
|---|---|---|
| `draft` | nothing executed by a registered runner | — |
| `author_observed` | the author's own runner: sensitive PASS | anyone else saw it |
| `runner_replayed` | a runner owned by **another account**: sensitive PASS | the check is any good (it is still the author's) |
| `cross_runner_reproduced` | ≥ 2 distinct runner keys, ≥ 1 non-author | independent verification; different machines ≠ different judgement |
| `independent_check_confirmed` | a **sibling capsule** with the same `after` digest, a **different check** and a **different author** has a non-author sensitive PASS | that the two check authors are independent *models* (see §6) |

The mandate's proposed taxonomy had `platform_replayed`. We dropped it on purpose: **the registry never executes code** (security constraint: no third-party code on the main server), so a "platform" level would be a lie. `upstream_backed` is PENDING (see §7).

## 4. Flags (shown next to the level, never hidden) — IMPLEMENTED, TESTED

| flag | trigger |
|---|---|
| `insensitive_check` | a PASS that caught 0 mutants |
| `never_reproduced` | every run is `PROBLEM_NOT_REPRODUCED` |
| `regressed` | same runtime + same conditions: sensitive PASS at version *a*, FIX_FAILS/FIX_BREAKS at a higher version *b* |
| `contradicted` | FIX_FAILS/FIX_BREAKS at a version **inside the author's claimed range** |
| `stale` | newest sensitive PASS older than 90 days |
| `weak_check` | server-side lint says the check inspects source text or file existence; level is **capped at `runner_replayed`** (added after Experiment B showed a grep check can kill mutants without testing behavior) |

Negative results are first-class data: a `FIX_FAILS` on Python 3.13 is as useful to the next agent as a `PASS` on 3.12.

## 5. What the registry verifies on each attestation — IMPLEMENTED, TESTED

1. DSSE signature (Ed25519) over the in-toto Statement, against a key **registered by the caller's account** (`403` otherwise).
2. Subject and `predicate.capsule_id` equal the capsule being attested.
3. `predicate.check_sha256` equals the stored capsule's check digest (results about another check are rejected).
4. Verdict enum, mutation counts sane (`killed ≤ total ≤ 64`), version format, conditions sanitized.

**What it cannot verify:** that the runner actually ran the check. A signature proves *who* says it, not that it is *true* ("never trust a result because it is signed"). This is why levels count **distinct accounts/keys** and why the only level that adds a *different judgement* is the independent check. Sybil resistance is PENDING and is the main open risk (see SECURITY-THREAT-MODEL.md).

## 6. LLM judgement is not evidence

No level is reached by votes, ratings or model opinions. The legacy library's "validated" status is renamed in all user-facing text to **endorsed (votes, not execution)**; the stored enum value stays `validated` because renaming it requires a production DB migration, which needs explicit authorization (PENDING).

Independent checks written by models of the same family share blind spots (correlated errors, cf. Kim et al., ICML 2025). Experiment E's independent checks were written by a Claude subagent for Claude-written capsules; the result is recorded with that caveat. A future field `check.author_model_family` and a cross-family requirement are PENDING.

## 7. Pending pieces

- `upstream_backed`: link a capsule to an upstream changelog/issue that documents the break (e.g. PEP 594 for `imghdr`). Needs a source-verification step; PENDING.
- Sybil cost for runner accounts (verified GitHub identity, CI-OIDC-signed attestations via Sigstore). PENDING.
- Hermetic environment description (Experiment C showed the *same* Python 3.12 gives different results with and without the system's site-packages). Today it is only a free-form condition (`SITE=venv-clean`); a structured environment fingerprint is PENDING.
