"""
los_fitting.py
--------------
Fits a probability distribution to user-supplied LOS percentiles.

Purpose:
    Users provide five percentiles (P10, P25, P50, P75, P90) instead of
    raw patient-level data. This module fits either a Gamma or LogNormal
    distribution to those five points using least-squares optimisation,
    then returns a frozen scipy distribution ready for Monte Carlo sampling.

Functions:
    fit_los(percentiles, dist)  -> FrozenDistribution + param dict
    _fit_gamma(values)          -> (shape, scale)
    _fit_lognorm(values)        -> (sigma, scale)
    select_best_fit(percentiles)-> whichever distribution fits better

Output:
    A frozen scipy.stats distribution object that simulation.py calls
    with .rvs(n, random_state=rng) to sample patient LOS values.
    A dict of fitted parameters returned inside DistributionFit schema.
"""

import numpy as np
from scipy import stats
from scipy.optimize import minimize
from typing import Tuple, Dict
from .models import LOSPercentiles


# Percentile probability points used for fitting
_PROBS = np.array([0.10, 0.25, 0.50, 0.75, 0.90])


# ---------------------------------------------------------------------------
# Internal fitters
# ---------------------------------------------------------------------------

def _fit_gamma(values: np.ndarray) -> Tuple[float, float]:
    """
    Fit a Gamma(shape, scale) distribution to five percentile values.

    Uses least-squares minimisation over the five target probability points.
    Initial guess is derived from method-of-moments on the provided values.

    Args:
        values: Array of five percentile values [P10, P25, P50, P75, P90].

    Returns:
        Tuple of (shape, scale) for scipy.stats.gamma.
    """
    # Method-of-moments initial guess from median and IQR
    median = values[2]
    iqr = values[3] - values[1]
    scale0 = max(iqr / 1.35, 0.1)
    shape0 = max(median / scale0, 0.5)

    def loss(params):
        shape, log_scale = params
        scale = np.exp(log_scale)
        if shape <= 0:
            return 1e10
        fitted = stats.gamma.ppf(_PROBS, a=shape, scale=scale)
        return np.mean((fitted - values) ** 2)

    result = minimize(
        loss,
        x0=[shape0, np.log(scale0)],
        method="Nelder-Mead",
        options={"xatol": 1e-6, "fatol": 1e-6, "maxiter": 5000},
    )

    shape = max(result.x[0], 0.01)
    scale = max(np.exp(result.x[1]), 0.01)
    return shape, scale


def _fit_lognorm(values: np.ndarray) -> Tuple[float, float]:
    """
    Fit a LogNormal(sigma, scale=exp(mu)) distribution to five percentile values.

    Uses a closed-form estimate from the median and 90th percentile,
    then refines with least-squares minimisation.

    Args:
        values: Array of five percentile values [P10, P25, P50, P75, P90].

    Returns:
        Tuple of (sigma, scale) for scipy.stats.lognorm.
        scale = exp(mu), so mu = log(scale).
    """
    # Closed-form starting point
    mu0 = np.log(max(values[2], 1e-6))
    z90 = stats.norm.ppf(0.90)
    sigma0 = max((np.log(max(values[4], 1e-6)) - mu0) / z90, 0.05)

    def loss(params):
        sigma, mu = params
        if sigma <= 0:
            return 1e10
        fitted = stats.lognorm.ppf(_PROBS, s=sigma, scale=np.exp(mu))
        return np.mean((fitted - values) ** 2)

    result = minimize(
        loss,
        x0=[sigma0, mu0],
        method="Nelder-Mead",
        options={"xatol": 1e-6, "fatol": 1e-6, "maxiter": 5000},
    )

    sigma = max(result.x[0], 0.01)
    mu = result.x[1]
    return sigma, float(np.exp(mu))


# ---------------------------------------------------------------------------
# Goodness-of-fit metric
# ---------------------------------------------------------------------------

def _rmse(fitted_dist, values: np.ndarray) -> float:
    """
    Root mean squared error between fitted percentiles and target values.

    Lower RMSE = better fit.

    Args:
        fitted_dist: A frozen scipy distribution with a .ppf() method.
        values:      Target percentile values.

    Returns:
        RMSE as a float.
    """
    predicted = fitted_dist.ppf(_PROBS)
    return float(np.sqrt(np.mean((predicted - values) ** 2)))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fit_los(
    percentiles: LOSPercentiles,
    dist: str = "auto",
) -> Tuple[object, Dict[str, float], str]:
    """
    Fit a probability distribution to the supplied LOS percentiles.

    Args:
        percentiles: LOSPercentiles model with p10..p90 in days.
        dist:        "gamma", "lognorm", or "auto".
                     "auto" selects whichever has lower RMSE.

    Returns:
        frozen_dist:  Frozen scipy distribution ready for .rvs() sampling.
        params:       Dict of fitted parameters for DistributionFit schema.
        dist_name:    "gamma" or "lognorm" (whichever was selected).

    Raises:
        ValueError: If dist is not one of the accepted values.
    """
    values = np.array([
        percentiles.p10,
        percentiles.p25,
        percentiles.p50,
        percentiles.p75,
        percentiles.p90,
    ], dtype=float)

    if dist not in ("gamma", "lognorm", "auto"):
        raise ValueError(f"dist must be 'gamma', 'lognorm', or 'auto', got '{dist}'")

    # Fit gamma
    g_shape, g_scale = _fit_gamma(values)
    gamma_dist = stats.gamma(a=g_shape, scale=g_scale)

    if dist == "gamma":
        params = {"shape": round(g_shape, 4), "scale": round(g_scale, 4)}
        return gamma_dist, params, "gamma"

    # Fit lognorm
    ln_sigma, ln_scale = _fit_lognorm(values)
    lognorm_dist = stats.lognorm(s=ln_sigma, scale=ln_scale)

    if dist == "lognorm":
        params = {"sigma": round(ln_sigma, 4), "scale": round(ln_scale, 4)}
        return lognorm_dist, params, "lognorm"

    # Auto: pick lower RMSE
    gamma_rmse = _rmse(gamma_dist, values)
    lognorm_rmse = _rmse(lognorm_dist, values)

    if gamma_rmse <= lognorm_rmse:
        params = {"shape": round(g_shape, 4), "scale": round(g_scale, 4)}
        return gamma_dist, params, "gamma"
    else:
        params = {"sigma": round(ln_sigma, 4), "scale": round(ln_scale, 4)}
        return lognorm_dist, params, "lognorm"