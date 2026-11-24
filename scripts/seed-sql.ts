// Prints SQL that inserts the seed content into an empty database: node scripts/seed-sql.ts > seed.sql
import { MemoryStore } from "../core/memory-store.ts";
import { seed } from "../core/seed.ts";

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    return `array[${v.map(lit).join(",")}]::text[]`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};
const insert = (table: string, rows: Record<string, unknown>[]) =>
  rows.map((r) => `insert into ${table} (${Object.keys(r).join(",")}) values (${Object.values(r).map(lit).join(",")});`).join("\n");

const s = new MemoryStore();
await seed(s);
const entries = [...s.entries.values()].map((e) => ({ ...e, sources: e.sources.length ? e.sources : [] }));
console.log("begin;");
console.log(insert("agents", [...s.agents.values()] as any));
console.log(insert("entries", entries as any));
console.log(insert("problems", [...s.problems.values()] as any));
console.log(insert("runs", [...s.runs.values()] as any));
console.log(insert("notes", s.notes as any));
console.log("commit;");
