"""Negative binomial (NB2) GLM with log link, exposure offset and ridge penalty.

Implemented with IRLS in numpy/scipy so the pipeline has no statsmodels dependency.
Model:  y_i ~ NB2(mu_i, alpha),  Var = mu + alpha*mu^2,  log mu_i = offset_i + x_i' beta.
alpha is estimated by maximum likelihood (profile, alternating with beta).
Coefficient covariance is the inverse of the penalized observed information (approximate).
"""
import numpy as np
from scipy.optimize import minimize_scalar
from scipy.special import gammaln


def nb_loglik(y, mu, alpha):
    r = 1.0 / alpha
    return float(np.sum(
        gammaln(y + r) - gammaln(r) - gammaln(y + 1)
        + r * np.log(r / (r + mu)) + y * np.log(mu / (r + mu))))


def poisson_deviance(y, mu, weights=None):
    y = np.asarray(y, float)
    mu = np.maximum(np.asarray(mu, float), 1e-12)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(y > 0, y * np.log(y / mu), 0.0) - (y - mu)
    t = 2 * t
    return float(np.sum(t if weights is None else t * weights))


def nb_prob_at_least_one(mu, alpha):
    """P(Y >= 1) under NB2; reduces to 1-exp(-mu) as alpha -> 0."""
    mu = np.asarray(mu, float)
    if alpha < 1e-8:
        return 1 - np.exp(-mu)
    return 1 - (1 + alpha * mu) ** (-1.0 / alpha)


class NBGLM:
    def __init__(self, l2=1.0, max_outer=40, max_inner=60, tol=1e-7):
        self.l2, self.max_outer, self.max_inner, self.tol = l2, max_outer, max_inner, tol

    def fit(self, X, y, offset=None, penalized=None, alpha=None):
        """X must already include an intercept column. `penalized` is a boolean mask."""
        X = np.asarray(X, float)
        y = np.asarray(y, float)
        n, p = X.shape
        offset = np.zeros(n) if offset is None else np.asarray(offset, float)
        pen = np.ones(p, bool) if penalized is None else np.asarray(penalized, bool)
        P = np.diag(np.where(pen, self.l2, 0.0))
        fixed_alpha = alpha is not None
        a = alpha if fixed_alpha else 0.5
        beta = np.zeros(p)
        beta[0] = np.log(max(y.sum(), 1.0) / max(np.exp(offset).sum(), 1e-9))
        for _ in range(self.max_outer):
            beta_old, a_old = beta.copy(), a
            for _ in range(self.max_inner):
                eta = np.clip(offset + X @ beta, -30, 30)
                mu = np.exp(eta)
                w = mu / (1 + a * mu)
                z = eta - offset + (y - mu) / mu
                A = X.T @ (X * w[:, None]) + P
                new = np.linalg.solve(A, X.T @ (w * z))
                done = np.max(np.abs(new - beta)) < self.tol
                beta = new
                if done:
                    break
            mu = np.exp(np.clip(offset + X @ beta, -30, 30))
            if not fixed_alpha:
                res = minimize_scalar(lambda la: -nb_loglik(y, mu, np.exp(la)),
                                      bounds=(-9, 3), method="bounded")
                a = float(np.exp(res.x))
            if np.max(np.abs(beta - beta_old)) < 1e-6 and abs(a - a_old) < 1e-6 * max(a, 1):
                break
        mu = np.exp(np.clip(offset + X @ beta, -30, 30))
        w = mu / (1 + a * mu)
        self.beta, self.alpha = beta, a
        self.cov = np.linalg.inv(X.T @ (X * w[:, None]) + P)
        self.se = np.sqrt(np.diag(self.cov))
        self.loglik = nb_loglik(y, mu, a)
        self.n, self.p = n, p
        return self

    def predict(self, X, offset=None):
        off = 0.0 if offset is None else offset
        return np.exp(np.clip(off + np.asarray(X, float) @ self.beta, -30, 30))
