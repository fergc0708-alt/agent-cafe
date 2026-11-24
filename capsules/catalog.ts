// Seed catalog of Replayable Fix Capsules. Each is a real runtime/toolchain breakage an agent can hit
// mid-task. Checks spawn the SAME interpreter they run under (process.execPath / sys.executable),
// so replaying under another binary tests that binary. Build with: node scripts/build-capsules.ts
import { CAPSULE_SCHEMA, type Capsule } from "../core/capsule/capsule.ts";

const AUTHOR = "cafe-curator";

/** A Node check that runs `file` with the same runtime and compares stdout. */
function nodeRunCheck(file: string, expected: string, extraArgs: string[] = []): Record<string, string> {
  return {
    "check.cjs": `const { spawnSync } = require("node:child_process");
const r = spawnSync(process.execPath, ${JSON.stringify([...extraArgs, file])}, { encoding: "utf8" });
if (r.status !== 0) {
  console.error("${file} exited with", r.status, r.stderr.slice(0, 400));
  process.exit(1);
}
if (r.stdout.trim() !== ${JSON.stringify(expected)}) {
  console.error("unexpected output:", JSON.stringify(r.stdout.trim()));
  process.exit(1);
}
`,
  };
}

const base = (o: Omit<Capsule, "schema" | "author">): Capsule => ({ schema: CAPSULE_SCHEMA, author: AUTHOR, ...o });

