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
  /** symptom_regex (optional): the BEFORE run's output must match it, tying the failure to the stated symptom. */
  problem: { symptom: string; description: string; tags: string[]; refs: string[]; symptom_regex?: string };
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
  /** How `cafe doctor` finds code affected by this problem in a project (runs locally, never uploaded). */
  detect?: Detect;
}

export interface Detect {
  /** File globs of the form "*.ext". */
  files: string[];
  /** Line regex (JavaScript syntax) that marks a likely affected line. */
  pattern: string;
  /** Optional regex that must ALSO appear somewhere in the same file. */
  also?: string;
  /** Shown with every hit, e.g. "only if you run .ts files directly with Node". */
  note?: string;
}

/** Rejects regexes that are long or have nested quantifiers (catastrophic backtracking on user files). */
export function safeRegex(src: unknown, max = 160): string | null {
  if (typeof src !== "string" || !src || src.length > max) return null;
  // Heuristic guards against catastrophic backtracking (patterns run over user files and error text):
  // quantified groups that contain a quantifier or an alternation, and chains of adjacent unbounded
  // quantifiers. Conservative on purpose: rejecting a valid rule is cheap, a hung scan is not.
  if (/\([^)]*[*+|][^)]*\)\s*[*+{]/.test(src)) return null;
  if (/([*+]|\{\d*,\})\??\s*(\\[a-zA-Z]|\.|\[[^\]]*\])[*+]/.test(src)) return null;
  try {
    new RegExp(src);
    return src;
  } catch {
    return null;
  }
}

const INTERPRETERS = new Set(["node", "python3", "python", "bash", "sh", "bun"]);
const ENV_ALLOW = new Set(["TZ", "LANG", "LC_ALL", "PYTHONWARNINGS", "PYTHONUTF8", "PYTHONDONTWRITEBYTECODE"]);
// Files that let a "solution" hijack the check instead of fixing the problem.
// Case-insensitive: on macOS/Windows "Conftest.py" is the same file as "conftest.py".
const FORBIDDEN_FILE = /(^|\/)(conftest\.py|sitecustomize\.py|usercustomize\.py|pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|setup\.py|\.pythonrc|\.pythonstartup|\.npmrc|\.noderc|\.yarnrc(\.yml)?|bunfig\.toml|deno\.jsonc?|\.env[^/]*)$|\.(pth|pyc|pyo|so|dylib|dll|node)$|(^|\/)node_modules\/|(^|\/)__pycache__\//i;
// Python files named like stdlib modules shadow them for the check (red-team C3/E: a "fix" that adds json.py).
const PY_STDLIB = new Set("abc antigravity argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc nis nntplib nt ntpath nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios textwrap this threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo".split(" "));
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
    const top = path.split("/")[0].replace(/\.py$/, "");
    if (FORBIDDEN_FILE.test(path) || ((path.endsWith(".py") || !path.includes(".")) && PY_STDLIB.has(top.toLowerCase()))) {
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
  let symptomRegex: string | undefined;
  if (p.symptom_regex !== undefined) {
    symptomRegex = safeRegex(p.symptom_regex, 200) ?? undefined;
    if (!symptomRegex) errors.push("problem.symptom_regex must be a valid regex <= 200 chars without nested quantifiers");
  }

  const tags = Array.isArray(p.tags) ? p.tags.filter((t: unknown) => typeof t === "string").slice(0, 10) : [];
  const refs = Array.isArray(p.refs) ? p.refs.filter((r: unknown) => typeof r === "string" && /^https:\/\//.test(r)).slice(0, 10) : [];
  if (!RUNTIMES.includes(o.runtime)) errors.push(`runtime must be one of ${RUNTIMES.join(", ")}`);
  const claims: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.applicability?.claims ?? {})) {
    if (typeof v === "string" && /^[a-z0-9]+$/.test(k) && /^[<>=0-9. ]+$/.test(v)) claims[k] = v.trim();
    else errors.push(`applicability.claims.${k} must look like ">=20.11 <25"`);
  }
  let conditions: Record<string, string> | undefined;
  if (o.applicability?.conditions !== undefined) {
    const raw = o.applicability.conditions;
    const ok = raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length <= 10 &&
      Object.entries(raw).every(([k, v]) => /^[A-Za-z0-9_]{1,40}$/.test(k) && typeof v === "string" && v.length <= 200);
    if (ok) conditions = raw as Record<string, string>;
    else errors.push("applicability.conditions must be a flat object of <= 10 string values");
  }
  const before = checkFiles("before", o.before?.files, errors);
  const after = checkFiles("after", o.after?.files, errors);
  const checkF = checkFiles("check", o.check?.files, errors);
  const run = o.check?.run;
  if (!Array.isArray(run) || run.length === 0 || run.length > 12 || run.some((a: unknown) => typeof a !== "string")) {
    errors.push("check.run must be a non-empty array of strings");
  } else if (!INTERPRETERS.has(run[0])) {
    errors.push(`check.run[0] must be an interpreter: ${[...INTERPRETERS].join(", ")}`);
  } else if (run.length !== 2 || !(run[1] in checkF)) {
    // Exactly [interpreter, check file]: no flags, no -c/-e/-p/--eval/--import/-m (red-team L1, C3/F).
    errors.push("check.run must be exactly [interpreter, <one of check.files>] with no flags");
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
  let detect: Detect | undefined;
  if (o.detect !== undefined) {
    const d = o.detect ?? {};
    const files = Array.isArray(d.files) ? d.files.filter((f: unknown) => typeof f === "string" && /^\*\.[a-z0-9]{1,6}$/.test(f)).slice(0, 8) : [];
    const pattern = safeRegex(d.pattern, 240);
    const also = d.also === undefined ? undefined : safeRegex(d.also);
    const note = d.note === undefined ? undefined : str(d.note, 300);
    if (!files.length || !pattern || also === null || note === null) errors.push('detect must be {files: ["*.py"], pattern: <safe regex <= 240 chars>, also?: <safe regex>, note?: string}');
    else detect = { files, pattern, ...(also ? { also } : {}), ...(note ? { note } : {}) };
  }
  if (errors.length) return { ok: false, errors };
  const capsule: Capsule = {
    schema: CAPSULE_SCHEMA,
    title: title!,
    problem: { symptom: symptom!, description: description!, tags, refs, ...(symptomRegex ? { symptom_regex: symptomRegex } : {}) },
    runtime: o.runtime,
    applicability: {
      claims,
      ...(conditions ? { conditions } : {}),
      ...(typeof o.applicability?.notes === "string" ? { notes: o.applicability.notes.slice(0, 1000) } : {}),
    },
    before: { files: before },
    after: { files: after },
    check: { run: run as string[], files: checkF, ...(Object.keys(env).length ? { env } : {}), timeout_ms: timeout },
    limitations: { proves: proves!, does_not_prove: doesNot! },
    author: author!,
    ...(detect ? { detect } : {}),
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

/** Content address of a capsule. `detect` is excluded: it is a local scanning hint, not part of what is
 *  executed or claimed, so improving a detection rule must not orphan the capsule's evidence. */
export function capsuleId(c: Capsule): Promise<string> {
  return sha256Hex(canonical({ ...c, detect: undefined }));
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
