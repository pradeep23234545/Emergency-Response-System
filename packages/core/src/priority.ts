/**
 * Priority score used to arbitrate traffic signals between competing
 * emergency vehicles (SIH26205 technical approach):
 *
 *     P = 0.5 * S + 0.3 * (1 / ETA) + 0.2 * W
 *
 * Each term is normalised to 0..1 so the weights keep their meaning:
 *  - S   : incident severity (1..5 -> 0.2..1.0)
 *  - 1/ETA: urgency of arrival at the contested junction. ETA is in seconds and
 *           expressed relative to a reference horizon so that a vehicle arriving
 *           in <= ETA_REFERENCE seconds scores 1.
 *  - W   : time the vehicle has already lost waiting, saturating at W_SATURATION.
 */
export const PRIORITY_WEIGHTS = { severity: 0.5, eta: 0.3, wait: 0.2 } as const;
export const ETA_REFERENCE_SECONDS = 10;
export const WAIT_SATURATION_SECONDS = 120;

export interface PriorityInput {
  severity: number; // 1..5
  etaSeconds: number;
  waitSeconds: number;
}

export interface PriorityBreakdown {
  score: number;
  severityTerm: number;
  etaTerm: number;
  waitTerm: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function priorityBreakdown({ severity, etaSeconds, waitSeconds }: PriorityInput): PriorityBreakdown {
  const s = clamp01(severity / 5);
  const inverseEta = clamp01(ETA_REFERENCE_SECONDS / Math.max(etaSeconds, 1));
  const w = clamp01(waitSeconds / WAIT_SATURATION_SECONDS);
  const severityTerm = PRIORITY_WEIGHTS.severity * s;
  const etaTerm = PRIORITY_WEIGHTS.eta * inverseEta;
  const waitTerm = PRIORITY_WEIGHTS.wait * w;
  return { score: round3(severityTerm + etaTerm + waitTerm), severityTerm, etaTerm, waitTerm };
}

export function priorityScore(input: PriorityInput): number {
  return priorityBreakdown(input).score;
}

/** Severity for units without an incident (e.g. returning to base). */
export const NON_EMERGENCY_SEVERITY = 0;

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
