# Architecture v2 — the Execution Evidence Network

Legend: **IMPLEMENTED** · **TESTED** · **EXPERIMENTAL** · **PENDING**

## One rule that shapes everything

**Code runs only on the user's side (their machine or their CI). The central registry stores capsules and signed results and never executes anything.** This follows the mandate ("no third-party code on the main server", "prefer local or the user's CI") and it is also the cheapest design: no sandbox fleet to pay for or secure.

```
 agent / human                         central registry (Next.js + Postgres on Neon)
 ┌──────────────────────────┐          ┌──────────────────────────────────────────┐
 │ cafe CLI  (cli/cafe.ts)  │  search  │ GET  /api/v1/capsules?q=                 │
 │ local MCP (cli/mcp.ts)   │ ───────► │ GET  /api/v1/capsules/:id  (+ evidence)  │
 │   runner (cli/runner.ts) │          │ POST /api/v1/capsules                    │
 │   ├ materialize in tmp   │          │ POST /api/v1/runners       (pub keys)    │
 │   ├ before / after / mut │  signed  │ POST /api/v1/capsules/:id/attestations   │
 │   ├ unshare -rn (no net) │ ───────► │   verify DSSE · bind check digest ·      │
 │   └ sign DSSE (Ed25519)  │  result  │   aggregate → level + flags              │
 └──────────────────────────┘          │ remote MCP (/mcp): search_capsules,      │
   GitHub Actions (user's CI) ───────► │   get_capsule (read-only)                │
                                       └──────────────────────────────────────────┘
```

## Components

| component | file(s) | status |
|---|---|---|
| Capsule schema, canonical id, validator (forbidden files, interpreter + env allowlists, sizes, paths) | `core/capsule/capsule.ts` | IMPLEMENTED, TESTED |
| Static lint for vacuous checks | `core/capsule/lint.ts` | IMPLEMENTED, TESTED (heuristic) |
| Local runner: before/after/mutants, verdicts, timeouts, network cut | `cli/runner.ts` | IMPLEMENTED, TESTED |
| in-toto Statement v1 + DSSE + Ed25519 (WebCrypto, no deps) | `core/capsule/attestation.ts` | IMPLEMENTED, TESTED |
| Evidence aggregation (levels, flags, regressions, contradictions) | `core/capsule/evidence.ts` | IMPLEMENTED, TESTED |
| Registry service + routes | `core/capsule/service.ts`, `core/handler.ts` | IMPLEMENTED, TESTED (memory + real Postgres via PGlite) |
| Stores: tables `capsules`, `runners`, `attestations` | `core/pg-schema.ts`, `core/*-store.ts` | IMPLEMENTED, TESTED; **not migrated in production** |
| CLI: `env lint replay keygen register-runner push submit search get mcp` | `cli/cafe.ts` | IMPLEMENTED; partly TESTED (runner, signing); `push/submit` against prod: PENDING (prod not migrated) |
| Local stdio MCP: `cafe_search`, `cafe_get_capsule`, `cafe_replay` (confirm gate), `cafe_submit_attestation`, `cafe_propose_capsule` | `cli/mcp.ts` | IMPLEMENTED, EXPERIMENTAL |
| Remote MCP read tools `search_capsules`, `get_capsule` | `core/mcp.ts` | IMPLEMENTED |
| Curated catalog (24 capsules, JS/TS + Python + bash) | `capsules/catalog.ts` → `capsules/built/` | IMPLEMENTED, TESTED (Experiment C) |
| CI replay matrix (Node 20.10/20.18/22.11/22, Python 3.10/3.12/3.13) | `.github/workflows/replay-matrix.yml`, `experiments/v2/ci-replay.ts` | IMPLEMENTED; results in VALIDATION-PLAN.md |
| Real sandbox for replay (E2B / Firecracker / gVisor) | — | PENDING (not built on purpose; see SECURITY-THREAT-MODEL.md) |
| Sigstore keyless / GitHub OIDC attestations | — | PENDING |
| Deployment of v2 to production | — | PENDING (needs Fer's authorization + DB migration) |

## Data model (Postgres)

- `capsules(id sha256 pk, slug, title, runtime, author_id, after_sha256, check_sha256, capsule jsonb, created_at)` — immutable; a change is a new capsule with `supersedes`.
- `runners(id = keyid, owner_id, public_key, label, created_at)` — max 5 per account.
- `attestations(id, capsule_id, runner_id, owner_id, verdict, env_key, runtime, version, conditions jsonb, mutation jsonb, envelope jsonb, created_at)` — the full signed envelope is kept so anyone can re-verify offline.

`after_sha256` is what links sibling capsules (same fix, different checks) for the independent-check level.

## The cumulative compatibility map

The product is not any single capsule; it is the table that accumulates: **capsule × (runtime, version, conditions) → verdict + mutation score**, including negatives. `experiments/v2/results/C-matrix.md` is the first real instance (104 runs). Two properties matter:

1. **Negative data is kept** (`FIX_FAILS`, `PROBLEM_NOT_REPRODUCED`): "this fix stops working on 3.13" is what an agent on 3.13 needs.
2. **Conditions are part of the key**: the same Python 3.12 reproduced the `distutils` removal only in a clean venv (Debian's setuptools shim hides it otherwise), and `fromtimestamp` only reproduces when `TZ` is not UTC.

## Why not ...

- **...run replays on our server?** Mandate forbids it, and a safe multi-tenant sandbox (Firecracker/gVisor) is a product in itself (E2B, Daytona, Vercel Sandbox exist). If hosted replay is ever needed, rent one of those; do not build isolation.
- **...use votes/reputation?** Stack Overflow for Agents and cq (Mozilla) already do confidence/reputation; votes from correlated models are not verification. Our differentiator is executed, environment-scoped, falsifiable evidence.
- **...Docker in the CLI?** Optional future; Docker alone is not a strong boundary for hostile code, and requiring it kills adoption. The CLI tells the user it is *not* a sandbox.
