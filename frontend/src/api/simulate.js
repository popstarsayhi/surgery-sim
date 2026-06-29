/**
 * simulate.js
 * -----------
 * API client for the /simulate endpoint.
 *
 * Purpose:
 *   Sends a SimulationInput payload to the FastAPI backend and returns
 *   a SimulationOutput object. Handles base URL configuration so the
 *   same code works in local development and production.
 *
 * Functions:
 *   runSimulation(payload)  ->  Promise<SimulationOutput>
 *   buildPayload(form)      ->  SimulationInput
 *
 * Base URL:
 *   Reads VITE_API_URL from environment variables.
 *   Default: http://localhost:8000
 *   Production: set VITE_API_URL=https://your-render-app.onrender.com
 *
 * Error handling:
 *   HTTP 422  ->  throws ValidationError with field-level detail
 *   HTTP 500  ->  throws SimulationError with server message
 *   Network   ->  throws NetworkError
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
    constructor(detail) {
        super("Validation failed");
        this.name = "ValidationError";
        this.detail = detail; // array of pydantic error objects
    }
}

export class SimulationError extends Error {
    constructor(message) {
        super(message);
        this.name = "SimulationError";
    }
}

export class NetworkError extends Error {
    constructor() {
        super("Could not reach the simulation server. Is the backend running?");
        this.name = "NetworkError";
    }
}

// ---------------------------------------------------------------------------
// runSimulation
// ---------------------------------------------------------------------------

/**
 * POST /simulate — run Monte Carlo simulation.
 *
 * @param {Object} payload  SimulationInput object matching the Pydantic schema.
 * @returns {Promise<Object>}  SimulationOutput from the backend.
 *
 * @throws {ValidationError}  If the backend returns 422 (bad input).
 * @throws {SimulationError}  If the backend returns 500.
 * @throws {NetworkError}     If the request cannot reach the server.
 */
export async function runSimulation(payload) {
    let response;

    try {
        response = await fetch(`${BASE_URL}/simulate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    } catch {
        throw new NetworkError();
    }

    if (response.status === 422) {
        const body = await response.json();
        throw new ValidationError(body.detail);
    }

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new SimulationError(body.detail ?? `Server error ${response.status}`);
    }

    return response.json();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely convert any value to a finite number.
 * Returns 0 if the result is NaN or Infinity, preventing silent bad payloads.
 */
function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

/**
 * Safely coerce any value to a boolean.
 * Handles both native booleans and the "true"/"false" strings that
 * <select> elements produce.
 */
function toBool(value) {
    return value === true || value === "true";
}

// ---------------------------------------------------------------------------
// buildPayload
// ---------------------------------------------------------------------------

/**
 * Convert raw form state (all strings from inputs) into a typed
 * SimulationInput object ready to POST to the backend.
 *
 * @param {Object} form  Raw form state from the Sidebar component.
 * @returns {Object}     Typed SimulationInput payload.
 */
export function buildPayload(form) {
    return {
        unit_name: form.unitName,
        beds: toNumber(form.beds),
        elective_per_day: toNumber(form.electivePerDay),
        urgent_per_day: toNumber(form.urgentPerDay),
        urgent_priority: toBool(form.urgentPriority),

        los_elective: {
            p10: toNumber(form.losElective.p10),
            p25: toNumber(form.losElective.p25),
            p50: toNumber(form.losElective.p50),
            p75: toNumber(form.losElective.p75),
            p90: toNumber(form.losElective.p90),
        },

        los_urgent: {
            p10: toNumber(form.losUrgent.p10),
            p25: toNumber(form.losUrgent.p25),
            p50: toNumber(form.losUrgent.p50),
            p75: toNumber(form.losUrgent.p75),
            p90: toNumber(form.losUrgent.p90),
        },

        nurse_ratios: {
            day: toNumber(form.nurseRatios.day),
            evening: toNumber(form.nurseRatios.evening),
            night: toNumber(form.nurseRatios.night),
        },

        scheduled_nurses: {
            day: toNumber(form.scheduledNurses.day),
            evening: toNumber(form.scheduledNurses.evening),
            night: toNumber(form.scheduledNurses.night),
        },

        n_days: toNumber(form.nDays),
        n_runs: toNumber(form.nRuns),
        seed: toNumber(form.seed),
    };
}

// ---------------------------------------------------------------------------
// health check
// ---------------------------------------------------------------------------

/**
 * GET /health — verify the backend is reachable.
 *
 * @returns {Promise<boolean>}  true if backend responds with status "ok".
 */
export async function checkHealth() {
    try {
        const response = await fetch(`${BASE_URL}/health`);
        if (!response.ok) return false;
        const data = await response.json();
        return data.status === "ok";
    } catch {
        return false;
    }
}