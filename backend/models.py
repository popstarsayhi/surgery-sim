"""
models.py
---------
Pydantic schemas defining the request and response contracts
between the React frontend and the FastAPI backend.

Purpose:
    - Validate and parse all user inputs before simulation begins
    - Define the exact JSON structure returned to the frontend
    - Serve as the single source of truth for the data contract

Input schemas:
    LOSPercentiles      Five-point percentile summary of LOS distribution
    NurseRatios         Nurse-to-patient ratios per shift
    ScheduledNurses     Number of nurses on duty per shift
    SimulationInput     Complete simulation configuration (root input model)

Output schemas:
    DistributionFit     Parameters of the fitted Gamma/LogNormal distribution
    PatientRecord       Single patient record for the sample table
    ShiftStaffingStats  Staffing metrics for one shift (day / evening / night)
    KPICards            Executive KPIs shown at the top of the dashboard
    SimulationMetadata  Run provenance: timestamp, version, seed, duration
    SimulationOutput    Complete simulation results (root output model)
"""

from datetime import datetime
from typing import Dict, Literal
from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Input schemas
# ---------------------------------------------------------------------------

class LOSPercentiles(BaseModel):
    """
    Length of Stay (LOS) distribution summarized by key percentiles.

    Users provide only five percentiles instead of raw patient-level data.
    These values are later used to fit a probability distribution
    (Gamma or LogNormal) for Monte Carlo simulation.
    """
    p10: float = Field(..., gt=0, description="10th percentile LOS in days")
    p25: float = Field(..., gt=0)
    p50: float = Field(..., gt=0)
    p75: float = Field(..., gt=0)
    p90: float = Field(..., gt=0)

    @model_validator(mode="after")
    def check_order(self):
        values = [self.p10, self.p25, self.p50, self.p75, self.p90]
        if values != sorted(values):
            raise ValueError("LOS percentiles must satisfy P10 <= P25 <= P50 <= P75 <= P90")
        return self


class NurseRatios(BaseModel):
    """
    Nurse-to-patient ratios.

    Values represent the maximum number of patients assigned
    to one nurse during each shift.
    Example:
        day = 4
        -> one nurse is responsible for four patients.
    """
    day: int = Field(..., ge=1, le=20, description="Patients per nurse, day shift 07:00-15:00")
    evening: int = Field(..., ge=1, le=20, description="Patients per nurse, evening shift 15:00-23:00")
    night: int = Field(..., ge=1, le=20, description="Patients per nurse, night shift 23:00-07:00")


class ScheduledNurses(BaseModel):
    """
    Number of nurses scheduled for each shift.

    These values are compared against simulated staffing
    requirements to estimate staffing shortages.
    """
    day: int = Field(..., ge=0)
    evening: int = Field(..., ge=0)
    night: int = Field(..., ge=0)


class SimulationInput(BaseModel):
    """
    Complete simulation configuration submitted by the frontend.

    Includes:
    - Unit characteristics
    - Bed capacity
    - Patient arrival rates
    - LOS distributions
    - Staffing configuration
    - Monte Carlo settings
    """

    # Unit information
    unit_name: str = Field(default="Surgery Ward", min_length=1, max_length=50)

    # Physical staffed beds available
    beds: int = Field(..., ge=1, le=200)

    # Average weekday elective admissions (weekend elective = 0)
    elective_per_day: float = Field(..., ge=0)

    # Average daily urgent admissions (all 7 days)
    urgent_per_day: float = Field(..., ge=0)

    # Waiting queue policy
    urgent_priority: bool = Field(
        default=False,
        description=(
            "If True, urgent patients are processed before elective "
            "in the waiting pool. No bumping of admitted patients."
        )
    )

    # LOS distributions
    los_elective: LOSPercentiles
    los_urgent: LOSPercentiles

    # Staffing configuration
    nurse_ratios: NurseRatios
    scheduled_nurses: ScheduledNurses

    # Monte Carlo settings
    n_runs: int = Field(default=100, ge=10, le=500)
    n_days: int = Field(default=30, ge=7, le=90)
    seed: int = Field(default=42)


# ---------------------------------------------------------------------------
# Output schemas
# ---------------------------------------------------------------------------

