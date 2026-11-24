// Production store. Runs ONLY inside the Supabase Edge Function with the service role key,
// which Supabase injects there. The client is passed in so core/ stays dependency-free.
import type { ListEntriesOpts, Store } from "./store.ts";
import type { Agent, Entry, Note, Problem, ProblemStatus, Review, Run, SearchStat, Validation, VisitStat } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const ENTRY_COLS =
  "id,slug,title,summary,body,tags,sources,status,confirm_count,dispute_count,confirm_providers,ttl_days,review_by,views,flagged,flag_reasons,created_by,created_at,updated_at";

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error("db: " + res.error.message);
  return res.data;
}

export class SupabaseStore implements Store {
  constructor(private db: Client) {}

  async createAgent(a: Agent) {
    check(await this.db.from("agents").insert(a));
  }
  async getAgentByKeyHash(hash: string) {
    return check(await this.db.from("agents").select("*").eq("key_hash", hash).maybeSingle()) as Agent | null;
  }
  async getAgentByHandle(handle: string) {
    return check(await this.db.from("agents").select("*").eq("handle", handle).maybeSingle()) as Agent | null;
  }
  async getAgentsByIds(ids: string[]) {
    if (!ids.length) return [];
    return check(await this.db.from("agents").select("*").in("id", ids)) as Agent[];
  }
  async touchAgent(id: string, at: string) {
    check(await this.db.from("agents").update({ last_seen_at: at }).eq("id", id));
  }
  async countAgents() {
    const res = await this.db.from("agents").select("id", { count: "exact", head: true });
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  async createEntry(e: Entry) {
    check(await this.db.from("entries").insert(e));
  }
  async updateEntry(id: string, patch: Partial<Entry>) {
    check(await this.db.from("entries").update(patch).eq("id", id));
  }
  async getEntry(slug: string) {
    return check(await this.db.from("entries").select(ENTRY_COLS).eq("slug", slug).maybeSingle()) as Entry | null;
  }
  async listEntries(o: ListEntriesOpts) {
    let q = this.db.from("entries").select(ENTRY_COLS);
    if (o.status) q = q.eq("status", o.status);
    if (o.tag) q = q.contains("tags", [o.tag]);
    if (o.sort === "recent") q = q.order("updated_at", { ascending: false });
    else if (o.sort === "least_validated") q = q.order("confirm_count", { ascending: true }).order("views", { ascending: false });
    else q = q.order("views", { ascending: false }).order("updated_at", { ascending: false });
    return check(await q.range(o.offset, o.offset + o.limit - 1)) as Entry[];
  }
  async searchEntries(q: string, limit: number) {
    const rows = check(await this.db.rpc("search_entries", { q, lim: limit })) as (Entry & { search_vec?: unknown })[];
    return rows.map(({ search_vec: _s, ...e }) => e as Entry);
  }
  async bumpEntryView(id: string) {
    check(await this.db.rpc("bump_entry_view", { p_id: id }));
  }
  async upsertValidation(v: Validation) {
    check(await this.db.from("validations").upsert(v, { onConflict: "entry_id,agent_id" }));
  }
  async listValidations(entryId: string) {
    return check(await this.db.from("validations").select("*").eq("entry_id", entryId)) as Validation[];
  }
  async listValidationsByAgent(agentId: string, limit: number) {
    return check(
      await this.db.from("validations").select("*").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(limit),
    ) as Validation[];
  }
  async countEntriesByStatus() {
    const rows = check(await this.db.rpc("entry_status_counts")) as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  async createNote(n: Note) {
    check(await this.db.from("notes").insert(n));
  }
  async listNotes(o: { agentId?: string; includePrivate?: boolean; limit: number; before?: string }) {
    let q = this.db.from("notes").select("*");
    if (o.agentId) q = q.eq("agent_id", o.agentId);
    if (!o.includePrivate) q = q.eq("visibility", "public");
    if (o.before) q = q.lt("created_at", o.before);
    return check(await q.order("created_at", { ascending: false }).limit(o.limit)) as Note[];
  }
  async countNotes() {
    const res = await this.db.from("notes").select("id", { count: "exact", head: true });
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  async createProblem(p: Problem) {
    check(await this.db.from("problems").insert(p));
  }
  async updateProblem(id: string, patch: Partial<Problem>) {
    check(await this.db.from("problems").update(patch).eq("id", id));
  }
  async getProblem(slug: string) {
    return check(await this.db.from("problems").select("*").eq("slug", slug).maybeSingle()) as Problem | null;
  }
  async listProblems(o: { status?: ProblemStatus; limit: number }) {
    let q = this.db.from("problems").select("*");
    if (o.status) q = q.eq("status", o.status);
    return check(await q.order("updated_at", { ascending: false }).limit(o.limit)) as Problem[];
  }
  async createRun(r: Run) {
    check(await this.db.from("runs").insert(r));
  }
  async updateRun(id: string, patch: Partial<Run>) {
    check(await this.db.from("runs").update(patch).eq("id", id));
  }
  async getRun(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return check(await this.db.from("runs").select("*").eq("id", id).maybeSingle()) as Run | null;
  }
  async listRuns(problemId: string) {
    return check(await this.db.from("runs").select("*").eq("problem_id", problemId).order("created_at")) as Run[];
  }
  async listRunsByAgent(agentId: string, limit: number) {
    return check(
      await this.db.from("runs").select("*").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(limit),
    ) as Run[];
  }
  async upsertReview(r: Review) {
    check(await this.db.from("reviews").upsert(r, { onConflict: "run_id,agent_id" }));
  }
  async listReviews(runId: string) {
    return check(await this.db.from("reviews").select("*").eq("run_id", runId)) as Review[];
  }
  async countRuns() {
    const res = await this.db.from("runs").select("id", { count: "exact", head: true });
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  async logSearch(query: string, hits: number) {
    check(await this.db.rpc("log_search", { p_query: query, p_hits: hits }));
  }
  async topSearches(o: { onlyMisses: boolean; limit: number }) {
    let q = this.db.from("searches").select("*");
    if (o.onlyMisses) q = q.eq("last_hits", 0);
    return check(await q.order("count", { ascending: false }).order("last_at", { ascending: false }).limit(o.limit)) as SearchStat[];
  }
  async hitRateLimit(key: string, windowSeconds: number, max: number) {
    return check(await this.db.rpc("hit_rate_limit", { p_key: key, p_window: windowSeconds, p_max: max })) as boolean;
  }
  async trackVisit(day: string, channel: string, client: string) {
    check(await this.db.rpc("track_visit", { p_day: day, p_channel: channel, p_client: client }));
  }
  async visitsSince(day: string) {
    return check(await this.db.from("visits").select("*").gte("day", day)) as VisitStat[];
  }
}
