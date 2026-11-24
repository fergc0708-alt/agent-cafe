import Link from "next/link";

/** Renders agent-written text safely: React escapes it; ``` fences become <pre>. Never rendered as HTML. */
export function AgentText({ text, label = "written by an agent" }: { text: string; label?: string }) {
  const parts = text.split(/```[^\n]*\n?/);
  return (
    <div className="agent-text">
      <div className="label">{label}</div>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <pre key={i}>
            <code>{p.replace(/\n$/, "")}</code>
          </pre>
        ) : p.trim() ? (
          <p key={i}>{p.trim()}</p>
        ) : null,
      )}
    </div>
  );
}

export function Badge({ s }: { s: string }) {
  return <span className={`badge ${s}`}>{s}</span>;
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags?.length) return null;
  return (
    <div className="tags">
      {tags.map((t) => (
        <span key={t}>#{t}</span>
      ))}
    </div>
  );
}

export function AgentLink({ a }: { a: { handle: string; provider?: string; model?: string } }) {
  return (
    <Link href={`/agents/${a.handle}`}>
      {a.handle}
      {a.provider ? <span className="meta"> · {a.provider}</span> : null}
    </Link>
  );
}

export function when(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function EntryItem({ e }: { e: any }) {
  return (
    <li>
      <h3>
        <Link href={`/library/${e.slug}`}>{e.title}</Link> <Badge s={e.status} />
      </h3>
      <div className="meta">{e.summary}</div>
      <div className="meta">
        {e.validation.confirmations} confirmations · {e.validation.disputes} disputes
        {e.validation.confirming_providers.length ? ` · ${e.validation.confirming_providers.join(", ")}` : ""} · {e.views} views
      </div>
      <Tags tags={e.tags} />
    </li>
  );
}

export function ProblemItem({ p }: { p: any }) {
  return (
    <li>
      <h3>
        <Link href={`/problems/${p.slug}`}>{p.title}</Link> <Badge s={p.status} />
      </h3>
      <div className="meta">
        {p.run_count} run{p.run_count === 1 ? "" : "s"} · opened by {p.author.handle}
      </div>
      <Tags tags={p.tags} />
    </li>
  );
}

export function NoteItem({ n }: { n: any }) {
  return (
    <li>
      <div className="meta">
        <AgentLink a={n.author} /> · {when(n.created_at)} {n.flagged ? <Badge s="flagged" /> : null}
      </div>
      <AgentText text={n.body} label="note" />
      <Tags tags={n.tags} />
    </li>
  );
}

/** JSON-LD script. Escapes "<" so agent text can never close the script tag (XSS). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
