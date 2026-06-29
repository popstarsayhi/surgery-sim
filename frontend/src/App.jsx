/**
 * App.jsx
 * -------
 * Root component — assembles sidebar, header, and dashboard.
 *
 * Purpose:
 *   Owns simulation state (idle / loading / success / error).
 *   Calls the FastAPI backend via simulate.js and passes results
 *   down to dashboard components.
 *
 * State:
 *   status        "idle" | "loading" | "success" | "error"
 *   result        SimulationOutput | null
 *   errorMsg      string | null
 *
 * Layout:
 *   app-shell
 *   ├── app-header
 *   └── app-body
 *       ├── Sidebar  (left, sticky)
 *       └── main     (right, scrollable)
 *           ├── KPICards
 *           ├── CensusChart
 *           ├── StaffingChart
 *           └── OverflowChart
 */

import { useState } from "react";
import Sidebar from "./components/Sidebar";
import KPICards from "./components/KPICards";
import CensusChart from "./components/CensusChart";
import StaffingChart from "./components/StaffingChart";
import OverflowChart from "./components/OverflowChart";
import { runSimulation, buildPayload, NetworkError, ValidationError } from "./api/simulate";

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function ErrorBanner({ message, onDismiss }) {
  return (
    <div style={{
      background: "var(--red-light)", border: "1px solid var(--red)",
      borderRadius: "var(--radius)", padding: "var(--space-4) var(--space-5)",
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: "var(--space-4)",
    }}>
      <div>
        <div style={{ fontWeight: 600, color: "var(--red)", fontSize: "0.85rem", marginBottom: 4 }}>
          Simulation failed
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
          {message}
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: "1.1rem", lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------

function LoadingPanel({ nRuns, nDays }) {
  return (
    <div className="empty-state">
      <div style={{ fontSize: "2.5rem" }}>⏳</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", color: "var(--accent)", fontWeight: 600 }}>
        Running simulation…
      </div>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        {nRuns} Monte Carlo runs × {nDays} days
      </div>
      <div className="progress-bar" style={{ width: 200 }}>
        <div className="progress-bar__fill" style={{ width: "100%", animation: "indeterminate 1.4s ease infinite" }} />
      </div>
      <style>{`
        @keyframes indeterminate {
          0%   { transform: translateX(-100%); width: 60%; }
          50%  { transform: translateX(100%);  width: 60%; }
          100% { transform: translateX(200%);  width: 60%; }
        }
        .progress-bar { overflow: hidden; position: relative; }
        .progress-bar__fill { position: absolute; }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">⚕</div>
      <p>
        Configure parameters in the sidebar<br />
        and click <strong>Run Simulation</strong> to begin.
      </p>
      <p style={{ fontSize: "0.72rem" }}>
        Powered by SimPy discrete-event simulation<br />
        + Monte Carlo uncertainty analysis
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard (shown after successful run)
// ---------------------------------------------------------------------------

function Dashboard({ result }) {
  const { kpi, metadata, distribution_fit,
    census_p10_over_time, census_p50_over_time, census_p90_over_time,
    representative_run_census,
    occupancy_over_time,
    shift_staffing,
    required_rn_day_dist, required_rn_evening_dist, required_rn_night_dist,
    waiting_patients_dist, waiting_days_dist,
    beds, n_runs, n_days } = result;

  // Pass n_runs and n_days into metadata so KPICards can display them
  const metaWithCounts = { ...metadata, n_runs, n_days };

  return (
    <>
      <KPICards kpi={kpi} beds={beds} metadata={metaWithCounts} />

      <CensusChart
        representativeRunCensus={representative_run_census}
        censusP10OverTime={census_p10_over_time}
        censusP50OverTime={census_p50_over_time}
        censusP90OverTime={census_p90_over_time}
        occupancyOverTime={occupancy_over_time}
        beds={beds}
      />

      <StaffingChart
        shiftStaffing={shift_staffing}
        requiredRnDayDist={required_rn_day_dist}
        requiredRnEveningDist={required_rn_evening_dist}
        requiredRnNightDist={required_rn_night_dist}
      />

      <OverflowChart
        waitingPatientsDist={waiting_patients_dist}
        waitingDaysDist={waiting_days_dist}
        nDays={n_days}
      />

      {/* Distribution fit info */}
      <div className="card" style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        <div className="card__title">Distribution Fit</div>
        <div style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>
          <span>
            Elective LOS → <strong style={{ color: "var(--text)" }}>{distribution_fit.elective_distribution}</strong>
            {" "}({Object.entries(distribution_fit.elective_params).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(", ")})
          </span>
          <span>
            Urgent LOS → <strong style={{ color: "var(--text)" }}>{distribution_fit.urgent_distribution}</strong>
            {" "}({Object.entries(distribution_fit.urgent_params).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(", ")})
          </span>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

export default function App() {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [lastForm, setLastForm] = useState(null);

  async function handleSubmit(form) {
    setLastForm(form);
    setStatus("loading");
    setErrorMsg(null);

    try {
      const payload = buildPayload(form);
      const data = await runSimulation(payload);
      setResult(data);
      setStatus("success");
    } catch (err) {
      if (err instanceof ValidationError) {
        // Format pydantic validation errors
        const messages = err.detail
          .map((e) => `${e.loc?.slice(1).join(".") ?? "field"}: ${e.msg}`)
          .join(" · ");
        setErrorMsg(messages);
      } else {
        setErrorMsg(err.message);
      }
      setStatus("error");
    }
  }

  const isLoading = status === "loading";

  return (
    <div className="app-shell">

      {/* ── Header ── */}
      <header className="app-header">
        <div>
          <div className="app-header__title">BED & STAFFING SIMULATOR</div>
          <div className="app-header__sub">
            Surgery Ward · Monte Carlo DES · SimPy
          </div>
        </div>
        {result && (
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: "0.68rem",
            color: "var(--green)", background: "var(--green-light)",
            padding: "3px 10px", borderRadius: 20,
          }}>
            ✓ {result.n_runs} runs complete
          </span>
        )}
      </header>

      {/* ── Body ── */}
      <div className="app-body">

        {/* Sidebar */}
        <aside className="sidebar">
          <Sidebar onSubmit={handleSubmit} isLoading={isLoading} />
        </aside>

        {/* Main content */}
        <main className="main">
          {status === "error" && (
            <ErrorBanner
              message={errorMsg}
              onDismiss={() => setStatus(result ? "success" : "idle")}
            />
          )}

          {status === "idle" && <EmptyState />}
          {status === "loading" && <LoadingPanel nRuns={lastForm?.nRuns ?? 500} nDays={lastForm?.nDays ?? 90} />}
          {status === "success" && result && <Dashboard result={result} />}
        </main>

      </div>
    </div>
  );
}