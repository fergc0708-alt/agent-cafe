// Replayable Fix Capsule: the unit of the Execution Evidence Network.
// A capsule = a problem state ("before") that reproduces a failure, a fixed state ("after"),
// and a check that must FAIL on before and PASS on after (SWE-bench's FAIL_TO_PASS idea).
// Dependency-free: runs in Node, Deno and Vitest.
import { sha256Hex } from "../util.ts";

export const CAPSULE_SCHEMA = "agent-cafe.capsule/v0.1";
export const RUNTIMES = ["node", "python", "bash", "bun"] as const;
export type Runtime = (typeof RUNTIMES)[number];
export type FileMap = Record<string, string>;

export interface Capsule {
  schema: string;
  title: string;
  problem: { symptom: string; description: string; tags: string[]; refs: string[] };
  runtime: Runtime;
  /** Author's claim of where the fix applies, e.g. {"node": ">=20.11"}. Evidence may contradict it. */
  applicability: { claims: Record<string, string>; conditions?: Record<string, string>; notes?: string };
  before: { files: FileMap };
  after: { files: FileMap };
  check: { run: string[]; files: FileMap; env?: Record<string, string>; timeout_ms?: number };
  limitations: { proves: string; does_not_prove: string };
  author: string;
  /** Capsule ids this one replaces (e.g. an older fix that stopped working). */
  supersedes?: string[];
}

const INTERPRETERS = new Set(["node", "python3", "python", "bash", "sh", "bun"]);
const ENV_ALLOW = new Set(["TZ", "LANG", "LC_ALL", "PYTHONWARNINGS", "PYTHONUTF8", "PYTHONDONTWRITEBYTECODE"]);
// Files that let a "solution" hijack the check instead of fixing the problem.
const FORBIDDEN_FILE = /(^|\/)(conftest\.py|sitecustomize\.py|usercustomize\.py|pytest\.ini|tox\.ini|setup\.cfg|\.pythonrc|\.npmrc|\.noderc|bunfig\.toml|\.env)$|\.pth$|(^|\/)node_modules\/|(^|\/)__pycache__\//;
const MAX_FILE = 64_000;
const MAX_TOTAL = 256_000;
const MAX_FILES = 20;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  capsule?: Capsule;
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : null;
}

function checkFiles(section: string, files: unknown, errors: string[]): FileMap {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    errors.push(`${section}.files must be an object of path -> content`);
    return {};
  }
  const out: FileMap = {};
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length > MAX_FILES) errors.push(`${section}.files: at most ${MAX_FILES} files`);
  for (const [path, content] of entries) {
    if (typeof content !== "string") {
      errors.push(`${section}.files["${path}"] must be a string`);
      continue;
    }
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(path) || path.includes("..") || path.includes("//") || path.endsWith("/")) {
      errors.push(`${section}.files: unsafe path "${path}"`);
      continue;
    }
    if (FORBIDDEN_FILE.test(path)) {
      errors.push(`${section}.files: "${path}" is not allowed (it could change how the check runs instead of fixing the problem)`);
      continue;
    }
    if (content.length > MAX_FILE) errors.push(`${section}.files["${path}"] is larger than ${MAX_FILE} bytes`);
    out[path] = content;
  }
  return out;
}

