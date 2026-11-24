# Real-world benchmark: runtime-upgrade breaks from public projects (GOAT 4)

**Question.** Which concrete problems does Agent Café find that the usual tools do not?

**Answer.** On 32 real breaks it found **4** (5 counting an "environment-dependent" flag). Free tools together found **9**.
Exactly **one** case was found by Agent Café and by none of the free tools: a Node 22 import-assertion syntax removal,
for which Node.js publishes an official codemod. **22 of 32 breaks were found by no static tool at all**, ours
included; they surface only when the code runs on the new version.

## Corpus (not ours)

- **Collection.** 32 cases, collected by a separate agent that was forbidden to read this repository. It used generic
  searches ("python 3.12 fix", "node 23", …; full list and the 16 rejected candidates in
  [`COLLECTION.md`](COLLECTION.md)).
- **Ground truth.** Each case is a merged fix commit and its parent, both fetched and verified with git. The ground
  truth is the set of lines the fix commit changed. No tool's rules were used to pick or label cases.
- **Mix.** 20 Python cases (3.11 ×5, 3.12 ×11, 3.13 ×4) and 12 Node cases (22 ×5, 23 ×5, 24 ×2). 15 behaviour
  changes, 5 removed APIs, 4 removed stdlib modules, 3 build/packaging, 3 dependency versions, 1 syntax change, 1 other.
  The collector judged only 12 of 32 statically visible.
- **Overlap with our catalog.** 4 cases touch APIs our catalog covers: SafeConfigParser, imp, getargspec and import
  assertions. Two more (ssl.wrap_socket and distutils) appear in files or environments our scanner does not read.
  This overlap is accidental and is the reason we score anything at all.

## Method

- **Execution.** Snapshots are only read; no third-party code was executed.
- **Scope.** Every tool analyses the files the fix touched in the broken snapshot. Running mypy on a whole repository
  often aborts ("duplicate module") and reports nothing, which would have been unfair to it. `cafe doctor` scans the
  whole repository, as it does for users.
- **Differential mode** is used for type checkers: findings for the new version minus findings for the last working
  version. This is how a team would use them for an upgrade, and it removes unrelated type noise.
- **Absolute mode** is used for deprecation linters (pylint `deprecated-*`, ruff `UP/PGH/PLW/PLE`, vermin,
  eslint-plugin-n). They warn before the removal, and a diff would erase exactly that.
- **Counting.** A finding counts if it is within ±3 lines of a changed line **and** a manual review agrees that its
  message is about that break ([`RELEVANCE.json`](RELEVANCE.json); 5 positional coincidences by ruff were discarded).
- **Data and scripts.** Raw results are in [`results.json`](results.json), the summary in
  [`summary.json`](summary.json), and the scripts are `run_bench.py` and `summarize.py`.

| tool | runtime | cases | could run | **found** | other findings in the touched files | findings left in the fixed files |
|---|---|---|---|---|---|---|
| mypy `--python-version` (differential) | Python | 20 | 18 | **7** | 3 | 3 |
| pyright `--pythonversion` (differential) | Python | 20 | 18 | **6** | 1 | 2 |
| pylint `deprecated-*` | Python | 20 | 18 | **4** | 9 | 5 |
| Agent Café `doctor` | both | 32 | 32 | **4** (+1 env-dependent) | see note | 0 |
| ruff `UP,PGH,PLW,PLE` | Python | 20 | 18 | **1** (`PGH005` mock typo) | 333 | 47 |
| vermin | Python | 20 | 18 | 0 | 1 | 1 |
| Semgrep registry (`p/python`, `p/javascript`) | both | 32 | 32 | 0 | 6 | — |
| tsc + `@types/node@<version>` (differential) | Node | 12 | 7 | 0 | 0 | 0 |
| eslint-plugin-n `no-deprecated-api` | Node | 12 | 0 (no plain JS in touched files) | 0 | — | — |

**Agent Café's extra findings.** It scans the whole repository and reported 55 hits outside the fixed lines. In a
sample, some are real latent breaks: `assertEquals` in vendored gmock tests, and `getargspec` in luigi and datalad.
Many are "code" capsules that are not upgrade breaks at all:
- `fromtimestamp`/`utcnow` style warnings;
- TS parameter properties, which only matter under Node's type stripping (kubeflow and httptoolkit compile with tsc,
  so these are false alarms);
- `__dirname` in ESM eslint configs.

**Who found what**
- **Free tools together (9):**
  - SafeConfigParser, distutils.spawn, distutils.util, imp, ssl.wrap_socket, getargspec;
  - `random.sample(set)` (mypy and pyright, from typeshed's 3.11 signature);
  - `object.__getstate__` returning None (pyright);
  - a `mock.called_once_with` typo (ruff `PGH005`).
- **Agent Café (4):** SafeConfigParser, imp and getargspec, all also found by mypy and pyright; plus Node import
  assertions, found by no other tool.
- **Missed by Agent Café but found by free tools:**
  - **ssl.wrap_socket:** the code lives in a `.test.ext` file our scanner skips.
  - **distutils.spawn:** in an extension-less script.
  - **distutils.util:** downgraded to "environment-dependent" because this machine has setuptools' shim.
  - **random.sample(set), `__getstate__` and the mock typo:** not in our catalog.
- **Found by nobody (22):**
  - 13 behaviour changes, for example:
    - PEP 667 `locals()`;
    - symlink resolution;
    - `email.utils` parsing on one patch release;
    - Node 22.10 `stdio` handling;
    - EISDIR on Node 23;
    - `require(esm)` with top-level await;
    - AsyncLocalStorage on Node 24.
  - 3 build/packaging: `pkg_resources`, Cython `long`, and distutils inside `configure.ac`.
  - 3 dependency pins.
  - 1 API removal hidden behind dynamic code (luigi's `random.seed`).
  - 1 Electron Forge toolchain case.
  - 1 removed-API case in a third-party JS dependency (jsdoc's `util.isRegExp`).

## What this means

1. **For statically visible breaks, the free type checkers dominate.** They have version-accurate data for the whole
   standard library (typeshed `VERSIONS` and `sys.version_info` guards, plus `@types/node` per major). They are
   maintained by others and already installed in many projects. Our curated catalog of 25 breaks cannot compete on
   coverage. On these real cases it was weaker than mypy alone (4 vs 7 on Python).
2. **Most real upgrade breaks (22/32, 69%) are not statically visible to anyone.** They show up only by running the
   code on the new runtime, which a CI matrix entry or Renovate's runtime-bump PR already does for free. The executed
   evidence we attach to capsules does not help here, because the break is not in a capsule.
3. **The one unique catch is narrow.** Import assertions have an official codemod
   (`@nodejs/import-assertions-to-attributes`), so a team that knows about the removal fixes it in one command.
4. **Caveats.**
   - 32 cases from GitHub search; the collector judged "statically visible" by hand.
   - Five cases have an inferred last-working version.
   - The type checkers ran without the projects' dependencies installed, which helps differential mode (missing
     imports cancel out) but may hide attribute errors on third-party objects.
   - Our tool was run with this machine's environment, which has setuptools' distutils shim.

Agent Café's differentiation as a *detector of known breaks* does not survive this benchmark.
