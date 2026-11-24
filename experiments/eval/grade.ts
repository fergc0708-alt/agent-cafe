// Grades every workspace with the hidden tests. Usage: node experiments/eval/grade.ts [/tmp/eval-runs]
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

const runs = process.argv[2] ?? "/tmp/eval-runs";
const tasks = new URL("./tasks/", import.meta.url).pathname;
const rows = [];
for (const ws of readdirSync(runs).sort()) {
  const [task, arm, rep] = ws.split("__");
  const g = JSON.parse(readFileSync(join(tasks, task, "grader", "grade.json"), "utf8"));
  const dir = mkdtempSync(join(os.tmpdir(), "grade-"));
  for (const f of readdirSync(join(runs, ws))) if (!["TASK.md", "__pycache__", "node_modules"].includes(f)) cpSync(join(runs, ws, f), join(dir, f), { recursive: true });
  for (const f of readdirSync(join(tasks, task, "grader"))) if (f !== "grade.json") cpSync(join(tasks, task, "grader", f), join(dir, f));
  const results = g.runs.map(([bin, file]: string[]) => {
    const r = spawnSync(bin, [file], { cwd: dir, encoding: "utf8", timeout: 20_000, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", TZ: "UTC" } as unknown as NodeJS.ProcessEnv });
    return { bin, pass: r.status === 0, err: r.status === 0 ? "" : (r.stderr || r.stdout).trim().split("\n").at(-1) };
  });
  rmSync(dir, { recursive: true, force: true });
  rows.push({ task, arm, rep, pass: results.every((x: any) => x.pass), results });
}
const outDir = new URL("./results/", import.meta.url).pathname;
if (!existsSync(outDir)) cpSync(tasks, outDir, { filter: () => false });
writeFileSync(join(outDir, "grades.json"), JSON.stringify(rows, null, 2) + "\n");
for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.task.padEnd(22)} ${r.arm.padEnd(8)} ${r.rep}  ${r.results.filter((x: any) => !x.pass).map((x: any) => `${x.bin}: ${x.err}`).join(" | ")}`);
