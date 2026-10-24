"""Storm-severity model: how daily weather drives territory-wide damage.

If data/raw/weather_daily.csv exists (see weather.py), fit a daily negative binomial GLM
    damage_reports_per_day ~ ln(gust) + rain + snow + 3-day antecedent rain + leaf-on
validated with blocked CV by calendar month. Severity S for any weather is then
    S = exp( sum_k coef_k * (x_k - x_k_ref) )   with the Feb 2025 reference day, so S = 1 there.

If no weather file exists, the severity block is an explicit PRIOR (engineering assumptions,
not learned) and says so. The frontend shows which case it is.
"""
import json

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import config as C
from nbglm import NBGLM, poisson_deviance

# key, label, kind, reference value (Feb 2025-like day)
TERMS = [
    ("gust", "Peak gust (mph)", "lnratio", 55.0),
    ("rain", "Rain, 24 h (in)", "linear", 2.0),
    ("snow", "Snowfall, 24 h (in)", "linear", 0.0),
    ("ante", "Rain, previous 3 days (in)", "linear", 2.5),
    ("leaf", "Trees in leaf (0/1)", "flag", 0.0),
]
REF = {k: r for k, _, _, r in TERMS}
# Engineering priors used only when no weather data was available to learn from.
PRIOR_COEF = {"gust": 4.0, "rain": 0.12, "snow": 0.10, "ante": 0.08, "leaf": 0.25}
PRIOR_SE = {"gust": 1.0, "rain": 0.08, "snow": 0.06, "ante": 0.05, "leaf": 0.15}
# No wind event and no precipitation => storm severity is exactly 0 (nothing to repair). Rule, not fitted.
ZERO_RULE = {"gust_max": 15, "rain_max": 0.0, "snow_max": 0.0}
ILLUSTRATIVE_SEP = {"gust": 37, "rain": 3.5, "snow": 0, "ante": 1.5, "leaf": 1}  # not observed weather


def basis(df):
    return np.column_stack([np.log(np.maximum(df.gust.values, 5.0)), df.rain.values, df.snow.values,
                            df.ante.values, df.leaf.values])


def severity_ratio(coefs, x, ref=REF):
    d = np.array([np.log(max(x["gust"], 5) / ref["gust"]), x["rain"] - ref["rain"], x["snow"] - ref["snow"],
                  x["ante"] - ref["ante"], x["leaf"] - ref["leaf"]])
    return float(np.exp(np.dot(coefs, d)))


def fit_severity(daily, l2_grid=(0.1, 1, 10, 100), folds=5):
    """daily: DataFrame with gust, rain, snow, ante, leaf, y and a DatetimeIndex."""
    B = basis(daily)
    mu_, sd_ = B.mean(0), B.std(0)
    sd_[sd_ == 0] = 1.0
    X = np.column_stack([np.ones(len(daily)), (B - mu_) / sd_])
    y = daily.y.values.astype(float)
    pen = np.r_[False, [True] * 5]
    groups = (daily.index.year * 100 + daily.index.month).values
    cv = list(GroupKFold(n_splits=min(folds, len(np.unique(groups)))).split(X, groups=groups))
    score = {}
    for l2 in l2_grid:
        oof = np.zeros(len(y))
        for tr, te in cv:
            m = NBGLM(l2=l2).fit(X[tr], y[tr], None, pen)
            oof[te] = m.predict(X[te])
        score[l2] = poisson_deviance(y, oof)
    best = min(score, key=score.get)
    oof = np.zeros(len(y))
    for tr, te in cv:
        oof[te] = NBGLM(l2=best).fit(X[tr], y[tr], None, pen).predict(X[te])
    null = np.zeros(len(y))
    for tr, te in cv:
        null[te] = y[tr].mean()
    m = NBGLM(l2=best).fit(X, y, None, pen)
    coef = m.beta[1:] / sd_                       # per raw unit of each basis function
    cov = m.cov[1:, 1:] / np.outer(sd_, sd_)
    return {
        "coef": coef.tolist(), "se": np.sqrt(np.diag(cov)).tolist(), "cov": cov.tolist(),
        "alpha": m.alpha, "l2": best, "n_days": int(len(y)), "n_event_days": int((y > 0).sum()),
        "cv_deviance_skill": 1 - poisson_deviance(y, oof) / poisson_deviance(y, null),
    }


def main():
    C.ARTIFACTS.mkdir(parents=True, exist_ok=True)
    if C.WEATHER_CSV.exists():
        w = pd.read_csv(C.WEATHER_CSV, parse_dates=["date"]).set_index("date")
        ar = pd.read_csv(C.PROCESSED / "arcos_points.csv", parse_dates=["Report_Tim"])
        counts = ar.groupby(ar.Report_Tim.dt.normalize()).size()
        w["y"] = counts.reindex(w.index).fillna(0)
        w = w[(w.index >= ar.Report_Tim.min()) & (w.index <= ar.Report_Tim.max())]
        fit = fit_severity(w)
        out = {"source": "learned", "n_days": fit["n_days"], "cv_deviance_skill": fit["cv_deviance_skill"],
               "coef": fit["coef"], "se": fit["se"], "cov": fit["cov"], "alpha": fit["alpha"]}
    else:
        se = np.array([PRIOR_SE[k] for k, *_ in TERMS])
        out = {"source": "prior",
               "reason": "No weather data was available to this pipeline run (weather.py not executed). "
                         "Coefficients are engineering assumptions and are NOT learned from outage data.",
               "coef": [PRIOR_COEF[k] for k, *_ in TERMS], "se": se.tolist(), "cov": np.diag(se ** 2).tolist()}
    out["terms"] = [{"key": k, "label": l, "kind": kd, "ref": r} for k, l, kd, r in TERMS]
    out["zero_rule"] = ZERO_RULE
    out["illustrative_sep"] = {"inputs": ILLUSTRATIVE_SEP,
                               "implied_ratio_vs_feb": severity_ratio(out["coef"], ILLUSTRATIVE_SEP)}
    (C.ARTIFACTS / "severity.json").write_text(json.dumps(out, indent=1))
    print("severity source:", out["source"], "| coef:", dict(zip(REF, np.round(out["coef"], 3))))
    print("illustrative Sep-like weather implies S =", round(out["illustrative_sep"]["implied_ratio_vs_feb"], 3))


if __name__ == "__main__":
    main()
