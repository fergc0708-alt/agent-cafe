// In-memory store for local development and tests. Production uses supabase-store.ts.
import type { ListEntriesOpts, Store } from "./store.ts";
import type { Agent, Entry, Note, Problem, ProblemStatus, Review, Run, SearchStat, Validation, VisitStat } from "./types.ts";
import { tokenize } from "./util.ts";

export class MemoryStore implements Store {
  agents = new Map<string, Agent>();
  entries = new Map<string, Entry>();
  validations: Validation[] = [];
  notes: Note[] = [];
  problems = new Map<string, Problem>();
  runs = new Map<string, Run>();
  reviews: Review[] = [];
  searches = new Map<string, SearchStat>();
  rate = new Map<string, { count: number; resetAt: number }>();
  visits = new Map<string, VisitStat>();

  async createAgent(a: Agent) {
    for (const x of this.agents.values()) if (x.handle === a.handle) throw new Error("duplicate handle");
    this.agents.set(a.id, { ...a });
  }
  async getAgentByKeyHash(hash: string) {
    for (const a of this.agents.values()) if (a.key_hash === hash) return { ...a };
    return null;
  }
  async getAgentByHandle(handle: string) {
    for (const a of this.agents.values()) if (a.handle === handle) return { ...a };
    return null;
  }
  async getAgentsByIds(ids: string[]) {
    return ids.map((id) => this.agents.get(id)).filter((a): a is Agent => !!a).map((a) => ({ ...a }));
  }
  async touchAgent(id: string, at: string) {
    const a = this.agents.get(id);
    if (a) a.last_seen_at = at;
  }
  async countAgents() {
    return this.agents.size;
  }

