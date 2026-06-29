/**
 * OverflowChart.jsx
 * -----------------
 * Two charts showing waiting pool behaviour across Monte Carlo runs.
 *
 * Purpose:
 *   1. Waiting patients distribution — histogram of daily waiting
 *      queue counts pooled across all runs. Shows how often and
 *      how many patients are in the waiting pool on any given day.
 *   2. Waiting days per run — histogram of how many days per run
 *      had at least one patient in the waiting pool. Shows the
 *      run-level distribution of waiting burden.
 *
 * Props:
 *   waitingPatientsDist   list[float]  daily waiting counts, pooled
 *   waitingDaysDist       list[float]  days-with-waiting per run
 *   nDays                 number       simulation days (for context)
 */

import {
    BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";

// ---------------------------------------------------------------------------
// Histogram builder
// ---------------------------------------------------------------------------

function buildHistogram(values, nBins = 20) {
    if (!values?.length) return [];
    const positives = values.filter((v) => v > 0);
    if (!positives.length) return [{ bin: "0", count: values.length }];

    const min = 0;
    const max = Math.max(...values);
    const range = max - min || 1;
    const binWidth = Math.max(range / nBins, 1);
    const actualBins = Math.ceil(range / binWidth);

    const counts = Array.from({ length: actualBins + 1 }, (_, i) => ({
        bin: parseFloat((min + i * binWidth).toFixed(1)),
        count: 0,
    }));

    values.forEach((v) => {
        const i = Math.min(counts.length - 1, Math.floor((v - min) / binWidth));
        counts[i].count += 1;
    });

    return counts;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function WaitTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "8px 12px",
            fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text)",
        }}>
            <div>≥ {payload[0]?.payload?.bin} patients waiting</div>
            <div style={{ color: "var(--chart-3)", fontWeight: 600 }}>
                {payload[0]?.value} days
            </div>
        </div>
    );
}

function DaysTooltip({ active, payload }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "8px 12px",
            fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text)",
        }}>
            <div>≥ {payload[0]?.payload?.bin} days with waiting</div>
            <div style={{ color: "var(--chart-5)", fontWeight: 600 }}>
                {payload[0]?.value} runs
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Summary stats strip
// ---------------------------------------------------------------------------

function StatStrip({ values, label, color }) {
    if (!values?.length) return null;

    const nonZero = values.filter((v) => v > 0);
    const riskPct = ((nonZero.length / values.length) * 100).toFixed(1);
    const sorted = [...values].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)]?.toFixed(1) ?? "—";
    const p95 = sorted[Math.floor(sorted.length * 0.95)]?.toFixed(1) ?? "—";
    const max = Math.max(...values).toFixed(1);

    return (
        <div style={{
            display: "flex", gap: "var(--space-5)",
            padding: "var(--space-3) var(--space-4)",
            background: "var(--surface-2)", borderRadius: "var(--radius-sm)",
            marginBottom: "var(--space-3)", flexWrap: "wrap",
        }}>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {label}
            </span>
            {[
                { key: "Risk", val: `${riskPct}%` },
                { key: "P50", val: p50 },
                { key: "P95", val: p95 },
                { key: "Max", val: max },
            ].map(({ key, val }) => (
                <span key={key} style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "var(--text-muted)" }}>{key} </span>
                    <span style={{ color, fontWeight: 600 }}>{val}</span>
                </span>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function OverflowChart({
    waitingPatientsDist,
    waitingDaysDist,
    nDays,
}) {
    const patientHistData = buildHistogram(waitingPatientsDist, 20);
    const daysHistData = buildHistogram(waitingDaysDist, 20);

    return (
        <div className="chart-grid-2">

            {/* ── Waiting patients per day ── */}
            <div className="card">
                <div className="card__title">Waiting Queue Size Distribution</div>

                <StatStrip
                    values={waitingPatientsDist}
                    label="Patients waiting / day"
                    color="var(--chart-3)"
                />

                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={patientHistData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                            dataKey="bin"
                            tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            label={{
                                value: "Patients in queue",
                                position: "insideBottom", offset: -2,
                                fontSize: 10, fill: "var(--text-muted)",
                            }}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            width={32}
                        />
                        <Tooltip content={<WaitTooltip />} />
                        <Bar
                            dataKey="count"
                            fill="var(--chart-3)"
                            radius={[3, 3, 0, 0]}
                            opacity={0.85}
                            name="Days"
                        />
                    </BarChart>
                </ResponsiveContainer>

                <div style={{
                    fontSize: "0.68rem", color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)", marginTop: 4,
                }}>
                    End-of-day waiting queue · pooled across all MC runs
                </div>
            </div>

            {/* ── Waiting days per run ── */}
            <div className="card">
                <div className="card__title">Days With Waiting Queue — Per Run</div>

                <StatStrip
                    values={waitingDaysDist}
                    label={`Waiting days / ${nDays}-day run`}
                    color="var(--chart-5)"
                />

                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={daysHistData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                            dataKey="bin"
                            tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            label={{
                                value: "Days with waiting",
                                position: "insideBottom", offset: -2,
                                fontSize: 10, fill: "var(--text-muted)",
                            }}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--text-muted)" }}
                            width={32}
                        />
                        <Tooltip content={<DaysTooltip />} />
                        <Bar
                            dataKey="count"
                            fill="var(--chart-5)"
                            radius={[3, 3, 0, 0]}
                            opacity={0.85}
                            name="Runs"
                        />
                        {/* Reference line: 20% of simulation days */}
                        <ReferenceLine
                            x={Math.round(nDays * 0.2)}
                            stroke="var(--amber)"
                            strokeDasharray="4 3"
                            label={{
                                value: "20%",
                                position: "top", fontSize: 9, fill: "var(--amber)",
                            }}
                        />
                    </BarChart>
                </ResponsiveContainer>

                <div style={{
                    fontSize: "0.68rem", color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)", marginTop: 4,
                }}>
                    One bar per MC run · amber line = 20% of simulation days
                </div>
            </div>

        </div>
    );
}