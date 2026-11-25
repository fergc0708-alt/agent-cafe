// Which update in a grouped PR is responsible? Delta debugging (ddmin) over the DIRECT dependency changes, applied
// on top of a fresh baseline install, then a two-way confirmation:
//   sufficiency: baseline + {culprits} reproduces the new failures
//   necessity:   update with {culprits} reverted no longer has them
// Anything weaker is reported as weaker: "interaction between A and B", "not explained by the direct updates", or
// "could not isolate (budget / install did not apply / inconsistent runs)". Never an individual blame without both.
import type { Change } from "./protocol.ts";

export type ProbeOutcome = "new_failures" | "clean" | "unstable" | "error";

/** Runs the tests with `apply` changes on top of a base side ("baseline" or "update") and says whether the
 *  failures introduced by the update are present. Implementations must verify the requested versions installed. */
export type Probe = (side: "baseline" | "update", apply: Change[]) => Promise<{ outcome: ProbeOutcome; note?: string }>;

export interface Isolation {
  status: "single" | "interaction" | "not_direct" | "inconclusive" | "not_needed";
  culprits: Change[];
  probes: { side: "baseline" | "update"; apply: string[]; outcome: ProbeOutcome; note?: string }[];
  confirmed: { sufficient: boolean | null; necessary: boolean | null };
  reason: string;
}

const label = (c: Change) => `${c.package} ${c.from ?? "∅"} → ${c.to ?? "∅"}`;
const revert = (c: Change): Change => ({ ...c, from: c.to, to: c.from });

export async function isolate(direct: Change[], probe: Probe, budget = 8): Promise<Isolation> {
  const probes: Isolation["probes"] = [];
  const cache = new Map<string, ProbeOutcome>();
  let exhausted = false;
  const run = async (side: "baseline" | "update", apply: Change[]) => {
    const key = side + "|" + apply.map(label).sort().join(",");
    if (cache.has(key)) return cache.get(key)!; // identical configuration: never pay for it twice
    if (side === "baseline" && probes.filter((p) => p.side === "baseline").length >= budget) { exhausted = true; return "error" as ProbeOutcome; }
    const r = await probe(side, apply);
    probes.push({ side, apply: apply.map(label), outcome: r.outcome, note: r.note });
    cache.set(key, r.outcome);
    return r.outcome;
  };
  const done = (status: Isolation["status"], culprits: Change[], reason: string, confirmed: Isolation["confirmed"] = { sufficient: null, necessary: null }): Isolation => ({ status, culprits, probes, confirmed, reason });

  if (direct.length === 0) return done("not_direct", [], "the PR changes no declared dependency, only transitive ones");
  if (direct.length === 1) return done("not_needed", direct, "the PR updates a single declared dependency (plus its transitive changes)");

  // 1. Do the direct updates alone reproduce it? (If not, the cause is in transitive lockfile changes.)
  const all = await run("baseline", direct);
  if (all === "error") return done("inconclusive", [], "the direct updates could not be applied on top of the baseline install");
  if (all === "unstable") return done("inconclusive", [], "runs with all direct updates disagreed (flaky)");
  if (all === "clean") return done("not_direct", [], "applying all direct updates to the baseline does not reproduce the failures: the cause is in transitive lockfile changes or their resolution");

  // 2. ddmin (Zeller): find a 1-minimal subset that still reproduces.
  let set = [...direct];
  let n = 2;
  const stop = (o: ProbeOutcome, what: Change[]) =>
    exhausted
      ? done("inconclusive", [], `stopped at the run budget (${budget} runs) with ${set.length} candidates left: ${set.map(label).join(", ")}`)
      : done("inconclusive", [], `a probe was ${o === "error" ? "not installable as requested" : "flaky"} (${what.map(label).join(", ")})`);
  while (set.length >= 2) {
    const size = Math.ceil(set.length / n);
    const chunks: Change[][] = [];
    for (let i = 0; i < set.length; i += size) chunks.push(set.slice(i, i + size));
    let reduced = false;
    for (const c of chunks) {
      const o = await run("baseline", c);
      if (o === "error" || o === "unstable") return stop(o, c);
      if (o === "new_failures") { set = c; n = 2; reduced = true; break; }
    }
    if (!reduced && n > 2) { // for n = 2 the complements are the subsets themselves
      for (const c of chunks) {
        const complement = set.filter((x) => !c.includes(x));
        if (!complement.length) continue;
        const o = await run("baseline", complement);
        if (o === "error" || o === "unstable") return stop(o, complement);
        if (o === "new_failures") { set = complement; n = Math.max(n - 1, 2); reduced = true; break; }
      }
    }
    if (!reduced) {
      if (n >= set.length) break; // 1-minimal: no single element can be removed
      n = Math.min(set.length, n * 2);
    }
  }

  // 3. Confirm both ways (the confirmation run is not counted against the search budget).
  const necessary = await run("update", set.map(revert));
  const isNecessary = necessary === "clean";
  const sufficient = true; // `set` reproduced on top of the baseline in step 1/2
  if (necessary === "error" || necessary === "unstable") return done("inconclusive", [], `could not confirm: reverting ${set.map(label).join(", ")} on the update ${necessary === "error" ? "did not install" : "was flaky"}`, { sufficient, necessary: null });
  if (!isNecessary) return done("inconclusive", set, `${set.map(label).join(" + ")} reproduces the failures on the baseline, but reverting ${set.length > 1 ? "them" : "it"} on the update does not remove them: other changes contribute`, { sufficient, necessary: false });
  if (set.length === 1) return done("single", set, `${label(set[0])} alone reproduces the failures, and reverting it alone removes them`, { sufficient, necessary: true });
  return done("interaction", set, `the failures need ${set.map(label).join(" and ")} together; none of them alone reproduces them`, { sufficient, necessary: true });
}
