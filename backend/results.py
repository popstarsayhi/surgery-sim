"""
results.py
----------
Dataclasses representing the raw output of a single simulation run.

Purpose:
    Separates simulation data structures from both the SimPy engine
    (simulation.py) and the Pydantic API schemas (models.py).
    monte_carlo.py and metrics.py consume these structures directly.

Classes:
    PatientEntry    Per-patient record produced during simulation.
    RunResult       Aggregated output of one complete simulation run.
"""

from dataclasses import dataclass, field
from typing import List, Literal, Optional


@dataclass
class PatientEntry:
    """
    Record for a single simulated patient.

    Created by the arrival generator in simulation.py and mutated
    in place as the patient moves through the system (waiting → admitted
    → discharged). Consumed by metrics.py to compute ALOS and waiting stats.
    """
    patient_id: str
    patient_type: Literal["elective", "urgent"]
    # SimPy priority value: 0 = served first, 1 = served second
    priority: int
    # Hours from simulation start
    arrival_time: float
    # Sampled LOS in days (clipped to [1/24, 60])
    los_days: float
    # Sampled LOS in hours — internal simulation unit to avoid repeated * 24
    los_hours: float
    # None until patient is admitted
    admission_time: Optional[float] = None
    # None until patient is discharged (may be None if run ended first)
    discharge_time: Optional[float] = None
    # True if patient spent any time in the waiting pool before admission
    waited: bool = False


@dataclass
class RunResult:
    """
    Raw outputs from a single simulation run.

    Consumed by metrics.py to compute KPIs, percentiles, and chart data.
    Intentionally kept as plain Python lists for speed; no NumPy arrays here
    so that concurrent.futures can serialise results without pickling issues.
    """
    # Number of occupied beds sampled every hour, length = n_days * 24
    hourly_census: List[int] = field(default_factory=list)

    # All patients generated in this run (admitted + still waiting at end)
    patients: List[PatientEntry] = field(default_factory=list)

    # Length of waiting queue sampled at end of each day, length = n_days
    daily_waiting_count: List[int] = field(default_factory=list)