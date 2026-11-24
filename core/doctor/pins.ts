// What the bundled evidence is allowed to trust, pinned in SOURCE (not in the data files), so editing
// capsules/built/* cannot change what counts as verified without a reviewed code change.
// Update deliberately: after GitHub rotates keys, or when another trusted workflow is added.
import type { TrustPolicy } from "../capsule/oidc.ts";

export const EVIDENCE_TRUST_POLICY: TrustPolicy = {
  // Exact refs, not wildcards. The operator controls these branches: "verified" means this repository's
  // replay workflow ran on a GitHub-hosted runner, not that someone independent reviewed the result.
  workflows: [
    "fergc0708-alt/agent-cafe/.github/workflows/replay-matrix.yml@refs/heads/main",
    "fergc0708-alt/agent-cafe/.github/workflows/replay-matrix.yml@refs/heads/goat/evidence-network",
  ],
  repositoryIds: ["1470350421"],
  ownerIds: ["284197988"],
};

/** sha256 of the pinned GitHub Actions OIDC key set (see oidc.ts jwksDigest). */
export const GITHUB_JWKS_DIGEST = "6bea1aa7b5354881056e69427277d47eb0ab39dda589d0a544490dff1836f003";

/** Public keys allowed to sign self-reported (claimed) bundle rows. */
export const LOCAL_RUNNER_KEYS: string[] = ["86ktDtFlpNv5UBzNWl2FurLu1IC7Hy2sxhiWn+NPotg="];
