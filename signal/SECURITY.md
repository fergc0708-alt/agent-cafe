# Signal — threat model

Signal runs **untrusted code on purpose**: the dependency update under test, its install scripts, and your tests
with it. A malicious or compromised package is exactly the case where you most want a diagnosis, so the design
assumes the code under test is hostile.

## The boundary

The code under test runs as the **same OS user** as Signal, on the same runner. **Nothing in Signal is a
sandbox.** Code running as that user can read the memory and the environment of every process of that user
(`/proc/<pid>/environ`), including Signal's and the runner's.

So the security boundary is **what the job has**, not what Signal hides:

| requirement | why | enforced by |
|---|---|---|
| Event is `pull_request` | `pull_request_target`, `workflow_run`, `issue_comment` and review events run with the base repository's secrets and a write token | Signal refuses them (`preflight`); override only with `--allow-privileged-event` |
| `permissions: contents: read` (+ `checks: read`, `statuses: read` for the CI cross-check) | the job token is readable by the code under test through process memory | your workflow; documented in the README |
| `persist-credentials: false` | actions/checkout otherwise writes the token into `.git/config` | Signal refuses an extraheader, credentials in remote URLs or `insteadOf` rewrites, and credential helpers in `.git/config` |
| No secrets in the job | same as the token | your workflow; Dependabot PRs get no repository secrets by default |
| Signal is the **last step** of its job | steps after it run on a workspace and runner the code under test has touched | documented |

Under those conditions the worst a malicious update can do is **lie**: make its own tests pass or fail, or forge
Signal's output. That is why Signal's verdict is **advice and never a security control**: `fail-on: regression`
can only make a job fail, Signal never approves, merges or comments, and nothing reads its output with privileges.

## What Signal does on top (defence in depth, not a boundary)

1. **Git only before untrusted code.** Every git operation (finding the base, reading lockfiles, exporting the two
   trees) happens before any project command runs, with no user/system config, no hooks, no fsmonitor and no
   credential helper. A filter or hook planted by the update in `.git/config` is never executed by Signal.
2. **No `.git` for the code under test.** Each side runs in a `git archive` export in a temporary directory, not a
   worktree: there is no `.git` to read or poison, and the checkout is never modified.
3. **Allowlisted environment.** Install and test commands get `PATH`, locale, `CI`, runtime and proxy/CA variables
   only. Tokens, cloud keys, `ACTIONS_*`, `GITHUB_ENV`/`GITHUB_OUTPUT`/`GITHUB_PATH`/`GITHUB_STEP_SUMMARY`,
   `RUNNER_TEMP` and anything else are withheld; `keep-env` adds names explicitly. **This is hygiene:** it stops
   accidental leaks (a test that prints its environment, a tool that uploads it), not a determined attacker.
4. **Fresh HOME and TMPDIR per side.** No `~/.npmrc`, `~/.git-credentials`, `~/.ssh`, `gh` config or shared caches
   between the two sides.
5. **Leftover processes.** Each command runs in its own process group, and every process gets a random per-run
   marker in its environment. When the command exits or times out, Signal kills the group and then (Linux) every
   process still carrying the marker, which also catches processes that left the group (`setpgid`, `set -m` jobs,
   `setsid`). A process that leaves the group **and** replaces its environment is not caught.
6. **Tamper detection.** Signal hashes the repository's git control files (`config`, `info/`, `hooks/`, `HEAD`,
   following `.git` files in worktrees and submodules) and the runner's workflow-command files before running
   project code, and compares after. Any change makes the verdict `inconclusive` and says so. An attacker who
   knows this can restore the files before exiting or use paths that are not watched: detection, not prevention.
7. **Workflow commands: accidental injection only.** Project output goes to a file, not to the runner. Signal's
   own printout of test names and errors is wrapped in `::stop-commands::<random>`, and `GITHUB_OUTPUT` values
   are reduced to safe characters, so a test *named* `::error::…` cannot inject a command. **A malicious update
   can still write workflow commands directly** to the runner's output (as the same user it can open the
   runner's own file descriptors through `/proc`), including fake Signal annotations, or `::stop-commands::` to
   hide Signal's. This is the same class as forging the verdict, and is why the verdict is only advice.
8. **No markdown/HTML injection in the summary.** Everything from the project or the registry is escaped; mentions,
   issue references and autolinks are defused; links only point to github.com and npmjs.com; `redact: true`
   replaces messages with their shape for public repositories.
9. **Bounded parsing.** Outputs are read from a capped tail (2 MB), parsers use linear scans and bounded regexes.
10. **Shell safety.** Package specs passed to the isolation install are validated against npm name/version
    syntax and quoted; `{specs}` substitution cannot inject `$`-patterns.
11. **No writes through symlinks in the trusted phase.** When restoring the old dependency files into the baseline
    tree, Signal refuses a path that is (or goes through) a symbolic link in the PR's commit.

## The token step

With `ci-context: true` (default) a **separate step** runs `ci-context.mjs` with the job token to read check runs
and statuses for the base commit and the PR head. It runs before any project code, executes nothing from the
repository, and writes a JSON file. The step that runs your code does not receive the token. (The token is still
in the runner's memory for the whole job, which is why the job's permissions are the boundary.)

## Known open risks

- **Same-user code can do anything the user can**, including reading the job token from the runner process.
  Mitigation is permissions, as above.
- **Pristine trees are writable.** The two exported trees that each run copies from are owned by the same user; a
  malicious update could edit them to influence later runs. Effect: a forged verdict (already possible).
- **Escaping processes.** See point 5.
- **Workflow commands and outputs can be forged** by the code under test. See point 7.
- **Proxy URLs** are passed to the code under test when the runner uses them (installs fail otherwise). If your
  proxy URL embeds credentials, the code under test sees them, as it does in your normal CI.
- **Outbound requests by Signal:** GitHub API (CI context, read-only) and the npm registry (changelog links). Both
  can be turned off (`ci-context: false`, `offline: true`).

## Reporting

Signal is an experimental tool in this repository. Report security issues privately to the repository owner
(not in a public issue).
