"""Train the restoration-duration model.

Interval-censored log-normal accelerated failure time (AFT) model on ARCOS repair gaps.
ARCOS stores dates without clock times, so a recorded gap of d days means the true duration
lies in (d-1, d+1) days. The shipped model is conditional on a repair being closed out:
the ~3.6% of records with Repaired == "No" form a tail a single log-normal cannot fit
(including them as right-censored inflates sigma from ~1.0 to ~1.8), so they are used only
in a reported sensitivity fit and the frontend warns that the true tail is heavier.

Covariates: asset group, blocked access, special equipment needed, and daily workload
(number of damage reports opened on the same day, a proxy for crew congestion).
Only the Feb 2025 event is used: Sep 2024 gaps cluster tightly at 23-26 days, which looks
like batch close-out of records rather than real repair times (see build_report.json).

Validation: leave-one-report-day-out, scored by held-out interval log-likelihood against
an intercept-only AFT and by empirical coverage of the model's P10-P90 band.
"""
import json

import numpy as np
import pandas as pd
from scipy.stats import norm

import config as C
from aft import IntervalLogNormalAFT

GROUPS = ["Secondary wire", "Pole", "Fuse bank", "Transformer", "Other"]  # baseline: Primary wire
WL_REF = 100.0
L2 = 0.5


def design(df):
    cols = [np.ones(len(df))]
    for g in GROUPS:
        cols.append((df.asset_group == g).astype(float).values)
    cols += [df.access.values.astype(float), df.special_eq.values.astype(float),
             np.log(df.workload.values / WL_REF)]
    return np.column_stack(cols)


NAMES = ["intercept"] + [f"asset:{g}" for g in GROUPS] + ["access_blocked", "special_equipment", "ln(workload/100)"]


def coverage(model, X, lo, hi, a=0.1, b=0.9):
    """Share of records whose recorded gap (interval midpoint) falls inside the [a, b] band."""
    qa, qb = model.quantile(X, a), model.quantile(X, b)
    mid = (lo + hi) / 2
    return float(np.mean((mid >= qa) & (mid <= qb)))


CANDIDATES = {  # nested designs, columns of the full design matrix
    "null": [0],
    "asset": [0, 1, 2, 3, 4, 5],
    "asset+access": [0, 1, 2, 3, 4, 5, 6],
    "asset+workload": [0, 1, 2, 3, 4, 5, 8],
    "asset+access+workload": [0, 1, 2, 3, 4, 5, 6, 8],
    "full": list(range(9)),
}


def lodo(X, lo, hi, days):
    """Leave-one-report-day-out held-out log-likelihood and band coverage for one design."""
    ll, c80, c50, n = 0.0, 0.0, 0.0, 0
    for d in np.unique(days):
        te, tr = days == d, days != d
        if te.sum() < 5:
            continue
        m = IntervalLogNormalAFT(L2).fit(X[tr], lo[tr], hi[tr])
        ll += m.interval_loglik(X[te], lo[te], hi[te])
        k = int(te.sum())
        c80 += coverage(m, X[te], lo[te], hi[te]) * k
        c50 += coverage(m, X[te], lo[te], hi[te], .25, .75) * k
        n += k
    return ll, c80 / n, c50 / n, n


