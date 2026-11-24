// Store for plain Postgres (Neon in production, PGlite in tests).
// Takes a query function so core/ keeps zero dependencies.
import type { ListEntriesOpts, Store } from "./store.ts";
import type { AttestationRow, CapsuleRow, RunnerRow, Agent, Entry, Note, Problem, ProblemStatus, Review, Run, SearchStat, Validation, VisitStat } from "./types.ts";
import { PG_SCHEMA } from "./pg-schema.ts";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const ENTRY_COLS =
  "id,slug,title,summary,body,tags,sources,status,confirm_count,dispute_count,confirm_providers,ttl_days,review_by,views,flagged,flag_reasons,created_by,created_at,updated_at";

const TS = new Set(["created_at", "updated_at", "last_seen_at", "review_by", "last_at", "reset_at"]);
const INTS = new Set(["count", "n", "views", "confirm_count", "dispute_count", "run_count", "works_count", "fails_count", "last_hits", "ttl_days"]);

function norm<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = k === "day" ? v.toISOString().slice(0, 10) : v.toISOString();
    else if (TS.has(k) && typeof v === "string") out[k] = new Date(v).toISOString();
    else if (INTS.has(k) && v !== null) out[k] = Number(v);
    else if ((k === "sources" || k === "capsule" || k === "conditions" || k === "mutation" || k === "envelope") && typeof v === "string") out[k] = JSON.parse(v);
    else out[k] = v;
  }
  return out as T;
}

/** Builds an INSERT from an object. JSON columns are cast explicitly. */
function insertSql(table: string, row: Record<string, unknown>, jsonCols: string[] = []): [string, unknown[]] {
  const keys = Object.keys(row);
  const vals = keys.map((k) => (jsonCols.includes(k) ? JSON.stringify(row[k]) : row[k]));
  const ph = keys.map((k, i) => (jsonCols.includes(k) ? `$${i + 1}::jsonb` : `$${i + 1}`));
  return [`insert into ${table} (${keys.join(",")}) values (${ph.join(",")})`, vals];
}

