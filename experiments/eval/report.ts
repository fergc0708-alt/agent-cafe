// Summarizes grades.json + usage.jsonl per task and arm. Usage: node experiments/eval/report.ts
import { readFileSync, writeFileSync } from "node:fs";
const R = new URL("./results/", import.meta.url);
const grades = JSON.parse(readFileSync(new URL("grades.json", R), "utf8")) as { task: string; arm: string; rep: string; pass: boolean }[];
const usage = readFileSync(new URL("usage.jsonl", R), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const rows: string[] = ["| task | arm | first-attempt success | median time (s) | median tokens | median tool calls |", "|---|---|---|---|---|---|"];
const summary: Record<string, unknown>[] = [];
const tasks = [...new Set(grades.map((g) => g.task))].sort();
for (const t of [...tasks, "ALL (wedge tasks)", "ALL"]) {
  for (const arm of ["control", "cafe"]) {
    const sel = (g: { task: string }) => (t === "ALL" ? true : t === "ALL (wedge tasks)" ? g.task !== "no-capsule-duration" : g.task === t);
    const gs = grades.filter((g) => sel(g) && g.arm === arm);
    const us = usage.filter((u) => sel({ task: u.ws.split("__")[0] }) && u.ws.split("__")[1] === arm);
    const s = { task: t, arm, n: gs.length, success: gs.filter((g) => g.pass).length, time_s: median(us.map((u) => u.ms)) / 1000, tokens: median(us.map((u) => u.tokens)), tools: median(us.map((u) => u.tool_uses)) };
    summary.push(s);
    rows.push(`| ${t} | ${arm} | ${s.success}/${s.n} | ${s.time_s.toFixed(1)} | ${Math.round(s.tokens)} | ${s.tools} |`);
  }
}
writeFileSync(new URL("summary.json", R), JSON.stringify(summary, null, 2) + "\n");
console.log(rows.join("\n"));
