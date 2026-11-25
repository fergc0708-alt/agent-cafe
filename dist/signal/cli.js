// `signal diagnose`: was it the update?  (exposed as `cafe signal …` and by the GitHub Action in signal/action.yml)
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnose } from "./diagnose.js";
import { git } from "./exec.js";
import { packageLinks, renderMarkdown, renderText } from "./report.js";
const BOOL = new Set(["no-isolate", "redact", "offline", "allow-persisted-credentials", "allow-privileged-event", "help"]);
export function flags(argv) {
    const pos = [];
    const f = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) {
            pos.push(a);
            continue;
        }
        const eq = a.indexOf("=");
        const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
        const v = eq < 0 ? undefined : a.slice(eq + 1); // values may contain "=" (e.g. --test "FOO=1 npm test")
        if (v !== undefined)
            f[k] = v;
        else if (BOOL.has(k))
            f[k] = true;
        else if (argv[i + 1] !== undefined)
            f[k] = argv[++i];
        else
            throw new Error(`--${k} needs a value`);
    }
    return { pos, f };
}
export const HELP = `signal diagnose — was it the dependency update?

Runs your tests with the update and, only if they fail, without it (same commit, dependency files reverted,
fresh install, same machine), then compares which tests fail.

  --base <ref>            base to compare with (default: auto = the PR merge commit's first parent)
  --install <cmd>         install command (default: detected from the lockfile)
  --test <cmd>            test command (default: package.json "test" script)
  --junit <path>          JUnit XML written by the test command (exact test names)
  --retries <n>           re-runs of a failing side, 0-3 (default 2)
  --timeout-minutes <n>   per command (default 20)
  --no-isolate            do not search for the responsible update in grouped PRs
  --isolate-budget <n>    max extra runs for that search (default 8)
  --fail-on <regression|never>  exit 1 on a high-confidence regression (default never)
  --markdown <file>       write the report;  --json <file>  write the full diagnosis
  --redact                show error shapes instead of messages (public repositories)
  --offline               no changelog lookups
  --add-command <cmd>     how to install specific versions during isolation, "{specs}" = name@version list
  --ci-context <file>     what the project's CI reported (written by ci-context.mjs before any project code runs)
`;
/** Refuses to run untrusted code where it could act as this repository. */
export function preflight(dir, allowPersisted, env = process.env, allowPrivileged = false) {
    const warn = [];
    const ev = env.GITHUB_EVENT_NAME ?? "";
    if (ev === "pull_request_target")
        throw new Error("refusing to run on pull_request_target: it executes the PR's code with the base repository's secrets and write token. Use `pull_request`.");
    if (/^(workflow_run|issue_comment|pull_request_review|pull_request_review_comment)$/.test(ev) && !allowPrivileged) {
        throw new Error(`refusing to run on ${ev}: that event runs with the base repository's token and secrets, and a PR's code must not. Use \`pull_request\`, or pass --allow-privileged-event if this job has no secrets and a read-only token.`);
    }
    const cfg = git(dir, ["config", "--local", "--list"]).out;
    const problems = [];
    if (/^http\.([^\n]*\.)?extraheader=/im.test(cfg))
        problems.push("an http extraheader (the actions/checkout token)");
    if (/^remote\.[^\n]*\.url=[a-z+]+:\/\/[^\/\s@]+@/im.test(cfg))
        problems.push("credentials inside a remote URL");
    if (/^url\.[^\n]*@[^\n]*\.insteadof=/im.test(cfg))
        problems.push("credentials inside a url.*.insteadOf rewrite");
    if (/^credential\.([^\n]*\.)?helper=./im.test(cfg))
        problems.push("a credential helper");
    if (problems.length && !allowPersisted)
        throw new Error(`the repository's .git/config holds ${problems.join(", ")}, and the project's install scripts and tests could read it. Use actions/checkout with \`persist-credentials: false\`, or pass --allow-persisted-credentials if you accept that risk.`);
    if (problems.length)
        warn.push(`.git/config holds ${problems.join(", ")}, readable by the code under test`);
    return warn;
}
/** GitHub workflow-command escaping (for ::error annotations) */
const escData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s) => escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
/** GITHUB_OUTPUT values: one line, no control characters */
const oneLine = (s) => s.replace(/[^\w@./+,~-]/g, "").slice(0, 200);
function prTitle() {
    const p = process.env.GITHUB_EVENT_PATH;
    if (!p)
        return undefined;
    try {
        return JSON.parse(readFileSync(p, "utf8"))?.pull_request?.title;
    }
    catch {
        return undefined;
    }
}
export async function main(argv) {
    const [sub, ...rest] = argv;
    if (!sub || sub === "help" || sub === "--help") {
        console.log(HELP);
        return 0;
    }
    if (sub !== "diagnose" && sub !== "run") {
        console.error(`unknown command "${sub}"\n\n${HELP}`);
        return 2;
    }
    const { f } = flags(rest);
    if (f.help) {
        console.log(HELP);
        return 0;
    }
    const dir = resolve(typeof f.dir === "string" ? f.dir : ".");
    const failOn = typeof f["fail-on"] === "string" ? f["fail-on"] : "never";
    if (!["regression", "never"].includes(failOn))
        throw new Error("--fail-on must be regression or never");
    const warnings = preflight(dir, f["allow-persisted-credentials"] === true, process.env, f["allow-privileged-event"] === true);
    const num = (k) => (typeof f[k] === "string" && f[k] !== "" ? Number(f[k]) : undefined);
    const str = (k) => (typeof f[k] === "string" && f[k] ? f[k] : undefined);
    let ci = null;
    if (str("ci-context")) {
        try {
            ci = JSON.parse(readFileSync(str("ci-context"), "utf8"));
        }
        catch {
            ci = { available: false, base: null, head: null, note: "the CI context file could not be read" };
        }
    }
    let d;
    try {
        d = await diagnose({
            dir, base: str("base") ?? "auto", install: str("install"), test: str("test"), junit: str("junit"),
            retries: num("retries"), timeoutMs: num("timeout-minutes") ? num("timeout-minutes") * 60_000 : undefined,
            isolate: f["no-isolate"] !== true, isolateBudget: num("isolate-budget"),
            title: str("title") ?? prTitle(), log: (s) => console.error(s), addCommand: str("add-command"), ci,
        });
    }
    catch (e) {
        const m = e.message;
        if (/^no dependency change/.test(m)) {
            console.log(`Signal: ${m}. Nothing to diagnose.`);
            return 0;
        }
        throw e;
    }
    for (const w of warnings)
        d.limits.push(`Security: ${w}.`);
    const linkFor = d.isolation?.culprits?.length ? [...d.isolation.culprits, ...d.delta.direct] : d.delta.direct.length ? d.delta.direct : d.delta.changes;
    const links = await packageLinks(linkFor, f.offline === true);
    const report = renderMarkdown(d, links, { redact: f.redact === true });
    // Test names and error messages come from untrusted code: stop the runner from parsing them as workflow commands.
    const token = randomBytes(16).toString("hex");
    if (process.env.GITHUB_ACTIONS)
        console.log(`::stop-commands::${token}`);
    console.log(renderText(d));
    if (process.env.GITHUB_ACTIONS) {
        console.log(`::${token}::`);
        const level = d.verdict.startsWith("regression") ? "error" : d.verdict === "compatible" || d.verdict === "pre_existing" ? "notice" : "warning";
        console.log(`::${level} title=${escProp(`Signal: ${d.verdict} (${d.confidence})`)}::${escData(d.next)}`);
    }
    if (str("markdown"))
        writeFileSync(str("markdown"), report);
    if (str("json"))
        writeFileSync(str("json"), JSON.stringify(d, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
    if (process.env.GITHUB_OUTPUT) {
        const culprit = d.isolation?.status === "single" ? d.isolation.culprits.map((c) => c.package).join(",") : d.verdict.startsWith("regression") && d.delta.direct.length === 1 ? d.delta.direct[0].package : "";
        appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${oneLine(d.verdict)}\nconfidence=${oneLine(d.confidence)}\nculprit=${oneLine(culprit)}\n`);
    }
    return failOn === "regression" && d.verdict.startsWith("regression") && d.confidence === "high" ? 1 : 0;
}
