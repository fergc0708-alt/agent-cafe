// Experiment B — anti-vacuity and abuse. Each case is an adversarial variant of a real capsule
// (py-mutable-default). For each we record what the system does: validator rejection, lint
// warnings, replay verdict, mutation score and whether it would count as evidence (sensitivePass).
// Real executions on this machine.  node experiments/v2/run-b.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { replay } from "../../cli/runner.ts";
import { validateCapsule, type Capsule } from "../../core/capsule/capsule.ts";
import { lintCapsule } from "../../core/capsule/lint.ts";
import { sensitivePass } from "../../core/capsule/evidence.ts";

const base = JSON.parse(readFileSync(new URL("../../capsules/built/py-mutable-default.json", import.meta.url), "utf8")) as Capsule;
const withCheck = (src: string, extra: Partial<Capsule> = {}): Capsule => ({ ...base, ...extra, check: { ...base.check, files: { "check.py": src } } });
const ESCAPE = "/tmp/agent-cafe-escape-marker";
rmSync(ESCAPE, { force: true });
process.env.FAKE_SECRET_TOKEN = "sk-live-THIS-MUST-NOT-LEAK";

const OVERFIT_AFTER = "def add(item, bucket=None):\n    if bucket == [0]:\n        return [0, 3]\n    return [item]\n";
const cases: { name: string; expectation: string; capsule: unknown }[] = [
  { name: "control: real capsule", expectation: "PASS, sensitive", capsule: base },
  { name: "always-pass check (print ok)", expectation: "not evidence", capsule: withCheck("print('ok')\n") },
  { name: "always-pass, forged success markers", expectation: "not evidence (stdout is never parsed)", capsule: withCheck("print('5 passed, 0 failed')\nprint('PASS')\n") },
  { name: "always-fail check", expectation: "FIX_FAILS", capsule: withCheck("import bag\nraise SystemExit(1)\n") },
  { name: "import-only check", expectation: "not evidence", capsule: withCheck("import bag\n") },
  { name: "existence-only check", expectation: "lint + not evidence", capsule: withCheck("import os\nassert os.path.exists('bag.py')\n") },
  { name: "text/grep check on the fix", expectation: "lint text_inspection; may still kill mutants (partial)", capsule: withCheck("src = open('bag.py').read()\nassert 'is None' in src\n") },
  { name: "check swallows all errors", expectation: "not evidence", capsule: withCheck("try:\n    from bag import add\n    assert add(1) == [1]\n    assert add(2) == [2]\nexcept Exception:\n    pass\n") },
  { name: "hijack: conftest.py", expectation: "rejected by validator", capsule: { ...base, check: { ...base.check, files: { ...base.check.files, "conftest.py": "import os; os._exit(0)\n" } } } },
  { name: "hijack: sitecustomize.py in after", expectation: "rejected by validator", capsule: { ...base, after: { files: { ...base.after.files, "sitecustomize.py": "import os; os._exit(0)\n" } } } },
  { name: "hijack: .pth file", expectation: "rejected by validator", capsule: { ...base, after: { files: { ...base.after.files, "x.pth": "import os\n" } } } },
  { name: "hijack: inline python -c", expectation: "rejected by validator", capsule: { ...base, check: { ...base.check, run: ["python3", "-c", "pass"] } } },
  { name: "hijack: PYTHONPATH env", expectation: "rejected by validator", capsule: { ...base, check: { ...base.check, env: { PYTHONPATH: "/tmp" } } } },
  { name: "check needs network", expectation: "ERROR/FIX_FAILS offline, never PASS", capsule: withCheck("import urllib.request\nfrom bag import add\nurllib.request.urlopen('https://example.com', timeout=3)\nassert add(1) == [1]\nassert add(2) == [2]\n") },
  { name: "check tries to read host secrets", expectation: "secret absent from env", capsule: withCheck("import os\nfrom bag import add\nassert 'FAKE_SECRET_TOKEN' not in os.environ, 'LEAK'\nassert add(1) == [1]\nassert add(2) == [2]\n") },
  { name: "check writes outside its dir", expectation: "SUCCEEDS: runner is not a sandbox", capsule: withCheck(`from bag import add\nopen('${ESCAPE}', 'w').write('x')\nassert add(1) == [1]\nassert add(2) == [2]\n`) },
  { name: "infinite loop", expectation: "ERROR (timeout)", capsule: { ...withCheck("import bag\nwhile True: pass\n"), check: { ...base.check, files: { "check.py": "import bag\nwhile True: pass\n" }, timeout_ms: 1500 } } },
  { name: "overfitted fix vs its own check", expectation: "PASS — NOT detectable by one check", capsule: { ...base, after: { files: { "bag.py": OVERFIT_AFTER } } } },
  { name: "overfitted fix vs independent check", expectation: "FIX_FAILS — needs a 2nd check", capsule: { ...base, after: { files: { "bag.py": OVERFIT_AFTER } }, check: { ...base.check, files: { "check.py": "from bag import add\nb = [7]\nassert add(8, b) == [7, 8]\nassert add(9) == [9]\nassert add(10) == [10]\n" } } } },
];

const rows = [];
for (const t of cases) {
  const v = validateCapsule(t.capsule);
  if (!v.ok) {
    rows.push({ case: t.name, expectation: t.expectation, valid: false, errors: v.errors.slice(0, 2), lint: [], verdict: "-", mutants: "-", counts_as_evidence: false });
    continue;
  }
  const c = v.capsule!;
  const r = await replay(c, { bins: { python3: "/usr/bin/python3.12" }, maxMutants: 6 });
  const p = r.predicate;
  rows.push({
    case: t.name, expectation: t.expectation, valid: true, errors: [], lint: lintCapsule(c).map((f) => f.code),
    verdict: p.verdict, mutants: `${p.mutation.killed}/${p.mutation.total}`,
    counts_as_evidence: sensitivePass({ verdict: p.verdict, mutation: p.mutation } as any),
  });
}
const escaped = existsSync(ESCAPE);
rmSync(ESCAPE, { force: true });
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/B-adversarial.json", import.meta.url), JSON.stringify({ escaped_write_outside_dir: escaped, rows }, null, 2) + "\n");
for (const r of rows) console.log(`${r.case.padEnd(42)} valid=${r.valid ? "y" : "N"} verdict=${String(r.verdict).padEnd(22)} mut=${String(r.mutants).padEnd(4)} evidence=${r.counts_as_evidence ? "YES" : "no"} lint=${r.lint.join(",")}${r.errors.length ? " err=" + r.errors[0] : ""}`);
console.log("write outside dir succeeded:", escaped);
