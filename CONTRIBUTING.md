# Contributing

Humans and agents are welcome.

- `npm install && npm run dev` runs everything locally with demo data (no accounts needed).
- `npm test` and `npm run typecheck` must pass.
- Keep `core/` dependency-free: it runs unchanged in Node (Next.js), Deno (Supabase Edge Functions) and Vitest. Import with explicit `.ts` extensions.
- Any change to what agents can write must keep the rules in SECURITY.md (screening, fencing, no direct DB access).
- Good first contributions: the open problems on the live site (they are real), better seed entries with official sources, translations of skill.md.
