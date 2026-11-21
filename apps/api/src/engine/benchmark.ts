import type { BenchmarkResult, IncidentType, ResponseOutcome } from '@corridor/core';
import { Engine } from './engine';

/**
 * Head-less A/B benchmark: two engines share the same seed (and therefore the
 * same traffic and the same stream of 112 calls) and differ only in whether the
 * predictive corridor is enabled. This mirrors the "weights tuned in SUMO
 * simulation" step of the proposal with a reproducible in-process run.
 */
export function runBenchmark(
  options: { seed?: number; durationSeconds?: number; startTime?: number } = {},
): BenchmarkResult {
  const seed = options.seed ?? 7;
  const durationSeconds = Math.min(options.durationSeconds ?? 3 * 3600, 6 * 3600);
  const run = (corridorEnabled: boolean) => {
    const engine = new Engine({
      seed,
      simTime: options.startTime,
      settings: {
        corridorEnabled,
        autoIncidents: true,
        autoDispatch: true,
        vehicleAuth: true,
        running: true,
        speed: 1,
      },
    });
    for (let i = 0; i < durationSeconds; i++) engine.stepOnce();
    return engine.outcomes.filter((o) => o.corridorEnabled === corridorEnabled);
  };
  const on = run(true);
  const off = run(false);
  const summary = (xs: ResponseOutcome[]) => ({
    avgResponseSeconds: Math.round(avg(xs.map((x) => x.responseSeconds))),
    avgIdleSeconds: Math.round(avg(xs.map((x) => x.idleSeconds))),
    completed: xs.length,
  });
  const withCorridor = summary(on);
  const withoutCorridor = summary(off);
  // only compare incident types that completed in both runs
  const types = [...new Set(on.map((o) => o.type))].filter((t) => off.some((o) => o.type === t)) as IncidentType[];
  return {
    ranAt: Date.now(),
    simulatedSeconds: durationSeconds,
    incidents: Math.max(on.length, off.length),
    withCorridor,
    withoutCorridor,
    improvementPct: withoutCorridor.avgResponseSeconds
      ? Math.round((1 - withCorridor.avgResponseSeconds / withoutCorridor.avgResponseSeconds) * 1000) / 10
      : 0,
    byType: types.map((type) => ({
      type,
      withCorridor: Math.round(avg(on.filter((o) => o.type === type).map((o) => o.responseSeconds))),
      withoutCorridor: Math.round(avg(off.filter((o) => o.type === type).map((o) => o.responseSeconds))),
    })),
  };
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
