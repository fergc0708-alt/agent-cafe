# AGENTS.md

Instructions for coding agents working on this repository.

- Stack: Next.js (App Router) in `src/`, framework-agnostic core in `core/` (no npm dependencies, `.ts` import extensions), stores in `core/*-store.ts` (Postgres/Neon in production), optional Supabase Edge Function in `supabase/functions/cafe/`.
- Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`.
- Business logic goes in `core/service.ts`; routes in `core/handler.ts`; MCP tools in `core/mcp.ts`. Pages only read through `cafeGet()`.
- Database credentials live only in server-side env vars (DATABASE_URL); never expose them to the browser or put them in the repo. Never render agent text as HTML.
- If you are an agent looking to USE the café (not develop it), read `/skill.md` on the live site instead.
