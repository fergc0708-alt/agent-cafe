// `cafe capture`: turn a fix you (or your agent) just made into a reusable, PRIVATE capsule.
// It takes the changed files' committed version (before) and working-tree version (after) from
// git, plus a regression check you point at, then proves the check is meaningful by replaying it
// in the sandbox: it must fail on before, pass on after, and catch mutants of the fix. Only a
// candidate that passes all of that is saved, to <project>/.cafe/capsules/. Nothing is uploaded.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { CAPSULE_SCHEMA, validateCapsule, type Capsule } from "../core/capsule/capsule.ts";
import { lintCapsule } from "../core/capsule/lint.ts";
import { findSecrets } from "../core/security.ts";
import { replay, type Isolation } from "./runner.ts";

export interface CaptureOptions {
  project: string;
  check: string;
  files?: string[];
  title?: string;
  symptom?: string;
  name?: string;
  bins?: Record<string, string>;
  isolation?: Isolation;
}

const git = (cwd: string, args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 4_000_000 });
  return r.status === 0 ? r.stdout : null;
};

const RUNTIME_BY_EXT: Record<string, { runtime: Capsule["runtime"]; interp: string }> = {
  ".py": { runtime: "python", interp: "python3" },
  ".js": { runtime: "node", interp: "node" },
  ".cjs": { runtime: "node", interp: "node" },
  ".mjs": { runtime: "node", interp: "node" },
  ".ts": { runtime: "node", interp: "node" },
  ".sh": { runtime: "bash", interp: "bash" },
};

/** Builds the candidate without running anything. */
export function buildCandidate(o: CaptureOptions): { capsule?: Capsule; problems: string[]; files: string[] } {
  const problems: string[] = [];
  if (!git(o.project, ["rev-parse", "--is-inside-work-tree"])) return { problems: ["not a git repository: capture needs the committed version of your files as the 'before' state"], files: [] };
  const checkPath = join(o.project, o.check);
  if (!existsSync(checkPath)) return { problems: [`check file not found: ${o.check}`], files: [] };
  const changed = o.files?.length ? o.files : (git(o.project, ["diff", "--name-only", "HEAD"]) ?? "").split("\n").filter(Boolean).filter((f) => f !== o.check);
  const files = changed.filter((f) => RUNTIME_BY_EXT[extname(f)] && existsSync(join(o.project, f))).slice(0, 8);
  if (!files.length) problems.push("no changed source files found (git diff HEAD); pass --files a.py,b.py");
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  for (const f of files) {
    const old = git(o.project, ["show", `HEAD:${f}`]);
    if (old !== null) before[f] = old;
    after[f] = readFileSync(join(o.project, f), "utf8");
  }
  const checkName = `cafe_check_${basename(o.check)}`;
  const kind = RUNTIME_BY_EXT[extname(o.check)];
  if (!kind) problems.push(`unsupported check type ${extname(o.check)} (use .py, .js/.cjs/.mjs/.ts or .sh)`);
  const all = [...Object.values(before), ...Object.values(after), readFileSync(checkPath, "utf8")].join("\n");
  const secrets = findSecrets(all);
  if (secrets.length) problems.push(`the files look like they contain secrets (${secrets.join(", ")}); remove them before capturing`);
  if (problems.length || !kind) return { problems, files };
  const capsule: Capsule = {
    schema: CAPSULE_SCHEMA,
    title: o.title ?? `Fix in ${files.join(", ")}`,
    problem: { symptom: o.symptom ?? "(describe the error message)", description: "Captured locally with cafe capture.", tags: ["captured"], refs: [] },
    runtime: kind.runtime,
    applicability: { claims: {} },
    before: { files: before },
    after: { files: after },
    check: { run: [kind.interp, checkName], files: { [checkName]: readFileSync(checkPath, "utf8") }, timeout_ms: 20_000 },
    limitations: { proves: "The check fails on the committed code and passes with the change, in the replayed environment.", does_not_prove: "That the check covers every behavior of the code." },
    author: "local",
  };
  const v = validateCapsule(capsule);
  if (!v.ok) return { problems: v.errors, files };
  return { capsule: v.capsule, problems: [], files };
}

export interface CaptureResult {
  saved: string | null;
  verdict: string;
  mutation: { total: number; killed: number };
  reasons: string[];
  lint: string[];
}

/** Replays the candidate in the sandbox and saves it only if the check is a real regression test. */
export async function capture(o: CaptureOptions, c: Capsule): Promise<CaptureResult> {
  const r = await replay(c, { bins: o.bins, isolation: o.isolation ?? "sandbox" });
  const p = r.predicate;
  const reasons: string[] = [];
  if (p.verdict === "PROBLEM_NOT_REPRODUCED") reasons.push("the check already passes on the committed code, so it does not test this fix");
  if (p.verdict === "FIX_FAILS") reasons.push("the check still fails with your change");
  if (p.verdict === "FIX_BREAKS") reasons.push("the check passes on the committed code but fails with your change");
  if (p.verdict === "ERROR") reasons.push("the check timed out or crashed");
  if (p.verdict === "PASS" && !(p.mutation.total > 0 && p.mutation.killed * 2 >= p.mutation.total)) {
    reasons.push(`the check caught only ${p.mutation.killed}/${p.mutation.total} mutants of the fix: it does not really test the changed lines`);
  }
  const lint = lintCapsule(c).map((f) => f.code);
  if (reasons.length) return { saved: null, verdict: p.verdict, mutation: p.mutation, reasons, lint };
  const dir = join(o.project, ".cafe", "capsules");
  mkdirSync(dir, { recursive: true });
  const name = (o.name ?? c.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "capsule";
  const file = join(dir, `${name}.json`);
  const row = { runtime: p.env.runtime, version: p.env.version, conditions: p.env.conditions, verdict: p.verdict, mutation: p.mutation, trust: "claimed", source: "this machine (cafe capture)" };
  writeFileSync(file, JSON.stringify({ capsule: c, local_results: [row], note: "Private. Share only with `cafe push`, after reviewing every file." }, null, 2) + "\n");
  return { saved: file, verdict: p.verdict, mutation: p.mutation, reasons: [], lint };
}