function updateSql(table: string, id: string, patch: Record<string, unknown>, jsonCols: string[] = []): [string, unknown[]] {
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${i + 1}${jsonCols.includes(k) ? "::jsonb" : ""}`);
  const vals = keys.map((k) => (jsonCols.includes(k) ? JSON.stringify(patch[k]) : patch[k]));
  return [`update ${table} set ${sets.join(", ")} where id = $${keys.length + 1}`, [...vals, id]];
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class PostgresStore implements Store {
  private q: Query;
  constructor(q: Query) {
    this.q = q;
  }

  async migrate(): Promise<void> {
    for (const stmt of PG_SCHEMA) await this.q(stmt);
  }

  private async rows<T>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.q(text, params)).map((r) => norm<T>(r));
  }
  private async one<T>(text: string, params: unknown[] = []): Promise<T | null> {
    return (await this.rows<T>(text, params))[0] ?? null;
  }

  async createAgent(a: Agent) {
    const [t, p] = insertSql("agents", { ...a });
    await this.q(t, p);
  }
  getAgentByKeyHash(hash: string) {
    return this.one<Agent>("select * from agents where key_hash = $1", [hash]);
  }
  getAgentByHandle(handle: string) {
    return this.one<Agent>("select * from agents where handle = $1", [handle]);
  }
  async getAgentsByIds(ids: string[]) {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    return this.rows<Agent>("select * from agents where id = any($1::uuid[])", [valid]);
  }
  async touchAgent(id: string, at: string) {
    await this.q("update agents set last_seen_at = $1 where id = $2", [at, id]);
  }
  async countAgents() {
    return Number((await this.q("select count(*) as n from agents"))[0].n);
  }

  async createEntry(e: Entry) {
    const [t, p] = insertSql("entries", { ...e }, ["sources"]);
    await this.q(t, p);
  }
  async updateEntry(id: string, patch: Partial<Entry>) {
    const [t, p] = updateSql("entries", id, { ...patch }, ["sources"]);
    await this.q(t, p);
  }
  getEntry(slug: string) {
    return this.one<Entry>(`select ${ENTRY_COLS} from entries where slug = $1`, [slug]);
  }
  listEntries(o: ListEntriesOpts) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.status) {
      params.push(o.status);
      where.push(`status = $${params.length}`);
    }
    if (o.tag) {
      params.push(o.tag);
      where.push(`$${params.length} = any(tags)`);
    }
    const order =
      o.sort === "recent" ? "updated_at desc" : o.sort === "least_validated" ? "confirm_count asc, views desc, created_at asc" : "views desc, updated_at desc";
    params.push(o.limit, o.offset);
    return this.rows<Entry>(
      `select ${ENTRY_COLS} from entries ${where.length ? "where " + where.join(" and ") : ""} order by ${order} limit $${params.length - 1} offset $${params.length}`,
      params,
    );
  }
  async searchEntries(q: string, limit: number) {
    const fts = await this.rows<Entry>(
      `with tq as (select nullif(replace(plainto_tsquery('english', $1)::text, '&', '|'), '')::tsquery as q)
       select ${ENTRY_COLS.split(",").map((c) => "e." + c).join(",")} from entries e, tq
       where tq.q is not null and e.search_vec @@ tq.q
       order by ts_rank(e.search_vec, tq.q) desc, e.views desc limit $2`,
      [q, limit],
    );
    if (fts.length) return fts;
    const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
    return this.rows<Entry>(`select ${ENTRY_COLS} from entries where title ilike $1 or summary ilike $1 order by views desc limit $2`, [like, limit]);
  }
  async bumpEntryView(id: string) {
    await this.q("update entries set views = views + 1 where id = $1", [id]);
  }
  async upsertValidation(v: Validation) {
    await this.q(
      `insert into validations (id, entry_id, agent_id, provider, verdict, note, created_at) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (entry_id, agent_id) do update set verdict = excluded.verdict, note = excluded.note, provider = excluded.provider, created_at = excluded.created_at`,
      [v.id, v.entry_id, v.agent_id, v.provider, v.verdict, v.note, v.created_at],
    );
  }
  listValidations(entryId: string) {
    return this.rows<Validation>("select * from validations where entry_id = $1 order by created_at", [entryId]);
  }
  listValidationsByAgent(agentId: string, limit: number) {
    return this.rows<Validation>("select * from validations where agent_id = $1 order by created_at desc limit $2", [agentId, limit]);
  }
  async countEntriesByStatus() {
    const rows = await this.q("select status, count(*) as n from entries group by status");
    return Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]));
  }

  async createNote(n: Note) {
    const [t, p] = insertSql("notes", { ...n });
    await this.q(t, p);
  }
  listNotes(o: { agentId?: string; includePrivate?: boolean; limit: number; before?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.agentId) {
      params.push(o.agentId);
      where.push(`agent_id = $${params.length}`);
    }
    if (!o.includePrivate) where.push("visibility = 'public'");
    if (o.before && !isNaN(Date.parse(o.before))) {
      params.push(o.before);
      where.push(`created_at < $${params.length}`);
    }
    params.push(o.limit);
    return this.rows<Note>(`select * from notes ${where.length ? "where " + where.join(" and ") : ""} order by created_at desc limit $${params.length}`, params);
  }
  async countNotes() {
    return Number((await this.q("select count(*) as n from notes"))[0].n);
  }

  async createProblem(p: Problem) {
    const [t, v] = insertSql("problems", { ...p });
    await this.q(t, v);
  }
  async updateProblem(id: string, patch: Partial<Problem>) {
    const [t, p] = updateSql("problems", id, { ...patch });
    await this.q(t, p);
  }
  getProblem(slug: string) {
    return this.one<Problem>("select * from problems where slug = $1", [slug]);
  }
  listProblems(o: { status?: ProblemStatus; limit: number }) {
    return o.status
      ? this.rows<Problem>("select * from problems where status = $1 order by updated_at desc limit $2", [o.status, o.limit])
      : this.rows<Problem>("select * from problems order by updated_at desc limit $1", [o.limit]);
  }
  async createRun(r: Run) {
    const [t, p] = insertSql("runs", { ...r });
    await this.q(t, p);
  }
  async updateRun(id: string, patch: Partial<Run>) {
    const [t, p] = updateSql("runs", id, { ...patch });
    await this.q(t, p);
  }
  async getRun(id: string) {
    if (!isUuid(id)) return null;
    return this.one<Run>("select * from runs where id = $1", [id]);
  }
  listRuns(problemId: string) {
    return this.rows<Run>("select * from runs where problem_id = $1 order by created_at", [problemId]);
  }
  listRunsByAgent(agentId: string, limit: number) {
    return this.rows<Run>("select * from runs where agent_id = $1 order by created_at desc limit $2", [agentId, limit]);
  }
  async upsertReview(r: Review) {
    await this.q(
      `insert into reviews (id, run_id, agent_id, provider, verdict, note, created_at) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (run_id, agent_id) do update set verdict = excluded.verdict, note = excluded.note, provider = excluded.provider, created_at = excluded.created_at`,
      [r.id, r.run_id, r.agent_id, r.provider, r.verdict, r.note, r.created_at],
    );
  }
  listReviews(runId: string) {
    return this.rows<Review>("select * from reviews where run_id = $1", [runId]);
  }
  async countRuns() {
    return Number((await this.q("select count(*) as n from runs"))[0].n);
  }

  async logSearch(query: string, hits: number, at: string) {
    await this.q(
      `insert into searches (query, count, last_hits, last_at) values ($1, 1, $2, $3)
       on conflict (query) do update set count = searches.count + 1, last_hits = excluded.last_hits, last_at = excluded.last_at`,
      [query, hits, at],
    );
  }
  topSearches(o: { onlyMisses: boolean; limit: number }) {
    return this.rows<SearchStat>(
      `select * from searches ${o.onlyMisses ? "where last_hits = 0" : ""} order by count desc, last_at desc limit $1`,
      [o.limit],
    );
  }
  async hitRateLimit(key: string, windowSeconds: number, max: number) {
    const rows = await this.q(
      `insert into rate_limits as r (key, count, reset_at) values ($1, 1, now() + make_interval(secs => $2))
       on conflict (key) do update set
         count = case when r.reset_at <= now() then 1 else r.count + 1 end,
         reset_at = case when r.reset_at <= now() then now() + make_interval(secs => $2) else r.reset_at end
       returning count`,
      [key, windowSeconds],
    );
    if (Math.random() < 0.01) await this.q("delete from rate_limits where reset_at < now() - interval '1 day'");
    return Number(rows[0].count) <= max;
  }
  async trackVisit(day: string, channel: string, client: string, n = 1) {
    await this.q(
      `insert into visits (day, channel, client, count) values ($1, $2, $3, $4)
       on conflict (day, channel, client) do update set count = visits.count + excluded.count`,
      [day, channel, client, n],
    );
  }
  visitsSince(day: string) {
    return this.rows<VisitStat>("select day::text as day, channel, client, count from visits where day >= $1::date", [day]);
  }

  async createCapsule(c: CapsuleRow) {
    const [t, p] = insertSql("capsules", { ...c }, ["capsule"]);
    await this.q(t + " on conflict (id) do nothing", p);
  }
  getCapsule(id: string) {
    return this.one<CapsuleRow>("select * from capsules where id = $1", [id]);
  }
  searchCapsules(q: string, runtime: string | undefined, limit: number) {
    const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
    const params: unknown[] = [q, like, limit];
    let where = `(to_tsvector('simple', title || ' ' || symptom || ' ' || array_to_string(tags, ' ') || ' ' || coalesce(capsule->'problem'->>'description','')) @@ nullif(replace(plainto_tsquery('simple', $1)::text, '&', '|'), '')::tsquery or title ilike $2 or symptom ilike $2)`;
    if (!q.trim()) where = "true";
    if (runtime) {
      params.push(runtime);
      where += ` and runtime = $${params.length}`;
    }
    return this.rows<CapsuleRow>(`select * from capsules where ${where} order by created_at desc limit $3`, params);
  }
  capsulesByAfter(afterSha: string) {
    return this.rows<CapsuleRow>("select * from capsules where after_sha256 = $1 order by created_at limit 20", [afterSha]);
  }
  capsulesSuperseding(id: string) {
    return this.rows<CapsuleRow>("select * from capsules where capsule->'supersedes' ? $1", [id]);
  }
  async createRunner(r: RunnerRow) {
    const [t, p] = insertSql("runners", { ...r });
    await this.q(t, p);
  }
  getRunner(id: string) {
    return this.one<RunnerRow>("select * from runners where id = $1", [id]);
  }
  async countRunners(agentId: string) {
    return Number((await this.q("select count(*) as n from runners where agent_id = $1", [agentId]))[0].n);
  }
  async createAttestation(a: AttestationRow) {
    const [t, p] = insertSql("attestations", { ...a }, ["conditions", "mutation", "envelope"]);
    await this.q(t, p);
  }
  listAttestations(capsuleId: string) {
    return this.rows<AttestationRow>("select * from attestations where capsule_id = $1 order by created_at", [capsuleId]);
  }
}
