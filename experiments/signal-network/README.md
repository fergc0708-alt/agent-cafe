# Signal "network" experiment (GOAT 5): removed from the product

This directory holds the cross-repository observation network that was built and then **removed** from Signal:
- the OIDC ingestion service;
- the owner-level Bayesian engine;
- the public seed;
- the prediction benchmark.

**Why it was removed.** On 4,883 real Renovate PRs the network predicted failures worse than existing indicators
(AUC 0.614, against Mend 0.680, Dependabot 0.705 and the repository's own history 0.910). It added nothing on top of
local data, was miscalibrated and was open to Sybil attacks ([bench/RESULTS.md](bench/RESULTS.md)). Keeping it would
add attack surface without demonstrated value.

**What is kept.** The code, the data and the results stay here as research, unmaintained. Nothing in `signal/` imports
them.
