"""
simulation.py
-------------
Single-run discrete-event simulation (DES) of a surgery ward.

Purpose:
    Simulates one full run of patient admissions, bed allocation,
    waiting pool management, and discharge over n_days.
    Called repeatedly by monte_carlo.py to build the distribution
    of outcomes across N runs.

Engine:
    SimPy event-driven simulation. Each patient is a SimPy process
    that requests a bed resource, waits if none is available,
    occupies the bed for their sampled LOS, then releases it on discharge.

Key logic:
    - Elective arrivals: Poisson(elective_per_day), weekdays only
    - Urgent arrivals:   Poisson(urgent_per_day), all 7 days
    - Admission rule:    FCFS or urgent-priority (no bumping)
    - Waiting pool:      patients queue until a bed is free
    - Census:            recorded at the end of every hour
    - Run duration:      extends beyond n_days to allow late admissions
                         to complete; metrics.py filters by arrival day

Functions:
    run_once(inp, elective_dist, urgent_dist, seed) -> RunResult

Output:
    RunResult containing hourly census, per-patient records,
    and daily waiting counts. Aggregated by monte_carlo.py.
"""

import simpy
import numpy as np
from typing import List

from .models import SimulationInput
from .results import PatientEntry, RunResult


# Maximum LOS cap in days — prevents extreme samples from stalling the run
_MAX_LOS_DAYS = 60.0
_MIN_LOS_DAYS = 1 / 24   # 1 hour minimum


# ---------------------------------------------------------------------------
# SimPy process: individual patient journey
# ---------------------------------------------------------------------------

def _patient_process(
    env: simpy.Environment,
    entry: PatientEntry,
    bed_resource: simpy.PriorityResource,
):
    """
    SimPy generator representing one patient's hospital journey.

    Steps:
        1. Request a bed at the patient's assigned priority level.
        2. Block until a bed is available (waiting pool behaviour).
        3. Record admission time and whether the patient waited.
        4. Occupy the bed for the sampled LOS duration.
        5. Release the bed on discharge (automatic via context manager).

    Args:
        env:          SimPy environment (shared clock).
        entry:        PatientEntry for this patient (mutated in place).
        bed_resource: Shared PriorityResource representing ward beds.
    """
    arrival = env.now

    with bed_resource.request(priority=entry.priority) as req:
        yield req

        entry.admission_time = env.now
        entry.waited = env.now > arrival

        # Use los_hours directly — simulation clock is in hours throughout
        yield env.timeout(entry.los_hours)

        entry.discharge_time = env.now


# ---------------------------------------------------------------------------
# SimPy process: hourly census recorder
# ---------------------------------------------------------------------------

def _census_recorder(
    env: simpy.Environment,
    bed_resource: simpy.PriorityResource,
    census: List[int],
    total_hours: int,
):
    """
    SimPy generator that records occupied bed count at the end of every hour.

    Sampling at the end of each hour (after a timeout) means the first
    recorded value reflects the state at t=1h, t=2h, etc. This avoids
    an artificial t=0 reading before any patients have arrived.

    Args:
        env:          SimPy environment.
        bed_resource: Shared PriorityResource.
        census:       List to append hourly counts to.
        total_hours:  Number of hours to record (n_days * 24).
    """
    for _ in range(total_hours):
        yield env.timeout(1)
        # Census is sampled at the end of each hour (t=1, t=2, …, t=n_days*24).
        # Sampling after the timeout ensures patients who arrived and were
        # admitted within that hour are already counted.
        census.append(bed_resource.count)


# ---------------------------------------------------------------------------
# SimPy process: daily waiting queue snapshot
# ---------------------------------------------------------------------------

def _waiting_recorder(
    env: simpy.Environment,
    bed_resource: simpy.PriorityResource,
    daily_waiting: List[int],
    n_days: int,
):
    """
    SimPy generator that records waiting queue length at the end of each day.

    Samples after each 24-hour timeout so the first entry represents
    the queue state at the end of Day 1, not at t=0.

    Args:
        env:           SimPy environment.
        bed_resource:  Shared PriorityResource.
        daily_waiting: List to append daily queue lengths to.
        n_days:        Number of days to record.
    """
    for _ in range(n_days):
        yield env.timeout(24)
        daily_waiting.append(len(bed_resource.queue))


# ---------------------------------------------------------------------------
# SimPy process: patient arrival generator
# ---------------------------------------------------------------------------

