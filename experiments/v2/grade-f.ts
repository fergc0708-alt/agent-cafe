// Grades the Experiment F pilot: each agent's final files are put in place of the capsule's "after"
// state and the capsule check is run on every target runtime (the agents never saw this grader).
import { readFileSync, writeFileSync } from "node:fs";
import { replay } from "../../cli/runner.ts";
import type { Capsule } from "../../core/capsule/capsule.ts";

const R = "/home/claude/f-pilot";
const tasks = [
  { task: "f1", capsule: "py-png-magic-bytes", file: "detect.py", bins: [{ python3: "/usr/bin/python3.11" }, { python3: "/usr/bin/python3.13" }] },
  { task: "f2", capsule: "node-ts-parameter-properties", file: "point.ts", bins: [{ node: "/opt/node22/bin/node" }, { node: "/opt/node24/bin/node" }] },
  { task: "f3", capsule: "node-import-assert-to-with", file: "main.mjs", bins: [{ node: "/opt/node22/bin/node" }, { node: "/opt/node24/bin/node" }] },
];
// Sub-agent usage as reported by the harness task notifications (tokens, tool uses, wall ms).
const usage: Record<string, { tokens: number; tool_uses: number; ms: number }> = {
  "f1-control": { tokens: 57869, tool_uses: 4, ms: 16220 },
  "f1-cafe": { tokens: 61825, tool_uses: 4, ms: 18664 },
  "f2-control": { tokens: 58681, tool_uses: 4, ms: 15359 },
  "f2-cafe": { tokens: 62725, tool_uses: 5, ms: 18673 },
  "f3-control": { tokens: 57304, tool_uses: 5, ms: 12206 },
  "f3-cafe": { tokens: 61170, tool_uses: 4, ms: 13641 },
};
const rows = [];
for (const t of tasks) {
  const c = JSON.parse(readFileSync(new URL(`../../capsules/built/${t.capsule}.json`, import.meta.url), "utf8")) as Capsule;
  for (const arm of ["control", "cafe"]) {
    const sol = readFileSync(`${R}/${t.task}-${arm}/${t.file}`, "utf8");
    const graded: Capsule = { ...c, after: { files: { ...c.after.files, [t.file]: sol } } };
    const results = [];
    for (const bins of t.bins) {
      const r = await replay(graded, { bins, maxMutants: 0 });
      results.push(`${r.predicate.env.key}: ${r.predicate.verdict}`);
    }
    const pass = results.every((x) => x.endsWith("PASS"));
    rows.push({ cell: `${t.task}-${arm}`, pass, results, ...usage[`${t.task}-${arm}`] });
  }
}
writeFileSync(new URL("./F-results.json", import.meta.url), JSON.stringify(rows, null, 2) + "\n");
console.log(JSON.stringify(rows, null, 1));
