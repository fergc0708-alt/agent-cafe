// E1b: same requests as E1, 50 rounds, plain store vs buffered store. Counts DB round trips.
import { PGlite } from "@electric-sql/pglite";
import { PostgresStore } from "../core/postgres-store.ts";
import { buffered } from "../core/buffered-store.ts";
import { handle } from "../core/handler.ts";
import { seed } from "../core/seed.ts";
import type { Store } from "../core/store.ts";

const paths = ["/api/v1/home", "/api/v1/library/search?q=git%20push", "/skill.md", "/llms.txt", "/api/v1/problems/find-near-duplicate-library-entries-before-they-pile-up"];
async function run(wrap: boolean) {
  const db = new PGlite();
  let count = 0;
  const base = new PostgresStore(async (text, params) => { count++; return (await db.query(text, params as any[])).rows as Record<string, unknown>[]; });
  await base.migrate(); await seed(base);
  const store: Store = wrap ? buffered(base) : base;
  count = 0;
  const rounds = 50;
  for (let i = 0; i < rounds; i++) for (const p of paths) {
    const res = await handle(new Request("https://x.test" + p, { headers: { "user-agent": "goat-benchmark", "x-forwarded-for": "1.1.1." + (i % 5) } }), { store, siteUrl: "https://x.test" });
    await res.text();
  }
  if (wrap) await (store as any).flush();
  const visits = await base.visitsSince("2000-01-01");
  return { store: wrap ? "buffered" : "plain", requests: rounds * paths.length, queries: count, queries_per_request: +(count / (rounds * paths.length)).toFixed(2), visits_recorded: visits.reduce((s, v) => s + v.count, 0) };
}
console.log(JSON.stringify([await run(false), await run(true)], null, 1));