def _arrival_generator(
    env: simpy.Environment,
    inp: SimulationInput,
    elective_dist,
    urgent_dist,
    bed_resource: simpy.PriorityResource,
    patients: List[PatientEntry],
    rng: np.random.Generator,
):
    """
    SimPy generator that produces patient arrivals day by day.

    For each simulated day:
        - Draws elective count from Poisson (0 on weekends, Saturday=5 Sunday=6).
        - Draws urgent count from Poisson (every day).
        - Assigns each patient a uniform random arrival time within the day.
        - Schedules each patient as an independent SimPy process.

    Priority assignment:
        urgent_priority=True:
            urgent  -> priority 0 (served first)
            elective -> priority 1 (served second)
        urgent_priority=False (FCFS):
            all patients -> priority 0
            SimPy serves equal-priority requests in FIFO order.

    LOS is clipped to [_MIN_LOS_DAYS, _MAX_LOS_DAYS] to prevent
    extreme samples from extending the simulation indefinitely.

    Args:
        env:           SimPy environment.
        inp:           SimulationInput with arrival rates and priority rule.
        elective_dist: Frozen scipy distribution for elective LOS sampling.
        urgent_dist:   Frozen scipy distribution for urgent LOS sampling.
        bed_resource:  Shared PriorityResource.
        patients:      Shared patient list (appended to in place).
        rng:           NumPy Generator for reproducible randomness.
    """
    patient_counter = 0

    for day in range(inp.n_days):
        day_start_hour = day * 24.0
        is_weekend = (day % 7) >= 5   # 0=Monday … 6=Sunday

        n_elective = 0 if is_weekend else int(rng.poisson(inp.elective_per_day))
        n_urgent = int(rng.poisson(inp.urgent_per_day))

        # Build today's arrivals list with uniform offsets within the day
        arrivals = []

        for i in range(n_elective):
            patient_counter += 1
            los_days = float(np.clip(
                elective_dist.rvs(random_state=rng),
                _MIN_LOS_DAYS, _MAX_LOS_DAYS,
            ))
            # When urgent_priority=False all patients share priority 0 (FCFS).
            # When urgent_priority=True elective gets 1 (lower precedence).
            priority = 1 if inp.urgent_priority else 0
            entry = PatientEntry(
                patient_id=f"P{patient_counter:07d}",
                patient_type="elective",
                priority=priority,
                arrival_time=day_start_hour + rng.uniform(0, 24),
                los_days=los_days,
                los_hours=los_days * 24.0,
            )
            arrivals.append((entry.arrival_time, patient_counter, entry))

        for i in range(n_urgent):
            patient_counter += 1
            los_days = float(np.clip(
                urgent_dist.rvs(random_state=rng),
                _MIN_LOS_DAYS, _MAX_LOS_DAYS,
            ))
            # Urgent always priority 0 regardless of admission rule.
            # Under FCFS this equals elective priority so SimPy uses FIFO.
            entry = PatientEntry(
                patient_id=f"P{patient_counter:07d}",
                patient_type="urgent",
                priority=0,
                arrival_time=day_start_hour + rng.uniform(0, 24),
                los_days=los_days,
                los_hours=los_days * 24.0,
            )
            arrivals.append((entry.arrival_time, patient_counter, entry))

        # Sort by (arrival_time, patient_counter) for a deterministic stable order
        # when two patients share the same arrival time.
        arrivals.sort(key=lambda x: (x[0], x[1]))

        current_time = day_start_hour
        for arrival_time, _, entry in arrivals:
            wait = entry.arrival_time - current_time
            if wait > 0:
                yield env.timeout(wait)
            current_time = entry.arrival_time

            patients.append(entry)
            env.process(_patient_process(env, entry, bed_resource))

        # Advance to end of day
        remaining = (day_start_hour + 24.0) - current_time
        if remaining > 0:
            yield env.timeout(remaining)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_once(
    inp: SimulationInput,
    elective_dist,
    urgent_dist,
    seed: int,
) -> RunResult:
    """
    Execute one full simulation run and return raw results.

    Run duration:
        The SimPy clock runs for n_days * 24 hours for arrivals and census
        recording. However env.run() is called without an explicit until= so
        all in-flight patient processes (including late admissions with long
        LOS) are allowed to complete naturally. Metrics are filtered by
        arrival_time < n_days * 24 rather than by discharge_time.

    Args:
        inp:           SimulationInput configuration.
        elective_dist: Frozen scipy distribution for elective LOS.
        urgent_dist:   Frozen scipy distribution for urgent LOS.
        seed:          Unique integer seed for this run's RNG.
                       Caller passes (base_seed + run_index) so each run
                       is reproducible but statistically independent.

    Returns:
        RunResult with hourly_census (length = n_days * 24),
        patients (all arrivals), and daily_waiting_count (length = n_days).
    """
    rng = np.random.default_rng(seed)
    env = simpy.Environment()

    census: List[int] = []
    patients: List[PatientEntry] = []
    daily_waiting: List[int] = []

    total_hours = inp.n_days * 24

    bed_resource = simpy.PriorityResource(env, capacity=inp.beds)

    env.process(_census_recorder(env, bed_resource, census, total_hours))
    env.process(_waiting_recorder(env, bed_resource, daily_waiting, inp.n_days))
    env.process(
        _arrival_generator(
            env, inp, elective_dist, urgent_dist,
            bed_resource, patients, rng,
        )
    )

    # Run without until= so late-admitted patients can complete discharge.
    # Arrival and census processes self-terminate after n_days.
    env.run()

    # Pad census in case env.run() ended before all hours were recorded
    while len(census) < total_hours:
        census.append(bed_resource.count)

    return RunResult(
        hourly_census=census,
        patients=patients,
        daily_waiting_count=daily_waiting,
    )