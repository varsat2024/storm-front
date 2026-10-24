"""Train the outage-count model.

Unit of analysis: (400 m cell, storm event).  Response: number of ARCOS damage records.
Model: ridge-penalized negative binomial GLM, log link, offset = ln(customers), event fixed effect.
Validation: 5-fold CV grouped by circuit (so a circuit never appears in both train and test),
plus a Feb->Sep transfer test. Compared against (a) an exposure-only baseline and
(b) a gradient-boosted Poisson model, to check the GLM is not leaving signal on the table.

Event level is removed from the comparison (predictions are rescaled so each event's total
matches), because event severity is a weather question handled by train_severity.py.
The comparison is therefore about *where* damage lands, not *how much* occurs.
"""
import json

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

import config as C
from features import FEATURES
from nbglm import NBGLM, nb_prob_at_least_one, poisson_deviance

KEYS = [f[0] for f in FEATURES]
SEP = "Sep2024"
Z_CLIP = 4.0


def design(df, mean, sd, with_event=True):
    Z = np.clip((df[KEYS].values - mean) / sd, -Z_CLIP, Z_CLIP)
    cols = [np.ones(len(df))]
    if with_event:
        cols.append((df.event == SEP).astype(float).values)
    return np.column_stack(cols + [Z])


def fit_glm(train, l2, with_event=True):
    cells = train.drop_duplicates("cell")
    mean, sd = cells[KEYS].mean().values, cells[KEYS].std().values
    X = design(train, mean, sd, with_event)
    pen = np.r_[[False] * (2 if with_event else 1), [True] * len(KEYS)]
    m = NBGLM(l2=l2).fit(X, train.y.values, np.log(train.n.values), pen)
    m.mean, m.sd, m.with_event = mean, sd, with_event
    return m


def glm_mu(m, df):
    return m.predict(design(df, m.mean, m.sd, m.with_event), np.log(df.n.values))


def baseline_mu(train, test):
    mu = np.zeros(len(test))
    for ev in test.event.unique():
        tr = train[train.event == ev]
        rate = tr.y.sum() / tr.n.sum() if len(tr) else train.y.sum() / train.n.sum()
        mu[(test.event == ev).values] = rate * test.n[test.event == ev].values
    return mu


def gbm_mu(train, test):
    def feats(d):
        return np.column_stack([d[KEYS].values, (d.event == SEP).astype(float)])
    g = HistGradientBoostingRegressor(loss="poisson", max_depth=3, learning_rate=0.05, max_iter=200,
                                      min_samples_leaf=50, random_state=C.SEED)
    g.fit(feats(train), train.y / train.n, sample_weight=train.n)
    return np.maximum(g.predict(feats(test)), 1e-9) * test.n.values


def level_match(mu, df):
    """Rescale predictions so each event's total equals its observed total."""
    out = mu.copy()
    for ev in df.event.unique():
        k = (df.event == ev).values
        out[k] *= df.y[k].sum() / max(mu[k].sum(), 1e-12)
    return out


def metrics(df, mu, alpha=None):
    y = df.y.values
    base = level_match(baseline_mu(df, df), df)  # in-sample event rate == level-matched exposure model
    mu = level_match(mu, df)
    p = nb_prob_at_least_one(mu, alpha) if alpha else 1 - np.exp(-mu)
    pb = 1 - np.exp(-base)
    hit = (y > 0).astype(int)
    d_m, d_b = poisson_deviance(y, mu), poisson_deviance(y, base)
    ce = pd.DataFrame({"c": df.circuit.values, "e": df.event.values, "y": y, "mu": mu}).groupby(["c", "e"]).sum()
    return {
        "deviance_skill": 1 - d_m / d_b,
        "auc_any_damage": float(roc_auc_score(hit, p)),
        "auc_baseline": float(roc_auc_score(hit, pb)) if np.ptp(pb) > 0 else 0.5,
        "brier": float(brier_score_loss(hit, p)),
        "brier_skill": 1 - float(brier_score_loss(hit, p)) / float(brier_score_loss(hit, pb)),
        "spearman_circuit_event": float(spearmanr(ce.y, ce.mu)[0]),
    }


def calibration(df, mu, alpha, bins=8):
    mu = level_match(mu, df)
    p = nb_prob_at_least_one(mu, alpha)
    d = pd.DataFrame({"p": p, "hit": (df.y.values > 0).astype(int)})
    d["bin"] = pd.qcut(d.p.rank(method="first"), bins, labels=False)
    g = d.groupby("bin").agg(pred=("p", "mean"), obs=("hit", "mean"), n=("hit", "size"))
    return g.round(4).reset_index().to_dict("records")


