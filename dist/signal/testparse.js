// Which tests failed, and with what message, from a test run's output (or JUnit XML). Best effort and explicit about
// it: when no failing test can be identified, callers say "tests not identified" instead of guessing.
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
const clean = (s) => strip(s).replace(/\s+/g, " ").trim().slice(0, 300);
const ERRLINE = /(?:Error|Exception|AssertionError|assert|expected|Expected|Received|toBe|toEqual|Cannot |is not a function|is not defined|Unexpected|failed|ERR_)/;
function firstError(lines, from, max = 25) {
    for (let i = from; i < Math.min(lines.length, from + max); i++) {
        const l = strip(lines[i]).trim();
        if (l && ERRLINE.test(l) && !/^(FAIL|PASS|✓|√|ok |not ok )/.test(l))
            return clean(l);
    }
    return "";
}
export function parseJunit(xml) {
    const out = [];
    const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
    const attr = (a, k) => a.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1]?.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") ?? "";
    for (const m of xml.matchAll(re)) {
        const body = m[3] ?? "";
        const f = body.match(/<(failure|error)\b([^>]*)>?/);
        if (!f)
            continue;
        const a = m[1];
        const id = [attr(a, "classname") || attr(a, "file"), attr(a, "name")].filter(Boolean).join(" > ");
        const msg = attr(f[2] ?? "", "message") || clean(body.replace(/<[^>]+>/g, " ").split("\n").find((l) => l.trim()) ?? "");
        out.push({ id, message: clean(msg) });
    }
    return out;
}
export function parseOutput(log) {
    const text = strip(log.length > 8 << 20 ? log.slice(-(8 << 20)) : log);
    const lines = text.split("\n");
    const seen = new Map();
    const add = (id, at, msg) => {
        id = id.replace(/\s+\d+(\.\d+)?\s?m?s$/, "").replace(/\s+/g, " ").trim().slice(0, 240);
        if (!id || seen.has(id))
            return;
        seen.set(id, { id, message: msg ? clean(msg) : firstError(lines, at + 1) });
    };
    let runner = "unknown";
    let totals;
    // pytest: "FAILED tests/test_x.py::test_y - AssertionError: ..." / "ERROR tests/test_x.py - ImportError"
    for (const [i, l] of lines.entries()) {
        const m = l.match(/^(FAILED|ERROR) ([^\s]+(?:::[^\s]+)?)(?: - (.*))?$/);
        if (m && (m[2].includes("::") || /\.py\b/.test(m[2]))) {
            runner = "pytest";
            add(m[2], i, m[3]);
        }
    }
    const pt = text.match(/=+ (?:(\d+) failed)?(?:, )?(?:(\d+) passed)?.* in [\d.]+s/);
    if (runner === "pytest" && pt)
        totals = { failed: Number(pt[1] ?? 0), passed: pt[2] ? Number(pt[2]) : undefined };
    if (runner === "unknown") {
        // vitest: " FAIL  test/a.test.ts > suite > name" ; jest: "  ● suite › name"
        for (const [i, l] of lines.entries()) {
            const v = l.match(/^\s*(?:FAIL|×|✗)\s+(\S+\.(?:[cm]?[jt]sx?)\s+>\s+.+)$/);
            if (v) {
                runner = "vitest";
                add(v[1], i);
                continue;
            }
            const j = l.match(/^\s*●\s+(.+›.+|[^●]+)$/);
            if (j && !/Console|Test suite failed to run/.test(j[1])) {
                runner = "jest";
                add(j[1].replace(/\s+›\s+/g, " > "), i);
                continue;
            }
            if (/^\s*●\s+Test suite failed to run/.test(l)) {
                runner = "jest";
                const file = lines.slice(Math.max(0, i - 3), i).reverse().map((x) => x.match(/FAIL\s+(\S+)/)?.[1]).find(Boolean);
                add(`${file ?? "suite"} (failed to run)`, i);
            }
        }
        const vt = text.match(/Tests\s+(\d+) failed(?: \| (\d+) passed)?/);
        const jt = text.match(/Tests:\s+(\d+) failed(?:, (\d+) passed)?/);
        if (vt)
            totals = { failed: Number(vt[1]), passed: vt[2] ? Number(vt[2]) : undefined };
        else if (jt)
            totals = { failed: Number(jt[1]), passed: jt[2] ? Number(jt[2]) : undefined };
    }
    if (runner === "unknown") {
        // node:test / TAP: "not ok 3 - name" (skip "# TODO"); spec reporter: "✖ name (1.2ms)"
        // TAP nests subtests by indentation; a parent (file or suite) reports "not ok" after its failing children,
        // so a "not ok" whose deeper children already failed is an aggregate, not a separate failure.
        let deeperFailed = [];
        for (const [i, l] of lines.entries()) {
            const t = l.match(/^(\s*)not ok \d+ - (.+?)(?:\s+#\s+(?:TODO|SKIP).*)?$/);
            if (t && !/#\s*(TODO|SKIP)/i.test(l)) {
                const depth = t[1].length;
                const hasChild = deeperFailed.some((d) => d > depth);
                deeperFailed = deeperFailed.filter((d) => d <= depth);
                runner = "node-test";
                if (!hasChild) {
                    // the YAML block after a TAP failure carries `error: '...'`
                    let m2 = "";
                    for (let k = i + 1; k < Math.min(lines.length, i + 30); k++) {
                        const e = lines[k].match(/^\s+error:\s*['"|>-]?\s*(.*?)['"]?\s*$/);
                        if (e) {
                            m2 = e[1];
                            break;
                        }
                        if (/^\s*\.\.\.\s*$/.test(lines[k]))
                            break;
                    }
                    add(t[2], i, m2 || undefined);
                }
                deeperFailed.push(depth);
                continue;
            }
            const okm = l.match(/^(\s*)ok \d+ - /);
            if (okm)
                deeperFailed = deeperFailed.filter((d) => d <= okm[1].length);
            const s = l.match(/^\s*✖ (.+?)(?: \([\d.]+m?s\))?$/);
            if (s && !/^failing tests:?$/i.test(s[1].trim())) {
                runner = "node-test";
                add(s[1], i);
            }
        }
        const nt = text.match(/^# fail (\d+)/m);
        const np = text.match(/^# pass (\d+)/m);
        if (nt)
            totals = { failed: Number(nt[1]), passed: np ? Number(np[1]) : undefined };
    }
    if (runner === "unknown") {
        // mocha: "  1) suite\n       name:\n     Error: ..."
        const failing = text.match(/^\s*(\d+) failing/m);
        if (failing) {
            runner = "mocha";
            for (const [i, l] of lines.entries()) {
                const m = l.match(/^\s{2}(\d+)\) (.+)$/);
                if (m) {
                    const parts = [m[2]];
                    for (let k = i + 1; k < Math.min(lines.length, i + 6); k++) {
                        const n = lines[k].match(/^\s{5,}(.+?):?$/);
                        if (n && !ERRLINE.test(n[1]))
                            parts.push(n[1]);
                        else
                            break;
                    }
                    add(parts.join(" > ").replace(/:$/, ""), i);
                }
            }
            totals = { failed: Number(failing[1]) };
        }
    }
    return { failed: [...seen.values()].slice(0, 200), runner, totals };
}
/** Failures that are about the machine or the network, not about the code. Any of these invalidates a comparison. */
const INFRA = [
    [/\b(ENOTFOUND|EAI_AGAIN|Could not resolve host|Temporary failure in name resolution)\b/, "DNS/network failure"],
    [/\b(ETIMEDOUT|ESOCKETTIMEDOUT|ERR_SOCKET_TIMEOUT|socket hang up|Read timed out|ECONNRESET)\b/, "network timeout or reset"],
    [/\b(429 Too Many Requests|rate limit(ed)? exceeded|E429)\b/i, "registry rate limit"],
    [/\b(50[234] (Bad Gateway|Service Unavailable|Gateway Time-?out)|E50[234])\b/, "registry/server unavailable"],
    [/\b(ENOSPC|No space left on device)\b/, "disk full"],
    [/(JavaScript heap out of memory|Cannot allocate memory|MemoryError\b|Killed\s*$|exit code 137)/m, "out of memory"],
    [/\b(EACCES|EPERM): (permission denied|operation not permitted), (mkdir|open|scandir) '\/(?!tmp)/, "file-system permission problem"],
];
export function infraProblem(log) {
    const t = log.length > 4 << 20 ? log.slice(-(4 << 20)) : log;
    for (const [re, why] of INFRA)
        if (re.test(t))
            return why;
    return null;
}
