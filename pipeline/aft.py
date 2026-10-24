"""Log-normal accelerated-failure-time model with interval and right censoring.

log T = x' beta + sigma * eps,  eps ~ N(0,1).
Each observation is (lo, hi]; hi = inf means right-censored. This handles repair dates
that are only known to the day (true duration lies within one day of the recorded gap).
"""
import numpy as np
from scipy.optimize import minimize
from scipy.stats import norm


def _nll(theta, X, lo, hi, l2):
    beta, sigma = theta[:-1], np.exp(theta[-1])
    mu = X @ beta
    zl = (np.log(lo) - mu) / sigma
    zh = np.where(np.isinf(hi), np.inf, (np.log(np.where(np.isinf(hi), 1.0, hi)) - mu) / sigma)
    # Work in log space for stability
    cdf_hi = norm.cdf(zh)
    cdf_lo = norm.cdf(zl)
    p = np.clip(cdf_hi - cdf_lo, 1e-300, None)
    # use survival form in the upper tail to avoid cancellation
    sf = norm.sf(zl) - np.where(np.isinf(zh), 0.0, norm.sf(zh))
    p = np.where(zl > 0, np.clip(sf, 1e-300, None), p)
    pen = 0.5 * l2 * np.sum(beta[1:] ** 2)
    return -np.sum(np.log(p)) + pen


class IntervalLogNormalAFT:
    def __init__(self, l2=0.5):
        self.l2 = l2

    def fit(self, X, lo, hi):
        X = np.asarray(X, float)
        lo, hi = np.asarray(lo, float), np.asarray(hi, float)
        p = X.shape[1]
        mid = np.log(np.sqrt(lo * np.where(np.isinf(hi), lo * 4, hi)))
        b0 = np.linalg.lstsq(X, mid, rcond=None)[0]
        theta0 = np.r_[b0, np.log(max(np.std(mid - X @ b0), 0.3))]
        res = minimize(_nll, theta0, args=(X, lo, hi, self.l2), method="BFGS",
                       options={"gtol": 1e-6, "maxiter": 500})
        self.theta = res.x
        self.beta, self.sigma = res.x[:-1], float(np.exp(res.x[-1]))
        self.nll = float(res.fun)
        # numerical Hessian for covariance (approximate)
        H = _num_hessian(lambda t: _nll(t, X, lo, hi, self.l2), res.x)
        try:
            self.cov = np.linalg.inv(H)
        except np.linalg.LinAlgError:
            self.cov = np.linalg.pinv(H)
        self.se = np.sqrt(np.clip(np.diag(self.cov), 0, None))
        self.converged = bool(res.success)
        return self

    def quantile(self, X, q):
        return np.exp(np.asarray(X, float) @ self.beta + self.sigma * norm.ppf(q))

    def interval_loglik(self, X, lo, hi):
        return -_nll(self.theta, np.asarray(X, float), np.asarray(lo, float),
                     np.asarray(hi, float), 0.0)


def _num_hessian(f, x, eps=1e-4):
    n = len(x)
    H = np.zeros((n, n))
    fx = f(x)
    for i in range(n):
        for j in range(i, n):
            xpp, xpm, xmp, xmm = x.copy(), x.copy(), x.copy(), x.copy()
            xpp[i] += eps; xpp[j] += eps
            xpm[i] += eps; xpm[j] -= eps
            xmp[i] -= eps; xmp[j] += eps
            xmm[i] -= eps; xmm[j] -= eps
            H[i, j] = H[j, i] = (f(xpp) - f(xpm) - f(xmp) + f(xmm)) / (4 * eps * eps)
    return H