class DistributionFit(BaseModel):
    """
    Parameters of the fitted LOS distributions.

    Returned for transparency so users can verify
    which distribution was fitted before simulation.

    Elective and urgent are fitted independently and may use
    different distribution families (e.g. elective=gamma, urgent=lognorm).
    """
    # Distribution family selected for elective LOS
    elective_distribution: Literal["gamma", "lognorm"]
    # Distribution family selected for urgent LOS
    urgent_distribution: Literal["gamma", "lognorm"]
    # e.g. {"shape": 2.1, "scale": 1.4} for gamma, {"sigma": 0.76, "scale": 3.0} for lognorm
    elective_params: Dict[str, float]
    urgent_params: Dict[str, float]


class PatientRecord(BaseModel):
    """
    Single patient record from the simulation.

    Included in the sample table on the frontend so users can
    inspect individual patient journeys from the final run.
    """
    patient_id: str
    patient_type: str                   # "elective" | "urgent"
    arrival_time: float                 # hours from simulation start
    admission_time: float | None        # None if patient is still waiting at end
    discharge_time: float | None        # None if not yet discharged
    los_days: float                     # sampled LOS in days
    waited: bool                        # True if patient entered waiting pool


class ShiftStaffingStats(BaseModel):
    """
    Staffing statistics for a single shift.

    Reports:
    - simulated peak census
    - required nurses
    - scheduled nurses
    - staffing shortage probability
    - average staffing gap
    """
    shift: str                          # "day" | "evening" | "night"
    hours: str                          # e.g. "07:00-15:00"
    peak_census_p50: float
    peak_census_p95: float
    required_rn_p50: float
    required_rn_p95: float
    scheduled_rn: int
    # Fraction of shift-days where required RN > scheduled RN
    shortage_shift_risk: float
    # mean(required - scheduled); negative = surplus
    mean_gap: float


class KPICards(BaseModel):
    """
    Executive summary displayed at the top of the dashboard.

    These KPIs summarize the overall simulation results
    and provide a quick overview of unit performance.
    """
    median_daily_peak_census: float
    p95_daily_peak_census: float
    # Percentage (0-100): average census / beds * 100
    mean_occupancy_rate: float
    # Fraction of days where at least one patient waited for a bed
    waiting_risk: float
    # Fraction of shift-days where required RN > scheduled RN
    staff_shortage_shift_risk: float
    # Mean realised LOS in days for admitted elective patients
    alos_elective: float
    # Mean realised LOS in days for admitted urgent patients
    alos_urgent: float
    # Little's Law estimate: beds needed for 85% occupancy target
    recommended_beds_85: int
    # Little's Law estimate: beds needed for 95% occupancy target
    recommended_beds_95: int


class SimulationMetadata(BaseModel):
    """
    Provenance information for the simulation run.

    Allows users to reproduce results and track when and how
    a simulation was executed. Included in any downloaded reports.
    """
    generated_at: datetime
    simulation_version: str             # e.g. "1.0.0"
    random_seed: int
    execution_time_seconds: float


class SimulationOutput(BaseModel):
    """
    Complete simulation results returned to the frontend.

    Contains:
    - dashboard KPIs
    - chart-ready datasets
    - staffing summaries
    - sample patient records
    - run metadata
    """

    # Unit information
    unit_name: str
    beds: int
    n_runs: int
    n_days: int

    # Dashboard summary
    kpi: KPICards

    # Run provenance
    metadata: SimulationMetadata

    # Parameters of fitted LOS distributions
    distribution_fit: DistributionFit

    # Daily census band across simulation days (length = n_days each)
    # P10/P50/P90 computed across all MC runs for each day
    census_p10_over_time: list[float]
    census_p50_over_time: list[float]
    census_p90_over_time: list[float]

    # Single representative run: daily peak census, length = n_days
    # Selected as the run whose median daily peak is closest to P50 across all runs
    # Shows real day-to-day fluctuation including weekend effects
    representative_run_census: list[float]

    # Mean daily occupancy rate (0-100) across all runs, length = n_days
    occupancy_over_time: list[float]

    # Waiting patients per day pooled across all runs
    waiting_patients_dist: list[float]

    # Number of days with waiting queue > 0, one value per run
    waiting_days_dist: list[float]

    # Staffing summary for each shift (day, evening, night)
    shift_staffing: list[ShiftStaffingStats]

    # RN requirement distributions per shift-day, pooled across runs
    required_rn_day_dist: list[float]
    required_rn_evening_dist: list[float]
    required_rn_night_dist: list[float]

    # Sample patient records from the final simulation run
    sample_patients: list[PatientRecord]