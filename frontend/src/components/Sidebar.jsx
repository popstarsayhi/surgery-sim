/**
 * Sidebar.jsx
 * -----------
 * Left-panel configuration form for the simulation.
 *
 * Purpose:
 *   Renders all user inputs and calls onSubmit(form) when the user
 *   clicks Run Simulation. Parent (App.jsx) owns the loading state
 *   and passes it down as `isLoading` to disable the button.
 *
 * Props:
 *   onSubmit(form)   Called with raw form state when user clicks Run.
 *   isLoading        Boolean — disables the Run button during simulation.
 *
 * Form sections:
 *   1. Unit configuration  (name, beds, arrivals, admission rule)
 *   2. LOS percentiles     (elective + urgent, P10-P90)
 *   3. Nurse staffing      (ratios + scheduled per shift)
 *   4. Simulation settings (days, runs, seed)
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Default form state
// ---------------------------------------------------------------------------

const DEFAULT_FORM = {
    unitName: "Surgery Unit",
    beds: 39,
    electivePerDay: 5.5,
    urgentPerDay: 7.2,
    urgentPriority: false,

    losElective: { p10: 0.5, p25: 0.93, p50: 1.74, p75: 2.80, p90: 4.06 },
    losUrgent: { p10: 0.6, p25: 0.89, p50: 1.71, p75: 3.37, p90: 6.70 },

    nurseRatios: { day: 4, evening: 4, night: 2 },
    scheduledNurses: { day: 8, evening: 4, night: 2 },

    nDays: 30,
    nRuns: 100,
    seed: 42,
};

// ---------------------------------------------------------------------------
// Small reusable field components
// ---------------------------------------------------------------------------

function Field({ label, children, hint }) {
    return (
        <div className="field">
            {label && <label>{label}</label>}
            {children}
            {hint && <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{hint}</span>}
        </div>
    );
}

function NumberInput({ value, onChange, min, max, step = 1 }) {
    return (
        <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

function ShiftRow({ label, ratio, onRatio, scheduled, onScheduled }) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: "var(--space-2)", alignItems: "center", marginBottom: "var(--space-2)" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {label}
            </span>
            <input
                type="number"
                value={ratio}
                min={1}
                max={20}
                step={1}
                onChange={(e) => onRatio(e.target.value)}
                style={{ textAlign: "center" }}
                title="Patients per nurse (ratio)"
            />
            <input
                type="number"
                value={scheduled}
                min={0}
                max={50}
                step={1}
                onChange={(e) => onScheduled(e.target.value)}
                style={{ textAlign: "center" }}
                title="Scheduled nurses"
            />
        </div>
    );
}

function PercentileInputs({ label, values, onChange }) {
    const keys = ["p10", "p25", "p50", "p75", "p90"];

    return (
        <div style={{ marginBottom: "var(--space-4)" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-2)", marginBottom: "var(--space-2)" }}>
                {label}
            </div>
            <div className="percentile-labels">
                {keys.map((k) => <span key={k}>{k.toUpperCase()}</span>)}
            </div>
            <div className="percentile-grid">
                {keys.map((k) => (
                    <input
                        key={k}
                        type="number"
                        value={values[k]}
                        min={0.1}
                        step={0.5}
                        onChange={(e) => onChange(k, e.target.value)}
                    />
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Sidebar component
// ---------------------------------------------------------------------------

export default function Sidebar({ onSubmit, isLoading }) {
    const [form, setForm] = useState(DEFAULT_FORM);

    // Generic top-level field updater
    function set(key, value) {
        setForm((f) => ({ ...f, [key]: value }));
    }

    // Nested field updater (e.g. losElective.p10)
    function setNested(section, key, value) {
        setForm((f) => ({
            ...f,
            [section]: { ...f[section], [key]: value },
        }));
    }

    function handleSubmit() {
        onSubmit(form);
    }

    return (
        <>
            {/* ── 1. Unit configuration ───────────────────────────── */}
            <div>
                <div className="section-label">Unit Configuration</div>

                <Field label="Unit name">
                    <input
                        type="text"
                        value={form.unitName}
                        onChange={(e) => set("unitName", e.target.value)}
                        maxLength={50}
                    />
                </Field>

                <Field label="Beds" hint="Total staffed beds available">
                    <NumberInput value={form.beds} min={1} max={200} onChange={(v) => set("beds", v)} />
                </Field>

                <Field label="Elective admissions / weekday" hint="Weekend elective = 0">
                    <NumberInput value={form.electivePerDay} min={0} max={100} step={0.5} onChange={(v) => set("electivePerDay", v)} />
                </Field>

                <Field label="Urgent admissions / day" hint="Every day including weekends">
                    <NumberInput value={form.urgentPerDay} min={0} max={100} step={0.5} onChange={(v) => set("urgentPerDay", v)} />
                </Field>

                <Field label="Admission rule">
                    <div className="toggle-group">
                        <button
                            className={!form.urgentPriority ? "active" : ""}
                            onClick={() => set("urgentPriority", false)}
                            type="button"
                        >
                            FCFS
                        </button>
                        <button
                            className={form.urgentPriority ? "active" : ""}
                            onClick={() => set("urgentPriority", true)}
                            type="button"
                        >
                            Urgent priority
                        </button>
                    </div>
                </Field>
            </div>

            <div className="divider" />

            {/* ── 2. LOS percentiles ──────────────────────────────── */}
            <div>
                <div className="section-label">Length of Stay (days)</div>

                <PercentileInputs
                    label="Elective LOS"
                    values={form.losElective}
                    onChange={(k, v) => setNested("losElective", k, v)}
                />

                <PercentileInputs
                    label="Urgent LOS"
                    values={form.losUrgent}
                    onChange={(k, v) => setNested("losUrgent", k, v)}
                />
            </div>

            <div className="divider" />

            {/* ── 3. Nurse staffing ───────────────────────────────── */}
            <div>
                <div className="section-label">Nurse Staffing</div>

                {/* Column headers */}
                <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                    <span />
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", textAlign: "center" }}>
                        RATIO (1:n)
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", textAlign: "center" }}>
                        SCHEDULED
                    </span>
                </div>

                <ShiftRow
                    label="07–15"
                    ratio={form.nurseRatios.day}
                    onRatio={(v) => setNested("nurseRatios", "day", v)}
                    scheduled={form.scheduledNurses.day}
                    onScheduled={(v) => setNested("scheduledNurses", "day", v)}
                />
                <ShiftRow
                    label="15–23"
                    ratio={form.nurseRatios.evening}
                    onRatio={(v) => setNested("nurseRatios", "evening", v)}
                    scheduled={form.scheduledNurses.evening}
                    onScheduled={(v) => setNested("scheduledNurses", "evening", v)}
                />
                <ShiftRow
                    label="23–07"
                    ratio={form.nurseRatios.night}
                    onRatio={(v) => setNested("nurseRatios", "night", v)}
                    scheduled={form.scheduledNurses.night}
                    onScheduled={(v) => setNested("scheduledNurses", "night", v)}
                />
            </div>

            <div className="divider" />

            {/* ── 4. Simulation settings ──────────────────────────── */}
            <div>
                <div className="section-label">Simulation Settings</div>

                <Field label="Simulation days">
                    <NumberInput value={form.nDays} min={30} max={365} onChange={(v) => set("nDays", v)} />
                </Field>

                <Field label="Monte Carlo runs">
                    <NumberInput value={form.nRuns} min={100} max={2000} step={100} onChange={(v) => set("nRuns", v)} />
                </Field>

                <Field label="Random seed" hint="Same seed = reproducible results">
                    <NumberInput value={form.seed} min={0} onChange={(v) => set("seed", v)} />
                </Field>
            </div>

            {/* ── Run button ──────────────────────────────────────── */}
            <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={isLoading}
                type="button"
            >
                {isLoading ? "⏳  Running…" : "▶  Run Simulation"}
            </button>
        </>
    );
}