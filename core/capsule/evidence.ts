// Turns signed replay results into an honest, scoped evidence summary.
// Principles: a PASS only means "this check went fail->pass in this environment";
// runner independence is not verifier independence; no votes anywhere.
import { satisfies, parseVersion } from "./capsule.ts";
import type { Verdict } from "./attestation.ts";

export interface AttestationRecord {
  runner_id: string;
  owner_id: string; // account that registered the runner key
  verdict: Verdict;
  env_key: string;
  runtime: string;
  version: string;
  conditions: Record<string, string>;
  mutation: { total: number; killed: number };
  created_at: string;
  /** Result came from a runner whose identity the registry verified. */
  trusted?: boolean;
  /** For verified results: who controls the runner identity (e.g. "github:<repository_owner_id>"). */
  identity_owner?: string;
}

export type EvidenceLevel = "draft" | "author_observed" | "ci_reproduced" | "runner_replayed" | "cross_runner_reproduced" | "independent_check_confirmed";

export const LEVEL_MEANING: Record<EvidenceLevel, string> = {
  draft: "Submitted, never executed by a registered runner.",
  author_observed: "The author's own runner saw the check fail without the fix and pass with it.",
  ci_reproduced: "A runner with a verified identity (e.g. a trusted GitHub Actions workflow on a GitHub-hosted runner) reproduced fail->pass. Its owner may be the author: this proves where it ran, not independence.",
  runner_replayed: "A runner owned by someone other than the author reproduced fail->pass.",
  cross_runner_reproduced: "At least two different runners reproduced fail->pass (different machines/keys; the check is still the author's).",
  independent_check_confirmed: "A second check written by a different author also goes fail->pass on the same fix.",
};

export interface EnvSummary {
  env_key: string;
  runtime: string;
  version: string;
  conditions: Record<string, string>;
  verdicts: Partial<Record<Verdict | "PASS_INSENSITIVE", number>>;
  runners: number;
  last_at: string;
  best_mutation: { total: number; killed: number } | null;
}

export interface EvidenceSummary {
  level: EvidenceLevel;
  meaning: string;
  flags: string[];
  environments: EnvSummary[];
  regressions: { from: string; to: string }[];
  contradictions: string[];
  statement: string;
}

const STALE_DAYS = 90;

/** A PASS counts only if the check caught at least half of the line-deletion mutants of the fix. */
export function sensitivePass(a: Pick<AttestationRecord, "verdict" | "mutation">): boolean {
  return a.verdict === "PASS" && a.mutation.total > 0 && a.mutation.killed > 0 && a.mutation.killed * 2 >= a.mutation.total;
}

function verGreater(a: string, b: string): boolean {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if ((x.at(i) ?? 0) !== (y.at(i) ?? 0)) return (x.at(i) ?? 0) > (y.at(i) ?? 0);
  return false;
}

function condKey(c: Record<string, string>): string {
  return Object.keys(c).sort().map((k) => `${k}=${c[k]}`).join(",");
}

