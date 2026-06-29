/**
 * CensusChart.jsx
 * ---------------
 * Two census charts displayed side by side.
 *
 * Left:  Representative run — raw daily peak census from a single
 *        median run, showing real day-to-day fluctuation including
 *        weekend dips and week-to-week variation.
 *
 * Right: P10/P50/P90 band — uncertainty across all MC runs,
 *        showing how census varies between optimistic and pessimistic
 *        scenarios on each simulation day.
 *
 * Props:
 *   representativeRunCensus  list[float]  daily peaks, single run
 *   censusP10OverTime        list[float]  P10 per day across runs
 *   censusP50OverTime        list[float]  P50 per day across runs
 *   censusP90OverTime        list[float]  P90 per day across runs
 *   beds                     number       bed capacity reference line
 */

import {
    ComposedChart, AreaChart, Area, Line, XAxis, YAxis, Tooltip,
    ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
    LineChart,
} from "recharts";

// ---------------------------------------------------------------------------
// Shared tooltip style
// ---------------------------------------------------------------------------

const tooltipStyle = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "8px 12px",
    fontSize: "0.75rem",
    fontFamily: "var(--font-mono)",
    color: "var(--text)",
};

function RepTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={tooltipStyle}>
            <div>Day {label}</div>
            <div style={{ color: "var(--chart-1)", fontWeight: 600 }}>
                Peak census: {payload[0]?.value?.toFixed(0)}
            </div>
        </div>
    );
}

function BandTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    const get = (name) => payload.find(p => p.name === name)?.value?.toFixed(1);
    return (
        <div style={tooltipStyle}>
            <div style={{ marginBottom: 4 }}>Day {label}</div>
            <div style={{ color: "var(--chart-3)" }}>P90: {get("P90")}</div>
            <div style={{ color: "var(--chart-1)", fontWeight: 600 }}>P50: {get("P50")}</div>
            <div style={{ color: "var(--chart-2)" }}>P10: {get("P10")}</div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CensusChart({
    representativeRunCensus,
    censusP10OverTime,
    censusP50OverTime,
    censusP90OverTime,
    beds,
}) {
    // Single run chart data
    const repData = (representativeRunCensus ?? []).map((v, i) => ({
        day: i + 1,
        census: v,
    }));

    // Band chart data
    const bandData = (censusP50OverTime ?? []).map((p50, i) => ({
        day: i + 1,
        p10: censusP10OverTime?.[i] ?? 0,
        p50,
        p90: censusP90OverTime?.[i] ?? 0,
    }));

    return (
        <div className="chart-grid-2">

            {/* ── Left: Representative single run ── */}
            <div className="card">
                <div className="card__title">Typical Run — Daily Peak Census</div>
                <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={repData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                            dataKey="day"
                            tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            label={{ value: "Day", position: "insideBottom", offset: -2, fontSize: 10, fill: "var(--text-muted)" }}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            width={28}
                            domain={[0, Math.max(beds + 4, Math.max(...(representativeRunCensus ?? [0])) + 2)]}
                        />
                        <Tooltip content={<RepTooltip />} />
                        <ReferenceLine
                            y={beds}
                            stroke="var(--red)"
                            strokeDasharray="4 3"
                            label={{ value: `Beds=${beds}`, position: "right", fontSize: 10, fill: "var(--red)" }}
                        />
                        <Area
                            type="monotone"
                            dataKey="census"
                            stroke="var(--chart-1)"
                            strokeWidth={1.5}
                            fill="var(--chart-1)"
                            fillOpacity={0.12}
                            dot={false}
                            activeDot={{ r: 3 }}
                            name="Census"
                        />
                    </ComposedChart>
                </ResponsiveContainer>
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                    Median representative run · shows weekend dips + weekly pattern
                </div>
            </div>

            {/* ── Right: P10/P50/P90 band ── */}
            <div className="card">
                <div className="card__title">Uncertainty Band — P10 / P50 / P90</div>
                <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={bandData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                            dataKey="day"
                            tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            label={{ value: "Day", position: "insideBottom", offset: -2, fontSize: 10, fill: "var(--text-muted)" }}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            width={28}
                            domain={[0, "auto"]}
                        />
                        <Tooltip content={<BandTooltip />} />
                        <ReferenceLine
                            y={beds}
                            stroke="var(--red)"
                            strokeDasharray="4 3"
                            label={{ value: `Beds=${beds}`, position: "right", fontSize: 10, fill: "var(--red)" }}
                        />
                        {/* Shaded band between P10 and P90 */}
                        <Area
                            type="monotone"
                            dataKey="p90"
                            stroke="none"
                            fill="var(--chart-1)"
                            fillOpacity={0.12}
                            name="P90"
                        />
                        <Area
                            type="monotone"
                            dataKey="p10"
                            stroke="none"
                            fill="var(--bg)"
                            fillOpacity={1}
                            name="P10base"
                            legendType="none"
                        />
                        <Line type="monotone" dataKey="p10" stroke="var(--chart-2)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="P10" />
                        <Line type="monotone" dataKey="p50" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} name="P50" />
                        <Line type="monotone" dataKey="p90" stroke="var(--chart-3)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="P90" />
                        <Legend wrapperStyle={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)" }} />
                    </ComposedChart>
                </ResponsiveContainer>
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                    Spread across all MC runs · red = bed capacity
                </div>
            </div>

        </div>
    );
}