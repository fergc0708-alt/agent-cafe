// Tests of the frozen analysis on SYNTHETIC inputs (hand-written fixtures, not benchmark data).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, truth, analyze } from "./analyze.mjs";

const run = (exit, tests) => ({ exit, timed_out: false, ms: 1, json_ok: !!tests, tests: tests ?? null });
const T = (id, status, message) => ({ id, status, message });
const side = (runs, perTest = true) => ({ install_ok: true, per_test: perTest, runs });
const five = (f) => Array.from({ length: 5 }, (_, i) => f(i));

test("Clopper-Pearson matches known values", () => {
  assert.ok(Math.abs(cp(0, 200).upper95 - 0.01487) < 2e-4); // 0/200: one-sided 95% upper bound ≈ 1.5%, NOT < 1%
  assert.ok(Math.abs(cp(0, 299).upper95 - 0.00997) < 2e-4); // needs ~299 positives with 0 errors to claim < 1%
  const x = cp(5, 50); assert.ok(Math.abs(x.lo - 0.0333) < 1e-3 && Math.abs(x.hi - 0.2181) < 1e-3);
});

test("truth classes", () => {
  const pass = five(() => run(0, [T("a > x", "passed"), T("a > y", "passed")]));
  const failX = five(() => run(1, [T("a > x", "failed", "boom"), T("a > y", "passed")]));
  assert.equal(truth(side(pass), side(failX)).cls, "REG_GREEN");
  assert.equal(truth(side(pass), side(pass)).cls, "COMPATIBLE");
  const failY = five(() => run(1, [T("a > x", "passed"), T("a > y", "failed", "old")]));
  const failXY = five(() => run(1, [T("a > x", "failed", "boom"), T("a > y", "failed", "old")]));
  assert.equal(truth(side(failY), side(failXY)).cls, "REG_ON_RED");
  assert.equal(truth(side(failY), side(failY)).cls, "PRE_EXISTING");
  const failYnew = five(() => run(1, [T("a > x", "passed"), T("a > y", "failed", "new error")]));
  assert.equal(truth(side(failY), side(failYnew)).cls, "CHANGED");
  // a test failing in only some head runs, never in base: not confirmed either way
  const someX = five((i) => run(i % 2, [T("a > x", i % 2 ? "failed" : "passed", "boom"), T("a > y", "passed")]));
  assert.equal(truth(side(pass), side(someX)).cls, "INDET_FLAKY_NEW");
  // red baseline without per-test evidence: undetermined, never counted as right or wrong
  assert.equal(truth(side(five(() => run(1)), false), side(five(() => run(1)), false)).cls, "INDET_RED_NO_TESTS");
  assert.equal(truth({ install_ok: false }, side(pass)).cls, "INDET_BASE_INSTALL");
  assert.equal(truth(side(pass), { install_ok: false }).cls, "INSTALL_REG");
  assert.equal(truth(side(pass.slice(0, 2)), side(pass)).cls, "INDET_TIMEOUT");
});

test("metrics count abstentions apart from errors", () => {
  const pass = five(() => run(0, [T("a > x", "passed")]));
  const fail = five(() => run(1, [T("a > x", "failed", "e")]));
  const cases = [1, 2, 3].map((i) => ({ id: `c${i}`, repo: "o/r", number: i, bot: "renovate", stratum: "renovate:red", pm: "npm", ci_head: { state: "red" }, ci_base: { state: "green" } }));
  const results = {
    "res-ref-base-c1": side(pass), "res-ref-head-c1": side(fail), "res-signal-c1": { signal: { verdict: "regression" } },
    "res-ref-base-c2": side(pass), "res-ref-head-c2": side(fail), "res-signal-c2": { signal: { verdict: "pre_existing" } },
    "res-ref-base-c3": side(pass), "res-ref-head-c3": side(fail), "res-signal-c3": { signal: { verdict: "inconclusive" } },
  };
  const a = analyze(cases, results);
  const s = a.segments[0].signal;
  assert.equal(s.positives, 3);
  assert.equal(s.false_exoneration.k, 1);
  assert.equal(s.abstain_on_positives.k, 1);
  assert.equal(a.errors.length, 1);
});
