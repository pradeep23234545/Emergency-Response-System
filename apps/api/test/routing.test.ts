import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';

const quietEngine = () => new Engine({ seed: 1, settings: { autoIncidents: false, autoDispatch: false } });

describe('routing', () => {
  it('finds a connected path between opposite corners', () => {
    const engine = quietEngine();
    const route = engine.planRoute('J00', 'J35', true)!;
    expect(route.path[0]).toBe('J00');
    expect(route.path.at(-1)).toBe('J35');
    for (let i = 0; i < route.path.length - 1; i++) {
      expect(() => engine.graph.edgeBetween(route.path[i], route.path[i + 1])).not.toThrow();
    }
  });

  it('avoids blocked road segments', () => {
    const engine = quietEngine();
    const before = engine.planRoute('J10', 'J12', true)!;
    expect(before.path).toEqual(['J10', 'J11', 'J12']);
    engine.blockEdge('E-J10-J11', 'test');
    const after = engine.planRoute('J10', 'J12', true)!;
    expect(after.path).not.toContain('J11');
    expect(after.seconds).toBeGreaterThan(before.seconds);
  });

  it('predicts the corridor trip to be faster than the no-corridor baseline', () => {
    const engine = quietEngine();
    const route = engine.planRoute('J00', 'J35', true)!;
    const baseline = engine.baselineSeconds(route.path);
    expect(route.seconds).toBeLessThan(baseline.seconds);
    expect(baseline.idle).toBeGreaterThan(0);
  });
});
