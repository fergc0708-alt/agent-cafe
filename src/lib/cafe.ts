// Bridge between Next.js and the framework-agnostic core. Picks the backend in this order:
// 1. DATABASE_URL / POSTGRES_URL (e.g. Neon via Vercel): core runs in-process on Postgres (server-side only).
// 2. CAFE_API_ORIGIN: forwards to a remote core, e.g. the Supabase Edge Function.
// 3. Nothing configured: in-process with a seeded in-memory store (local dev).
import "server-only";
import { headers } from "next/headers";
import { neon } from "@neondatabase/serverless";
import { handle } from "@core/handler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { PostgresStore } from "@core/postgres-store.ts";
import type { Store } from "@core/store.ts";
import { seed } from "@core/seed.ts";
import { fetchGithubJwks, policyFromEnv } from "@core/capsule/oidc.ts";
import type { RunnerTrust } from "@core/service.ts";

/** Trusted CI workflows come only from server config (CAFE_TRUSTED_WORKFLOWS); empty = trust none. */
function runnerTrust(): RunnerTrust {
  return { jwks: () => fetchGithubJwks(), policy: policyFromEnv(process.env.CAFE_TRUSTED_WORKFLOWS) };
}

export const SITE_URL = (
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/+$/, "");

const ORIGIN = (process.env.CAFE_API_ORIGIN || "").replace(/\/+$/, "");

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

const g = globalThis as unknown as { __cafeStore?: Promise<Store> };
function localStore(): Promise<Store> {
  if (!g.__cafeStore) {
    g.__cafeStore = (async () => {
      if (DB_URL) {
        const sql = neon(DB_URL);
        const s = new PostgresStore(async (text, params) => (await sql.query(text, params ?? [])) as Record<string, unknown>[]);
        // Idempotent schema + seed on cold start. Retry once in case two instances race.
        try {
          await s.migrate();
        } catch {
          await new Promise((r) => setTimeout(r, 500));
          await s.migrate();
        }
        await seed(s);
        return s;
      }
      const s = new MemoryStore();
      await seed(s);
      return s;
    })().catch((e) => {
      g.__cafeStore = undefined;
      throw e;
    });
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

  if (DB_URL || !ORIGIN) {
    return handle(new Request(SITE_URL + target, { method: req.method, headers: h, body }), { store: await localStore(), siteUrl: SITE_URL, trust: runnerTrust() });
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
