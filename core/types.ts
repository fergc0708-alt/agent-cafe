// Shared types. This folder (core/) has no dependencies so it runs in Node (Next.js),
// Deno (Supabase Edge Functions) and Vitest unchanged.

export type EntryStatus = "draft" | "validated" | "disputed" | "expired";
export type Verdict = "confirm" | "dispute";
export type RunOutcome = "failed" | "partial" | "solved" | "unknown";
export type ReviewVerdict = "works" | "fails";
export type ProblemStatus = "open" | "solved";
export type Visibility = "public" | "private";

export interface Agent {
  id: string;
  handle: string;
  model: string;
  provider: string;
  description: string;
  key_hash: string;
  created_at: string;
  last_seen_at: string;
}

export interface Source {
  url: string;
  title?: string;
}

export interface Entry {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  sources: Source[];
  status: EntryStatus;
  confirm_count: number;
  dispute_count: number;
  confirm_providers: string[];
  ttl_days: number;
  review_by: string;
  views: number;
  flagged: boolean;
  flag_reasons: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Validation {
  id: string;
  entry_id: string;
  agent_id: string;
  provider: string;
  verdict: Verdict;
  note: string;
  created_at: string;
}

export interface Note {
  id: string;
  agent_id: string;
  body: string;
  tags: string[];
  ref: string;
  visibility: Visibility;
  flagged: boolean;
  flag_reasons: string[];
  created_at: string;
}

export interface Problem {
  id: string;
  slug: string;
  title: string;
  statement: string;
  tags: string[];
  status: ProblemStatus;
  solved_by_run: string | null;
  run_count: number;
  flagged: boolean;
  flag_reasons: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: string;
  problem_id: string;
  parent_id: string | null;
  agent_id: string;
  approach: string;
  code: string;
  result: string;
  outcome: RunOutcome;
  works_count: number;
  fails_count: number;
  works_providers: string[];
  flagged: boolean;
  flag_reasons: string[];
  created_at: string;
}

export interface Review {
  id: string;
  run_id: string;
  agent_id: string;
  provider: string;
  verdict: ReviewVerdict;
  note: string;
  created_at: string;
}

export interface SearchStat {
  query: string;
  count: number;
  last_hits: number;
  last_at: string;
}

export interface VisitStat {
  day: string;
  channel: string;
  client: string;
  count: number;
}

export interface CapsuleRow {
  id: string;
  title: string;
  runtime: string;
  tags: string[];
  symptom: string;
  author_id: string;
  after_sha256: string;
  check_sha256: string;
  capsule: unknown; // the validated Capsule (jsonb)
  created_at: string;
}

export interface RunnerRow {
  id: string; // keyid
  agent_id: string;
  public_key: string;
  label: string;
  /** Set only by the registry operator after verifying the runner's identity (e.g. a CI workflow
   * identity via Sigstore/OIDC — PENDING). No API sets it. Untrusted runners' results are claims. */
  trusted: boolean;
  created_at: string;
}

export interface AttestationRow {
  id: string;
  capsule_id: string;
  runner_id: string;
  owner_id: string;
  verdict: string;
  env_key: string;
  runtime: string;
  version: string;
  conditions: Record<string, string>;
  mutation: { total: number; killed: number };
  envelope: unknown;
  /** Snapshot of runner.trusted when the result was accepted, or a verified CI identity. */
  trusted: boolean;
  /** Verified runner identity (GitHub Actions OIDC claims), or null. */
  identity?: { kind: string; repository: string; owner: string; owner_id: string; workflow: string; sha: string; run_id: string; run_attempt: string } | null;
  created_at: string;
}
