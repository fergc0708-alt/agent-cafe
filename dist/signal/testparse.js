// Which tests failed, and with what message, from a test run's output (or JUnit XML). Best effort and explicit about
// it: when no failing test can be identified, callers say "tests not identified" instead of guessing.
/** Replaces the run's own directory (and Signal's temporary paths) so the same failure has the same id and message
 *  on both sides, which run in different temporary directories. */
export function normalizer(...dirs) {
    const ds = [...new Set(dirs.filter((d) => d && d.length > 1))].sort((a, b) => b.length - a.length);
    return (s) => {
        let out = s;
        for (const d of ds)
            out = out.split(d + "/").join("").split(d).join("<project>");
        return out.replace(/signal-(update|baseline|home|src|log|h)-[A-Za-z0-9]{6}/g, "signal-$1");
    };
}
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
export function parseJunit(input) {
    const xml = input.length > 4 << 20 ? input.slice(0, 4 << 20) : input;
    const out = [];
    const attr = (a, k) => a.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1]?.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") ?? "";
    // linear scan with indexOf (no regex backtracking across the whole file)
    let pos = 0;
    while (out.length < 500) {
        const start = xml.indexOf("<testcase", pos);
        if (start < 0)
            break;
        const tagEnd = xml.indexOf(">", start);
        if (tagEnd < 0)
            break;
        const a = xml.slice(start + 9, tagEnd);
        let body = "";
        if (xml[tagEnd - 1] === "/")
            pos = tagEnd + 1;
        else {
            const close = xml.indexOf("</testcase>", tagEnd);
            body = xml.slice(tagEnd + 1, Math.min(close < 0 ? xml.length : close, tagEnd + 20000));
            pos = close < 0 ? tagEnd + 1 : close + 11;
        }
        const f = body.match(/<(failure|error)\b([^>]{0,4000})>?/);
        if (!f)
            continue;
        const id = [attr(a, "classname") || attr(a, "file"), attr(a, "name")].filter(Boolean).join(" > ");
        const msg = attr(f[2] ?? "", "message") || clean(body.replace(/<[^<>]{0,500}>/g, " ").split("\n").find((l) => l.trim()) ?? "");
        out.push({ id, message: clean(msg) });
    }
    const res = out;
    if (out.length >= 500 || input.length > 4 << 20)
        res.truncated = true;
    return res;
}
export function parseOutput(log) {
    const cut = log.length > 1 << 20;
    const text = strip(cut ? log.slice(-(1 << 20)) : log);
    // every pattern below runs per line, on lines capped at 2,000 characters: hostile output cannot make it slow
    const lines = text.split("\n").map((l) => (l.length > 2000 ? l.slice(0, 2000) : l));
    const seen = new Map();
    const add = (id, at, msg) => {
        id = id.slice(0, 400).replace(/\s+\d+(\.\d+)?\s?m?s$/, "").replace(/\s+/g, " ").trim().slice(0, 240);
        if (!id || seen.has(id))
            return;
        seen.set(id, { id, message: msg ? clean(msg) : firstError(lines, at + 1) });
    };
    let runner = "unknown";
    let totals;
    // pytest: "FAILED tests/test_x.py::test_y - AssertionError: ..." / "ERROR tests/test_x.py - ImportError"
    for (const [i, l] of lines.entries()) {
        const m = l.match(/^(FAILED|ERROR) (\S+)(?: - (.*))?$/);
        if (m && (m[2].includes("::") || /\.py\b/.test(m[2]))) {
            runner = "pytest";
            add(m[2], i, m[3]);
        }
    }
    const pt = runner === "pytest" ? lines.map((l) => l.match(/^=+[ \t](?:(\d+) failed)?(?:, )?(?:(\d+) passed)?[^\n]{0,200} in [\d.]+s/)).find(Boolean) : null;
    if (runner === "pytest" && pt)
        totals = { failed: Number(pt[1] ?? 0), passed: pt[2] ? Number(pt[2]) : undefined };
    if (runner === "unknown") {
        // vitest: " FAIL  test/a.test.ts > suite > name" ; jest: "  ● suite › name"
        let jestFile = "";
        for (const [i, l] of lines.entries()) {
            const v = l.match(/^\s*(?:FAIL|×|✗)\s+(\S+\.(?:[cm]?[jt]sx?)\s+>\s+.+)$/);
            if (v) {
                runner = "vitest";
                add(v[1], i);
                continue;
            }
            const jf = l.match(/^\s*FAIL\s+(\S+\.(?:[cm]?[jt]sx?))\s*$/);
            if (jf) {
                jestFile = jf[1];
                continue;
            }
            const j = l.match(/^\s*●\s+(.+›.+|[^●]+)$/);
            if (j && !/Console|Test suite failed to run/.test(j[1])) {
                runner = "jest";
                add((jestFile ? jestFile + " > " : "") + j[1].replace(/\s+›\s+/g, " > "), i);
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
            const t = l.match(/^(\s*)not ok \d+ - (.*)$/);
            if (t && !/#\s*(TODO|SKIP)/i.test(l) && t[2].trim()) {
                t[2] = t[2].trim();
                const depth = t[1].length;
                const hasChild = deeperFailed.some((d) => d > depth);
                deeperFailed = deeperFailed.filter((d) => d <= depth);
                runner = "node-test";
                if (!hasChild) {
                    // the YAML block after a TAP failure carries `location: 'file:line:col'` and `error: '...'`
                    let m2 = "", loc = "";
                    for (let k = i + 1; k < Math.min(lines.length, i + 30); k++) {
                        const e = lines[k].match(/^\s+error:\s*(.*)$/);
                        if (e && !m2)
                            m2 = e[1].trim().replace(/^['"|>-]\s*/, "").replace(/['"]$/, "");
                        const lc = lines[k].match(/^\s+location:\s*(.*)$/);
                        if (lc && !loc) {
                            const p = lc[1].trim().replace(/^['"]|['"]$/g, "").replace(/:\d+:\d+$/, "").replace(/^file:\/\//, "");
                            // callers normalize the run directory away; an absolute path left means "outside the project"
                            loc = p.startsWith("/") ? p.split("/").slice(-2).join("/") : p;
                        }
                        if (/^\s*\.\.\.\s*$/.test(lines[k]))
                            break;
                    }
                    add(loc ? `${loc} > ${t[2]}` : t[2], i, m2 || undefined);
                }
                deeperFailed.push(depth);
                continue;
            }
            const okm = l.match(/^(\s*)ok \d+ - /);
            if (okm)
                deeperFailed = deeperFailed.filter((d) => d <= okm[1].length);
            const s = l.match(/^\s*✖ (.*)$/);
            if (s && s[1].trim() && !/^failing tests:?$/i.test(s[1].trim())) {
                runner = "node-test";
                add(s[1].replace(/ \([\d.]+m?s\)$/, ""), i);
            }
        }
        const nt = text.match(/^[ \t]*# fail (\d+)/m);
        const np = text.match(/^[ \t]*# pass (\d+)/m);
        if (nt)
            totals = { failed: Number(nt[1]), passed: np ? Number(np[1]) : undefined };
    }
    if (runner === "unknown") {
        // mocha: "  1) suite\n       name:\n     Error: ..."
        const failing = text.match(/^[ \t]*(\d+) failing/m);
        if (failing) {
            runner = "mocha";
            for (const [i, l] of lines.entries()) {
                const m = l.match(/^\s{2}(\d+)\) (.+)$/);
                if (m) {
                    const parts = [m[2]];
                    for (let k = i + 1; k < Math.min(lines.length, i + 6); k++) {
                        const n = lines[k].match(/^\s{5,}(\S.*)$/);
                        const v = n?.[1].replace(/:$/, "");
                        if (v && !ERRLINE.test(v))
                            parts.push(v);
                        else
                            break;
                    }
                    add(parts.join(" > ").replace(/:$/, ""), i);
                }
            }
            totals = { failed: Number(failing[1]) };
        }
    }
    if (runner === "unknown") {
        // TypeScript compiler: "src/a.ts(12,5): error TS2339: ..." or "src/a.ts:12:5 - error TS2339: ..."
        for (const [i, l] of lines.entries()) {
            const m = l.match(/^([^\s(:]+\.[cm]?tsx?)(?:\((\d+),\d+\)|:(\d+):\d+)\s*[:-]\s*error (TS\d{4}): (.*)$/);
            if (m) {
                runner = "tsc";
                add(`${m[1]} ${m[4]}`, i, `${m[4]}: ${m[5]}`);
            }
        }
    }
    return { failed: [...seen.values()].slice(0, 200), runner, totals, truncated: cut || seen.size > 200 || undefined };
}
/** Message comparable across runs: numbers, paths, hex ids and durations removed. */
export function messageKey(m) {
    // paths first (a temporary directory's random suffix must not leak into the key), then ids and numbers
    return m.slice(0, 2000).toLowerCase().replace(/(?:[a-z]:)?(?:\/[^\s'"`:)(]+)+/g, "<path>").replace(/0x[0-9a-f]+/g, "#").replace(/\d+(\.\d+)?/g, "#").replace(/\s+/g, " ").trim().slice(0, 160);
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
/** Callers pass install logs, or the failing tests' messages plus the last lines of output: an environment word
 *  printed by a passing test elsewhere in the log must not turn a real regression into "inconclusive". */
export function infraProblem(log) {
    const t = log.length > 1 << 20 ? log.slice(-(1 << 20)) : log;
    for (const [re, why] of INFRA)
        if (re.test(t))
            return why;
    return null;
}