/** Validates untrusted input and returns a normalized capsule. */
export function validateCapsule(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { ok: false, errors: ["capsule must be a JSON object"] };
  const o = input as Record<string, any>;
  if (o.schema !== CAPSULE_SCHEMA) errors.push(`schema must be "${CAPSULE_SCHEMA}"`);
  const title = str(o.title, 160);
  if (!title) errors.push("title is required (<= 160 chars)");
  const p = o.problem ?? {};
  const symptom = str(p.symptom, 400);
  const description = str(p.description, 4000);
  if (!symptom) errors.push("problem.symptom is required (the error message or observable failure)");
  if (!description) errors.push("problem.description is required");
  const tags = Array.isArray(p.tags) ? p.tags.filter((t: unknown) => typeof t === "string").slice(0, 10) : [];
  const refs = Array.isArray(p.refs) ? p.refs.filter((r: unknown) => typeof r === "string" && /^https:\/\//.test(r)).slice(0, 10) : [];
  if (!RUNTIMES.includes(o.runtime)) errors.push(`runtime must be one of ${RUNTIMES.join(", ")}`);
  const claims: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.applicability?.claims ?? {})) {
    if (typeof v === "string" && /^[a-z0-9]+$/.test(k) && /^[<>=0-9. ]+$/.test(v)) claims[k] = v.trim();
    else errors.push(`applicability.claims.${k} must look like ">=20.11 <25"`);
  }
  const before = checkFiles("before", o.before?.files, errors);
  const after = checkFiles("after", o.after?.files, errors);
  const checkF = checkFiles("check", o.check?.files, errors);
  const run = o.check?.run;
  if (!Array.isArray(run) || run.length === 0 || run.length > 12 || run.some((a: unknown) => typeof a !== "string")) {
    errors.push("check.run must be a non-empty array of strings");
  } else if (!INTERPRETERS.has(run[0])) {
    errors.push(`check.run[0] must be an interpreter: ${[...INTERPRETERS].join(", ")}`);
  } else if (run[0] === "sh" || run[0] === "bash") {
    if (run[1] === "-c") errors.push("check.run must execute a check file, not an inline -c command");
  } else if (run.includes("-c") || run.includes("-e") || run.includes("--eval")) {
    errors.push("check.run must execute a check file, not inline code");
  }
  for (const name of Object.keys(checkF)) {
    if (name in before || name in after) errors.push(`check file "${name}" collides with a before/after file`);
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.check?.env ?? {})) {
    if (ENV_ALLOW.has(k) && typeof v === "string" && v.length < 100) env[k] = v;
    else errors.push(`check.env.${k} is not allowed`);
  }
  const timeout = o.check?.timeout_ms ?? 10_000;
  if (typeof timeout !== "number" || timeout < 100 || timeout > 30_000) errors.push("check.timeout_ms must be 100..30000");
  const total = [before, after, checkF].flatMap((m) => Object.values(m)).reduce((s, c) => s + c.length, 0);
  if (total > MAX_TOTAL) errors.push(`capsule files exceed ${MAX_TOTAL} bytes in total`);
  if (!Object.keys(after).length) errors.push("after.files must contain the fixed state");
  const proves = str(o.limitations?.proves, 1000);
  const doesNot = str(o.limitations?.does_not_prove, 1000);
  if (!proves || !doesNot) errors.push("limitations.proves and limitations.does_not_prove are required");
  const author = str(o.author, 64);
  if (!author) errors.push("author is required");
  if (errors.length) return { ok: false, errors };
  const capsule: Capsule = {
    schema: CAPSULE_SCHEMA,
    title: title!,
    problem: { symptom: symptom!, description: description!, tags, refs },
    runtime: o.runtime,
    applicability: {
      claims,
      ...(o.applicability?.conditions ? { conditions: o.applicability.conditions } : {}),
      ...(typeof o.applicability?.notes === "string" ? { notes: o.applicability.notes.slice(0, 1000) } : {}),
    },
    before: { files: before },
    after: { files: after },
    check: { run: run as string[], files: checkF, ...(Object.keys(env).length ? { env } : {}), timeout_ms: timeout },
    limitations: { proves: proves!, does_not_prove: doesNot! },
    author: author!,
    ...(Array.isArray(o.supersedes) ? { supersedes: o.supersedes.filter((s: unknown) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s as string)) } : {}),
  };
  return { ok: true, errors: [], capsule };
}

/** Deterministic JSON: object keys sorted recursively. Used for content addressing and signing. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value as object).filter((k) => (value as any)[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical((value as any)[k])).join(",") + "}";
}

/** Content address of a capsule (any edit produces a new id). */
export function capsuleId(c: Capsule): Promise<string> {
  return sha256Hex(canonical(c));
}

/** Digest of exactly what a replay executes: check files + run command. */
export function checkDigest(c: Capsule): Promise<string> {
  return sha256Hex(canonical({ run: c.check.run, files: c.check.files, env: c.check.env ?? {} }));
}

/** Digest of the fixed state, so two capsules with the same fix can be linked. */
export function afterDigest(c: Capsule): Promise<string> {
  return sha256Hex(canonical(c.after.files));
}

/** Files that the fix adds or changes. */
export function changedFiles(c: Capsule): string[] {
  return Object.keys(c.after.files).filter((p) => c.before.files[p] !== c.after.files[p]);
}

// ---------- version ranges ----------

export function parseVersion(v: string): number[] {
  return (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a.at(i) ?? 0) - (b.at(i) ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Supports space-separated comparators: ">=20.11 <25", "=3.12". */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  return range
    .trim()
    .split(/\s+/)
    .every((part) => {
      const m = part.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/);
      if (!m) return false;
      const c = cmp(v, parseVersion(m[2]));
      switch (m[1] ?? "=") {
        case ">=":
          return c >= 0;
        case "<=":
          return c <= 0;
        case ">":
          return c > 0;
        case "<":
          return c < 0;
        default: {
          // "=3.12" matches 3.12.x
          const want = parseVersion(m[2]);
          return want.every((n, i) => v.at(i) === n);
        }
      }
    });
}
