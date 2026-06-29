/**
 * KPICards.jsx
 * ------------
 * Executive summary cards displayed at the top of the dashboard.
 *
 * Purpose:
 *   Renders 7 KPI cards from SimulationOutput.kpi. Each card shows
 *   a metric value with a colour-coded status (good / warn / bad)
 *   based on clinically meaningful thresholds.
 *
 * Props:
 *   kpi           KPICards object from SimulationOutput.
 *   beds          Number of beds (used for context in subtitles).
 *   metadata      SimulationMetadata (execution time, seed, version).
 *
 * Thresholds (standard acute care benchmarks):
 *   Occupancy      < 85% good  |  85-95% warn  |  > 95% bad
 *   Waiting risk   < 10% good  |  10-30% warn  |  > 30% bad
 *   Staff shortage < 10% good  |  10-25% warn  |  > 25% bad
 */

// ---------------------------------------------------------------------------
// Threshold helpers
// ---------------------------------------------------------------------------

function occupancyStatus(pct) {
    if (pct < 85) return "good";
    if (pct < 95) return "warn";
    return "bad";
}

function riskStatus(fraction) {
    if (fraction < 0.10) return "good";
    if (fraction < 0.30) return "warn";
    return "bad";
}

function staffStatus(fraction) {
    if (fraction < 0.10) return "good";
    if (fraction < 0.25) return "warn";
    return "bad";
}

// ---------------------------------------------------------------------------
// Single KPI card
// ---------------------------------------------------------------------------

function KPICard({ label, value, sub, status }) {
    return (
        <div className={`kpi-card${status ? ` kpi-card--${status}` : ""}`}>
            <div className="kpi-card__label">{label}</div>
            <div className="kpi-card__value">{value}</div>
            {sub && <div className="kpi-card__sub">{sub}</div>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function KPICards({ kpi, beds, metadata }) {
    if (!kpi) return null;

    const {
        median_daily_peak_census,
        p95_daily_peak_census,
        mean_occupancy_rate,
        waiting_risk,
        staff_shortage_shift_risk,
        alos_elective,
        alos_urgent,
        recommended_beds_85,
        recommended_beds_95,
    } = kpi;

    return (
        <div>
            {/* Metadata bar */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-4)",
                flexWrap: "wrap",
                gap: "var(--space-2)",
            }}>
                <div className="section-label" style={{ margin: 0 }}>
                    Key Performance Indicators
                </div>
                {metadata && (
                    <span style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.68rem",
                        color: "var(--text-muted)",
                    }}>
                        {metadata.n_runs ?? "—"} runs · {metadata.n_days ?? "—"} days ·{" "}
                        seed {metadata.random_seed} · {metadata.execution_time_seconds?.toFixed(1)}s
                    </span>
                )}
            </div>

            <div className="kpi-grid">
                <KPICard
                    label="Median Peak Census"
                    value={median_daily_peak_census?.toFixed(1)}
                    sub={`P95: ${p95_daily_peak_census?.toFixed(1)} · Beds: ${beds}`}
                />

                <KPICard
                    label="Occupancy Rate"
                    value={`${mean_occupancy_rate?.toFixed(1)}%`}
                    sub="avg census / beds"
                    status={occupancyStatus(mean_occupancy_rate)}
                />

                <KPICard
                    label="Waiting Risk"
                    value={`${(waiting_risk * 100)?.toFixed(1)}%`}
                    sub="days with queue > 0"
                    status={riskStatus(waiting_risk)}
                />

                <KPICard
                    label="Staff Shortage"
                    value={`${(staff_shortage_shift_risk * 100)?.toFixed(1)}%`}
                    sub="shift-days understaffed"
                    status={staffStatus(staff_shortage_shift_risk)}
                />

                <KPICard
                    label="ALOS — Elective"
                    value={`${alos_elective?.toFixed(1)}d`}
                    sub="mean admitted LOS"
                />

                <KPICard
                    label="ALOS — Urgent"
                    value={`${alos_urgent?.toFixed(1)}d`}
                    sub="mean admitted LOS"
                />

                <KPICard
                    label="Peak vs Capacity"
                    value={`${((median_daily_peak_census / beds) * 100)?.toFixed(0)}%`}
                    sub={`median peak / ${beds} beds`}
                    status={occupancyStatus((median_daily_peak_census / beds) * 100)}
                />

                <KPICard
                    label="Recommended Beds (85%)"
                    value={recommended_beds_85}
                    sub="Little's Law · 85% occ. target"
                    status={beds >= recommended_beds_85 ? "good" : "warn"}
                />

                <KPICard
                    label="Recommended Beds (95%)"
                    value={recommended_beds_95}
                    sub="Little's Law · 95% occ. target"
                    status={beds >= recommended_beds_95 ? "good" : "bad"}
                />
            </div>
        </div>
    );
}