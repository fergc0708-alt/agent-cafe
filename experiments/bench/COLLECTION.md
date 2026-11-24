# Runtime-upgrade breakage benchmark (Python / Node.js)

`cases.json` holds **32 cases** (20 Python, 12 Node.js). In each one, a public GitHub project broke when Python moved from 3.10 to 3.11/3.12/3.13, or Node moved from 18/20 to 22/23/24, and a commit fixed it.

Every `fix_commit` was checked with a fresh `git init` plus `git fetch --depth 2 https://github.com/OWNER/REPO <fix_sha>`. For each case, `FETCH_HEAD` equals the fix SHA, `FETCH_HEAD^1` equals `broken_commit`, and the parent object is present. The script is `tools/build_cases.py`. The fetched copies are in `verify/<id>/`.

`files_lines` was computed with `git diff -U0 broken fix -- <paths>` in blobless clones (`repos/`). Line numbers refer to the **broken** commit:
- `lines` lists the lines that were changed or removed.
- `insertions_after_line` lists the points where the fix only adds code.

Changes to CI, lockfiles, changelogs and version bumps are not recorded. Tests are recorded only when the break itself was in test code. Fields that go beyond the original spec:
- `found_via_search` (which query below found the case)
- `notes` (merge or squash details, caveats)

A `works_on` value marked "(inferred)" or "unknown" means the source did not state the last working version.

## Category breakdown
| category | n |
|---|---|
| behavior-change | 15 |
| api-removed | 5 |
| stdlib-module-removed | 4 |
| build-or-packaging | 3 |
| dependency-version | 3 |
| syntax-change | 1 |
| other | 1 |

`statically_visible`: 12 true, 20 false.

## How cases were found
**Access constraints:**
- GitHub web pages and repo-specific REST endpoints (`/repos/...`) were blocked by the session proxy.
- Only the GitHub **search API** (`/search/issues`, `/search/commits`) and **git over HTTPS** worked.
- PRs were mapped to commits with `git fetch origin refs/pull/N/head`. The script then looked for:
  - the merge commit that contains that head, or
  - a squash commit with `(#N)` in its message on the default branch, or
  - if neither existed, a commit on the default branch with the same message (4 cases; see `notes`).

**Searches run** (GitHub issue/PR search, default "best match" order, first 40 results each, raw results in `raw/`):

| tag | query | outcome |
|---|---|---|
| c1 | commit search `"fix python 3.12 compatibility"` | test only; results were mostly Guix mirror and toy-repo noise, none used |
| q1 | `"python 3.12" compatibility fix is:pr is:merged` | 3 used |
| q2 | `"python 3.13" support fix is:pr is:merged` | 0 used (all were declare-support or CI changes) |
| q3 | `"fails on python 3.13"` | API error (needs is:issue), re-run as q7 |
| q4 | `"python 3.12" fix is:pr is:merged created:2023-06-01..2024-12-31` | 4 used |
| q5 | `"python 3.13" fix is:pr is:merged created:2024-05-01..2025-06-30` | 2 used |
| q6 | `"python 3.11" fix compatibility is:pr is:merged created:2022-05-01..2023-12-31` | 1 used |
| q7 | `"fails on python 3.13" is:issue` | 0 used (issues only, mostly open; issue→fix links not reachable without the REST API) |
| q8 | `python 3.12 fix in:title is:pr is:merged created:2023-06-01..2025-06-30` | 5 used |
| q9 | `python 3.13 fix in:title is:pr is:merged created:2024-06-01..2025-09-30` | 1 used |
| q10 | `python 3.11 fix in:title is:pr is:merged created:2022-06-01..2024-06-30` | 4 used |
| n1 | `"node 22" compatibility fix is:pr is:merged` | 0 used (the "22" matched PR number 22; noise) |
| n2 | `"breaks on node 23"` / `"breaks on node 23" is:issue` | first form was an API error; second gave only number-23 noise |
| n3 | `"node 24" support is:pr is:merged` | 0 used (number-24 noise, CI bumps) |
| n4 | `deprecation removed node 22 is:pr is:merged` | 0 used (noise) |
| n5 | `"node 22" fix in:title is:pr is:merged created:2024-04-20..2025-06-30` | 5 used |
| n6 | `"node 23" in:title is:pr is:merged` | 0 used (mostly security pins and CI) |
| n7 | `"node 24" fix in:title is:pr is:merged created:2025-05-01..2025-12-31` | 2 used |
| n8 | `"breaks on node" in:title is:issue` | 0 used (old Node versions, or open issues with no fix) |
| n9 | `"node 23" fix in:title is:pr is:merged created:2024-10-01..2025-06-30` | 5 used |

The date-bounded variants were added because the undated queries returned mostly very recent results, many of them CI-only. The bounds roughly follow each release's adoption window. No query names any specific API.