export function summarize(
  atts: AttestationRecord[],
  opts: { authorOwnerId: string; claims: Record<string, string>; siblingIndependentPass?: boolean; now?: Date; lint?: string[] },
): EvidenceSummary {
  const now = opts.now ?? new Date();
  const flags: string[] = [];
  const byEnv = new Map<string, AttestationRecord[]>();
  for (const a of atts) byEnv.set(a.env_key, [...(byEnv.get(a.env_key) ?? []), a]);

  const environments: EnvSummary[] = Array.from(byEnv.entries()).map(([env_key, list]) => {
    const verdicts: EnvSummary["verdicts"] = {};
    for (const a of list) {
      const v = a.verdict === "PASS" && !sensitivePass(a) ? "PASS_INSENSITIVE" : a.verdict;
      verdicts[v] = (verdicts[v] ?? 0) + 1;
    }
    const best = list.filter(sensitivePass).sort((x, y) => y.mutation.killed / y.mutation.total - x.mutation.killed / x.mutation.total).at(0);
    return {
      env_key,
      runtime: list[0].runtime,
      version: list[0].version,
      conditions: list[0].conditions,
      verdicts,
      runners: new Set(list.map((a) => a.runner_id)).size,
      last_at: list.map((a) => a.created_at).sort().at(-1)!,
      best_mutation: best ? best.mutation : null,
    };
  });

  const passes = atts.filter(sensitivePass);
  const nonAuthorPass = passes.filter((a) => a.owner_id !== opts.authorOwnerId);
  let level: EvidenceLevel = "draft";
  if (passes.some((a) => a.owner_id === opts.authorOwnerId)) level = "author_observed";
  if (nonAuthorPass.length) level = "runner_replayed";
  if (nonAuthorPass.length && new Set(passes.map((a) => a.runner_id)).size >= 2) level = "cross_runner_reproduced";
  if (level !== "draft" && level !== "author_observed" && opts.siblingIndependentPass) level = "independent_check_confirmed";
  // A check that inspects source text or file existence can kill mutants without testing behavior
  // (Experiment B). Server-side lint caps such capsules: they never rise above runner_replayed.
  const WEAK = ["text_inspection", "existence_only", "no_failure_path", "does_not_reference_fix", "no_before_state"];
  const weak = (opts.lint ?? []).filter((c) => WEAK.includes(c));
  if (weak.length) {
    flags.push(`weak_check: static analysis of the check found ${weak.join(", ")}; level capped`);
    if (level === "cross_runner_reproduced" || level === "independent_check_confirmed") level = "runner_replayed";
  }

  if (atts.some((a) => a.verdict === "PASS" && !sensitivePass(a))) {
    flags.push("insensitive_check: a run passed but the check did not notice any mutation of the fix");
  }
  if (atts.length && !atts.some((a) => a.verdict === "PASS") && atts.every((a) => a.verdict === "PROBLEM_NOT_REPRODUCED")) {
    flags.push("never_reproduced: the problem never showed up; the check may be vacuous or the problem is gone in tested environments");
  }

  // Regressions: same runtime + conditions, a sensitive PASS at a lower version and a failure at a higher one.
  const regressions: { from: string; to: string }[] = [];
  const groups = new Map<string, AttestationRecord[]>();
  for (const a of atts) {
    const k = `${a.runtime}|${condKey(a.conditions)}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  for (const list of groups.values()) {
    const goods = list.filter(sensitivePass);
    const bads = list.filter((a) => a.verdict === "FIX_FAILS" || a.verdict === "FIX_BREAKS");
    for (const g of goods) {
      const later = bads.filter((b) => verGreater(b.version, g.version)).sort((x, y) => (verGreater(x.version, y.version) ? 1 : -1)).at(0);
      if (later && !regressions.some((r) => r.from === g.env_key && r.to === later.env_key)) {
        // keep only the highest passing version before the first failing one
        const higherGood = goods.some((g2) => verGreater(g2.version, g.version) && !verGreater(g2.version, later.version) && g2.version !== later.version);
        if (!higherGood) regressions.push({ from: g.env_key, to: later.env_key });
      }
    }
  }
  if (regressions.length) flags.push("regressed: the fix passed in an older environment and fails in a newer one");

  const contradictions: string[] = [];
  for (const a of atts) {
    if (a.verdict !== "FIX_FAILS" && a.verdict !== "FIX_BREAKS") continue;
    const range = opts.claims[a.runtime];
    if (range && satisfies(a.version, range)) contradictions.push(`${a.verdict} on ${a.env_key}, inside the claimed range ${a.runtime} ${range}`);
  }
  if (contradictions.length) flags.push("contradicted: it failed inside the environments the author claims it supports");

  const lastPass = passes.map((a) => a.created_at).sort().at(-1);
  if (lastPass && now.getTime() - new Date(lastPass).getTime() > STALE_DAYS * 86_400_000) {
    flags.push(`stale: last successful replay is older than ${STALE_DAYS} days`);
  }

  const passEnvs = environments.filter((e) => e.best_mutation);
  const failEnvs = environments.filter((e) => e.verdicts.FIX_FAILS || e.verdicts.FIX_BREAKS);
  const nrEnvs = environments.filter((e) => e.verdicts.PROBLEM_NOT_REPRODUCED && !e.best_mutation);
  const parts: string[] = [];
  if (passEnvs.length) {
    parts.push(
      `fail->pass reproduced on ${passEnvs.map((e) => `${e.env_key} (${e.best_mutation!.killed}/${e.best_mutation!.total} mutants caught)`).join("; ")}`,
    );
  } else parts.push("no fail->pass reproduction yet");
  if (failEnvs.length) parts.push(`fix does NOT work on ${failEnvs.map((e) => e.env_key).join("; ")}`);
  if (nrEnvs.length) parts.push(`problem not reproduced on ${nrEnvs.map((e) => e.env_key).join("; ")}`);
  parts.push(level === "independent_check_confirmed" ? "checked by two independent tests" : "the only check is the author's");
  return { level, meaning: LEVEL_MEANING[level], flags, environments, regressions, contradictions, statement: parts.join(". ") + "." };
}

export interface EvidenceView extends EvidenceSummary {
  /** Number of distinct VERIFIED runners behind `level`. */
  verified_runners: number;
  /** Everything signed by registered keys, verified or not. Keys are free: these are claims. */
  claimed: EvidenceSummary & { note: string };
}

/**
 * `level`/`flags` use ONLY results from runners the registry verified (red-team C1/H2: a signature
 * proves who holds a key, not that the run happened, and keys are free). Self-reported results are
 * still shown, under `claimed`, so negative data is not lost — but they never move the main level.
 */
export function evidenceView(
  atts: AttestationRecord[],
  opts: { authorOwnerId: string; claims: Record<string, string>; siblingVerifiedPass: boolean; siblingClaimedPass: boolean; lint: string[]; now?: Date },
): EvidenceView {
  const verifiedAtts = atts.filter((a) => a.trusted);
  const verified = summarize(verifiedAtts, { ...opts, siblingIndependentPass: opts.siblingVerifiedPass });
  const claimed = summarize(atts, { ...opts, siblingIndependentPass: opts.siblingClaimedPass });
  // Verified ladder: counted by identity OWNER (two jobs of the same repo owner are not independent).
  const passes = verifiedAtts.filter(sensitivePass);
  const owners = new Set(passes.map((a) => a.identity_owner ?? a.owner_id));
  let level: EvidenceLevel = passes.length === 0 ? "draft" : owners.size >= 2 ? "cross_runner_reproduced" : "ci_reproduced";
  if (level !== "draft" && opts.siblingVerifiedPass) level = "independent_check_confirmed";
  if (level !== "draft" && verified.flags.some((f) => f.startsWith("weak_check"))) level = "ci_reproduced";
  verified.level = level;
  verified.meaning = LEVEL_MEANING[level];
  if (!verifiedAtts.length) verified.statement = "No result from a verified runner yet. See `claimed` for self-reported results.";
  return {
    ...verified,
    verified_runners: new Set(verifiedAtts.map((a) => a.runner_id)).size,
    claimed: {
      ...claimed,
      meaning: "Self-reported, not verified: " + claimed.meaning,
      note: "Signed by registered keys. A signature identifies the key holder; it does not prove the run happened, and one operator can hold many keys and accounts.",
    },
  };
}
