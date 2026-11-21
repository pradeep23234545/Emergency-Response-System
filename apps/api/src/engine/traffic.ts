import type { ForecastSeries, RoadNetwork } from '@corridor/core';
import { Random } from './random';

/**
 * Traffic model + short-horizon congestion forecaster.
 *
 * Congestion per edge (0..1) is driven by a diurnal demand profile, a per-road
 * base load, AR(1) noise and local disturbances (incidents, blockages).
 *
 * Forecasting ("Predict" in the AI core) uses Holt's linear exponential
 * smoothing on the sampled history, blended with the diurnal prior as the
 * horizon grows. The `forecast()` interface is deliberately model-agnostic so a
 * trained LSTM/GNN can replace it without touching routing or the UI.
 */

const SAMPLE_INTERVAL_S = 60;
const HISTORY_LENGTH = 90;
const ALPHA = 0.55;
const BETA = 0.25;

const gauss = (x: number, mu: number, sigma: number) => Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));

/** Demand multiplier by hour of day (0..24) with morning and evening peaks. */
export function diurnalDemand(hour: number): number {
  return 0.28 + 0.55 * gauss(hour, 9.2, 1.4) + 0.62 * gauss(hour, 18.6, 1.7) + 0.18 * gauss(hour, 13.5, 2.2);
}

const hourOf = (simTime: number) => {
  const d = new Date(simTime);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};

const clamp = (v: number, lo = 0, hi = 0.97) => Math.max(lo, Math.min(hi, v));

export interface TrafficState {
  base: number[];
  noise: number[];
  disturbance: number[];
  congestion: number[];
  history: number[][];
  historyTimes: number[];
  lastSampleAt: number;
}

export class TrafficModel {
  readonly blocked = new Set<number>();
  state: TrafficState;

  constructor(
    private readonly network: RoadNetwork,
    private readonly rng: Random,
    simTime: number,
    state?: TrafficState,
  ) {
    this.state = state ?? this.initialState(simTime);
  }

  private initialState(simTime: number): TrafficState {
    const n = this.network.edges.length;
    const cx = this.network.width / 2;
    const cy = this.network.height / 2;
    const nodes = new Map(this.network.nodes.map((node) => [node.id, node]));
    const base = this.network.edges.map((edge) => {
      const a = nodes.get(edge.from)!;
      const b = nodes.get(edge.to)!;
      // roads near the centre carry more traffic
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const centrality = 1 - Math.min(1, Math.hypot(mx - cx, my - cy) / 560);
      return clamp(0.32 + 0.38 * centrality + this.rng.range(-0.06, 0.06), 0.15, 0.8);
    });
    const state: TrafficState = {
      base,
      noise: new Array(n).fill(0),
      disturbance: new Array(n).fill(0),
      congestion: new Array(n).fill(0),
      history: Array.from({ length: n }, () => []),
      historyTimes: [],
      lastSampleAt: simTime,
    };
    this.state = state;
    // Backfill an hour of history so the forecaster has data from the start.
    const start = simTime - 60 * SAMPLE_INTERVAL_S * 1000;
    for (let t = start; t <= simTime; t += SAMPLE_INTERVAL_S * 1000) {
      for (let s = 0; s < 6; s++) this.evolve(t, 10);
      this.sample(t);
    }
    state.lastSampleAt = simTime;
    return state;
  }

  /** Advance the model by `dt` seconds. */
  step(simTime: number, dt: number) {
    this.evolve(simTime, dt);
    if (simTime - this.state.lastSampleAt >= SAMPLE_INTERVAL_S * 1000) {
      this.sample(simTime);
      this.state.lastSampleAt = simTime;
    }
  }

  private evolve(simTime: number, dt: number) {
    const demand = diurnalDemand(hourOf(simTime));
    const { base, noise, disturbance, congestion } = this.state;
    const decay = Math.pow(0.985, dt);
    for (let i = 0; i < base.length; i++) {
      noise[i] = noise[i] * Math.pow(0.97, dt) + this.rng.gaussian() * 0.012 * Math.sqrt(dt);
      noise[i] = Math.max(-0.2, Math.min(0.2, noise[i]));
      disturbance[i] *= decay;
      congestion[i] = this.blocked.has(i) ? 1 : clamp(base[i] * demand * 1.25 + noise[i] + disturbance[i], 0.03);
    }
  }

  private sample(simTime: number) {
    const { congestion, history, historyTimes } = this.state;
    historyTimes.push(simTime);
    if (historyTimes.length > HISTORY_LENGTH) historyTimes.shift();
    congestion.forEach((c, i) => {
      history[i].push(Math.min(c, 0.97));
      if (history[i].length > HISTORY_LENGTH) history[i].shift();
    });
  }

  /** Add a temporary congestion spike (e.g. an incident at a junction). */
  disturb(edgeIndex: number, amount: number) {
    this.state.disturbance[edgeIndex] = Math.min(0.5, this.state.disturbance[edgeIndex] + amount);
  }

  congestion(edgeIndex: number): number {
    return this.state.congestion[edgeIndex];
  }

  /** Diurnal prior for an edge at a future time, without noise. */
  private prior(edgeIndex: number, simTime: number): number {
    return clamp(this.state.base[edgeIndex] * diurnalDemand(hourOf(simTime)) * 1.25);
  }

  /**
   * Forecast congestion `horizonSeconds` ahead. Returns the point estimate and
   * a residual-based uncertainty half-width.
   */
  forecast(edgeIndex: number, simTime: number, horizonSeconds: number): { c: number; spread: number } {
    if (this.blocked.has(edgeIndex)) return { c: 1, spread: 0 };
    const series = this.state.history[edgeIndex];
    const current = this.state.congestion[edgeIndex];
    if (horizonSeconds <= 0 || series.length < 3) return { c: current, spread: 0.05 };

    let level = series[0];
    let trend = series[1] - series[0];
    let sqErr = 0;
    for (let i = 1; i < series.length; i++) {
      const predicted = level + trend;
      sqErr += (series[i] - predicted) ** 2;
      const prevLevel = level;
      level = ALPHA * series[i] + (1 - ALPHA) * (level + trend);
      trend = BETA * (level - prevLevel) + (1 - BETA) * trend;
    }
    // incorporate the live (un-sampled) value
    level = ALPHA * current + (1 - ALPHA) * level;
    const rmse = Math.sqrt(sqErr / (series.length - 1));
    const steps = horizonSeconds / SAMPLE_INTERVAL_S;
    const holt = level + trend * steps;
    // the further out we look, the more we trust the diurnal prior
    const w = Math.exp(-steps / 12);
    const prior =
      this.prior(edgeIndex, simTime + horizonSeconds * 1000) + this.state.disturbance[edgeIndex] * Math.exp(-steps / 4);
    return { c: clamp(w * holt + (1 - w) * prior, 0.02), spread: Math.min(0.35, rmse * Math.sqrt(steps + 1)) };
  }

  series(edgeIndex: number, simTime: number): ForecastSeries {
    const edge = this.network.edges[edgeIndex];
    const history = this.state.history[edgeIndex].map((c, i) => ({ t: this.state.historyTimes[i], c: round(c) }));
    const forecast = [];
    for (let m = 0; m <= 30; m += 2) {
      const { c, spread } = this.forecast(edgeIndex, simTime, m * 60);
      forecast.push({
        t: simTime + m * 60_000,
        c: round(c),
        lo: round(Math.max(0, c - spread)),
        hi: round(Math.min(1, c + spread)),
      });
    }
    return { edgeId: edge.id, name: edge.name, history, forecast };
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