Supporting lookups, used only to read linked issues for symptoms (not to find cases):
- `repo:<r> is:issue <kw>` for spotify/luigi #3202, slgobinath/safeeyes #491, seek-oss/crackle #247, nfroidure/ttf2woff2 #87, guidance-ai/guidance #942, promplate/core #13, shelljs/shelljs #1180 and aliyun/alibabacloud-esa-cli #1.
- `repo:electron/forge "node 23" is:issue`, which did not return #3671.

## What was skipped and why
**Skipped at the title or summary stage** (about 650 search hits in total, the large majority). Results were dropped when they were:
- CI or test-matrix-only changes, "declare support" or trove-classifier PRs
- Dependabot/Renovate bumps, or Node security-release pins
- `@types/node` bumps, or `actions/*` Node-runtime bumps
- SyntaxWarning or DeprecationWarning-only fixes
- distro packaging (nixpkgs, Guix mirrors, conda feedstocks), or CPython's own PRs
- fixes for *older* Python/Node versions (wrong direction), or other runtimes (Blender, QGIS, OctoPrint)
- hits on the issue number instead of the Node version (n1–n4)
- open issues with no fix

**Inspected in detail (commit found and diffed) but rejected: 16**

| candidate | reason |
|---|---|
| happycube/ld-decode #893 | cause ambiguous ("Python 3.12+friends", a NumPy int8 overflow); not clearly a Python change |
| sstsimulator/sst-core #1060 | invalid-escape SyntaxWarning only, not a break |
| axnsan12/drf-yasg #921 | adds support for new 3.12 syntax (PEP 695) in user code; not a regression |
| huggingface/optimum-intel #747 | mostly CI; the setup.py change is vague (setuptools added "needed for 3.12") |
| snyk/snyk-python-plugin #229 | fix vendors a 3,361-line copy of pkg_resources plus CI/TS changes; the root-cause lines cannot be pinned down |
| powerline/powerline #2271 | the author says the 3.13 root cause is unclear; the PR mixes in a 3.14 argparse fix and typo fixes |
| KyleKing/textract-py3 #9 | duplicate of an accepted case (`distutils.spawn.find_executable` → `shutil.which`, as in stackrox/workflow) |
| jarkkom/skybot #2 | duplicate of an accepted case (`ssl.wrap_socket` removal, as in apache/trafficserver) |
| programisto-labs/endurance #9 | duplicate (import assertions `assert {type:'json'}`, as in aliyun/alibabacloud-esa-cli) |
| nlxai/sdk #221 | duplicate (import assertions) |
| jlundan-vincit/get-firebase-token #4 | duplicate (import assertions) |
| razorpay/blade #2715 | duplicate (import assertions) |
| At-Maag/AI_Trading #35 | cause is the ethers v6 API change, not Node 22 |
| borhae/choreapp #2 | cause is an ESM-only lowdb, not Node 22 |
| microsoft/azure-pipelines-task-lib #1146 | cause is a custom `Array.prototype.find` polyfill, not Node 24 |
| fastify/busboy #193 | only a types-test config change; what broke is not stated |

Duplicate rule: only one case was kept per identical removed API and replacement, namely the first one found in search order. This rule applied only to the 6 duplicates listed above.

**Plausible candidates not examined** because the quota of 24–32 cases (about 2/3 Python) was already filled:
- **Python:** TagStudio #1047, errbot #1729, openbabel #2809, proto-plus-python #492, litellm #8160, devopshq/artifactory #476, nvda #18656 and #15885, astroid #2665, suite2p #1122, django-photologue #226, ntfy #271, pycortex #536, Kludex/zuvloop #273, IMIO/imio.email.parser #10, Bin-Cao/Bgolearn #11 (open issue).
- **Node:** theforeman/foreman #10556, n8n #16730, galaxy #19378, lifion-kinesis #2, codeforlife #86, fastify/otel #65, fastify-postgres #203, fastify-swagger #873, BitGoJS #6529, dword-design/base #827, nats.js #255, starlight #3200, genkit #3116, node-red-contrib-condition-monitoring #56, docusaurus #11530 (warning only).

No candidate was rejected because its SHA could not be fetched. All 32 accepted fix commits and their parents fetched successfully.

## Caveats
- Many recent hits (2026) came from small or AI-assisted repos. A few accepted cases are AI-assisted fixes (IMIO/email2pdf2, stackrox/workflow, teramoby/speedle-plus). They are still real merged fixes.
- teramoby/speedle-plus is specific to one patch release: CPython 3.12.3 fails and 3.12.16 does not, according to the PR.
- For kando, crackle and insights-core, the exact runtime change behind the break is not spelled out in the sources; see `notes`.
- In some cases the reported version differs from the version where the API was actually removed (e.g. sphinx-js reports Node 24). `breaks_on` keeps the reported version and adds a qualifier.

## Files
- `cases.json`: the benchmark
- `tools/spec.py`: hand-curated metadata
- `tools/build_cases.py`: verification and files_lines extraction
- `tools/prcase.py`: finds the fix commit for a PR
- `tools/search.sh`: search helper
- `raw/`: raw search API responses
- `repos/`: blobless clones
- `verify/`: depth-2 verification fetches