def main():
    panel = pd.read_csv(C.PROCESSED / "panel.csv")
    groups = panel.circuit.values
    folds = list(GroupKFold(n_splits=C.CV_FOLDS).split(panel, groups=groups))

    # ---- choose ridge penalty by grouped CV deviance
    cv_dev = {}
    for l2 in C.L2_GRID:
        oof = np.zeros(len(panel))
        for tr, te in folds:
            oof[te] = glm_mu(fit_glm(panel.iloc[tr], l2), panel.iloc[te])
        cv_dev[l2] = poisson_deviance(panel.y.values, level_match(oof, panel))
    best_l2 = min(cv_dev, key=cv_dev.get)

    # ---- out-of-fold predictions for all models at the chosen penalty
    oof = {k: np.zeros(len(panel)) for k in ["nbglm", "gbm", "baseline"]}
    alphas, fold_skill = [], []
    for tr, te in folds:
        a, b = panel.iloc[tr], panel.iloc[te]
        m = fit_glm(a, best_l2)
        alphas.append(m.alpha)
        oof["nbglm"][te] = glm_mu(m, b)
        oof["gbm"][te] = gbm_mu(a, b)
        oof["baseline"][te] = baseline_mu(a, b)
        fold_skill.append(metrics(b, oof["nbglm"][te], m.alpha)["deviance_skill"])
    alpha_cv = float(np.mean(alphas))
    res = {"nbglm": metrics(panel, oof["nbglm"], alpha_cv),
           "gbm_poisson": metrics(panel, oof["gbm"]),
           "exposure_only": metrics(panel, oof["baseline"])}
    res["nbglm"]["fold_deviance_skill"] = [round(float(s), 4) for s in fold_skill]
    calib = calibration(panel, oof["nbglm"], alpha_cv)

    # ---- transfer: learn spatial structure from Feb only, predict Sep
    feb, sep = panel[panel.event == C.REFERENCE_EVENT], panel[panel.event == SEP]
    mt = fit_glm(feb, best_l2, with_event=False)
    transfer = metrics(sep, glm_mu(mt, sep), mt.alpha)

    # ---- final model on all data
    final = fit_glm(panel, best_l2)
    rr = {}
    names = ["intercept", "event_Sep2024"] + KEYS
    out = {
        "unit": "400 m cell x storm event", "response": "ARCOS damage records",
        "family": "Negative binomial (NB2), log link, offset ln(customers), ridge-penalized",
        "l2": best_l2, "l2_cv_deviance": {str(k): round(v, 2) for k, v in cv_dev.items()},
        "alpha": final.alpha, "n_rows": int(len(panel)), "n_positive_rows": int((panel.y > 0).sum()),
        "n_damage": int(panel.y.sum()), "reference_event": C.REFERENCE_EVENT,
        "terms": [], "cov": final.cov.tolist(), "term_names": names,
        "features": [{"key": k, "label": l, "desc": d, "mean": float(final.mean[i]), "sd": float(final.sd[i])}
                     for i, (k, l, d) in enumerate(FEATURES)],
        "z_clip": Z_CLIP,
        "fleet_rate_per_1000": {ev: float(panel[panel.event == ev].y.sum() / panel[panel.event == ev].n.sum() * 1000)
                                for ev in C.EVENTS},
        "cv": {"folds": C.CV_FOLDS, "grouping": "circuit", "models": res, "calibration": calib,
               "transfer_feb_to_sep": transfer, "alpha_cv_mean": alpha_cv},
        "total_customers": int(panel[panel.event == C.REFERENCE_EVENT].n.sum()),
    }
    for i, nm in enumerate(names):
        b, se = float(final.beta[i]), float(final.se[i])
        out["terms"].append({"name": nm, "beta": b, "se": se, "z": b / se if se > 0 else 0.0,
                             "rr": float(np.exp(b)), "rr_lo": float(np.exp(b - 1.96 * se)),
                             "rr_hi": float(np.exp(b + 1.96 * se))})
    C.ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (C.ARTIFACTS / "outage.json").write_text(json.dumps(out, indent=1))
    print(f"best l2={best_l2}  alpha={final.alpha:.3f}")
    print(json.dumps({k: {m: (round(v, 4) if isinstance(v, float) else v) for m, v in d.items()}
                      for k, d in res.items()}, indent=1))
    print("transfer Feb->Sep:", {k: round(v, 4) for k, v in transfer.items()})
    for t in out["terms"]:
        print(f"{t['name']:>14s} beta={t['beta']:+.3f} se={t['se']:.3f} RR/sd={t['rr']:.2f} [{t['rr_lo']:.2f},{t['rr_hi']:.2f}]")
    print("calibration:", [(c['pred'], c['obs']) for c in calib])


if __name__ == "__main__":
    main()
