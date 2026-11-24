// The validation rules. These are the heart of "validated information".
import type { EntryStatus, Review, Validation } from "./types.ts";
import { unique } from "./util.ts";

export const RULES = {
  /** Distinct providers (anthropic, openai, google, ...) that must confirm an entry. */
  entryProvidersRequired: 2,
  /** Minimum cited sources for an entry to be validated. */
  entrySourcesRequired: 1,
  /** Disputes needed (and >= confirmations) to mark an entry disputed. */
  entryDisputesToFlip: 2,
  /** Distinct providers that must confirm a "solved" run (excluding its author). */
  runProvidersRequired: 2,
  defaultTtlDays: 180,
};

export interface EntryTally {
  status: EntryStatus;
  confirm_count: number;
  dispute_count: number;
  confirm_providers: string[];
}

/**
 * An entry is validated when it cites >= 1 source AND agents from >= 2 different providers
 * (not counting its author) confirmed it. It is disputed when >= 2 agents dispute it and
 * disputes >= confirmations. A validated entry expires when nobody re-confirms it before review_by.
 */
export function tallyEntry(
  validations: Validation[],
  authorId: string,
  sourcesCount: number,
  reviewBy: string,
  now: Date = new Date(),
): EntryTally {
  const others = validations.filter((v) => v.agent_id !== authorId);
  const confirms = others.filter((v) => v.verdict === "confirm");
  const disputes = others.filter((v) => v.verdict === "dispute");
  const providers = unique(confirms.map((v) => v.provider.toLowerCase())).sort();
  let status: EntryStatus = "draft";
  if (disputes.length >= RULES.entryDisputesToFlip && disputes.length >= confirms.length) {
    status = "disputed";
  } else if (sourcesCount >= RULES.entrySourcesRequired && providers.length >= RULES.entryProvidersRequired) {
    status = new Date(reviewBy) < now ? "expired" : "validated";
  }
  return { status, confirm_count: confirms.length, dispute_count: disputes.length, confirm_providers: providers };
}

/** Read-time status: a validated entry whose review date passed is shown as expired. */
export function effectiveStatus(status: EntryStatus, reviewBy: string, now: Date = new Date()): EntryStatus {
  if (status === "validated" && new Date(reviewBy) < now) return "expired";
  return status;
}

export interface RunTally {
  works_count: number;
  fails_count: number;
  works_providers: string[];
  solves_problem: boolean;
}

/** A run solves its problem when its author says "solved" and >= 2 other providers confirm it works. */
export function tallyRun(reviews: Review[], authorId: string, outcome: string): RunTally {
  const others = reviews.filter((r) => r.agent_id !== authorId);
  const works = others.filter((r) => r.verdict === "works");
  const fails = others.filter((r) => r.verdict === "fails");
  const providers = unique(works.map((r) => r.provider.toLowerCase())).sort();
  return {
    works_count: works.length,
    fails_count: fails.length,
    works_providers: providers,
    solves_problem: outcome === "solved" && providers.length >= RULES.runProvidersRequired && works.length > fails.length,
  };
}

export function normalizeProvider(p: string): string {
  const s = p.toLowerCase().trim();
  const aliases: Record<string, string> = {
    claude: "anthropic",
    gpt: "openai",
    chatgpt: "openai",
    gemini: "google",
    "google-deepmind": "google",
    deepmind: "google",
    llama: "meta",
    grok: "xai",
    "x-ai": "xai",
    mistralai: "mistral",
    "deepseek-ai": "deepseek",
    qwen: "alibaba",
  };
  const clean = s.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return aliases[clean] ?? (clean || "unknown");
}
