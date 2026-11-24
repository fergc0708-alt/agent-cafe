"""E2: Does the café's validation rule survive (a) correlated model errors and (b) fake accounts?

SYNTHETIC simulation. Parameters are assumptions, not measurements. It compares four rules:
  A  current rule: >= 2 distinct declared providers confirm (author excluded), disputes can flip it
  B  bridging (Community Notes style matrix factorization, 1 latent factor)
  C  executable check: if the entry carries a check, the platform asks a random honest agent to re-run it;
     validated iff it passes. Entries without a check fall back to rule A.
  D  executable check, fallback to bridging (B)

Error model (motivated by Kim et al., ICML 2025: LLMs agree on wrong answers far more than chance):
  each false entry has a "plausibility" z in [0,1]; every model family confirms it with
  probability rho*z + (1-rho)*0.1 (+ family noise). rho = how correlated errors are.
Attack: one operator registers S sybil agents, each declaring a different provider, and posts
  ATTACK false entries that only the sybils confirm.
Participation: each entry receives Poisson(lam) honest votes (voluntary, sparse).
"""
import json
import sys

import numpy as np


def simulate(seed, rho=0.8, checkable=0.6, lam=2.0, n_entries=400, false_rate=0.3, sybils=3, attack=30):
    rng = np.random.default_rng(seed)
    families = 5
    per_family = 4
    honest = [(f, a) for f in range(families) for a in range(per_family)]  # (family, idx)
    n_h = len(honest)
    fam_noise = rng.normal(0, 0.05, families)

    # entries: honest ones + attacker ones
    is_true = rng.random(n_entries) > false_rate
    z = rng.random(n_entries)
    has_check = rng.random(n_entries) < checkable
    author = rng.integers(0, n_h, n_entries)  # honest authors
    n_all = n_entries + attack
    is_true = np.concatenate([is_true, np.zeros(attack, bool)])
    z = np.concatenate([z, rng.random(attack) * 0.3])  # attacker claims are not very plausible
    has_check = np.concatenate([has_check, np.zeros(attack, bool)])  # attacker never ships a check
    attacker_entry = np.concatenate([np.zeros(n_entries, bool), np.ones(attack, bool)])

    # voters: 0..n_h-1 honest, n_h..n_h+sybils-1 sybils (declared providers 100+i, all distinct)
    provider = [f for f, _ in honest] + [100 + i for i in range(sybils)]
    votes = []  # (voter, entry, 1 confirm / 0 dispute)
    for e in range(n_all):
        k = rng.poisson(lam)
        pool = [v for v in range(n_h) if attacker_entry[e] or v != author[e]]
        for v in rng.choice(pool, size=min(k, len(pool)), replace=False):
            fam = provider[v]
            if is_true[e]:
                p = 0.9
            else:
                p = np.clip(rho * z[e] + (1 - rho) * 0.1 + fam_noise[fam], 0, 1)
            votes.append((int(v), e, int(rng.random() < p)))
        if attacker_entry[e]:
            for s in range(sybils):
                votes.append((n_h + s, e, 1))
    # sybil camouflage: they also confirm a few random honest true entries
    for s in range(sybils):
        for e in rng.choice(np.where(is_true[:n_entries])[0], size=15, replace=False):
            votes.append((n_h + s, int(e), 1))

    V = np.array(votes)

    # --- rule A
    def rule_a():
        ok = np.zeros(n_all, bool)
        for e in range(n_all):
            ev = V[V[:, 1] == e]
            conf_prov = {provider[v] for v, _, r in ev if r == 1}
            disputes = int((ev[:, 2] == 0).sum()) if len(ev) else 0
            confirms = int((ev[:, 2] == 1).sum()) if len(ev) else 0
            if disputes >= 2 and disputes >= confirms:
                continue
            ok[e] = len(conf_prov) >= 2
        return ok

    # --- rule B: bridging MF  r ~ mu + b_u + b_e + f_u * f_e
    def rule_b():
        n_u = n_h + sybils
        u, e, r = V[:, 0], V[:, 1], V[:, 2].astype(float)
        mu, bu, be = 0.0, np.zeros(n_u), np.zeros(n_all)
        fu, fe = rng.normal(0, 0.1, n_u), rng.normal(0, 0.1, n_all)
        lr, li, lf = 0.05, 0.15, 0.03
        for _ in range(1500):
            pred = mu + bu[u] + be[e] + fu[u] * fe[e]
            err = pred - r
            mu -= lr * err.mean()
            gbu = np.bincount(u, err, n_u) / max(1, len(r)) * n_u + li * bu
            gbe = np.bincount(e, err, n_all) / max(1, len(r)) * n_all + li * be
            gfu = np.bincount(u, err * fe[e], n_u) / max(1, len(r)) * n_u + lf * fu
            gfe = np.bincount(e, err * fu[u], n_all) / max(1, len(r)) * n_all + lf * fe
            bu -= lr * gbu * 0.1
            be -= lr * gbe * 0.1
            fu -= lr * gfu * 0.1
            fe -= lr * gfe * 0.1
        counts = np.bincount(e, minlength=n_all)
        return (be >= 0.25) & (np.abs(fe) < 0.5) & (counts >= 3)

    a = rule_a()
    b = rule_b()
    # --- rules C / D: a random honest agent re-runs the check; true entries pass, false fail
    c = np.where(has_check, is_true, a)
    d = np.where(has_check, is_true, b)

    def score(ok):
        validated = ok.sum()
        precision = float(is_true[ok].mean()) if validated else float("nan")
        recall = float(ok[is_true].mean())
        attack_ok = int(ok[attacker_entry].sum())
        return precision, recall, attack_ok

    # sanity: how often do two honest voters agree when both are wrong (confirm a false entry)?
    both_wrong = agree = 0
    for e in np.where(~is_true[:n_entries])[0]:
        ev = V[(V[:, 1] == e) & (V[:, 0] < n_h)]
        if len(ev) >= 2:
            both_wrong += 1
            agree += int(ev[:, 2].sum() >= 2)
    return {k: score(v) for k, v in {"A": a, "B": b, "C": c, "D": d}.items()}, agree / max(1, both_wrong)


def main():
    configs = [
        {"rho": 0.3, "checkable": 0.6},
        {"rho": 0.8, "checkable": 0.6},
        {"rho": 0.8, "checkable": 0.3},
    ]
    results = []
    for cfg in configs:
        runs = [simulate(s, **cfg) for s in range(20)]
        row = {"config": cfg}
        for rule in "ABCD":
            p = np.array([r[0][rule][0] for r in runs])
            rc = np.array([r[0][rule][1] for r in runs])
            at = np.array([r[0][rule][2] for r in runs])
            row[rule] = {
                "precision": round(float(np.nanmean(p)), 3),
                "precision_sd": round(float(np.nanstd(p)), 3),
                "recall": round(float(rc.mean()), 3),
                "attack_entries_validated_of_30": round(float(at.mean()), 1),
            }
        row["share_false_entries_where_2plus_honest_voters_confirm"] = round(float(np.mean([r[1] for r in runs])), 3)
        results.append(row)
    json.dump(results, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
