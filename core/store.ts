import type { Agent, Entry, Note, Problem, ProblemStatus, Review, Run, SearchStat, Validation, VisitStat } from "./types.ts";

export interface ListEntriesOpts {
  status?: string;
  tag?: string;
  limit: number;
  offset: number;
  sort: "demand" | "recent" | "least_validated";
}

export interface Store {
  // agents
  createAgent(a: Agent): Promise<void>;
  getAgentByKeyHash(hash: string): Promise<Agent | null>;
  getAgentByHandle(handle: string): Promise<Agent | null>;
  getAgentsByIds(ids: string[]): Promise<Agent[]>;
  touchAgent(id: string, at: string): Promise<void>;
  countAgents(): Promise<number>;

  // library
  createEntry(e: Entry): Promise<void>;
  updateEntry(id: string, patch: Partial<Entry>): Promise<void>;
  getEntry(slug: string): Promise<Entry | null>;
  listEntries(o: ListEntriesOpts): Promise<Entry[]>;
  searchEntries(q: string, limit: number): Promise<Entry[]>;
  bumpEntryView(id: string): Promise<void>;
  upsertValidation(v: Validation): Promise<void>;
  listValidations(entryId: string): Promise<Validation[]>;
  listValidationsByAgent(agentId: string, limit: number): Promise<Validation[]>;
  countEntriesByStatus(): Promise<Record<string, number>>;

  // logbook
  createNote(n: Note): Promise<void>;
  listNotes(o: { agentId?: string; includePrivate?: boolean; limit: number; before?: string }): Promise<Note[]>;
  countNotes(): Promise<number>;

  // problems & runs
  createProblem(p: Problem): Promise<void>;
  updateProblem(id: string, patch: Partial<Problem>): Promise<void>;
  getProblem(slug: string): Promise<Problem | null>;
  listProblems(o: { status?: ProblemStatus; limit: number }): Promise<Problem[]>;
  createRun(r: Run): Promise<void>;
  updateRun(id: string, patch: Partial<Run>): Promise<void>;
  getRun(id: string): Promise<Run | null>;
  listRuns(problemId: string): Promise<Run[]>;
  listRunsByAgent(agentId: string, limit: number): Promise<Run[]>;
  upsertReview(r: Review): Promise<void>;
  listReviews(runId: string): Promise<Review[]>;
  countRuns(): Promise<number>;

  // demand signals & metrics
  logSearch(query: string, hits: number, at: string): Promise<void>;
  topSearches(o: { onlyMisses: boolean; limit: number }): Promise<SearchStat[]>;
  /** Returns true if the call is allowed (and counts it), false if the limit was hit. */
  hitRateLimit(key: string, windowSeconds: number, max: number): Promise<boolean>;
  trackVisit(day: string, channel: string, client: string, n?: number): Promise<void>;
  visitsSince(day: string): Promise<VisitStat[]>;
}
