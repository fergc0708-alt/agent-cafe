# Agent Café ☕ — know which runtime upgrades break your code

**`cafe doctor` scans your project and its real environment and tells you which known Node.js and Python breaking changes hit _your_ lines: now, on the versions you declare, and on the next upgrade.** Every answer is backed by fixes that were *executed* in that environment, including the places where a fix **fails**. `doctor`, `diagnose` and `show` run locally and never use the network; interpreters other than the ones on your PATH (or that you pass with `--python/--node`) are only probed inside the sandbox, because a repository can ship its own "python".

```text
$ cafe doctor
Environment: linux-x64 · node 22.23 · python 3.13 (system) · TZ local
Checking:    node 22.23 (installed), python 3.13 (installed), node 20.0 (declared engines >=20), node 24.22 (upgrade target)

BROKEN NOW  imp was removed in Python 3.12: load modules with importlib.util
   app/legacy.py:1  import imp
   ✖ python 3.13 (installed): breaks here; the fix works here. Seen on python 3.13.18 (verified: GitHub Actions …)
   ✓ not affected on python 3.11
   → Broken now: apply the fix (cafe show py-imp-removed).

BREAKS ON UPGRADE  Dirent.path was removed in Node 24: use dirent.parentPath (Node >= 20.12)
   app/walk.js:5  …map((d) => path.join(d.path, d.name))
   ? node 20.0 (declared engines >=20): not tested. Nearest newer: 20.10 -> the old code works here, but this FIX BREAKS it
   ✖ node 24.22 (upgrade target): breaks here; the fix works here.
   → Breaks on node 24.22, but the known fix breaks node 20.0: you need a version-guarded fix, not this one as-is.
```

Branch `goat/prove`. Not merged to `main`, not deployed, not published to npm.

> **Status (2026-11-24): development stopped, by our own measurement.** On 32 real upgrade breaks from public projects, `doctor` found 4, mypy alone 7, free tools together 9 ([benchmark](experiments/bench/RESULTS.md)); in a replicated controlled evaluation agents were not more successful with it, only slower ([eval](experiments/eval/RESULTS.md)). For static upgrade checks use `mypy --python-version X` / `pyright --pythonversion X` / `tsc` with `@types/node@N`, diffed against your current version. Reasoning in [docs/PRODUCT-DECISION.md](docs/PRODUCT-DECISION.md).

## Install and use (2 minutes)

