"""
metrics.py
----------
Aggregates raw simulation results into KPIs and chart-ready datasets.

Purpose:
    Consumes the List[RunResult] produced by monte_carlo.run_monte_carlo()
    and computes all values required by SimulationOutput. Keeps all
    statistical logic in one place so simulation.py and monte_carlo.py
    remain focused on event generation and parallelism respectively.

Functions:
    compute_metrics(inp, results, fit_params) -> SimulationOutput

Key calculations:
    - Daily peak census per run (for histogram)
    - Shift-specific peak census: day 07-15, evening 15-23, night 23-07
    - Occupancy rate per day averaged across runs (for time-series chart)
    - Waiting risk: fraction of days with queue > 0
    - Required RN per shift-day from peak census and nurse ratios
    - Staffing gap: required RN - scheduled RN per shift-day
    - ALOS: mean realised LOS for admitted elective and urgent patients
      (only patients whose arrival_time falls within n_days * 24)
"""

import math
from datetime import datetime, timezone
from typing import Any, Dict, List

import numpy as np

from .models import (
    DistributionFit,
    KPICards,
    PatientRecord,
    ShiftStaffingStats,
    SimulationInput,
    SimulationMetadata,
    SimulationOutput,
)
from .results import RunResult


# Shift definitions: (name, display_hours, start_hour_inclusive, end_hour_exclusive)
# Night wraps midnight: hours 23 and 0-6 inclusive
_SHIFTS = [
    ("day",     "07:00-15:00", 7,  15),
    ("evening", "15:00-23:00", 15, 23),
    ("night",   "23:00-07:00", 23, 7),   # handled specially below
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _shift_peak_census(hourly_census: List[int], n_days: int) -> Dict[str, List[int]]:
    """
    Compute the peak census for each shift on each day.

    Night shift spans 23:00-07:00 and wraps midnight, so it is assembled
    from the last hour of the current day and the first seven hours of the
    next day.

    Args:
        hourly_census: Hourly census values, length = n_days * 24.
                       Index h corresponds to the end of hour h+1
                       (census[0] = end of hour 1, i.e. t=1).
        n_days:        Number of simulated days.

    Returns:
        Dict with keys "day", "evening", "night", each mapping to a
        list of peak census values of length n_days.
    """
    peaks = {"day": [], "evening": [], "night": []}

    for day in range(n_days):
        base = day * 24

        # Day shift: hours 7-14 (indices base+7 .. base+14, end-of-hour samples)
        day_slice   = hourly_census[base + 7  : base + 15]
        eve_slice   = hourly_census[base + 15 : base + 23]

        # Night shift: hour 23 of this day + hours 0-6 of next day
        night_start = [hourly_census[base + 23]] if base + 23 < len(hourly_census) else []
        next_base   = (day + 1) * 24
        night_end   = hourly_census[next_base : next_base + 7] if next_base + 7 <= len(hourly_census) else []
        night_slice = night_start + night_end

        peaks["day"].append(max(day_slice)   if day_slice   else 0)
        peaks["evening"].append(max(eve_slice) if eve_slice else 0)
        peaks["night"].append(max(night_slice) if night_slice else 0)

    return peaks


def _required_rn(peak_census: int, ratio: int) -> int:
    """
    Compute nurses required given peak census and nurse-to-patient ratio.

    Args:
        peak_census: Number of occupied beds at shift peak.
        ratio:       Patients per nurse (e.g. 4 means 1 nurse per 4 patients).

    Returns:
        Ceiling division: ceil(peak_census / ratio).
    """
    return math.ceil(peak_census / ratio) if ratio > 0 else 0


def _percentile(values: List[float], p: float) -> float:
    """Compute the p-th percentile of a list (0 <= p <= 100)."""
    return float(np.percentile(values, p, method="linear")) if values else 0.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_metrics(
    inp: SimulationInput,
    results: List[RunResult],
    fit_params: Dict[str, Any],
    execution_time_seconds: float,
    version: str = "1.0.0",
) -> SimulationOutput:
    """
    Aggregate Monte Carlo results into a complete SimulationOutput.

    Args:
        inp:                      Original SimulationInput.
        results:                  List[RunResult] from run_monte_carlo().
        fit_params:               Dict returned by run_monte_carlo() with
                                  distribution names and fitted parameters.
        execution_time_seconds:   Wall-clock time for the MC run (seconds).
        version:                  Simulation version string for metadata.

    Returns:
        SimulationOutput ready for JSON serialisation by FastAPI.
    """
    n_days    = inp.n_days
    n_runs    = len(results)
    total_hrs = n_days * 24

    # ------------------------------------------------------------------
    # 1. Per-run daily peak census and occupancy
    # ------------------------------------------------------------------

    all_daily_peaks:     List[float] = []   # pooled across runs (for KPI only)
    all_waiting_counts:  List[float] = []   # pooled across runs
    all_waiting_days:    List[float] = []   # one value per run
    daily_peak_matrix:   List[List[float]] = []  # shape (n_runs, n_days)
    occupancy_matrix:    List[List[float]] = []  # shape (n_runs, n_days)

    for run in results:
        census = run.hourly_census

        # Daily peak census and occupancy
        daily_peaks = []
        daily_occ   = []
        for day in range(n_days):
            day_slice = census[day * 24 : (day + 1) * 24]
            peak      = max(day_slice) if day_slice else 0
            avg_occ   = (sum(day_slice) / len(day_slice) / inp.beds * 100
                         if day_slice and inp.beds > 0 else 0.0)
            daily_peaks.append(float(peak))
            daily_occ.append(avg_occ)

        all_daily_peaks.extend(daily_peaks)
        daily_peak_matrix.append(daily_peaks)
        occupancy_matrix.append(daily_occ)

        # Waiting stats
        waiting_counts = run.daily_waiting_count
        all_waiting_counts.extend([float(w) for w in waiting_counts])
        all_waiting_days.append(float(sum(1 for w in waiting_counts if w > 0)))

    # Per-day census band across all runs (shape: n_runs × n_days → n_days)
    peak_array = np.asarray(daily_peak_matrix)   # shape (n_runs, n_days)
    census_p10_over_time = list(np.percentile(peak_array, 10, axis=0, method="linear"))
    census_p50_over_time = list(np.percentile(peak_array, 50, axis=0, method="linear"))
    census_p90_over_time = list(np.percentile(peak_array, 90, axis=0, method="linear"))

    # Select representative run: the run whose median daily peak is closest to
    # the overall P50. This gives a realistic single-run view of day-to-day
    # fluctuation including weekend dips, without cherry-picking best or worst.
    run_medians = np.median(peak_array, axis=1)          # one median per run
    overall_p50 = float(np.median(run_medians))
    rep_run_idx = int(np.argmin(np.abs(run_medians - overall_p50)))
    representative_run_census = daily_peak_matrix[rep_run_idx]

    # Mean occupancy across runs for each day (for time-series chart)
    occ_array = np.asarray(occupancy_matrix)     # shape (n_runs, n_days)
    occupancy_over_time = list(np.mean(occ_array, axis=0))

    # ------------------------------------------------------------------
    # 2. Shift-specific peak census and staffing
    # ------------------------------------------------------------------

    shift_day_peaks:     List[int] = []
    shift_eve_peaks:     List[int] = []
    shift_night_peaks:   List[int] = []

    for run in results:
        peaks = _shift_peak_census(run.hourly_census, n_days)
        shift_day_peaks.extend(peaks["day"])
        shift_eve_peaks.extend(peaks["evening"])
        shift_night_peaks.extend(peaks["night"])

    # Required RN per shift-day
    req_rn_day   = [_required_rn(p, inp.nurse_ratios.day)     for p in shift_day_peaks]
    req_rn_eve   = [_required_rn(p, inp.nurse_ratios.evening) for p in shift_eve_peaks]
    req_rn_night = [_required_rn(p, inp.nurse_ratios.night)   for p in shift_night_peaks]

    sched_day   = inp.scheduled_nurses.day
    sched_eve   = inp.scheduled_nurses.evening
    sched_night = inp.scheduled_nurses.night

    def _shift_stats(
        shift_name: str,
        hours: str,
        peaks: List[int],
        req_rns: List[int],
        scheduled: int,
    ) -> ShiftStaffingStats:
        gaps = [r - scheduled for r in req_rns]
        shortage_risk = float(sum(1 for g in gaps if g > 0) / len(gaps)) if gaps else 0.0
        return ShiftStaffingStats(
            shift=shift_name,
            hours=hours,
            peak_census_p50=_percentile(peaks, 50),
            peak_census_p95=_percentile(peaks, 95),
            required_rn_p50=_percentile(req_rns, 50),
            required_rn_p95=_percentile(req_rns, 95),
            scheduled_rn=scheduled,
            shortage_shift_risk=shortage_risk,
            mean_gap=float(np.mean(gaps)) if gaps else 0.0,
        )

    # Map shift name to (peaks, req_rns, scheduled)
    _shift_data = {
        "day":     (shift_day_peaks,   req_rn_day,   sched_day),
        "evening": (shift_eve_peaks,   req_rn_eve,   sched_eve),
        "night":   (shift_night_peaks, req_rn_night, sched_night),
    }

    shift_staffing = [
        _shift_stats(name, hours, *_shift_data[name])
        for name, hours, _, _ in _SHIFTS
    ]

    # ------------------------------------------------------------------
    # 3. ALOS: pool across all runs, filter to patients who arrived
    #    within the simulation window (arrival_time < total_hrs)
    # ------------------------------------------------------------------

    cutoff_time = total_hrs
    e_los_list: List[float] = []
    u_los_list: List[float] = []

    for run in results:
        for p in run.patients:
            if p.arrival_time >= cutoff_time:
                continue
            if p.admission_time is None:
                continue
            if p.patient_type == "elective":
                e_los_list.append(p.los_days)
            else:
                u_los_list.append(p.los_days)

    alos_elective = float(np.mean(e_los_list)) if e_los_list else 0.0
    alos_urgent   = float(np.mean(u_los_list)) if u_los_list else 0.0

    # ------------------------------------------------------------------
    # 3b. Recommended beds via Little's Law
    #     L = λ × W
    #     L  = mean census (beds needed at 100% occupancy)
    #     λ  = arrival rate per day
    #     W  = mean LOS in days
    #
    #     Effective elective rate accounts for weekends (5/7 days).
    #     Recommended beds = L / occupancy_target, rounded up.
    # ------------------------------------------------------------------

    effective_elective_rate = inp.elective_per_day * (5 / 7)
    littles_census = (
        effective_elective_rate * alos_elective +
        inp.urgent_per_day      * alos_urgent
    )

    recommended_beds_85 = math.ceil(littles_census / 0.85)
    recommended_beds_95 = math.ceil(littles_census / 0.95)

    # ------------------------------------------------------------------
    # 4. KPI cards
    # ------------------------------------------------------------------

    # Overall staff shortage risk: fraction of shift-days short across all shifts
    all_req  = req_rn_day + req_rn_eve + req_rn_night
    all_shed = ([sched_day] * len(req_rn_day) +
                [sched_eve] * len(req_rn_eve) +
                [sched_night] * len(req_rn_night))
    staff_shortage_risk = float(
        sum(1 for r, s in zip(all_req, all_shed) if r > s) / len(all_req)
    ) if all_req else 0.0

    # Fraction of simulated days where the waiting queue was non-empty
    # (pooled across all runs — one data point per day per run)
    waiting_risk = float(
        sum(1 for w in all_waiting_counts if w > 0) / len(all_waiting_counts)
    ) if all_waiting_counts else 0.0

    kpi = KPICards(
        median_daily_peak_census=_percentile(all_daily_peaks, 50),
        p95_daily_peak_census=_percentile(all_daily_peaks, 95),
        mean_occupancy_rate=float(np.mean(occupancy_over_time)),
        waiting_risk=waiting_risk,
        staff_shortage_shift_risk=staff_shortage_risk,
        alos_elective=alos_elective,
        alos_urgent=alos_urgent,
        recommended_beds_85=recommended_beds_85,
        recommended_beds_95=recommended_beds_95,
    )

    # ------------------------------------------------------------------
    # 5. Sample patient records (last run, first 200 admitted patients)
    #    Only admitted patients (admission_time is not None) are included
    #    so the table always shows complete journey records.
    # ------------------------------------------------------------------

    admitted_last_run = [
        p for p in results[-1].patients if p.admission_time is not None
    ]
    sample_patients = []
    for p in admitted_last_run[:200]:
        sample_patients.append(PatientRecord(
            patient_id=p.patient_id,
            patient_type=p.patient_type,
            arrival_time=round(p.arrival_time, 2),
            admission_time=round(p.admission_time, 2) if p.admission_time is not None else None,
            discharge_time=round(p.discharge_time, 2) if p.discharge_time is not None else None,
            los_days=round(p.los_days, 3),
            waited=p.waited,
        ))

    # ------------------------------------------------------------------
    # 6. Metadata
    # ------------------------------------------------------------------

    metadata = SimulationMetadata(
        generated_at=datetime.now(timezone.utc),
        simulation_version=version,
        random_seed=inp.seed,
        execution_time_seconds=round(execution_time_seconds, 2),
    )

    # ------------------------------------------------------------------
    # 7. Distribution fit
    # ------------------------------------------------------------------

    distribution_fit = DistributionFit(
        elective_distribution=fit_params["elective_distribution"],
        urgent_distribution=fit_params["urgent_distribution"],
        elective_params={k: float(v) for k, v in fit_params["elective_params"].items()},
        urgent_params={k: float(v) for k, v in fit_params["urgent_params"].items()},
    )

    # ------------------------------------------------------------------
    # 8. Assemble and return
    # ------------------------------------------------------------------

    return SimulationOutput(
        unit_name=inp.unit_name,
        beds=inp.beds,
        n_runs=n_runs,
        n_days=n_days,
        kpi=kpi,
        metadata=metadata,
        distribution_fit=distribution_fit,
        census_p10_over_time=[round(v, 1) for v in census_p10_over_time],
        census_p50_over_time=[round(v, 1) for v in census_p50_over_time],
        census_p90_over_time=[round(v, 1) for v in census_p90_over_time],
        representative_run_census=[round(v, 1) for v in representative_run_census],
        occupancy_over_time=[round(v, 2) for v in occupancy_over_time],
        waiting_patients_dist=[round(v, 1) for v in all_waiting_counts],
        waiting_days_dist=[round(v, 1) for v in all_waiting_days],
        shift_staffing=shift_staffing,
        required_rn_day_dist=[float(v) for v in req_rn_day],
        required_rn_evening_dist=[float(v) for v in req_rn_eve],
        required_rn_night_dist=[float(v) for v in req_rn_night],
        sample_patients=sample_patients,
    )