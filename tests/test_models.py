"""Sanity tests: the custom estimators must recover known parameters from simulated data.
Run:  python -m pytest tests  (or  python tests/test_models.py)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from aft import IntervalLogNormalAFT  # noqa: E402
from nbglm import NBGLM, nb_prob_at_least_one  # noqa: E402


def test_nbglm_recovers_parameters():
    rng = np.random.default_rng(0)
    n = 20000
    x = rng.normal(size=(n, 2))
    off = np.log(rng.uniform(5, 50, n))
    beta = np.array([-3.0, 0.6, -0.4])
    alpha = 0.8
    mu = np.exp(off + beta[0] + x @ beta[1:])
    r = 1 / alpha
    y = rng.poisson(rng.gamma(r, mu / r))
    X = np.c_[np.ones(n), x]
    m = NBGLM(l2=0.0).fit(X, y, off, penalized=[False, True, True])
    assert np.allclose(m.beta, beta, atol=0.05), m.beta
    assert abs(m.alpha - alpha) < 0.08, m.alpha
    assert np.all(m.se > 0)


def test_nb_prob_limits():
    assert abs(nb_prob_at_least_one(0.3, 0.0) - (1 - np.exp(-0.3))) < 1e-12
    assert nb_prob_at_least_one(0.3, 2.0) < nb_prob_at_least_one(0.3, 0.0)  # overdispersion lowers P(>=1)


def test_aft_recovers_parameters_with_censoring():
    rng = np.random.default_rng(1)
    n = 6000
    x = rng.normal(size=n)
    X = np.c_[np.ones(n), x]
    beta, sigma = np.array([0.5, 0.7]), 0.9
    t = np.exp(X @ beta + sigma * rng.normal(size=n))
    # Both timestamps are recorded as dates: report at a random time of day, repair = report + t.
    s = rng.uniform(0, 1, n)
    d = np.floor(s + t)  # recorded gap in whole days; the true t lies in (d-1, d+1)
    lo = np.maximum(d - 1, 0.02)
    hi = d + 1
    cens = t > 30
    lo = np.where(cens, 30.0, lo)
    hi = np.where(cens, np.inf, hi)
    m = IntervalLogNormalAFT(l2=0.0).fit(X, lo, hi)
    assert np.allclose(m.beta, beta, atol=0.08), m.beta
    assert abs(m.sigma - sigma) < 0.07, m.sigma


if __name__ == "__main__":
    test_nbglm_recovers_parameters()
    test_nb_prob_limits()
    test_aft_recovers_parameters_with_censoring()
    print("all tests passed")