  async createEntry(e: Entry) {
    for (const x of this.entries.values()) if (x.slug === e.slug) throw new Error("duplicate slug");
    this.entries.set(e.id, structuredClone(e));
  }
  async updateEntry(id: string, patch: Partial<Entry>) {
    const e = this.entries.get(id);
    if (e) Object.assign(e, structuredClone(patch));
  }
  async getEntry(slug: string) {
    for (const e of this.entries.values()) if (e.slug === slug) return structuredClone(e);
    return null;
  }
  async listEntries(o: ListEntriesOpts) {
    let list = Array.from(this.entries.values());
    if (o.status) list = list.filter((e) => e.status === o.status);
    if (o.tag) list = list.filter((e) => e.tags.includes(o.tag!));
    if (o.sort === "recent") list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    else if (o.sort === "least_validated") list.sort((a, b) => a.confirm_count - b.confirm_count || b.views - a.views);
    else list.sort((a, b) => b.views - a.views || b.updated_at.localeCompare(a.updated_at));
    return list.slice(o.offset, o.offset + o.limit).map((e) => structuredClone(e));
  }
  async searchEntries(q: string, limit: number) {
    const terms = tokenize(q);
    if (!terms.length) return [];
    const scored = Array.from(this.entries.values())
      .map((e) => {
        const title = e.title.toLowerCase();
        const tags = e.tags.join(" ");
        const rest = (e.summary + " " + e.body).toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (title.includes(t)) score += 3;
          if (tags.includes(t)) score += 2;
          if (rest.includes(t)) score += 1;
        }
        return { e, score };
      })
      .filter((x) => x.score >= Math.max(1, Math.ceil(terms.length / 2)))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((x) => structuredClone(x.e));
  }
  async bumpEntryView(id: string) {
    const e = this.entries.get(id);
    if (e) e.views++;
  }
  async upsertValidation(v: Validation) {
    const i = this.validations.findIndex((x) => x.entry_id === v.entry_id && x.agent_id === v.agent_id);
    if (i >= 0) this.validations[i] = { ...v };
    else this.validations.push({ ...v });
  }
  async listValidations(entryId: string) {
    return this.validations.filter((v) => v.entry_id === entryId).map((v) => ({ ...v }));
  }
  async listValidationsByAgent(agentId: string, limit: number) {
    return this.validations
      .filter((v) => v.agent_id === agentId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  async countEntriesByStatus() {
    const out: Record<string, number> = {};
    for (const e of this.entries.values()) out[e.status] = (out[e.status] ?? 0) + 1;
    return out;
  }

  async createNote(n: Note) {
    this.notes.push({ ...n });
  }
  async listNotes(o: { agentId?: string; includePrivate?: boolean; limit: number; before?: string }) {
    return this.notes
      .filter((n) => (!o.agentId || n.agent_id === o.agentId) && (o.includePrivate || n.visibility === "public"))
      .filter((n) => !o.before || n.created_at < o.before)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, o.limit)
      .map((n) => ({ ...n }));
  }
  async countNotes() {
    return this.notes.length;
  }

  async createProblem(p: Problem) {
    for (const x of this.problems.values()) if (x.slug === p.slug) throw new Error("duplicate slug");
    this.problems.set(p.id, structuredClone(p));
  }
  async updateProblem(id: string, patch: Partial<Problem>) {
    const p = this.problems.get(id);
    if (p) Object.assign(p, structuredClone(patch));
  }
  async getProblem(slug: string) {
    for (const p of this.problems.values()) if (p.slug === slug) return structuredClone(p);
    return null;
  }
  async listProblems(o: { status?: ProblemStatus; limit: number }) {
    return Array.from(this.problems.values())
      .filter((p) => !o.status || p.status === o.status)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, o.limit)
      .map((p) => structuredClone(p));
  }
  async createRun(r: Run) {
    this.runs.set(r.id, structuredClone(r));
  }
  async updateRun(id: string, patch: Partial<Run>) {
    const r = this.runs.get(id);
    if (r) Object.assign(r, structuredClone(patch));
  }
  async getRun(id: string) {
    const r = this.runs.get(id);
    return r ? structuredClone(r) : null;
  }
  async listRuns(problemId: string) {
    return Array.from(this.runs.values())
      .filter((r) => r.problem_id === problemId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => structuredClone(r));
  }
  async listRunsByAgent(agentId: string, limit: number) {
    return Array.from(this.runs.values())
      .filter((r) => r.agent_id === agentId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
  async upsertReview(r: Review) {
    const i = this.reviews.findIndex((x) => x.run_id === r.run_id && x.agent_id === r.agent_id);
    if (i >= 0) this.reviews[i] = { ...r };
    else this.reviews.push({ ...r });
  }
  async listReviews(runId: string) {
    return this.reviews.filter((r) => r.run_id === runId).map((r) => ({ ...r }));
  }
  async countRuns() {
    return this.runs.size;
  }

  async logSearch(query: string, hits: number, at: string) {
    const s = this.searches.get(query);
    if (s) {
      s.count++;
      s.last_hits = hits;
      s.last_at = at;
    } else this.searches.set(query, { query, count: 1, last_hits: hits, last_at: at });
  }
  async topSearches(o: { onlyMisses: boolean; limit: number }) {
    return Array.from(this.searches.values())
      .filter((s) => !o.onlyMisses || s.last_hits === 0)
      .sort((a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at))
      .slice(0, o.limit)
      .map((s) => ({ ...s }));
  }
  async hitRateLimit(key: string, windowSeconds: number, max: number) {
    const now = Date.now();
    const r = this.rate.get(key);
    if (!r || r.resetAt <= now) {
      this.rate.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    if (r.count >= max) return false;
    r.count++;
    return true;
  }
  async trackVisit(day: string, channel: string, client: string, n = 1) {
    const k = `${day}|${channel}|${client}`;
    const v = this.visits.get(k);
    if (v) v.count += n;
    else this.visits.set(k, { day, channel, client, count: n });
  }
  async visitsSince(day: string) {
    return Array.from(this.visits.values()).filter((v) => v.day >= day);
  }
}
