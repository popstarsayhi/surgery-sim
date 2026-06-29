"""
monte_carlo.py
--------------
Runs N independent simulation runs and aggregates raw results.

Purpose:
    Wraps simulation.run_once() in a parallel executor to produce
    the full Monte Carlo distribution of outcomes. Each run uses a
    unique seed (base_seed + run_index) so results are reproducible
    but statistically independent across runs.

Functions:
    run_monte_carlo(inp) -> (List[RunResult], fit_params)

Parallelism:
    Uses concurrent.futures.ProcessPoolExecutor to run multiple
    SimPy simulations in parallel across CPU cores.

    Frozen scipy distributions are NOT passed to workers because
    pickling behaviour varies across environments and can silently
    fail on some deployment targets. Instead, the main process fits
    distributions, extracts the named parameters, and passes only
    plain dicts + dist_name strings to each worker. Workers
    reconstruct the frozen distribution locally via _make_dist().

Output:
    A list of RunResult objects (length = inp.n_runs), one per
    simulation run. Consumed by metrics.py to compute KPIs,
    percentiles, and chart-ready distributions.
"""

import concurrent.futures
import os
from typing import Dict, List, Tuple

from .models import SimulationInput
from .results import RunResult
from .simulation import run_once
from .los_fitting import fit_los


# ---------------------------------------------------------------------------
# Distribution reconstruction (used inside each worker)
# ---------------------------------------------------------------------------

def _make_dist(dist_name: str, params: Dict[str, float]):
    """
    Reconstruct a frozen scipy distribution from its name and parameters.

    Called inside each worker process so that only plain Python dicts
    and strings cross the process boundary — not frozen scipy objects,
    which can be unreliable to pickle across environments.

    Args:
        dist_name: "gamma" or "lognorm".
        params:    Dict of distribution parameters as returned by fit_los().
                   gamma   -> {"shape": float, "scale": float}
                   lognorm -> {"sigma": float, "scale": float}

    Returns:
        A frozen scipy distribution with a .rvs() method.

    Raises:
        ValueError: If dist_name is not recognised.
    """
    from scipy import stats

    if dist_name == "gamma":
        return stats.gamma(a=params["shape"], scale=params["scale"])

    if dist_name == "lognorm":
        return stats.lognorm(s=params["sigma"], scale=params["scale"])

    raise ValueError(f"Unknown distribution: {dist_name!r}")


# ---------------------------------------------------------------------------
# Worker function (top-level for multiprocessing pickling)
# ---------------------------------------------------------------------------

def _worker(args: Tuple) -> RunResult:
    """
    Execute a single simulation run inside a worker process.

    Reconstructs both LOS distributions from parameters before calling
    run_once(), so no frozen scipy objects cross the process boundary.

    Args:
        args: Tuple of
              (inp, e_dist_name, e_params, u_dist_name, u_params, seed).

    Returns:
        RunResult from one complete simulation run.
    """
    inp, e_dist_name, e_params, u_dist_name, u_params, seed = args
    elective_dist = _make_dist(e_dist_name, e_params)
    urgent_dist   = _make_dist(u_dist_name, u_params)
    return run_once(inp, elective_dist, urgent_dist, seed)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_monte_carlo(inp: SimulationInput) -> Tuple[List[RunResult], Dict]:
    """
    Fit LOS distributions and run N independent simulation runs in parallel.

    Steps:
        1. Fit elective and urgent LOS distributions from user percentiles.
           Each is auto-selected (gamma vs lognorm) independently.
        2. Extract named parameters from each fitted distribution.
        3. Dispatch inp.n_runs workers, each receiving plain dict params
           and a unique seed. Workers reconstruct the distributions locally.
        4. Collect and return all RunResult objects.

    Args:
        inp: SimulationInput containing all simulation parameters,
             including n_runs and seed.

    Returns:
        results:    List of RunResult, length = inp.n_runs.
        fit_params: Dict with keys:
                      "elective_distribution" -> dist name string
                      "urgent_distribution"   -> dist name string
                      "elective_params"       -> fitted parameter dict
                      "urgent_params"         -> fitted parameter dict
                    Passed through to SimulationOutput.distribution_fit.

    Notes:
        - Elective and urgent distributions are auto-selected independently
          and may differ (e.g. elective=gamma, urgent=lognorm).
        - Worker count is capped at min(n_runs, cpu_count).
        - Falls back to sequential execution when n_runs < 4 or
          cpu_count == 1 to avoid process-spawn overhead.
    """
    # Fit distributions in the main process
    _, e_params, e_dist_name = fit_los(inp.los_elective, dist="auto")
    _, u_params, u_dist_name = fit_los(inp.los_urgent,   dist="auto")

    fit_params = {
        "elective_distribution": e_dist_name,
        "urgent_distribution":   u_dist_name,
        "elective_params":       e_params,
        "urgent_params":         u_params,
    }

    # Build per-run argument tuples — only plain dicts and primitives
    run_args = [
        (inp, e_dist_name, e_params, u_dist_name, u_params, inp.seed + i)
        for i in range(inp.n_runs)
    ]

    cpu_count = os.cpu_count() or 1
    use_parallel = inp.n_runs >= 4 and cpu_count > 1

    if use_parallel:
        max_workers = min(inp.n_runs, cpu_count)
        with concurrent.futures.ProcessPoolExecutor(max_workers=max_workers) as executor:
            results = list(executor.map(_worker, run_args))
    else:
        results = [_worker(args) for args in run_args]

    return results, fit_params