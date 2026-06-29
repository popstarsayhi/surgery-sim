"""
main.py
-------
FastAPI application entry point for the Surgery Ward Simulator.

Purpose:
    Exposes a single POST /simulate endpoint that accepts a
    SimulationInput payload, runs the Monte Carlo simulation,
    computes metrics, and returns a SimulationOutput response.

Endpoints:
    POST /simulate      Run simulation and return results
    GET  /health        Health check for deployment monitoring

CORS:
    Configured to allow requests from the React frontend.
    Origins are read from the ALLOWED_ORIGINS environment variable
    (comma-separated). Defaults to localhost:5173 for local development.

    Before deploying to production, set:
        ALLOWED_ORIGINS=https://your-frontend-domain.com
    Otherwise the React production build will be blocked by CORS.

Error handling:
    Pydantic validation errors return 422 with field-level detail.
    Unexpected simulation errors return 500 with a safe message.
    Full tracebacks are printed server-side only (never sent to client).

Deployment:
    Local (from project root surgery-sim/):
        uvicorn backend.main:app --reload

    Render.com (start command, run from surgery-sim/):
        uvicorn backend.main:app --host 0.0.0.0 --port $PORT

    If Render is configured to run from the backend/ directory:
        uvicorn main:app --host 0.0.0.0 --port $PORT
"""

import os
import time
import traceback

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .metrics import compute_metrics
from .models import SimulationInput, SimulationOutput
from .monte_carlo import run_monte_carlo


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Surgery Ward Simulator",
    description="Monte Carlo discrete-event simulation of surgery ward bed occupancy and staffing.",
    version="1.0.0",
)

# CORS — allow React dev server and production frontend
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    """
    Health check endpoint.

    Returns a simple status dict so deployment platforms (Render, Railway)
    can verify the service is running before routing traffic.
    """
    return {"status": "ok", "version": "1.0.0"}


@app.post("/simulate", response_model=SimulationOutput)
def simulate(inp: SimulationInput) -> SimulationOutput:
    """
    Run Monte Carlo simulation and return aggregated results.

    Accepts a SimulationInput JSON body, runs inp.n_runs independent
    SimPy simulations in parallel, aggregates results via metrics.py,
    and returns a SimulationOutput JSON response.

    Args:
        inp: SimulationInput — validated by Pydantic before this function
             is called. Returns 422 automatically on validation failure.

    Returns:
        SimulationOutput with KPIs, chart data, staffing summaries,
        and sample patient records.

    Raises:
        HTTPException 500: If an unexpected error occurs during simulation.
    """
    try:
        t0 = time.perf_counter()
        results, fit_params = run_monte_carlo(inp)
        elapsed = time.perf_counter() - t0

        return compute_metrics(
            inp=inp,
            results=results,
            fit_params=fit_params,
            execution_time_seconds=elapsed,
            version="1.0.0",
        )

    except Exception as exc:
        # Print full traceback server-side for debugging — never sent to client
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            # Keep detail generic in production to avoid leaking internals.
            # For local debugging, swap to:
            #   detail=f"Simulation failed: {type(exc).__name__}: {exc}"
            detail="Simulation failed. Please check your input parameters or try again.",
        )