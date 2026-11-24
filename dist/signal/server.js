// Ingestion + query service for Café Signal. Framework-agnostic (Web Request -> Response): mounted by the
// existing core router under /api/signal/v1/*, and by `cafe signal serve` for self-hosting.
//
// Trust model (honest version):
//  - A submission must carry a GitHub Actions OIDC token whose audience binds it to this exact observation id.
//    That proves the observation was produced by a GitHub-hosted job of repository R (owner O). It does NOT
//    prove the tests are meaningful or that the author is honest.
//  - Independence is counted per OWNER id; one owner cannot outvote others by having many repositories,
//    retries or runs. Per-owner daily quotas cap flooding; each owner is one voice per transition anyway.
//  - The server recomputes the attribution from the two run results (validate()).
//  - Observations from private repositories stay private to their owner: never returned to anyone else.
import { bindingAudience as _unused, verifyGithubOidc } from "../core/capsule/oidc.js";
import { buildIndex, query } from "./engine.js";
import { normalizePackage, validate } from "./protocol.js";
export const SIGNAL_AUDIENCE_PREFIX = "cafe-signal/v1:";
export const audienceFor = (observationId) => `${SIGNAL_AUDIENCE_PREFIX}${observationId}`;
export const QUERY_AUDIENCE = `${SIGNAL_AUDIENCE_PREFIX}query`;
export class MemorySignalStore {
    rows = new Map();
    constructor(seed = []) {
        for (const s of seed)
            this.rows.set(s.key, s);
    }
    async upsert(o) {
        const had = this.rows.has(o.key);
        this.rows.set(o.key, o);
        return had ? "replaced" : "inserted";
    }
    async byPackage(ecosystem, pkg) {
        return [...this.rows.values()].filter((r) => r.primary.ecosystem === ecosystem && normalizePackage(r.primary.ecosystem, r.primary.package) === pkg);
    }
    async countToday(ownerId, day) {
        return [...this.rows.values()].filter((r) => r.provenance.owner_id === ownerId && r.received_at.startsWith(day)).length;
    }
}
const POLICY = {
    workflows: ["*"], // any repository may contribute; independence and quotas are enforced per owner id
    events: ["pull_request", "push", "workflow_dispatch", "schedule", "merge_group"],
    maxAgeMs: 2 * 3600_000,
};
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
function claim(token, k) {
    try {
        return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))[k];
    }
    catch {
        return undefined;
    }
}
export async function handleSignal(req, path, deps) {
    if (!path.startsWith("/api/signal/v1/"))
        return null;
    const now = deps.now?.() ?? Date.now();
    const sub = path.slice("/api/signal/v1/".length);
    if (sub === "observations" && req.method === "POST") {
        const body = (await req.text().catch(() => "")) ?? "";
        if (body.length > 64_000)
            return json({ error: "payload too large" }, 413);
        let b;
        try {
            b = JSON.parse(body);
        }
        catch {
            return json({ error: "invalid JSON" }, 400);
        }
        let obs;
        try {
            obs = validate(b.observation);
        }
        catch (e) {
            return json({ error: e.message }, 400);
        }
        let id;
        try {
            id = await verifyGithubOidc(String(b.oidc_token ?? ""), { jwks: await deps.jwks(), expectedAudience: audienceFor(obs.id), policy: POLICY, now });
        }
        catch (e) {
            return json({ error: `identity: ${e.message}` }, 401);
        }
        const day = new Date(now).toISOString().slice(0, 10);
        if ((await deps.store.countToday(id.repository_owner_id, day)) >= (deps.dailyQuotaPerOwner ?? 200))
            return json({ error: "daily quota for this owner reached" }, 429);
        const visibility = claim(String(b.oidc_token), "repository_visibility");
        const isPublic = visibility === "public";
        const stored = {
            ...obs,
            // provenance is set by the server from the verified token, never taken from the client
            provenance: {
                kind: "github-oidc",
                owner_id: id.repository_owner_id,
                repository_id: id.repository_id,
                workflow: id.job_workflow_ref,
                ...(isPublic && b.share_source === true ? { source_url: `https://github.com/${id.repository}/commit/${id.sha}` } : {}),
            },
            scope: isPublic && b.share_public === true ? "public" : `owner:${id.repository_owner_id}`,
            key: [id.repository_id, obs.primary.ecosystem, normalizePackage(obs.primary.ecosystem, obs.primary.package), obs.primary.from, obs.primary.to, id.sha].join("|"),
            received_at: new Date(now).toISOString(),
        };
        const r = await deps.store.upsert(stored);
        return json({ status: r, scope: stored.scope, independence_unit: `owner ${id.repository_owner}`, note: r === "replaced" ? "same repository, transition and commit: the previous record was replaced (retries are not extra evidence)" : undefined });
    }
    if (sub === "query" && (req.method === "GET" || req.method === "POST")) {
        const u = new URL(req.url);
        let p = Object.fromEntries(u.searchParams);
        let owner = null;
        if (req.method === "POST") {
            const b = await req.json().catch(() => ({}));
            p = { ...p, ...b };
            if (b.oidc_token) {
                try {
                    owner = (await verifyGithubOidc(String(b.oidc_token), { jwks: await deps.jwks(), expectedAudience: QUERY_AUDIENCE, policy: POLICY, now })).repository_owner_id;
                }
                catch (e) {
                    return json({ error: `identity: ${e.message}` }, 401);
                }
            }
        }
        if (!["npm", "pypi"].includes(p.ecosystem) || !p.package || !p.from || !p.to)
            return json({ error: "need ecosystem (npm|pypi), package, from, to" }, 400);
        const all = await deps.store.byPackage(p.ecosystem, normalizePackage(p.ecosystem, p.package));
        const q = {
            ecosystem: p.ecosystem, package: p.package, from: p.from, to: p.to,
            env: p.runtime && p.runtime_version ? { runtime: p.runtime, runtime_version: p.runtime_version } : null,
        };
        // network: other owners' public observations, one voice per owner
        const network = query(buildIndex(all.filter((r) => r.scope === "public")), { ...q, excludeOwner: owner ? `id:${owner}` : undefined });
        // your fleet: this owner's own observations (public or private), one voice per repository
        const fleet = owner ? query(buildIndex(all.filter((r) => r.provenance.owner_id === owner)), { ...q, unit: "repository" }) : null;
        return json({ network, ...(fleet ? { your_organization: fleet } : {}) });
    }
    return json({ error: "not found" }, 404);
}
void _unused;
