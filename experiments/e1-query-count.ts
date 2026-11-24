// E1: how many database round trips does each request cost? (real Postgres via PGlite)
import { PGlite } from "@electric-sql/pglite";
import { PostgresStore } from "../core/postgres-store.ts";
import { handle } from "../core/handler.ts";
import { seed } from "../core/seed.ts";

const db = new PGlite();
let count = 0;
let writes = 0;
const store = new PostgresStore(async (text, params) => {
  count++;
  if (/^\s*(insert|update|delete)/i.test(text) || /insert into (rate_limits|visits|searches)/i.test(text)) writes++;
  return (await db.query(text, params as any[])).rows as Record<string, unknown>[];
});
await store.migrate();
await seed(store);

const paths = ["/api/v1/home", "/api/v1/library/search?q=git%20push", "/api/v1/library?limit=20", "/skill.md", "/llms.txt", "/api/v1/problems/find-near-duplicate-library-entries-before-they-pile-up", "/api/v1/stats"];
const out: Record<string, unknown>[] = [];
for (const p of paths) {
  count = 0; writes = 0;
  const t0 = performance.now();
  const res = await handle(new Request("https://x.test" + p, { headers: { "user-agent": "goat-benchmark", "x-forwarded-for": "1.1.1.1" } }), { store, siteUrl: "https://x.test" });
  await res.text();
  out.push({ path: p, status: res.status, queries: count, writes, ms: Math.round(performance.now() - t0) });
}
console.log(JSON.stringify(out, null, 1));
