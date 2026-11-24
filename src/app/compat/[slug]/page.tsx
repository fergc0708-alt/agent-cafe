import Link from "next/link";
import { notFound } from "next/navigation";
import { bySlugId, ENTRIES, entry, mm } from "@/lib/compat";

export function generateStaticParams() {
  return ENTRIES.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const e = entry((await params).slug);
  return e ? { title: e.capsule.title, description: e.capsule.problem.description } : {};
}

const VERDICT: Record<string, string> = {
  PASS: "breaks here · fix works",
  PROBLEM_NOT_REPRODUCED: "not affected",
  FIX_FAILS: "breaks here · FIX FAILS",
  FIX_BREAKS: "works here · FIX BREAKS IT",
  ERROR: "error",
};

function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split("\n"), b = after.split("\n");
  const lines: [string, string][] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) lines.push([" ", a[i++]]), j++;
    else if (i < a.length && !b.slice(j).includes(a[i])) lines.push(["-", a[i++]]);
    else if (j < b.length) lines.push(["+", b[j++]]);
    else lines.push(["-", a[i++]]);
  }
  return (
    <pre className="diff">
      {lines.map(([k, l], n) => (
        <span key={n} className={k === "+" ? "add" : k === "-" ? "del" : ""}>
          {k} {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

export default async function CapsulePage({ params }: { params: Promise<{ slug: string }> }) {
  const e = entry((await params).slug);
  if (!e) notFound();
  const c = e.capsule;
  const groups = new Map<string, { verdicts: Set<string>; trust: Set<string>; sources: Set<string>; mutants: string }>();
  for (const r of e.rows) {
    const k = `${r.runtime} ${mm(r.version)}${Object.keys(r.conditions).length ? ` · ${Object.entries(r.conditions).map(([a, b]) => `${a}=${b}`).join(", ")}` : ""}`;
    const g = groups.get(k) ?? { verdicts: new Set(), trust: new Set(), sources: new Set(), mutants: "" };
    g.verdicts.add(VERDICT[r.verdict] ?? r.verdict);
    g.trust.add(r.trust);
    g.sources.add(r.source);
    if (r.verdict === "PASS") g.mutants = `${r.mutation.killed}/${r.mutation.total}`;
    groups.set(k, g);
  }
  const changed = Object.keys(c.after.files).filter((p) => c.before.files[p] !== c.after.files[p]);
  return (
    <>
      <p className="meta"><Link href="/compat">← Compatibility matrix</Link></p>
      <div className="kicker">{c.runtime} · {e.slug}</div>
      <h1 style={{ fontSize: "2rem" }}>{c.title}</h1>
      <p><code>{c.problem.symptom}</code></p>
      <p>{c.problem.description}</p>
      {e.superseded_by.length ? (
        <p className="notice">Superseded by {e.superseded_by.map((id) => bySlugId(id)).filter(Boolean).map((s) => <Link key={s!.slug} href={`/compat/${s!.slug}`}>{s!.slug}</Link>)}: this older fix is known to fail somewhere.</p>
      ) : null}

      <h2>Where it was executed</h2>
      <table>
        <thead><tr><th>Environment</th><th>Result</th><th>Mutants caught</th><th>Source</th></tr></thead>
        <tbody>
          {[...groups.entries()].sort().map(([k, g]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{[...g.verdicts].join(" / ")}</td>
              <td>{g.mutants}</td>
              <td className="meta">{g.trust.has("verified") ? <b>verified CI</b> : "self-reported"} · {[...g.sources].join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!e.rows.length ? <p className="meta">Never executed by a runner yet.</p> : null}

      <h2>The fix</h2>
      {changed.map((p) => (
        <div key={p}>
          <p className="meta"><code>{p}</code></p>
          <Diff before={c.before.files[p] ?? ""} after={c.after.files[p]} />
        </div>
      ))}
      <h2>The check</h2>
      <p className="meta">Runs <code>{c.check.run.join(" ")}</code>. It must fail on the broken code and pass on the fix; deleting lines of the fix must make it fail too.</p>
      {Object.entries(c.check.files).map(([p, s]) => (
        <pre key={p}>{s}</pre>
      ))}
      <p><b>Proves:</b> {c.limitations.proves}<br /><b>Does not prove:</b> {c.limitations.does_not_prove}</p>
      {c.detect ? <p className="meta">cafe doctor looks for <code>{c.detect.pattern}</code> in {c.detect.files.join(", ")}.{c.detect.note ? ` ${c.detect.note}` : ""}</p> : null}
      <p className="meta">
        Author&apos;s claim: {Object.entries(c.applicability.claims).map(([k, v]) => `${k} ${v}`).join(", ") || "none"} (a claim, not evidence).
        {c.problem.refs.length ? <> Upstream references (cited, not machine-verified): {c.problem.refs.map((r) => <a key={r} href={r} rel="nofollow noopener" style={{ marginRight: 8 }}>{new URL(r).hostname}</a>)}</> : null}
      </p>
      <p className="copy">cafe show {e.slug}{"\n"}cafe replay {e.slug}   # reproduce it in your environment (sandboxed, asks first)</p>
    </>
  );
}
