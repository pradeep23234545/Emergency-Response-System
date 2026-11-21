/**
 * Vehicle dynamics and timing constants. Kept in one place so routing (which
 * predicts) and the simulator (which moves vehicles) agree with each other.
 */

/** Signals start pre-clearing (flushing queues) when a vehicle is this close in time. */
export const PRECLEAR_WINDOW_S = 90;
/** Signals switch to the corridor phase when a vehicle is this close in time. */
export const GREEN_WINDOW_S = 25;
/** After a corridor, signals run a recovery phase before the normal cycle. */
export const RESTORE_DURATION_S = 20;
/** Normal fixed-time cycle, seconds per axis. */
export const NORMAL_PHASE_S = 30;
/** Emergency vehicles without a corridor proceed cautiously through a red after this long. */
export const MAX_CAUTIOUS_WAIT_S = 18;
/** Re-plan active routes this often (seconds). */
export const REPLAN_INTERVAL_S = 15;
/** A new route must be this much faster to replace the current one. */
export const REPLAN_GAIN = 0.12;

export const SCENE_TIME_S: Record<'ambulance' | 'fire' | 'police', number> = {
  ambulance: 100,
  fire: 260,
  police: 180,
};
export const HANDOVER_TIME_S = 60;

const kmhToMs = (kmh: number) => kmh / 3.6;

/** Emergency vehicle speed (m/s) on an edge given congestion and corridor state. */
export function emergencySpeed(speedLimit: number, congestion: number, corridor: boolean): number {
  if (congestion >= 1) return 0;
  // With a corridor, queues have been flushed and drivers alerted to yield.
  const factor = corridor ? 1.1 * (1 - 0.3 * congestion) : 1 - 0.62 * congestion;
  return Math.max(kmhToMs(8), kmhToMs(speedLimit) * factor);
}

/** Expected delay (s) at a signalised junction without signal pre-emption. */
export function expectedSignalDelay(congestion: number): number {
  // ~50% chance of arriving on red (avg 15 s remaining) + queue discharge
  return 0.5 * 15 + 20 * congestion;
}

/** Civilian queue length estimate at a junction for display. */
export function queueEstimate(avgCongestion: number): number {
  return Math.round(avgCongestion * 28);
}

/** Vehicles reached by a yield alert on an edge (V2X + navigation app push). */
export function alertReach(lengthMeters: number, lanes: number, congestion: number): number {
  // ~60 vehicles per lane-km at saturation, of which ~70% receive alerts
  return Math.round((lengthMeters / 1000) * lanes * 60 * Math.max(0.1, congestion) * 0.7);
}
