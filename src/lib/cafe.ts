// Bridge between Next.js and the framework-agnostic core.
// Production: forwards to the Supabase Edge Function (CAFE_API_ORIGIN), which holds the DB access.
// Local dev / no config: runs the core in-process with a seeded in-memory store.
import { headers } from "next/headers";
import { handle } from "@core/handler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { seed } from "@core/seed.ts";

export const SITE_URL = (
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/+$/, "");

const ORIGIN = (process.env.CAFE_API_ORIGIN || "").replace(/\/+$/, "");

const g = globalThis as unknown as { __cafeStore?: Promise<MemoryStore> };
function memoryStore(): Promise<MemoryStore> {
  if (!g.__cafeStore) {
    g.__cafeStore = (async () => {
      const s = new MemoryStore();
      await seed(s);
      return s;
    })();
  }
  return g.__cafeStore;
}

const PASS_REQ = ["authorization", "content-type", "accept", "user-agent", "mcp-protocol-version", "mcp-session-id", "x-api-key", "x-cafe-channel"];
const PASS_RES = ["content-type", "cache-control", "allow", "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-max-age", "x-content-type-options"];

/** Forward an incoming request to the core (remote or in-process). `path` overrides the URL path. */
export async function forward(req: Request, path?: string): Promise<Response> {
  const url = new URL(req.url);
  const target = (path ?? url.pathname) + url.search;
  const h = new Headers();
  for (const k of PASS_REQ) {
    const v = req.headers.get(k);
    if (v) h.set(k, v);
  }
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  if (ip) h.set("x-forwarded-for", ip.split(",")[0].trim());
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  if (!ORIGIN) {
    return handle(new Request(SITE_URL + target, { method: req.method, headers: h, body }), { store: await memoryStore(), siteUrl: SITE_URL });
  }
  const upstream = await fetch(ORIGIN + target, { method: req.method, headers: h, body, redirect: "manual", cache: "no-store" });
  const out = new Headers();
  for (const k of PASS_RES) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/** Server-side data fetch for pages. Marks the visit as an HTML page view with the visitor's user agent. */
export async function cafeGet<T = any>(path: string): Promise<{ ok: boolean; status: number; data: T }> {
  const hs = await headers();
  const h: Record<string, string> = { "x-cafe-channel": "html", accept: "application/json" };
  const ua = hs.get("user-agent");
  if (ua) h["user-agent"] = ua;
  const ip = hs.get("x-forwarded-for");
  if (ip) h["x-forwarded-for"] = ip;
  const res = await forward(new Request(SITE_URL + path, { headers: h }));
  const data = (await res.json().catch(() => null)) as T;
  return { ok: res.ok, status: res.status, data };
}
