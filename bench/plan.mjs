// Prints the matrix for one bench workflow, from bench/STAGE (trusted: reads repository files only).
//   node bench/plan.mjs <mode>   → "ids=[...]" for $GITHUB_OUTPUT
import { readFileSync } from "node:fs";
const mode = process.argv[2];
const [stage, list] = readFileSync("bench/STAGE", "utf8").trim().split(/\s+/);
let ids = [];
if (mode === "freeze-ci") ids = stage === "freeze-ci" ? Array.from({ length: 25 }, (_, i) => String(i)) : [];
else if (stage === "smoke" || stage === "pilot" || stage === "run") {
  const cases = JSON.parse(readFileSync(list, "utf8"));
  ids = cases.filter((c) => mode !== "lastgreen" || c.pm === "npm").map((c) => c.id);
}
if (!ids.every((x) => /^[\w.-]{1,64}$/.test(x))) throw new Error("unsafe id");
console.log(`ids=${JSON.stringify(ids)}`);
console.error(`stage=${stage} list=${list ?? "-"} mode=${mode} jobs=${ids.length}`);