export const CATALOG: Record<string, Capsule> = {
  "node-require-esm": base({
    title: "CommonJS can't require() an ES module (ERR_REQUIRE_ESM): load it with dynamic import()",
    problem: {
      symptom: "Error [ERR_REQUIRE_ESM]: require() of ES Module ./lib.mjs not supported",
      description: "A CommonJS file loads an ESM-only module with require(). Older Node versions reject it. Dynamic import() works from CommonJS on every supported Node version.",
      tags: ["node", "esm", "commonjs", "require"],
      refs: ["https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require", "https://nodejs.org/api/esm.html"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=12" }, notes: "Since Node 22.12 / 20.19, require() of synchronous ESM works, so the problem itself may not reproduce there." },
    before: { files: { "lib.mjs": "export const answer = 42;\n", "main.cjs": "const { answer } = require(\"./lib.mjs\");\nconsole.log(answer);\n" } },
    after: { files: { "lib.mjs": "export const answer = 42;\n", "main.cjs": "import(\"./lib.mjs\").then((m) => console.log(m.answer));\n" } },
    check: { run: ["node", "check.cjs"], files: nodeRunCheck("main.cjs", "42") },
    limitations: { proves: "main.cjs prints the ESM export when loaded with this runtime.", does_not_prove: "Behavior with packages that use top-level await or conditional exports." },
  }),

  "node-esm-dirname": base({
    title: "__dirname is not defined in ES modules: use import.meta.dirname",
    problem: {
      symptom: "ReferenceError: __dirname is not defined in ES module scope",
      description: "CommonJS globals (__dirname, __filename) do not exist in .mjs files. Node 20.11+ provides import.meta.dirname.",
      tags: ["node", "esm", "dirname"],
      refs: ["https://nodejs.org/api/esm.html#importmetadirname"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=20.11" }, notes: "For older Node use fileURLToPath(new URL('.', import.meta.url))." },
    before: { files: { "main.mjs": "console.log(__dirname);\n" } },
    after: { files: { "main.mjs": "console.log(import.meta.dirname);\n" } },
    check: {
      run: ["node", "check.cjs"],
      files: {
        "check.cjs": `const { spawnSync } = require("node:child_process");
const { realpathSync } = require("node:fs");
const r = spawnSync(process.execPath, ["main.mjs"], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr.slice(0, 300)); process.exit(1); }
const out = r.stdout.trim();
if (!out || realpathSync(out) !== realpathSync(process.cwd())) { console.error("wrong dir", r.stdout); process.exit(1); }
`,
      },
    },
    limitations: { proves: "main.mjs prints its own directory.", does_not_prove: "Bundler behavior (webpack/esbuild may rewrite import.meta)." },
  }),

  "node-ts-parameter-properties": base({
    title: "Node type stripping rejects TypeScript parameter properties: declare fields explicitly",
    problem: {
      symptom: "SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode",
      description: "Running .ts files directly with Node (type stripping, default since 22.18) only erases types. Syntax that needs code generation, like constructor(public x), fails. Declare fields and assign them.",
      tags: ["node", "typescript", "type-stripping"],
      refs: ["https://nodejs.org/api/typescript.html#type-stripping"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=22.18" }, notes: "Bun and tsc support parameter properties; the problem is specific to Node's strip-only mode." },
    before: {
      files: { "point.ts": "class Point {\n  constructor(public x: number, public y: number) {}\n}\nconst p = new Point(1, 2);\nconsole.log(p.x + p.y);\n" },
    },
    after: {
      files: {
        "point.ts": "class Point {\n  x: number;\n  y: number;\n  constructor(x: number, y: number) {\n    this.x = x;\n    this.y = y;\n  }\n}\nconst p = new Point(1, 2);\nconsole.log(p.x + p.y);\n",
      },
    },
    check: { run: ["node", "check.cjs"], files: nodeRunCheck("point.ts", "3") },
    limitations: { proves: "point.ts runs and computes the sum with this runtime's TypeScript handling.", does_not_prove: "Other strip-only restrictions (enums, namespaces) or tsc type errors." },
  }),

  "node-ts-import-extension": base({
    title: "Node type stripping needs explicit .ts extensions in imports",
    problem: {
      symptom: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './util' imported from main.ts",
      description: "When Node runs TypeScript directly, ESM resolution does not guess extensions. Import './util.ts' (and enable allowImportingTsExtensions in tsconfig for type checking).",
      tags: ["node", "typescript", "esm", "imports"],
      refs: ["https://nodejs.org/api/typescript.html#importing-types-without-type-keyword"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=22.18" } },
    before: {
      files: {
        "package.json": "{\"type\": \"module\"}\n",
        "util.ts": "export function double(n: number): number {\n  return n * 2;\n}\n",
        "main.ts": "import { double } from \"./util\";\nconsole.log(double(21));\n",
      },
    },
    after: {
      files: {
        "package.json": "{\"type\": \"module\"}\n",
        "util.ts": "export function double(n: number): number {\n  return n * 2;\n}\n",
        "main.ts": "import { double } from \"./util.ts\";\nconsole.log(double(21));\n",
      },
    },
    check: { run: ["node", "check.cjs"], files: nodeRunCheck("main.ts", "42") },
    limitations: { proves: "main.ts imports util.ts and runs with this runtime.", does_not_prove: "That tsc accepts the import without allowImportingTsExtensions." },
  }),

  "node-import-assert-to-with": base({
    title: "Import assertions (assert { type: 'json' }) were removed in Node 22: use import attributes (with)",
    problem: {
      symptom: "SyntaxError: Unexpected identifier 'assert'",
      description: "Node 22 dropped the old import-assertions syntax. JSON modules now use import attributes: import data from './data.json' with { type: 'json' }.",
      tags: ["node", "esm", "json", "import-attributes", "migration"],
      refs: ["https://nodejs.org/api/esm.html#import-attributes"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=18.20" } },
    before: { files: { "data.json": "{\"name\": \"cafe\"}\n", "main.mjs": "import data from \"./data.json\" assert { type: \"json\" };\nconsole.log(data.name);\n" } },
    after: { files: { "data.json": "{\"name\": \"cafe\"}\n", "main.mjs": "import data from \"./data.json\" with { type: \"json\" };\nconsole.log(data.name);\n" } },
    check: { run: ["node", "check.cjs"], files: nodeRunCheck("main.mjs", "cafe") },
    limitations: { proves: "The JSON module loads with this runtime.", does_not_prove: "TypeScript or bundler support for the with syntax." },
  }),

  "node-json-import-assert-OLD": base({
    title: "(OLD FIX) Importing JSON in ESM: add assert { type: 'json' }",
    problem: {
      symptom: "TypeError: Module \"./data.json\" needs an import attribute of \"type: json\"",
      description: "ESM refuses to import JSON without declaring its type. This capsule records the fix that was common in 2022-2023 (import assertions).",
      tags: ["node", "esm", "json"],
      refs: ["https://nodejs.org/api/esm.html#import-attributes"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=17.5" }, notes: "Claim as originally written; kept to show how evidence detects regressions." },
    before: { files: { "data.json": "{\"name\": \"cafe\"}\n", "main.mjs": "import data from \"./data.json\";\nconsole.log(data.name);\n" } },
    after: { files: { "data.json": "{\"name\": \"cafe\"}\n", "main.mjs": "import data from \"./data.json\" assert { type: \"json\" };\nconsole.log(data.name);\n" } },
    check: { run: ["node", "check.cjs"], files: nodeRunCheck("main.mjs", "cafe") },
    limitations: { proves: "The JSON module loads with this runtime.", does_not_prove: "Anything about newer Node versions; see superseding capsule." },
  }),

  "node-json-import-with": base({
    title: "Importing JSON in ESM: add with { type: 'json' } (import attributes)",
    problem: {
      symptom: "TypeError: Module \"./data.json\" needs an import attribute of \"type: json\"",
      description: "ESM refuses to import JSON without declaring its type. Current syntax: import attributes with `with`.",
      tags: ["node", "esm", "json", "import-attributes"],
      refs: ["https://nodejs.org/api/esm.html#import-attributes"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=18.20" } },
    before: { files: { "data.json": "{\"name\": \"cafe\"}\n", "main.mjs": "import data from \"./data.json\";\nconsole.log(data.name);\n" } },
    after: { files: { "data.json": "{\"name\": \"cafe\"}\n", "main.mjs": "import data from \"./data.json\" with { type: \"json\" };\nconsole.log(data.name);\n" } },
    check: { run: ["node", "check.cjs"], files: nodeRunCheck("main.mjs", "cafe") },
    limitations: { proves: "The JSON module loads with this runtime.", does_not_prove: "TypeScript or bundler support." },
  }),

  "node-cjs-top-level-await": base({
    title: "Top-level await is not allowed in CommonJS: wrap it in an async function",
    problem: {
      symptom: "SyntaxError: await is only valid in async functions and the top level bodies of modules",
      description: "A .cjs (or CommonJS .js) file uses await at the top level. Either convert the file to ESM or wrap the code in an async IIFE.",
      tags: ["node", "commonjs", "async"],
      refs: ["https://nodejs.org/api/esm.html#top-level-await"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=14" } },
    before: { files: { "main.cjs": "const v = await Promise.resolve(42);\nconsole.log(v);\n" } },
    after: { files: { "main.cjs": "(async () => {\n  const v = await Promise.resolve(42);\n  console.log(v);\n})();\n" } },
    check: { run: ["node", "check.cjs"], files: nodeRunCheck("main.cjs", "42") },
    limitations: { proves: "main.cjs prints the awaited value.", does_not_prove: "Error handling of the wrapped promise (unhandled rejections)." },
  }),

  "node-structuredclone-dates": base({
    title: "JSON deep copy turns Dates into strings: use structuredClone",
    problem: {
      symptom: "TypeError: copy.createdAt.getTime is not a function",
      description: "JSON.parse(JSON.stringify(obj)) loses Dates, Maps, undefined and more. structuredClone (Node 17+) keeps them.",
      tags: ["node", "javascript", "clone"],
      refs: ["https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=17" } },
    before: { files: { "lib.cjs": "module.exports.clone = (o) => JSON.parse(JSON.stringify(o));\n" } },
    after: { files: { "lib.cjs": "module.exports.clone = (o) => structuredClone(o);\n" } },
    check: {
      run: ["node", "check.cjs"],
      files: {
        "check.cjs": `const { clone } = require("./lib.cjs");
const src = { createdAt: new Date(0), tags: new Map([["a", 1]]) };
const copy = clone(src);
if (!(copy.createdAt instanceof Date) || copy.createdAt.getTime() !== 0) throw new Error("Date lost");
if (!(copy.tags instanceof Map) || copy.tags.get("a") !== 1) throw new Error("Map lost");
if (copy.createdAt === src.createdAt) throw new Error("not a deep copy");
`,
      },
    },
    limitations: { proves: "Dates and Maps survive the copy.", does_not_prove: "Behavior with functions or class instances (structuredClone drops prototypes)." },
  }),

  "node-sort-mutates": base({
    title: "Array.prototype.sort mutates the input: use toSorted for a sorted copy",
    problem: {
      symptom: "The caller's array changed order after calling a helper that 'returns a sorted list'",
      description: "sort() sorts in place and returns the same array. toSorted() (Node 20+) returns a new array.",
      tags: ["node", "javascript", "arrays"],
      refs: ["https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=20" }, notes: "For older runtimes use [...a].sort(cmp)." },
    before: { files: { "lib.cjs": "module.exports.sortedCopy = (a) => a.sort((x, y) => x - y);\n" } },
    after: { files: { "lib.cjs": "module.exports.sortedCopy = (a) => a.toSorted((x, y) => x - y);\n" } },
    check: {
      run: ["node", "check.cjs"],
      files: {
        "check.cjs": `const assert = require("node:assert");
const { sortedCopy } = require("./lib.cjs");
const input = [3, 1, 2];
assert.deepStrictEqual(sortedCopy(input), [1, 2, 3]);
assert.deepStrictEqual(input, [3, 1, 2], "input was mutated");
`,
      },
    },
    limitations: { proves: "The result is sorted and the input is untouched.", does_not_prove: "Sort stability or performance on large arrays." },
  }),

  "node-money-cents": base({
    title: "Summing prices with floats gives 0.30000000000000004: add integer cents",
    problem: {
      symptom: "Expected total 0.30, got 0.30000000000000004",
      description: "Binary floating point cannot represent 0.1 exactly. Convert to integer minor units before adding.",
      tags: ["node", "javascript", "money", "floating-point"],
      refs: ["https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=0.10" } },
    before: { files: { "lib.cjs": "module.exports.total = (prices) => prices.reduce((s, p) => s + p, 0).toString();\n" } },
    after: {
      files: {
        "lib.cjs": "module.exports.total = (prices) => {\n  const cents = prices.reduce((s, p) => s + Math.round(p * 100), 0);\n  return (cents / 100).toFixed(2);\n};\n",
      },
    },
    check: {
      run: ["node", "check.cjs"],
      files: {
        "check.cjs": `const assert = require("node:assert");
const { total } = require("./lib.cjs");
assert.strictEqual(total([0.1, 0.2]), "0.30");
assert.strictEqual(total([19.99, 0.01]), "20.00");
`,
      },
    },
    limitations: { proves: "Two-decimal totals are exact for these inputs.", does_not_prove: "Currency rounding rules, amounts above 2^53 cents, or more than 2 decimals." },
  }),

  "node-bigint-json": base({
    title: "JSON.stringify throws on BigInt: serialize it as a string",
    problem: {
      symptom: "TypeError: Do not know how to serialize a BigInt",
      description: "JSON has no BigInt type. Use a replacer that converts bigint values to strings (and parse them back explicitly).",
      tags: ["node", "javascript", "json", "bigint"],
      refs: ["https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt#use_within_json"],
    },
    runtime: "node",
    applicability: { claims: { node: ">=10.4" } },
    before: { files: { "lib.cjs": "module.exports.toJson = (o) => JSON.stringify(o);\n" } },
    after: { files: { "lib.cjs": "module.exports.toJson = (o) => JSON.stringify(o, (_k, v) => (typeof v === \"bigint\" ? v.toString() : v));\n" } },
    check: {
      run: ["node", "check.cjs"],
      files: {
        "check.cjs": `const assert = require("node:assert");
const { toJson } = require("./lib.cjs");
assert.strictEqual(toJson({ id: 9007199254740993n, ok: true }), '{"id":"9007199254740993","ok":true}');
`,
      },
    },
    limitations: { proves: "BigInt values serialize as exact decimal strings.", does_not_prove: "That consumers parse them back as BigInt." },
  }),

  "py-fromisoformat-z": base({
    title: "datetime.fromisoformat rejects a trailing 'Z' before Python 3.11: normalize it to +00:00",
    problem: {
      symptom: "ValueError: Invalid isoformat string: '2026-11-24T15:17:00Z'",
      description: "Before Python 3.11, fromisoformat only accepted its own output format. Replacing a trailing Z with +00:00 works on all versions.",
      tags: ["python", "datetime", "iso8601"],
      refs: ["https://docs.python.org/3/library/datetime.html#datetime.datetime.fromisoformat"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.7" }, notes: "On 3.11+ the original code already works." },
    before: { files: { "parse.py": "from datetime import datetime\n\n\ndef parse(ts):\n    return datetime.fromisoformat(ts)\n" } },
    after: {
      files: { "parse.py": "from datetime import datetime\n\n\ndef parse(ts):\n    if ts.endswith(\"Z\"):\n        ts = ts[:-1] + \"+00:00\"\n    return datetime.fromisoformat(ts)\n" },
    },
    check: {
      run: ["python3", "check.py"],
      files: { "check.py": "from parse import parse\n\nd = parse(\"2026-11-24T15:17:00Z\")\nassert d.utcoffset().total_seconds() == 0, d\nassert (d.hour, d.minute) == (15, 17), d\n" },
    },
    limitations: { proves: "A Z-suffixed timestamp parses as UTC.", does_not_prove: "Other ISO 8601 variants (week dates, fractional hours) on old Pythons." },
  }),

  "py-utcnow-deprecated": base({
    title: "datetime.utcnow() is deprecated and naive: use datetime.now(timezone.utc)",
    problem: {
      symptom: "DeprecationWarning: datetime.datetime.utcnow() is deprecated and scheduled for removal",
      description: "utcnow() returns a naive datetime and is deprecated since Python 3.12. datetime.now(timezone.utc) returns an aware UTC datetime.",
      tags: ["python", "datetime", "deprecation", "timezone"],
      refs: ["https://docs.python.org/3/library/datetime.html#datetime.datetime.utcnow"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.2" } },
    before: { files: { "clock.py": "from datetime import datetime\n\n\ndef now_utc():\n    return datetime.utcnow()\n" } },
    after: { files: { "clock.py": "from datetime import datetime, timezone\n\n\ndef now_utc():\n    return datetime.now(timezone.utc)\n" } },
    check: {
      run: ["python3", "check.py"],
      files: {
        "check.py": "import warnings\n\nwarnings.simplefilter(\"error\", DeprecationWarning)\nfrom clock import now_utc\n\nd = now_utc()\nassert d.tzinfo is not None and d.utcoffset().total_seconds() == 0, d\n",
      },
    },
    limitations: { proves: "now_utc returns an aware UTC datetime without deprecation warnings.", does_not_prove: "Callers that compare it with naive datetimes (they will now raise TypeError)." },
  }),

  "py-distutils-removed": base({
    title: "distutils was removed in Python 3.12: stop using distutils.version.LooseVersion",
    problem: {
      symptom: "ModuleNotFoundError: No module named 'distutils'",
      description: "PEP 632 removed distutils in 3.12. For simple dotted versions, compare tuples of ints; for real version specs use the packaging library.",
      tags: ["python", "distutils", "removal", "migration"],
      refs: ["https://peps.python.org/pep-0632/", "https://docs.python.org/3/whatsnew/3.12.html"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.0" } },
    before: { files: { "ver.py": "from distutils.version import LooseVersion\n\n\ndef newer(a, b):\n    return LooseVersion(a) > LooseVersion(b)\n" } },
    after: {
      files: { "ver.py": "def _key(v):\n    return tuple(int(x) for x in v.split(\".\"))\n\n\ndef newer(a, b):\n    return _key(a) > _key(b)\n" },
    },
    check: { run: ["python3", "check.py"], files: { "check.py": "from ver import newer\n\nassert newer(\"1.10\", \"1.9\")\nassert not newer(\"1.2\", \"1.10\")\n" } },
    limitations: { proves: "Numeric dotted versions compare correctly.", does_not_prove: "Pre-releases (1.0rc1), epochs or local versions: use packaging.version for those." },
  }),

  "py-csv-utf8-bom": base({
    title: "CSV header starts with \\ufeff (BOM from Excel): open with encoding='utf-8-sig'",
    problem: {
      symptom: "KeyError: 'name' (the first column is actually '\\ufeffname')",
      description: "Files saved by Excel and some Windows tools start with a UTF-8 byte order mark. utf-8-sig strips it.",
      tags: ["python", "csv", "unicode", "bom"],
      refs: ["https://docs.python.org/3/library/codecs.html#module-encodings.utf_8_sig"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.0" } },
    before: {
      files: {
        "data.csv": "\ufeffname,price\nx,1\n",
        "reader.py": "import csv\n\n\ndef header(path):\n    with open(path, encoding=\"utf-8\", newline=\"\") as f:\n        return next(csv.reader(f))\n",
      },
    },
    after: {
      files: {
        "data.csv": "\ufeffname,price\nx,1\n",
        "reader.py": "import csv\n\n\ndef header(path):\n    with open(path, encoding=\"utf-8-sig\", newline=\"\") as f:\n        return next(csv.reader(f))\n",
      },
    },
    check: { run: ["python3", "check.py"], files: { "check.py": "from reader import header\n\nassert header(\"data.csv\") == [\"name\", \"price\"], header(\"data.csv\")\n" } },
    limitations: { proves: "The BOM is not part of the first header.", does_not_prove: "Files in other encodings (cp1252, UTF-16)." },
  }),

  "py-mutable-default": base({
    title: "Mutable default argument keeps state between calls: default to None",
    problem: {
      symptom: "add(2) returned [1, 2] instead of [2]",
      description: "Default values are evaluated once. A list default is shared by every call.",
      tags: ["python", "functions", "bug"],
      refs: ["https://docs.python.org/3/tutorial/controlflow.html#default-argument-values"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.0" } },
    before: { files: { "bag.py": "def add(item, bucket=[]):\n    bucket.append(item)\n    return bucket\n" } },
    after: { files: { "bag.py": "def add(item, bucket=None):\n    if bucket is None:\n        bucket = []\n    bucket.append(item)\n    return bucket\n" } },
    check: { run: ["python3", "check.py"], files: { "check.py": "from bag import add\n\nassert add(1) == [1]\nassert add(2) == [2]\nshared = [0]\nassert add(3, shared) == [0, 3]\n" } },
    limitations: { proves: "Each call without a bucket starts empty; passing a list still appends to it.", does_not_prove: "Anything about other mutable defaults (dicts, sets) elsewhere in the code." },
  }),

  "py-lstrip-is-not-removeprefix": base({
    title: "str.lstrip('abc_') strips characters, not a prefix: use removeprefix",
    problem: {
      symptom: "'abc_cab'.lstrip('abc_') returned '' instead of 'cab'",
      description: "lstrip treats its argument as a set of characters. Python 3.9+ has str.removeprefix for prefixes.",
      tags: ["python", "strings"],
      refs: ["https://docs.python.org/3/library/stdtypes.html#str.removeprefix"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.9" } },
    before: { files: { "names.py": "def strip_prefix(name):\n    return name.lstrip(\"abc_\")\n" } },
    after: { files: { "names.py": "def strip_prefix(name):\n    return name.removeprefix(\"abc_\")\n" } },
    check: { run: ["python3", "check.py"], files: { "check.py": "from names import strip_prefix\n\nassert strip_prefix(\"abc_cab\") == \"cab\"\nassert strip_prefix(\"abc_x\") == \"x\"\nassert strip_prefix(\"zzz\") == \"zzz\"\n" } },
    limitations: { proves: "Only the exact prefix is removed.", does_not_prove: "Case-insensitive prefixes." },
  }),

  "py-sqlite-injection": base({
    title: "f-string SQL lets input rewrite the query: use parameter placeholders",
    problem: {
      symptom: "find(conn, \"x' OR '1'='1\") returned every user",
      description: "Interpolating user input into SQL allows injection. sqlite3 placeholders (?) pass values separately from the query.",
      tags: ["python", "sql", "sqlite", "security"],
      refs: ["https://docs.python.org/3/library/sqlite3.html#sqlite3-placeholders"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.0" } },
    before: { files: { "users.py": "def find(conn, name):\n    return conn.execute(f\"SELECT name FROM users WHERE name = '{name}'\").fetchall()\n" } },
    after: { files: { "users.py": "def find(conn, name):\n    return conn.execute(\"SELECT name FROM users WHERE name = ?\", (name,)).fetchall()\n" } },
    check: {
      run: ["python3", "check.py"],
      files: {
        "check.py": "import sqlite3\nfrom users import find\n\nconn = sqlite3.connect(\":memory:\")\nconn.execute(\"CREATE TABLE users (name TEXT)\")\nconn.executemany(\"INSERT INTO users VALUES (?)\", [(\"ann\",), (\"bob\",)])\nassert find(conn, \"ann\") == [(\"ann\",)]\nassert find(conn, \"x' OR '1'='1\") == []\nassert find(conn, \"o'brien\") == []\n",
      },
    },
    limitations: { proves: "These inputs cannot change the query.", does_not_prove: "Injection elsewhere (dynamic table/column names cannot use placeholders)." },
  }),

  "py-fromtimestamp-local-tz": base({
    title: "datetime.fromtimestamp(0) depends on the machine's time zone: pass tz=timezone.utc",
    problem: {
      symptom: "Epoch printed as 1969-12-31T21:00:00 on a server in Buenos Aires",
      description: "Without tz, fromtimestamp converts to local time. Results change with the TZ of the machine.",
      tags: ["python", "datetime", "timezone"],
      refs: ["https://docs.python.org/3/library/datetime.html#datetime.datetime.fromtimestamp"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.2" }, conditions: { TZ: "any non-UTC zone reproduces it" } },
    before: { files: { "epoch.py": "from datetime import datetime\n\n\ndef epoch_iso():\n    return datetime.fromtimestamp(0).isoformat()\n" } },
    after: { files: { "epoch.py": "from datetime import datetime, timezone\n\n\ndef epoch_iso():\n    return datetime.fromtimestamp(0, tz=timezone.utc).isoformat()\n" } },
    check: {
      run: ["python3", "check.py"],
      env: { TZ: "America/Argentina/Buenos_Aires" },
      files: { "check.py": "from epoch import epoch_iso\n\nassert epoch_iso().startswith(\"1970-01-01T00:00:00\"), epoch_iso()\n" },
    },
    limitations: { proves: "The epoch is rendered in UTC regardless of TZ.", does_not_prove: "Correct behavior for timestamps before 1970 on Windows." },
  }),

  "py-imghdr-OLD": base({
    title: "(OLD FIX) Detect PNG files regardless of extension with imghdr.what",
    problem: {
      symptom: "A PNG saved as photo.dat is not recognized as an image",
      description: "Checking file extensions misses misnamed files. This capsule records the classic stdlib answer: imghdr.",
      tags: ["python", "images", "imghdr"],
      refs: ["https://peps.python.org/pep-0594/"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.0" }, notes: "Claim as originally written; kept to show regression detection." },
    before: { files: { "detect.py": "def kind(path):\n    return \"png\" if path.endswith(\".png\") else None\n" } },
    after: { files: { "detect.py": "import imghdr\n\n\ndef kind(path):\n    return imghdr.what(path)\n" } },
    check: {
      run: ["python3", "check.py"],
      files: { "check.py": "from detect import kind\n\nwith open(\"photo.dat\", \"wb\") as f:\n    f.write(b\"\\x89PNG\\r\\n\\x1a\\n\" + b\"\\x00\" * 24)\nassert kind(\"photo.dat\") == \"png\", kind(\"photo.dat\")\n" },
    },
    limitations: { proves: "A PNG header is detected without relying on the extension.", does_not_prove: "Support in newer Pythons (imghdr was removed in 3.13 by PEP 594)." },
  }),

  "py-png-magic-bytes": base({
    title: "Detect PNG files by their magic bytes (imghdr is gone in Python 3.13)",
    problem: {
      symptom: "ModuleNotFoundError: No module named 'imghdr'",
      description: "PEP 594 removed imghdr in Python 3.13. For a single format, compare the 8-byte PNG signature; for many formats use a maintained library.",
      tags: ["python", "images", "imghdr", "removal", "migration"],
      refs: ["https://peps.python.org/pep-0594/", "https://www.w3.org/TR/png-3/#5PNG-file-signature"],
    },
    runtime: "python",
    applicability: { claims: { python: ">=3.0" } },
    before: { files: { "detect.py": "def kind(path):\n    return \"png\" if path.endswith(\".png\") else None\n" } },
    after: {
      files: { "detect.py": "PNG = b\"\\x89PNG\\r\\n\\x1a\\n\"\n\n\ndef kind(path):\n    with open(path, \"rb\") as f:\n        return \"png\" if f.read(8) == PNG else None\n" },
    },
    check: {
      run: ["python3", "check.py"],
      files: {
        "check.py": "from detect import kind\n\nwith open(\"photo.dat\", \"wb\") as f:\n    f.write(b\"\\x89PNG\\r\\n\\x1a\\n\" + b\"\\x00\" * 24)\nwith open(\"notes.png\", \"wb\") as f:\n    f.write(b\"just text\")\nassert kind(\"photo.dat\") == \"png\", kind(\"photo.dat\")\nassert kind(\"notes.png\") is None, kind(\"notes.png\")\n",
      },
    },
    limitations: { proves: "PNG content is detected by signature and a fake .png is rejected.", does_not_prove: "Detection of other formats or truncated files." },
  }),

  "bash-pipefail": base({
    title: "A failing command in a pipeline is ignored: set -eo pipefail",
    problem: {
      symptom: "The deploy script printed 'deployed' and exited 0 although a step failed",
      description: "By default a pipeline's status is the last command's. pipefail propagates failures; -e stops the script.",
      tags: ["bash", "shell", "ci"],
      refs: ["https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html"],
    },
    runtime: "bash",
    applicability: { claims: { bash: ">=3" } },
    before: { files: { "run.sh": "#!/usr/bin/env bash\nfalse | true\necho \"deployed\"\n" } },
    after: { files: { "run.sh": "#!/usr/bin/env bash\nset -eo pipefail\nfalse | true\necho \"deployed\"\n" } },
    check: {
      run: ["bash", "check.sh"],
      files: {
        "check.sh": "out=$(bash run.sh 2>&1)\ncode=$?\nif [ \"$code\" -eq 0 ]; then echo \"failure was swallowed\"; exit 1; fi\ncase \"$out\" in *deployed*) echo \"continued after failure\"; exit 1 ;; esac\nexit 0\n",
      },
    },
    limitations: { proves: "A failure inside a pipeline stops the script with a non-zero status.", does_not_prove: "Behavior of commands inside if/while conditions, where -e does not apply." },
  }),

  "bash-read-raw": base({
    title: "read mangles backslashes and leading spaces: use IFS= read -r",
    problem: {
      symptom: "C:\\Users\\fer became C:Usersfer and indentation disappeared",
      description: "Without -r, read treats backslashes as escapes; without IFS=, it trims leading and trailing whitespace.",
      tags: ["bash", "shell"],
      refs: ["https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html"],
    },
    runtime: "bash",
    applicability: { claims: { bash: ">=3" } },
    before: { files: { "paths.txt": "C:\\Users\\fer\n  indented line\n", "print.sh": "#!/usr/bin/env bash\nwhile read line; do\n  echo \"$line\"\ndone < paths.txt\n" } },
    after: { files: { "paths.txt": "C:\\Users\\fer\n  indented line\n", "print.sh": "#!/usr/bin/env bash\nwhile IFS= read -r line; do\n  echo \"$line\"\ndone < paths.txt\n" } },
    check: {
      run: ["bash", "check.sh"],
      files: { "check.sh": "if [ \"$(bash print.sh)\" != \"$(cat paths.txt)\" ]; then\n  echo \"output differs from input\"\n  exit 1\nfi\n" },
    },
    limitations: { proves: "Lines are reproduced byte for byte (for this input).", does_not_prove: "Handling of a last line without a trailing newline." },
  }),
};

/** Capsule slugs whose `supersedes` points at another slug (resolved to ids at build time). */
export const SUPERSEDES: Record<string, string[]> = {
  "node-json-import-with": ["node-json-import-assert-OLD"],
  "py-png-magic-bytes": ["py-imghdr-OLD"],
};
