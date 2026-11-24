# Implementation roadmap

Branch `goat/evidence-network` (not merged, not deployed). Status legend: IMPLEMENTED · TESTED · EXPERIMENTAL · PENDING.

## Done in this branch

| item | status |
|---|---|
| Capsule schema v0.1, validator, canonical id | IMPLEMENTED, TESTED |
| Lint for vacuous checks (+ server-side `weak_check` cap) | IMPLEMENTED, TESTED |
| Local runner: before/after, mutation sensitivity, timeouts, env scrub, `unshare -rn` | IMPLEMENTED, TESTED |
| in-toto/DSSE/Ed25519 attestations, runner key registry | IMPLEMENTED, TESTED |
| Evidence levels + flags (regressed, contradicted, stale, insensitive, never_reproduced, weak_check) | IMPLEMENTED, TESTED |
| Registry API (memory + Postgres), remote MCP read tools | IMPLEMENTED, TESTED |
| CLI + local stdio MCP with confirm-before-run | IMPLEMENTED, EXPERIMENTAL |
| 24 curated capsules; 184 signed runs; CI replay matrix | IMPLEMENTED, TESTED |
| Library wording: "validated" → "endorsed (votes, not execution)" in all user-facing text | IMPLEMENTED (enum value unchanged, see below) |
| Experiments A–F + red-team fixes | see VALIDATION-PLAN.md, SECURITY-THREAT-MODEL.md |

## Next, in order (each needs Fer's authorization where marked 🔒)

1. 🔒 **Neon branch + preview deploy.** Run `migrate()` (adds `capsules`, `runners`, `attestations`; does not touch existing tables) on a Neon *branch*, deploy the branch to a Vercel preview, smoke-test, then decide on production.
2. 🔒 **Library enum rename** `validated → endorsed` (DB migration + API compatibility alias for one release).
3. **Sybil cost for runners:** accept CI attestations signed keylessly via Sigstore/GitHub OIDC (identity = repo + workflow), count *identities* not accounts; show "same operator" when keys share an owner identity.
4. **Post-cutoff capsule set** (15 capsules) + **F at n ≥ 10**, two model families. This decides whether to continue (gate in VALIDATION-PLAN.md).
5. **Structured environment fingerprint** (interpreter path, site-packages hash, lockfile hash) to replace free-form conditions like `SITE=venv-clean`.
6. **Optional container replay** (`--docker`) for users who want isolation; still not a security claim. Hosted replay only via a rented sandbox (E2B/Vercel Sandbox), never our own.
7. 🔒 **Publish the CLI** (npm) and register the MCP server in public registries.
8. Private registries for teams (the monetization hypothesis) — only after step 4 passes.

## Explicitly not doing
- Running third-party code on our server.
- Building our own isolation layer.
- Votes, ratings or LLM judges as evidence.
- Auto-uploading code, logs, env vars or private repo data: the CLI uploads only what `push`/`submit` is told to, after showing it.