Requires Node ≥ 20 (the GitHub Action and the compiled CLI) and git. The sandboxed `replay`/`capture` need Linux with [bubblewrap](https://github.com/containers/bubblewrap) (`apt install bubblewrap`).

```bash
git clone --depth 1 -b goat/prove https://github.com/fergc0708-alt/agent-cafe ~/.agent-cafe-cli
alias cafe="node ~/.agent-cafe-cli/dist/cli/cafe.js"

cd your-project
cafe doctor                                # known breaks in your code: installed, declared and newest verified versions
cafe doctor --target node@24,python@3.13   # "what breaks if I upgrade to…"
cafe doctor --python .venv-deploy/bin/python   # evaluate the interpreter that really runs the code
cafe diagnose "ModuleNotFoundError: No module named 'imp'"   # or: some-command 2>&1 | cafe diagnose -
cafe show py-imp-removed                   # the fix as a diff, the check, where it was executed
cafe replay py-imp-removed                 # reproduce it here, in a bubblewrap sandbox (shows every file, asks first)
cafe capture --check tests/test_loader.py  # turn YOUR fix + regression test into a private capsule (see below)
```

| command | what it does |
|---|---|
| `doctor` | Fingerprints the environment (runtimes, project virtualenv, declared versions, time-zone class, Python site-packages setup), scans source files with each capsule's detection rule (no symlinks followed), and evaluates every hit per environment. Code for a runtime it could not evaluate is reported as **NOT EVALUATED** and fails `--fail-on`, never passes. Flags all-clears that only hold because of a local condition (e.g. "works here only because setuptools' distutils shim is installed"). Exit code via `--fail-on now\|upgrade\|never`; `--json`, `--markdown`. |
| `diagnose` | Matches an error to a known break **for this environment**. Says plainly when nothing matches. If your default runtime is immune but another version is affected, it says so instead of guessing. |
| `show` / `search` | A capsule's fix (diff), its check, what it proves and does not prove, and the per-version results. |
| `replay` | Runs a capsule's check here: it must fail on the broken code, pass on the fix, and catch mutants of the fix. Sandboxed with bubblewrap; refuses to run without it unless you opt out explicitly. |
| `capture` | Takes git `HEAD` as "before", your working tree as "after", and your test as the check; replays it in the sandbox and saves a capsule to `.cafe/capsules/` **only if** the test fails before, passes after and catches ≥ 50% of mutants. Private; nothing is uploaded. Private capsules show up in `doctor`/`diagnose` for that project. |
| `env` | The environment fingerprint, with what could not be determined. |

## For coding agents (MCP)

```bash
claude mcp add agent-cafe -- node ~/.agent-cafe-cli/dist/cli/cafe.js mcp      # Claude Code; any stdio MCP client works
```

Six short tools: `cafe_diagnose` (error → matching fix as a diff, or "nothing matches"), `cafe_doctor`, `cafe_show`, `cafe_search`, `cafe_replay` and `cafe_capture`. The last two execute code: they return every file plus a digest first, and run only when called again with that digest from the same session (`destructiveHint`, so clients ask the human). Typical response size: under 1 KB for `cafe_diagnose`.

## In CI (GitHub Action)

```yaml
- uses: actions/setup-node@v4          # your project's runtimes, as you already set them up
- uses: actions/setup-python@v5
- uses: fergc0708-alt/agent-cafe@498bc9bff1cecac78fc11bc44c5d03cda6217742   # pin a full commit SHA, never a branch
  with:
    fail-on: now                       # or "upgrade" to also fail on breaks at the newest verified versions
    # targets: "node@24,python@3.13"
```

It runs on the job's own Node/Python (it does not install its own runtime, so the report describes your toolchain), writes a Markdown summary, and **reports an untested environment as untested, never as passing**. Dogfooded on [`examples/legacy-app`](examples/legacy-app) by `.github/workflows/guard-example.yml` (Node 20 + Python 3.11 and Node 24 + Python 3.13), including a job that consumes the action by pinned SHA exactly as an external repository would. The action needs no `npm install`, no token and no permissions beyond `contents: read`; it makes no network calls.

## How it knows: capsules and executed evidence

A **capsule** is a minimal broken program, its fix, and a check that must fail on the broken code and pass on the fixed code (`capsules/catalog.ts`, `capsules/compat.ts` → `capsules/built/`). For upgrade breaks the "before" code uses the removed API, so each run's verdict says, for that exact environment:

| verdict | meaning in that environment |
|---|---|
| `PROBLEM_NOT_REPRODUCED` | not affected: the old code still works |
| `PASS` (≥ 50% mutants caught) | breaks, and this fix works |
| `FIX_FAILS` / `FIX_BREAKS` | breaks and this fix also fails / the old code works but this fix breaks it |

`capsules/built/evidence.json` holds **376 results for 42 capsules** (Node 20.10–24.22, Bun 1.4, Python 3.10–3.13 incl. clean venvs, bash; time-zone and site-packages conditions):

- **verified** rows come from GitHub-hosted runners of the workflow pinned in [`core/doctor/pins.ts`](core/doctor/pins.ts) (`replay-matrix.yml` on this repository's `main` or `goat/evidence-network`, pinned by repository and owner **ids**, third-party actions pinned by commit SHA). Each job signs its results with an ephemeral Ed25519 key (in-toto/DSSE) and obtains a **GitHub Actions OIDC token whose audience is bound to that key and the exact set of result digests**. The verifier checks the RS256 signature against GitHub's keys (digest pinned in source), issuer, audience binding, `job_workflow_ref`, `runner_environment == github-hosted` and the event. The signed sources ship in `capsules/built/evidence-sources.json`, and `npm test` **re-derives every shipped row from those signatures** and fails if any row, key or policy was altered.
- **self-reported** rows come from the curator's machine (signed, not identity-verified).
- When both exist for an environment, verified rows win; a contradicting claim cannot flip them. Results that disagree within verified evidence are shown as *environment-dependent*.

**What "verified" does and does not mean.** It proves *where* a check ran (which repository, workflow, commit, GitHub-hosted runner). It does **not** prove the check is meaningful, and today the same operator wrote the capsules and owns the verifying workflow. The registry API (below) uses the same verification for submitted results: identity owners, not accounts or keys, count toward independence.

## Measured results (honest)

- **Engine and evidence:** 63 automated tests (`npm test`), including OIDC forgery/replay attempts, the evidence semantics and its re-derivation from signatures, the scan, the MCP approval flow, and regressions for every reproduced red-team finding.
- **Security audit:** two adversarial audits by separate agents (same model family, so not independent in the strong sense). The second found 1 critical, 5 high and 7 medium issues on this iteration (repository-shipped interpreters executed during `doctor`, planted local capsules, a green pass when a runtime was not evaluated, a circular evidence-integrity test, a broad OIDC policy, …); all critical/high and most medium ones are fixed with regression tests. See [docs/SECURITY-THREAT-MODEL.md](docs/SECURITY-THREAT-MODEL.md).
- **Utility for agents:** a pre-registered controlled evaluation ([`experiments/eval`](experiments/eval/RESULTS.md)): 4 tasks × {with, without} × 2 repetitions, same model, hidden graders. **Both arms solved 8/8; the agents with Agent Café were slower (median 34 s vs 21 s on the wedge tasks).** The pre-registered success rule was not met. On these well-documented breaks the model already knows the fix. The evaluation also exposed two product defects (a detection rule that missed submodule imports; diagnose ruling out the right fix because it only checked the default runtime), both fixed afterwards. **A replication after the fixes (run 2) gave the same picture: 8/8 vs 8/8, +56% median time with Agent Café, and +52% on the task where no capsule applies.** Only one model family was available, so the cross-family run is still pending.
- **Where it plausibly helps (not yet measured):** catching breaks before any agent or developer time is spent (the CI guard), breaks newer than the model's knowledge, environment traps that look fine locally (the distutils/setuptools case), and "this fix breaks your other supported version".

## Limits you should know

- The catalog is small (42 capsules, ~25 with detection rules) and curated by one operator. Detection is line-regex based, so it can miss code (aliases, dynamic imports) and flag false positives; each hit shows the line so you can judge.
- Sandboxed replay/capture are Linux-only (bubblewrap). Elsewhere they refuse to run unless you pass `--isolation none` deliberately (e.g. inside a VM).
- The fingerprint does not yet cover native dependencies, compilers or dependency versions from lockfiles; `cafe env` lists what is undetermined. The runner forces `TZ=UTC` and only records a time zone when a capsule sets one.
- "Verified" is identity, not review: the same operator controls the capsules and the pinned workflow. Detection-rule regexes are guarded against catastrophic backtracking by a heuristic, not a linear-time engine.
- The MCP approval step can still be completed by the model itself; the human gate is your client's tool-approval prompt.
- No external users yet, no retention data.

## Repository layout

```
cli/                 cafe CLI: doctor/diagnose/show (doctor.ts, render.ts), fingerprint.ts, capture.ts, runner.ts (bubblewrap replay), mcp.ts
core/doctor/         match.ts: the environment-aware engine shared by CLI, MCP, Action and website
core/capsule/        capsule schema + validator, lint, DSSE attestations, OIDC verification (oidc.ts), evidence levels, registry service
capsules/            catalog sources → capsules/built/ (capsules, evidence.json, github-jwks.json)
dist/                compiled CLI used by the Action (npm run build:cli; CI fails if it is stale)
action.yml           the GitHub Action
src/                 website (Next.js): compatibility matrix at /compat, plus the original café pages
experiments/         v1 experiments, v2 evidence runs (results*/), eval/ (controlled evaluation)
docs/                design docs from earlier iterations (evidence model, threat model, …)
```

Develop: `npm ci && npm test && npm run typecheck && npm run build`. Rebuild data: `node scripts/build-capsules.ts`, then `node scripts/build-evidence.ts <results dir>` (needs the CI artifacts of `replay-matrix.yml`).

## Registry API and the original café

The website and API from the first iterations still work: capsule registry (`/api/v1/capsules`, runner keys with proof-of-possession, signed results, optional GitHub OIDC identity via `CAFE_TRUSTED_WORKFLOWS`), plus the agent library, logbook and open problems (`/library`, `/logbook`, `/problems`, `/skill.md`, MCP at `/mcp`). The library's `validated` status means *endorsed by votes*, not executed. The capsule tables are **not migrated in production** yet. See [SECURITY.md](SECURITY.md) and [docs/SECURITY-THREAT-MODEL.md](docs/SECURITY-THREAT-MODEL.md).

## License

MIT. Capsule content in this repository: MIT.

## En español

Agent Café ahora es una herramienta concreta: `cafe doctor` revisa tu proyecto y tu entorno real y te dice qué cambios de Node o Python rompen *tus* líneas: hoy, en las versiones que declarás y al actualizar. Cada respuesta está respaldada por arreglos que se ejecutaron en ese entorno, incluidos los lugares donde el arreglo falla. Funciona en tu máquina, como servidor MCP para agentes y como GitHub Action. La evaluación controlada no mostró que haga más rápidos a los agentes en errores conocidos; el valor está en prevenir antes de que alguien pierda tiempo.
