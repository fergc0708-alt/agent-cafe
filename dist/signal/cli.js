// `cafe signal …` — paired upgrade experiments in CI, lookups of what other projects saw, explicit sharing.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, query } from "./engine.js";
import { shareable } from "./protocol.js";
import { prTitleFromEvent, runPaired } from "./run.js";
import { audienceFor, handleSignal, MemorySignalStore } from "./server.js";
import { fetchGithubJwks } from "../core/capsule/oidc.js";
const HERE = dirname(fileURLToPath(import.meta.url));
/** The public seed shipped with the tool (works offline, no network sharing needed). */
export function seedPath() {
    for (const p of [join(HERE, "seed/observations.json"), join(HERE, "../../signal/seed/observations.json")])
        if (existsSync(p))
            return p;
    return null;
}
function flags(argv) {
    const pos = [];
    const f = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const [k, v] = a.slice(2).split("=", 2);
            if (v !== undefined)
                f[k] = v;
            else if (argv[i + 1] && !argv[i + 1].startsWith("--") && !["public", "source", "json", "no-network"].includes(k))
                f[k] = argv[++i];
            else
                f[k] = true;
        }
        else
            pos.push(a);
    }
    return { pos, f };
}
const pct = (x) => (x === null ? "–" : `${Math.round(x * 100)}%`);
export function renderReport(r, title = "What other projects saw") {
    const L = [`### ${title}: \`${r.query.package}\` ${r.query.from} → ${r.query.to}`, ""];
    const v = { known_regression: "⚠️ **Known regression** reported by other projects", likely_safe: "✅ Other projects took this update without regressions", mixed: "⚠️ **Mixed results**", insufficient_evidence: "ℹ️ **Not enough evidence** to say anything" }[r.verdict];
    L.push(v, "", r.summary, "");
    L.push("| evidence | independent owners | failed | estimate | 90% interval |", "|---|---|---|---|---|");
    L.push(`| paired experiments (causal) | ${r.causal.owners} | ${r.causal.failures} | ${pct(r.causal.mean)} | ${r.causal.ci90 ? `${pct(r.causal.ci90[0])}–${pct(r.causal.ci90[1])}` : "–"} |`);
    L.push(`| CI status only (not causal) | ${r.observational.owners} | ${r.observational.failures} | ${pct(r.observational.mean)} | ${r.observational.ci90 ? `${pct(r.observational.ci90[0])}–${pct(r.observational.ci90[1])}` : "–"} |`);
    L.push("", `Prior: ${r.causal.prior.from}. Match level: ${r.match}.`);
    if (r.fingerprints.length)
        L.push("", "**Failure signatures** (normalized):", ...r.fingerprints.map((f) => `- \`${f.signature}\` (${f.owners} owners)`));
    if (r.environments.length)
        L.push("", `**Environments seen:** ${r.environments.map((e) => `${e.runtime}/${e.os}: ${e.failures}/${e.owners} failed`).join(" · ")}`);
    if (r.your_env_tested === false)
        L.push("", "Your runtime has **not** been observed for this update.");
    const src = r.evidence.filter((e) => e.source).slice(0, 5);
    if (src.length)
        L.push("", "Sources: " + src.map((e) => `[${e.attribution}](${e.source})`).join(" · "));
    return L.join("\n");
}
function renderRun(o, other, files) {
    const meaning = {
        regression: "❌ **The update breaks the tests.** Baseline (same code, old dependencies, same runner) passes; the update fails, reproducibly.",
        compatible: "✅ **Compatible here.** Baseline and update both pass.",
        baseline_red: "⚪ **Not caused by the update.** The tests already fail with the old dependencies on this runner. Fix the base branch first; this PR is not the culprit.",
        upgrade_fixes: "✅ The update **fixes** a failure that the old dependencies had.",
        unstable: "🟡 **Flaky.** A side gave different results on retry; the result cannot be attributed to the update.",
        observational_fail: "❌ The update fails (no baseline could be run).",
        observational_pass: "✅ The update passes (no baseline could be run).",
    };
    const L = [`## Café Signal: \`${o.primary.package}\` ${o.primary.from} → ${o.primary.to}`, "", meaning[o.attribution], ""];
    L.push(`| | result |`, `|---|---|`, `| baseline (dependencies reverted) | ${o.baseline} |`, `| candidate (the update) | ${o.candidate} |`);
    L.push("", `Environment: ${o.env?.runtime} ${o.env?.runtime_version} · ${o.env?.os}/${o.env?.arch}. Dependency changes: ${o.changes.length} (${o.changes.filter((c) => c.direct).length} direct) in ${files.join(", ")}.`);
    if (other)
        L.push(`The branch also changes ${other} non-dependency file(s); they were kept identical in both runs, so they cannot explain a difference.`);
    if (o.fingerprints.length)
        L.push("", "Errors that appear only with the update:", ...o.fingerprints.map((f) => `- \`${f}\``));
    return L.join("\n");
}
async function lookup(eco, pkg, from, to, f, env = null) {
    if (typeof f.endpoint === "string") {
        const u = new URL("/api/signal/v1/query", f.endpoint);
        for (const [k, v] of Object.entries({ ecosystem: eco, package: pkg, from, to, ...(env ? { runtime: env.runtime, runtime_version: env.runtime_version } : {}) }))
            u.searchParams.set(k, v);
        const r = await fetch(u);
        if (!r.ok)
            throw new Error(`signal endpoint: HTTP ${r.status}`);
        return (await r.json()).network;
    }
    const db = typeof f.db === "string" ? f.db : seedPath();
    if (!db)
        return null;
    const obs = JSON.parse(readFileSync(db, "utf8")).observations;
    return query(buildIndex(obs), { ecosystem: eco, package: pkg, from, to, env });
}
async function requestOidc(audience) {
    const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!url || !tok)
        throw new Error("no GitHub Actions OIDC available (needs `permissions: id-token: write` in a GitHub-hosted job)");
    const r = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok)
        throw new Error(`OIDC request failed: HTTP ${r.status}`);
    return (await r.json()).value;
}
export async function main(argv) {
    const [sub, ...rest] = argv;
    const { pos, f } = flags(rest);
    const summary = (md) => {
        console.log(md);
        if (process.env.GITHUB_STEP_SUMMARY)
            appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n\n");
    };
    switch (sub) {
        case "run": {
            if (typeof f.test !== "string")
                throw new Error("usage: cafe signal run --test '<cmd>' [--install '<cmd>'] [--base origin/main] [--out obs.json]");
            const base = typeof f.base === "string" ? f.base : process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";
            let out;
            try {
                out = await runPaired({ dir: resolve(typeof f.dir === "string" ? f.dir : "."), base, test: f.test, install: typeof f.install === "string" ? f.install : undefined, retries: f.retries ? Number(f.retries) : 1, title: typeof f.title === "string" ? f.title : prTitleFromEvent(), log: (s) => console.error(s) });
            }
            catch (e) {
                if (/no dependency update found/.test(e.message)) {
                    console.log(`[signal] ${e.message}: nothing to do.`);
                    return 0;
                }
                throw e;
            }
            const o = out.observation;
            writeFileSync(typeof f.out === "string" ? f.out : "cafe-signal-observation.json", JSON.stringify(o, null, 2));
            summary(renderRun(o, out.otherFilesChanged, out.depFiles));
            if (!f["no-network"]) {
                const r = await lookup(o.primary.ecosystem, o.primary.package, o.primary.from, o.primary.to, f, o.env).catch((e) => (console.error(`[signal] lookup failed: ${e.message}`), null));
                if (r)
                    summary(renderReport(r));
            }
            // Exit code: fail only on an attributed regression (never on a red baseline or flakiness).
            return o.attribution === "regression" && f["fail-on-regression"] ? 1 : 0;
        }
        case "lookup": {
            const [eco, pkg, from, to] = pos;
            if (!eco || !pkg || !from || !to)
                throw new Error("usage: cafe signal lookup <npm|pypi> <package> <from> <to> [--db file | --endpoint url] [--json]");
            const r = await lookup(eco, pkg, from, to, f);
            if (!r)
                throw new Error("no seed database found; pass --db or --endpoint");
            console.log(f.json ? JSON.stringify(r, null, 2) : renderReport(r));
            return 0;
        }
        case "preview": {
            const o = JSON.parse(readFileSync(pos[0] ?? "cafe-signal-observation.json", "utf8"));
            const priv = typeof f["private-packages"] === "string" ? f["private-packages"].split(",").map((s) => s.trim()).filter(Boolean) : [];
            console.log("This is EXACTLY what `cafe signal share` would send (nothing else leaves this machine):\n");
            console.log(JSON.stringify(shareable(o, { privatePackages: priv }), null, 2));
            return 0;
        }
        case "share": {
            if (typeof f.endpoint !== "string")
                throw new Error("usage: cafe signal share obs.json --endpoint <url> [--public] [--source] [--private-packages '@acme/*']");
            const o = JSON.parse(readFileSync(pos[0] ?? "cafe-signal-observation.json", "utf8"));
            const priv = typeof f["private-packages"] === "string" ? f["private-packages"].split(",").map((s) => s.trim()).filter(Boolean) : [];
            const s = shareable(o, { privatePackages: priv });
            const token = await requestOidc(audienceFor(s.id));
            const r = await fetch(new URL("/api/signal/v1/observations", f.endpoint), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation: s, oidc_token: token, share_public: f.public === true, share_source: f.source === true }) });
            console.log(`${r.status} ${await r.text()}`);
            return r.ok ? 0 : 1;
        }
        case "serve": {
            const port = Number(f.port ?? 8787);
            const seed = (typeof f.db === "string" ? f.db : seedPath()) ?? null;
            const rows = seed ? JSON.parse(readFileSync(seed, "utf8")).observations.map((o) => ({ ...o, scope: "public", key: `seed|${o.id}`, received_at: o.observed_at })) : [];
            const store = new MemorySignalStore(rows);
            createServer(async (req, res) => {
                const body = req.method === "POST" ? await new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); }) : undefined;
                const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, body, headers: { "content-type": "application/json" } });
                const r = (await handleSignal(request, new URL(request.url).pathname, { store, jwks: () => fetchGithubJwks() })) ?? new Response("not found", { status: 404 });
                res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "text/plain" });
                res.end(await r.text());
            }).listen(port, () => console.error(`[signal] serving ${rows.length} seed observations on http://localhost:${port}/api/signal/v1/`));
            return await new Promise(() => { });
        }
        default:
            console.log("cafe signal run|lookup|preview|share|serve");
            return sub ? 2 : 0;
    }
}
