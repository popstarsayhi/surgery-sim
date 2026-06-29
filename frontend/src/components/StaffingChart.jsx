/**
 * StaffingChart.jsx
 * -----------------
 * Three charts summarising shift-level staffing results.
 *
 * Purpose:
 *   1. Shift staffing comparison — grouped bar chart showing
 *      P50 required RN vs scheduled RN for each shift.
 *   2. Required RN distributions — three histograms (day / evening /
 *      night) showing the spread of required nurses per shift-day.
 *   3. Staffing gap summary — horizontal bar chart showing mean gap
 *      (required − scheduled) per shift, colour-coded by direction.
 *
 * Props:
 *   shiftStaffing         list[ShiftStaffingStats]  3 items from backend
 *   requiredRnDayDist     list[float]  pooled required RN, day shift
 *   requiredRnEveningDist list[float]  pooled required RN, evening shift
 *   requiredRnNightDist   list[float]  pooled required RN, night shift
 */

import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    CartesianGrid, ReferenceLine, Cell, Legend,
} from "recharts";

// ---------------------------------------------------------------------------
// Histogram builder (reused from CensusChart pattern)
// ---------------------------------------------------------------------------

function buildHistogram(values, nBins = 20) {
    if (!values?.length) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const binWidth = range / nBins;

    const counts = Array.from({ length: nBins }, (_, i) => ({
        bin: parseFloat((min + i * binWidth).toFixed(1)),
        count: 0,
    }));

    values.forEach((v) => {
        const i = Math.min(nBins - 1, Math.floor((v - min) / binWidth));
        counts[i].count += 1;
    });

    return counts;
}

// ---------------------------------------------------------------------------
// Shared tooltip
// ---------------------------------------------------------------------------

function SimpleTooltip({ active, payload, label, unit = "" }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "8px 12px",
            fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text)",
        }}>
            <div>{label}{unit}</div>
            {payload.map((p) => (
                <div key={p.dataKey} style={{ color: p.color, fontWeight: 600 }}>
                    {p.name}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value}
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// RN distribution histogram (one shift)
// ---------------------------------------------------------------------------

function RNHistogram({ dist, scheduled, shiftLabel, color }) {
    const data = buildHistogram(dist, 15);

    return (
        <div className="card">
            <div className="card__title">{shiftLabel} — Required RN Distribution</div>
            <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                        dataKey="bin"
                        tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                        label={{ value: "RN required", position: "insideBottom", offset: -2, fontSize: 10, fill: "var(--text-muted)" }}
                    />
                    <YAxis
                        tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                        width={28}
                    />
                    <Tooltip content={<SimpleTooltip unit=" RN" />} />
                    <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} opacity={0.85} name="Days" />
                    <ReferenceLine
                        x={scheduled}
                        stroke="var(--red)"
                        strokeDasharray="4 3"
                        label={{ value: `Sched=${scheduled}`, position: "top", fontSize: 9, fill: "var(--red)" }}
                    />
                </BarChart>
            </ResponsiveContainer>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                Red line = scheduled nurses · right of line = shortage
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StaffingChart({
    shiftStaffing,
    requiredRnDayDist,
    requiredRnEveningDist,
    requiredRnNightDist,
}) {
    if (!shiftStaffing?.length) return null;

    // Build comparison bar data
    const comparisonData = shiftStaffing.map((s) => ({
        shift: s.hours,
        "Required (P50)": parseFloat(s.required_rn_p50.toFixed(1)),
        "Required (P95)": parseFloat(s.required_rn_p95.toFixed(1)),
        Scheduled: s.scheduled_rn,
    }));

    // Build gap data
    const gapData = shiftStaffing.map((s) => ({
        shift: s.hours,
        gap: parseFloat(s.mean_gap.toFixed(2)),
        risk: `${(s.shortage_shift_risk * 100).toFixed(0)}%`,
    }));

    const distByShift = {
        day: { dist: requiredRnDayDist, label: "Day (07–15)", color: "var(--chart-1)" },
        evening: { dist: requiredRnEveningDist, label: "Evening (15–23)", color: "var(--chart-4)" },
        night: { dist: requiredRnNightDist, label: "Night (23–07)", color: "var(--chart-2)" },
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>

            {/* ── Row 1: Comparison + Gap ── */}
            <div className="chart-grid-2">

                {/* Grouped bar: required vs scheduled */}
                <div className="card">
                    <div className="card__title">Required vs Scheduled Nurses</div>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={comparisonData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis
                                dataKey="shift"
                                tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            />
                            <YAxis
                                tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                                width={28}
                                label={{ value: "Nurses", angle: -90, position: "insideLeft", fontSize: 10, fill: "var(--text-muted)" }}
                            />
                            <Tooltip content={<SimpleTooltip />} />
                            <Legend
                                wrapperStyle={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)" }}
                            />
                            <Bar dataKey="Required (P50)" fill="var(--chart-1)" radius={[3, 3, 0, 0]} opacity={0.85} />
                            <Bar dataKey="Required (P95)" fill="var(--chart-3)" radius={[3, 3, 0, 0]} opacity={0.70} />
                            <Bar dataKey="Scheduled" fill="var(--chart-2)" radius={[3, 3, 0, 0]} opacity={0.85} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                        Blue = P50 required · amber = P95 required · green = scheduled
                    </div>
                </div>

                {/* Mean gap horizontal bars */}
                <div className="card">
                    <div className="card__title">Mean Staffing Gap (Required − Scheduled)</div>
                    <div style={{ marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
                        {gapData.map((d) => {
                            const isShort = d.gap > 0;
                            const barColor = isShort ? "var(--red)" : "var(--green)";
                            const maxGap = Math.max(...gapData.map((g) => Math.abs(g.gap)), 1);
                            const barPct = Math.min((Math.abs(d.gap) / maxGap) * 100, 100);

                            return (
                                <div key={d.shift}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>
                                            {d.shift}
                                        </span>
                                        <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", fontWeight: 600, color: barColor }}>
                                            {d.gap > 0 ? "+" : ""}{d.gap.toFixed(2)} RN · shortage {d.risk}
                                        </span>
                                    </div>
                                    <div style={{ background: "var(--surface-2)", borderRadius: 4, height: 10, overflow: "hidden" }}>
                                        <div style={{
                                            height: "100%", width: `${barPct}%`,
                                            background: barColor, borderRadius: 4,
                                            transition: "width 0.6s ease",
                                        }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "var(--space-5)" }}>
                        Positive = shortage · negative = surplus
                    </div>
                </div>
            </div>

            {/* ── Row 2: RN distribution histograms ── */}
            <div className="chart-grid-3">
                {shiftStaffing.map((s) => {
                    const key = s.shift;
                    const { dist, label, color } = distByShift[key] ?? {};
                    return (
                        <RNHistogram
                            key={key}
                            dist={dist}
                            scheduled={s.scheduled_rn}
                            shiftLabel={label}
                            color={color}
                        />
                    );
                })}
            </div>

        </div>
    );
}