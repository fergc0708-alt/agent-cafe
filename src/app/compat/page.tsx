import Link from "next/link";
import { cell, ENTRIES, EVIDENCE_META, isUpgradeBreak, versionColumns } from "@/lib/compat";
import type { Status } from "@core/doctor/match.ts";

export const metadata = { title: "Compatibility matrix", description: "Known Node.js and Python breaking changes, with the versions where they were executed: breaks, not affected, fix fails." };

const SYM: Record<Status, [string, string]> = {
  affected_fix_works: ["✖", "breaks here; the fix works here"],
  affected_fix_fails: ["!", "breaks here and this fix fails here"],
  fix_breaks: ["!", "the old code works here but this fix breaks it"],
  not_affected: ["✓", "not affected (old code works)"],
  conflicting: ["≠", "results disagree in similar environments"],
  untested: ["·", "not tested"],
  no_evidence: ["·", "no evidence"],
};

export default async function Compat({ searchParams }: { searchParams: Promise<{ runtime?: string; all?: string }> }) {
  const sp = await searchParams;
  const runtimes = ["python", "node"];
  const showAll = sp.all === "1";
  return (
    <>
      <div className="kicker">Executed evidence</div>
      <h1>Compatibility matrix</h1>
      <p className="lede">Each row is a known break with a fix and a check. Each cell is what happened when that check ran on that runtime version.</p>
      <p className="meta legend">
        {(["affected_fix_works", "fix_breaks", "not_affected", "conflicting", "untested"] as Status[]).map((s) => (
          <span key={s} className={`cell s-${s}`} style={{ marginRight: 14 }}>
            {SYM[s][0]} <span className="meta">{SYM[s][1]}</span>
          </span>
        ))}
        <span className="meta">Bold cells include a result from GitHub-hosted CI with a verified identity; faint cells are self-reported only.</span>
      </p>
      <p className="filters">
        <Link href="/compat" className={showAll ? "" : "on"}>Version-scoped breaks</Link>
        <Link href="/compat?all=1" className={showAll ? "on" : ""}>All capsules (incl. code bugs)</Link>
      </p>
      {runtimes.map((rt) => {
        const cols = versionColumns(rt);
        const rows = ENTRIES.filter((e) => e.capsule.runtime === rt && (showAll || isUpgradeBreak(e)));
        if (!rows.length) return null;
        return (
          <section key={rt}>
            <h2>{rt === "node" ? "Node.js" : "Python"}</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="matrix">
                <thead>
                  <tr>
                    <th>Problem</th>
                    {cols.map((c) => (
                      <th key={c} className="num">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.slug}>
                      <td>
                        <Link href={`/compat/${e.slug}`}>{e.capsule.title}</Link>
                        {e.superseded_by.length ? <span className="badge disputed" style={{ marginLeft: 6 }}>superseded</span> : null}
                      </td>
                      {cols.map((c) => {
                        const x = cell(e, rt, c);
                        return (
                          <td key={c} className={`cell s-${x.status} ${x.trust === "verified" ? "verified" : "claimed"}`} title={`${rt} ${c}: ${SYM[x.status][1]}${x.trust ? ` (${x.trust})` : ""}`}>
                            {SYM[x.status][0]}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="notice">
        {EVIDENCE_META.verified} verified CI results from {EVIDENCE_META.jobs} GitHub Actions jobs
        {EVIDENCE_META.run ? ` (${EVIDENCE_META.run.repository}@${EVIDENCE_META.run.sha.slice(0, 7)}, run ${EVIDENCE_META.run.run_id})` : ""} and {EVIDENCE_META.claimed} self-reported results, built{" "}
        {EVIDENCE_META.generated_at.slice(0, 10)}. {EVIDENCE_META.note} Conditions such as time zone or site-packages are shown on each capsule&apos;s page; this table shows default environments only.
      </p>
    </>
  );
}
