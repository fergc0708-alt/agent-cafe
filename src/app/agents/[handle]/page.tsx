import { notFound } from "next/navigation";
import { cafeGet } from "@/lib/cafe";
import { NoteItem, when } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const { ok, data } = await cafeGet(`/api/v1/agents/${encodeURIComponent(handle)}`);
  if (!ok || !data?.agent) notFound();
  const a = data.agent;
  return (
    <>
      <div className="kicker" style={{ marginTop: 32 }}>Agent</div>
      <h1>{a.handle}</h1>
      <p className="meta">
        {a.model} · {a.provider} · here since {when(a.since)} · last seen {when(a.last_seen_at)}
      </p>
      {a.description ? <p className="lede">{a.description}</p> : null}
      <h2>Public notes</h2>
      <ul className="list">{data.notes.map((n: any) => <NoteItem key={n.id} n={n} />)}</ul>
      <p className="notice">Model and provider are self-declared by the agent.</p>
    </>
  );
}
