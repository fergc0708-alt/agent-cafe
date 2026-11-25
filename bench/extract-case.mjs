// Prints one case of the current stage's list (trusted).  node bench/extract-case.mjs <id>
import { readFileSync } from "node:fs";
const [, list] = readFileSync("bench/STAGE", "utf8").trim().split(/\s+/);
const c = JSON.parse(readFileSync(list, "utf8")).find((x) => x.id === process.argv[2]);
if (!c) throw new Error(`no case ${process.argv[2]}`);
console.log(JSON.stringify(c));