def main():
    rs = pd.read_csv(C.PROCESSED / "restoration.csv")
    rs["hi"] = rs.hi.replace([np.inf, "inf"], np.inf).astype(float)
    X_all, lo_all, hi_all = design(rs), rs.lo.values, rs.hi.values
    closed = np.isfinite(hi_all)
    X, lo, hi, days = X_all[closed], lo_all[closed], hi_all[closed], rs.report_date.values[closed]

    table = {}
    for name, cols in CANDIDATES.items():
        ll, c80, c50, n = lodo(X[:, cols], lo, hi, days)
        table[name] = {"heldout_loglik": float(ll), "coverage_p10_p90": float(c80),
                       "coverage_p25_p75": float(c50), "n_test": n}
    best = max(table, key=lambda k: table[k]["heldout_loglik"])
    for k in table:
        table[k]["gain_vs_null_per_record"] = (table[k]["heldout_loglik"] - table["null"]["heldout_loglik"]) / table[k]["n_test"]
    cols = CANDIDATES[best]

    m = IntervalLogNormalAFT(L2).fit(X[:, cols], lo, hi)
    P = len(NAMES)
    beta = np.zeros(P); beta[cols] = m.beta
    se = np.zeros(P); se[cols] = m.se[:-1]
    cov = np.zeros((P, P)); cov[np.ix_(cols, cols)] = m.cov[:-1, :-1]
    base = np.zeros(P); base[0] = 1
    full_fit = IntervalLogNormalAFT(L2).fit(X, lo, hi)  # reported for transparency (not shipped)
    sens = IntervalLogNormalAFT(L2).fit(X_all[:, cols], lo_all, hi_all)  # never-closed kept as censored
    qd = lambda q: float(np.exp(beta @ base + m.sigma * __import__("scipy.stats").stats.norm.ppf(q)))  # noqa: E731
    # Severity -> wait scaling. Expected daily workload is taken as proportional to storm severity S
    # (S = 1 is the Feb 2025 reference), so the duration multiplier is S**beta, where beta is the
    # coefficient on ln(workload) in the full-design fit. It is identified only from day-to-day
    # variation inside one event, and CV did not select it (see cv.candidates), so it is weak.
    wi = NAMES.index("ln(workload/100)")
    wl = rs.workload.values[closed].astype(float)
    w_ref = float(wl.mean())
    sev_scale = {"beta": float(full_fit.beta[wi]), "se": float(full_fit.se[:-1][wi]),
                 "w_ref": w_ref, "s_min": float(wl.min() / w_ref), "s_max": float(wl.max() / w_ref),
                 "selected_by_cv": "workload" in best,
                 "cv_gain_vs_asset_only_per_record":
                     table["asset+workload"]["gain_vs_null_per_record"] - table["asset"]["gain_vs_null_per_record"]}
    out = {
        "severity_scaling": sev_scale,
        "family": "Interval-censored log-normal AFT (conditional on repair closed out)",
        "event": C.RESTORATION_EVENT, "n": int(len(lo)), "n_never_closed_excluded": int((~closed).sum()),
        "l2": L2, "sigma": m.sigma, "converged": m.converged, "workload_ref": WL_REF,
        "workload_range": [int(rs.workload.min()), int(rs.workload.max())],
        "selected_design": best, "selected_cols": cols,
        "terms": [{"name": n_, "beta": float(b), "se": float(s), "selected": i in cols,
                   "tr": float(np.exp(b)), "tr_lo": float(np.exp(b - 1.96 * s)), "tr_hi": float(np.exp(b + 1.96 * s))}
                  for i, (n_, b, s) in enumerate(zip(NAMES, beta, se))],
        "full_design_unselected": {"beta": dict(zip(NAMES, map(float, full_fit.beta))),
                                   "se": dict(zip(NAMES, map(float, full_fit.se[:-1])))},
        "cov": cov.tolist(), "groups": GROUPS, "term_names": NAMES,
        "baseline_days": {str(q): qd(q) for q in (0.1, 0.5, 0.9)},
        "cv": {"scheme": "leave-one-report-day-out", "candidates": table, "selected": best,
               "target_coverage_p10_p90": 0.8, "target_coverage_p25_p75": 0.5},
        "sensitivity_with_censored": {"sigma": sens.sigma},
    }
    (C.ARTIFACTS / "restoration.json").write_text(json.dumps(out, indent=1))
    print("selected design:", best, " sigma=%.2f" % m.sigma, "baseline P10/P50/P90 days:", out["baseline_days"])
    for k, v in table.items():
        print(f"{k:>24s} heldout ll gain/record={v['gain_vs_null_per_record']:+.4f}  cov80={v['coverage_p10_p90']:.2f}  cov50={v['coverage_p25_p75']:.2f}")
    for t in out["terms"]:
        if t["selected"]:
            print(f"{t['name']:>20s} beta={t['beta']:+.3f} se={t['se']:.3f} time-ratio={t['tr']:.2f}")
    print("severity scaling:", {k: (round(v, 3) if isinstance(v, float) else v) for k, v in sev_scale.items()})
    print("sensitivity with never-closed as censored: sigma=%.2f" % sens.sigma)


if __name__ == "__main__":
    main()
