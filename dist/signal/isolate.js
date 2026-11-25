const label = (c) => `${c.package} ${c.from ?? "∅"} → ${c.to ?? "∅"}`;
const revert = (c) => ({ ...c, from: c.to, to: c.from });
/** Packages released together (same target version and same scope or name stem: react + react-dom,
 *  @babel/core + @babel/preset-env, vitest + @vitest/coverage-v8) are one unit: they usually cannot be installed
 *  apart because of peer dependencies, and Renovate groups them for that reason. */
export function units(changes) {
    const stem = (n) => (n.startsWith("@") ? n.slice(1, n.indexOf("/")) : n.split(/[-./]/)[0]).toLowerCase();
    const groups = new Map();
    for (const c of changes) {
        const k = `${stem(c.package)}|${c.to ?? "removed"}`;
        (groups.get(k) ?? groups.set(k, []).get(k)).push(c);
    }
    return [...groups.values()];
}
export async function isolate(direct, probe, budget = 8) {
    const us = units(direct);
    const r = await isolateUnits(us, probe, budget);
    return r;
}
async function isolateUnits(unitList, probe, budget) {
    const direct = unitList; // each element is a unit of one or more packages
    const flat = (xs) => xs.flat();
    const probes = [];
    const cache = new Map();
    let exhausted = false;
    const run = async (side, applyUnits) => {
        const apply = applyUnits.flat();
        const key = side + "|" + apply.map(label).sort().join(",");
        if (cache.has(key))
            return cache.get(key); // identical configuration: never pay for it twice
        if (side === "baseline" && probes.filter((p) => p.side === "baseline").length >= budget) {
            exhausted = true;
            return "error";
        }
        const r = await probe(side, apply);
        probes.push({ side, apply: apply.map(label), outcome: r.outcome, note: r.note });
        cache.set(key, r.outcome);
        return r.outcome;
    };
    const done = (status, culprits, reason, confirmed = { sufficient: null, necessary: null }) => ({ status, culprits, probes, confirmed, reason });
    const ulabel = (u) => u.map(label).join(" + ");
    if (direct.length === 0)
        return done("not_direct", [], "the PR changes no declared dependency, only transitive ones");
    if (direct.length === 1)
        return done(direct[0].length > 1 ? "single" : "not_needed", direct[0], direct[0].length > 1 ? `${ulabel(direct[0])} are released together and updated together` : "the PR updates a single declared dependency (plus its transitive changes)");
    // 1. Do the direct updates alone reproduce it? (If not, the cause is in transitive lockfile changes.)
    const all = await run("baseline", direct);
    if (all === "error")
        return done("inconclusive", [], "the direct updates could not be applied on top of the baseline install");
    if (all === "unstable")
        return done("inconclusive", [], "runs with all direct updates disagreed (flaky)");
    if (all === "clean")
        return done("not_direct", [], "applying all direct updates to the baseline does not reproduce the failures: the cause is in transitive lockfile changes or their resolution");
    // 2. ddmin (Zeller): find a 1-minimal subset that still reproduces.
    let set = [...direct];
    let n = 2;
    const stop = (o, what) => exhausted
        ? done("inconclusive", [], `stopped at the run budget (${budget} runs) with ${set.length} candidates left: ${set.map(ulabel).join(", ")}`)
        : done("inconclusive", [], `a probe was ${o === "error" ? "not installable as requested" : "flaky"} (${what.map(ulabel).join(", ")})`);
    while (set.length >= 2) {
        const size = Math.ceil(set.length / n);
        const chunks = [];
        for (let i = 0; i < set.length; i += size)
            chunks.push(set.slice(i, i + size));
        let reduced = false;
        for (const c of chunks) {
            const o = await run("baseline", c);
            if (o === "error" || o === "unstable")
                return stop(o, c);
            if (o === "new_failures") {
                set = c;
                n = 2;
                reduced = true;
                break;
            }
        }
        if (!reduced && n > 2) { // for n = 2 the complements are the subsets themselves
            for (const c of chunks) {
                const complement = set.filter((x) => !c.includes(x));
                if (!complement.length)
                    continue;
                const o = await run("baseline", complement);
                if (o === "error" || o === "unstable")
                    return stop(o, complement);
                if (o === "new_failures") {
                    set = complement;
                    n = Math.max(n - 1, 2);
                    reduced = true;
                    break;
                }
            }
        }
        if (!reduced) {
            if (n >= set.length)
                break; // 1-minimal: no single element can be removed
            n = Math.min(set.length, n * 2);
        }
    }
    // 3. Confirm both ways (the confirmation run is not counted against the search budget).
    const necessary = await run("update", flat(set).map(revert));
    const isNecessary = necessary === "clean";
    const sufficient = true; // `set` reproduced on top of the baseline in step 1/2
    const names = set.map(ulabel).join(" and ");
    if (necessary === "error" || necessary === "unstable")
        return done("inconclusive", [], `could not confirm: reverting ${names} on the update ${necessary === "error" ? "did not install" : "was flaky"}`, { sufficient, necessary: null });
    if (!isNecessary)
        return done("inconclusive", flat(set), `${names} reproduces the failures on the baseline, but reverting ${set.length > 1 || set[0].length > 1 ? "them" : "it"} on the update does not remove them: other changes contribute`, { sufficient, necessary: false });
    if (set.length === 1)
        return done("single", set[0], `${names} alone reproduce${set[0].length > 1 ? "" : "s"} the failures, and reverting ${set[0].length > 1 ? "them" : "it"} alone removes them${set[0].length > 1 ? " (released together, treated as one update)" : ""}`, { sufficient, necessary: true });
    return done("interaction", flat(set), `the failures need ${names} together; none of them alone reproduces them`, { sufficient, necessary: true });
}
