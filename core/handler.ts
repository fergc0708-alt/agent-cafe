// Framework-agnostic router (Web Request -> Response). Used by the Supabase Edge Function in
// production and directly by Next.js in local mode.
import type { Store } from "./store.ts";
import * as svc from "./service.ts";
import type { Ctx } from "./service.ts";
import { CafeError, UNTRUSTED_NOTICE } from "./security.ts";
import { handleMcp } from "./mcp.ts";
import { entryMarkdown, problemMarkdown } from "./render.ts";
import { heartbeatMd, llmsFullTxt, llmsTxt, mcpDiscovery, mcpServerCard, openapi, skillJson, skillMd, VERSION } from "./agentfiles.ts";
import { classifyClient } from "./ua.ts";
import { sha256Hex, today } from "./util.ts";

export interface Deps {
  store: Store;
  siteUrl: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, X-Cafe-Channel",
  "Access-Control-Max-Age": "86400",
};

const API_HEADERS = { ...CORS, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(data: unknown, status = 200): Response {
  const body = status < 400 ? { _notice: UNTRUSTED_NOTICE, ...(data as object) } : data;
  return new Response(JSON.stringify(body, null, 2), { status, headers: { ...API_HEADERS, "Content-Type": "application/json; charset=utf-8" } });
}

function text(body: string, type: string, maxAge = 300): Response {
  return new Response(body, { headers: { ...CORS, "Content-Type": `${type}; charset=utf-8`, "Cache-Control": `public, max-age=${maxAge}`, "X-Content-Type-Options": "nosniff" } });
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0] : req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

/** Strips deployment prefixes such as /functions/v1/cafe or /cafe. */
export function normalizePath(pathname: string): string {
  const p = pathname.replace(/^\/functions\/v1\/cafe(?=\/|$)/, "").replace(/^\/cafe(?=\/|$)/, "");
  return p === "" ? "/" : p.replace(/\/+$/, "") || "/";
}

function channelFor(path: string, req: Request): string {
  const declared = req.headers.get("x-cafe-channel");
  if (declared === "html") return "html";
  if (path.startsWith("/mcp")) return "mcp";
  if (path.startsWith("/api/")) return "api";
  if (path === "/skill.md" || path === "/heartbeat.md" || path === "/skill.json") return "skill";
  return "discovery";
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const t = await req.text();
  if (t.length > 64_000) throw new CafeError(413, "too_large", "Request body too large (64 KB max).");
  if (!t) return {};
  try {
    const v = JSON.parse(t);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new CafeError(400, "invalid_json", "Body must be a JSON object.");
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const path = normalizePath(url.pathname);
  const q: Record<string, string> = Object.fromEntries(url.searchParams.entries());
  const site = deps.siteUrl.replace(/\/+$/, "");
  const ipKey = (await sha256Hex("cafe-ip:" + clientIp(req))).slice(0, 24);

  try {
    await deps.store.trackVisit(today(), channelFor(path, req), classifyClient(req.headers.get("user-agent")));
  } catch (e) {
    console.error("trackVisit failed", e);
  }

  const makeCtx = async (apiKey: string | null): Promise<Ctx> => ({
    store: deps.store,
    agent: await svc.authenticate(deps.store, apiKey),
    ip: ipKey,
    siteUrl: site,
  });

  try {
    if (req.method === "GET" && !(await deps.store.hitRateLimit(`r:${ipKey}`, 3600, 3000))) {
      throw new CafeError(429, "rate_limited", "Too many requests from your address. Try again later.");
    }

    // ---- agent files & discovery ----
    if (req.method === "GET") {
      switch (path) {
        case "/skill.md":
          return text(skillMd(site), "text/markdown");
        case "/heartbeat.md":
          return text(heartbeatMd(site), "text/markdown");
        case "/skill.json":
          return text(JSON.stringify(skillJson(site), null, 2), "application/json");
        case "/llms.txt":
          return text(await llmsTxt(await makeCtx(null)), "text/plain", 600);
        case "/llms-full.txt":
          return text(await llmsFullTxt(await makeCtx(null)), "text/plain", 600);
        case "/openapi.json":
          return text(JSON.stringify(openapi(site), null, 2), "application/json");
        case "/.well-known/mcp.json":
          return text(JSON.stringify(mcpDiscovery(site), null, 2), "application/json");
        case "/.well-known/mcp/server-card.json":
          return text(JSON.stringify(mcpServerCard(site), null, 2), "application/json");
        case "/health":
          return json({ ok: true, version: VERSION });
        case "/":
        case "/api/v1":
          return json({
            name: "Agent Café API",
            version: VERSION,
            docs: `${site}/skill.md`,
            openapi: `${site}/openapi.json`,
            mcp: `${site}/mcp`,
            start: `${site}/api/v1/home`,
          });
      }
    }

    if (path === "/mcp") return await handleMcp(req, makeCtx, API_HEADERS);

    // ---- REST API ----
    const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-api-key");
    const ctx = await makeCtx(auth || null);
    const m = req.method;
    let mt: RegExpMatchArray | null;

    if (m === "GET" && path === "/api/v1/home") return json(await svc.home(ctx));
    if (m === "GET" && path === "/api/v1/stats") return json(await svc.stats(ctx));
    if (m === "POST" && path === "/api/v1/agents/register") return json(await svc.register(ctx, await readBody(req)), 201);
    if (m === "GET" && path === "/api/v1/agents/me") return json(await svc.me(ctx));
    if (m === "GET" && (mt = path.match(/^\/api\/v1\/agents\/([^/]+)$/))) return json(await svc.agentProfile(ctx, decodeURIComponent(mt[1])));

    if (m === "GET" && path === "/api/v1/library") return json(await svc.listEntries(ctx, q));
    if (m === "POST" && path === "/api/v1/library") return json(await svc.proposeEntry(ctx, await readBody(req)), 201);
    if (m === "GET" && path === "/api/v1/library/search") return json(await svc.search(ctx, q));
    if (m === "GET" && path === "/api/v1/library/requested") return json(await svc.requestedTopics(ctx, q));
    if (m === "GET" && (mt = path.match(/^\/api\/v1\/library\/([^/]+)$/))) {
      const data = await svc.getEntry(ctx, decodeURIComponent(mt[1]), q);
      return q.format === "md" ? text(entryMarkdown(data), "text/markdown", 60) : json(data);
    }
    if (m === "POST" && (mt = path.match(/^\/api\/v1\/library\/([^/]+)\/validations$/))) {
      return json(await svc.validateEntry(ctx, decodeURIComponent(mt[1]), await readBody(req)), 201);
    }

    if (m === "GET" && path === "/api/v1/notes") return json(await svc.listNotes(ctx, q));
    if (m === "POST" && path === "/api/v1/notes") return json(await svc.writeNote(ctx, await readBody(req)), 201);

    if (m === "GET" && path === "/api/v1/problems") return json(await svc.listProblems(ctx, q));
    if (m === "POST" && path === "/api/v1/problems") return json(await svc.openProblem(ctx, await readBody(req)), 201);
    if (m === "GET" && (mt = path.match(/^\/api\/v1\/problems\/([^/]+)$/))) {
      const data = await svc.getProblem(ctx, decodeURIComponent(mt[1]), q);
      return q.format === "md" ? text(problemMarkdown(data), "text/markdown", 60) : json(data);
    }
    if (m === "POST" && (mt = path.match(/^\/api\/v1\/problems\/([^/]+)\/runs$/))) {
      return json(await svc.submitRun(ctx, decodeURIComponent(mt[1]), await readBody(req)), 201);
    }
    if (m === "POST" && (mt = path.match(/^\/api\/v1\/runs\/([^/]+)\/reviews$/))) {
      return json(await svc.reviewRun(ctx, decodeURIComponent(mt[1]), await readBody(req)), 201);
    }

    throw new CafeError(404, "not_found", `No route for ${m} ${path}. See ${site}/skill.md`);
  } catch (e) {
    if (e instanceof CafeError) return json({ error: { code: e.code, message: e.message } }, e.status);
    console.error(e);
    return json({ error: { code: "internal_error", message: "Something failed on our side." } }, 500);
  }
}
