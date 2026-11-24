// Builds capsules/built/<slug>.json (validated, content-addressed) and capsules/built/index.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { CATALOG as BASE, SUPERSEDES as BASE_SUPERSEDES } from "../capsules/catalog.ts";
import { COMPAT, COMPAT_SUPERSEDES, DETECT } from "../capsules/compat.ts";

const CATALOG = { ...BASE, ...COMPAT };
for (const [slug, d] of Object.entries(DETECT)) CATALOG[slug] = { ...CATALOG[slug], detect: d };
const SUPERSEDES = { ...BASE_SUPERSEDES, ...COMPAT_SUPERSEDES };
import { capsuleId, validateCapsule, type Capsule } from "../core/capsule/capsule.ts";
import { lintCapsule } from "../core/capsule/lint.ts";

const out = new URL("../capsules/built/", import.meta.url);
mkdirSync(out, { recursive: true });
const ids: Record<string, string> = {};
const built: Record<string, Capsule> = {};
// First pass without supersedes, so referenced ids are known.
for (const [slug, c] of Object.entries(CATALOG)) {
  const v = validateCapsule(c);
  if (!v.ok) throw new Error(`${slug}: ${v.errors.join("; ")}`);
  built[slug] = v.capsule!;
}
for (const slug of Object.keys(built)) if (!SUPERSEDES[slug]) ids[slug] = await capsuleId(built[slug]);
for (const [slug, olds] of Object.entries(SUPERSEDES)) {
  built[slug] = { ...built[slug], supersedes: olds.map((o) => ids[o]) };
  ids[slug] = await capsuleId(built[slug]);
}
const index = [];
for (const [slug, c] of Object.entries(built)) {
  writeFileSync(new URL(`${slug}.json`, out), JSON.stringify(c, null, 2) + "\n");
  index.push({ slug, id: ids[slug], title: c.title, runtime: c.runtime, detect: !!c.detect, lint: lintCapsule(c).map((f) => f.code) });
}
writeFileSync(new URL("index.json", out), JSON.stringify(index, null, 2) + "\n");
// One file the web app can import statically (no filesystem reads at request time).
writeFileSync(new URL("catalog.json", out), JSON.stringify(index.map((i) => ({ slug: i.slug, id: i.id, capsule: built[i.slug] }))) + "\n");
console.log(`built ${index.length} capsules`);
for (const i of index) console.log(`${i.id.slice(0, 12)} ${i.runtime.padEnd(6)} ${i.slug}${i.lint.length ? "  lint: " + i.lint.join(",") : ""}`);
