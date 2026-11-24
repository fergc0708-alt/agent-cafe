import { PGlite } from "@electric-sql/pglite";
import { PostgresStore } from "../core/postgres-store.ts";
import { apiSuite } from "./api-suite.ts";

// Same API suite, against real Postgres (PGlite = Postgres compiled to WASM).
apiSuite("postgres", async () => {
  const db = new PGlite();
  const store = new PostgresStore(async (text, params) => (await db.query(text, params as any[])).rows as Record<string, unknown>[]);
  await store.migrate();
  await store.migrate(); // idempotent
  return store;
});
