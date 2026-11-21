import type { AuditEntry, BenchmarkResult } from '@corridor/core';
import type { Logger } from 'pino';
import type { Repositories } from '../db/repositories';
import { runBenchmark } from '../engine/benchmark';
import { Engine, type EngineState } from '../engine/engine';
import type { RealtimeHub } from './realtime';

const SNAPSHOT_KEY = 'engine_state_v1';
const BENCHMARK_KEY = 'benchmark_v1';
const TICK_MS = 1000;
const SAVE_EVERY_MS = 15_000;

/**
 * Application service that owns the simulation engine: it drives the clock,
 * persists domain events, checkpoints engine state and fans updates out to
 * connected clients.
 */
export class CorridorService {
  engine: Engine;
  private timer: NodeJS.Timeout | null = null;
  private lastSave = Date.now();
  private lastBroadcastVersion = -1;
  private unsubscribe: () => void = () => {};

  constructor(
    private readonly repos: Repositories,
    private readonly hub: RealtimeHub,
    private readonly logger: Logger,
    private readonly seed: number,
  ) {
    this.engine = this.restore();
    this.wire();
  }

  private restore(): Engine {
    const saved = this.repos.kv.get<EngineState>(SNAPSHOT_KEY);
    if (saved) {
      try {
        const engine = new Engine({ state: saved });
        this.logger.info({ simTime: new Date(saved.simTime).toISOString() }, 'Restored simulation checkpoint');
        return engine;
      } catch (err) {
        this.logger.warn({ err }, 'Checkpoint incompatible; starting a fresh simulation');
      }
    }
    return this.freshEngine();
  }

  private freshEngine(): Engine {
    const engine = new Engine({ seed: this.seed });
    engine.loadOutcomes(this.repos.outcomes.recent());
    const state = engine.exportState();
    state.seq.incident = Math.max(state.seq.incident, this.repos.incidents.maxSequence());
    return engine;
  }

  private wire() {
    this.unsubscribe = this.engine.onEvent((event) => {
      try {
        switch (event.type) {
          case 'audit': {
            const entry = this.repos.audit.insert(event.entry);
            this.hub.broadcast('audit', entry);
            break;
          }
          case 'incident':
            this.repos.incidents.upsert(event.incident);
            break;
          case 'outcome':
            this.repos.outcomes.insert(event.outcome);
            break;
          case 'alert':
            this.hub.broadcast('alert', event.alert);
            break;
        }
      } catch (err) {
        this.logger.error({ err, event: event.type }, 'Failed to persist engine event');
      }
    });
  }

  start() {
    if (this.timer) return;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - last) / 1000;
      last = now;
      try {
        this.engine.advance(elapsed);
        this.publish();
        if (now - this.lastSave > SAVE_EVERY_MS) this.checkpoint();
      } catch (err) {
        this.logger.error({ err }, 'Simulation tick failed');
      }
    }, TICK_MS);
  }

  /** Push the latest snapshot if anything changed. */
  publish(force = false) {
    if (!force && this.engine.version === this.lastBroadcastVersion) return;
    this.lastBroadcastVersion = this.engine.version;
    this.hub.broadcast('snapshot', this.engine.snapshot());
  }

  checkpoint() {
    this.lastSave = Date.now();
    this.repos.kv.set(SNAPSHOT_KEY, this.engine.exportState());
  }

  /** Run `fn` against the engine and publish the result immediately. */
  command<T>(fn: (engine: Engine) => T): T {
    const result = fn(this.engine);
    this.engine.version++;
    this.publish(true);
    return result;
  }

  reset(actor: string) {
    this.unsubscribe();
    this.repos.kv.delete(SNAPSHOT_KEY);
    this.repos.outcomes.clear();
    const settings = { ...this.engine.settings };
    this.engine = this.freshEngine();
    this.engine.loadOutcomes([]);
    this.engine.updateSettings(settings);
    this.wire();
    this.record({
      at: this.engine.simTime,
      actor,
      action: 'Simulation reset',
      detail: 'City state restored to the 08:30 baseline',
      category: 'system',
    });
    this.checkpoint();
    this.publish(true);
  }

  record(entry: Omit<AuditEntry, 'id'>) {
    const saved = this.repos.audit.insert(entry);
    this.hub.broadcast('audit', saved);
    return saved;
  }

  benchmark(seed?: number): BenchmarkResult {
    const result = runBenchmark({ seed: seed ?? this.seed, durationSeconds: 3 * 3600 });
    this.repos.kv.set(BENCHMARK_KEY, result);
    return result;
  }

  lastBenchmark(): BenchmarkResult | null {
    return this.repos.kv.get<BenchmarkResult>(BENCHMARK_KEY) ?? null;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.checkpoint();
  }
}
