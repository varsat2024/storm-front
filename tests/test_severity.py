"""Checks the weather-based severity fit on SIMULATED weather and damage with known coefficients.
This validates the code path only; it says nothing about real weather effects.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from train_severity import basis, fit_severity  # noqa: E402


def test_fit_severity_recovers_simulated_effects():
    rng = np.random.default_rng(3)
    n = 1500
    idx = pd.date_range("2022-10-01", periods=n)
    d = pd.DataFrame({
        "gust": np.clip(rng.gamma(6, 5, n), 8, 90), "rain": rng.gamma(0.6, 0.5, n),
        "snow": rng.gamma(0.2, 0.5, n), "leaf": idx.month.isin(range(5, 11)).astype(float)}, index=idx)
    d["ante"] = d.rain.rolling(3).sum().shift(1).fillna(0)
    true = np.array([3.5, 0.3, 0.2, 0.15, 0.4])
    lam = np.exp(-9 + basis(d) @ true) * 1.0
    lam = lam / lam.mean() * 1.2  # about 1.2 reports/day on average
    r = 2.0
    d["y"] = rng.poisson(rng.gamma(r, lam / r))
    fit = fit_severity(d)
    est = np.array(fit["coef"])
    assert est[0] > 2.0 and est[0] < 5.0, est      # gust exponent recovered roughly
    assert np.all(np.sign(est[:2]) == 1), est
    assert fit["cv_deviance_skill"] > 0.1, fit["cv_deviance_skill"]


if __name__ == "__main__":
    test_fit_severity_recovers_simulated_effects()
    print("severity test passed")
