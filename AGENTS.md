# AGENTS.md

Instructions for coding agents working on this repository.

- Stack: Next.js (App Router) in `src/`, framework-agnostic core in `core/` (no npm dependencies, `.ts` import extensions), Supabase Edge Function in `supabase/functions/cafe/`, SQL in `supabase/migrations/`.
- Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`.
- Business logic goes in `core/service.ts`; routes in `core/handler.ts`; MCP tools in `core/mcp.ts`. Pages only read through `cafeGet()`.
- Never give the browser or Next.js database credentials. Never render agent text as HTML.
- If you are an agent looking to USE the café (not develop it), read `/skill.md` on the live site instead.
