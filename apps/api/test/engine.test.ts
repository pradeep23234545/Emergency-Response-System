import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';

const quietEngine = (settings = {}) =>
  new Engine({ seed: 5, settings: { autoIncidents: false, autoDispatch: false, ...settings } });

function runUntil(engine: Engine, done: () => boolean, maxSeconds = 3600) {
  for (let i = 0; i < maxSeconds && !done(); i++) engine.stepOnce();
}

describe('incident lifecycle', () => {
  it('dispatches, reaches the scene, transports to hospital and resolves', () => {
    const engine = quietEngine();
    const incident = engine.createIncident({ type: 'cardiac', nodeId: 'J24', autoDispatch: true });
    expect(incident.status).toBe('dispatched');
    expect(incident.hospitalId).toBeTruthy();
    const unit = engine.getUnit(incident.assignedUnitIds[0]);
    expect(unit.kind).toBe('ambulance');
    expect(unit.verified).toBe(true);

    runUntil(engine, () => incident.status === 'on_scene');
    expect(incident.responseSeconds).toBeGreaterThan(0);
    expect(incident.responseSeconds!).toBeLessThan(incident.baselineResponseSeconds!);

    runUntil(engine, () => incident.status === 'resolved');
    expect(incident.status).toBe('resolved');
    expect(engine.outcomes).toHaveLength(1);
    const hospital = engine.snapshot().hospitals.find((h) => h.id === incident.hospitalId)!;
    expect(hospital.incoming).toHaveLength(0);
  });

  it('dispatches the multi-agency mix an incident type requires', () => {
    const engine = quietEngine();
    const incident = engine.createIncident({ type: 'fire', nodeId: 'J23', autoDispatch: true });
    const kinds = incident.assignedUnitIds.map((id) => engine.getUnit(id).kind).sort();
    expect(kinds).toEqual(['ambulance', 'fire', 'fire']);
  });

  it('cancelling releases units and the hospital bed reservation', () => {
    const engine = quietEngine();
    const incident = engine.createIncident({ type: 'stroke', nodeId: 'J32', autoDispatch: true });
    const hospitalId = incident.hospitalId!;
    const ward = () => engine.snapshot().hospitals.find((h) => h.id === hospitalId)!.icu;
    expect(ward().reserved).toBe(1);
    engine.cancelIncident(incident.id);
    expect(incident.status).toBe('cancelled');
    expect(ward().reserved).toBe(0);
    expect(engine.getUnit(incident.assignedUnitIds[0]).status).toMatch(/returning|available/);
  });
});

describe('green-wave corridor', () => {
  it('pre-clears signals ahead of an emergency vehicle and restores them afterwards', () => {
    const engine = quietEngine();
    const incident = engine.createIncident({ type: 'cardiac', nodeId: 'J03', autoDispatch: true });
    const unitId = incident.assignedUnitIds[0];
    let sawCorridor = false;
    runUntil(engine, () => {
      const held = engine
        .snapshot()
        .signals.some((s) => s.holderUnitId === unitId && (s.mode === 'preclear' || s.mode === 'green_wave'));
      sawCorridor ||= held;
      return incident.status === 'on_scene';
    });
    expect(sawCorridor).toBe(true);
    for (let i = 0; i < 5; i++) engine.stepOnce();
    expect(engine.snapshot().signals.some((s) => s.holderUnitId === unitId)).toBe(false);
  });

  it('vehicles wait less at signals with the corridor than without it', () => {
    const waits = [true, false].map((corridorEnabled) => {
      const engine = quietEngine({ corridorEnabled });
      const incident = engine.createIncident({ type: 'road_accident', nodeId: 'J05', autoDispatch: true });
      runUntil(engine, () => incident.status === 'on_scene');
      return engine.getUnit(incident.assignedUnitIds[0]).waitSeconds;
    });
    expect(waits[0]).toBeLessThanOrEqual(waits[1]);
  });

  it('gives contested junctions to the highest priority claimant', () => {
    const engine = quietEngine();
    engine.createIncident({ type: 'cardiac', nodeId: 'J23', severity: 5, autoDispatch: true });
    engine.createIncident({ type: 'crime', nodeId: 'J23', severity: 2, autoDispatch: true });
    runUntil(
      engine,
      () => {
        for (const s of engine.snapshot().signals) {
          if (s.claims.length < 2 || !s.holderUnitId) continue;
          const top = [...s.claims].sort((a, b) => b.priority - a.priority)[0];
          // a committed vehicle (very close) keeps the junction; otherwise the top claim wins
          const holder = s.claims.find((c) => c.unitId === s.holderUnitId)!;
          expect(holder.unitId === top.unitId || holder.etaSeconds <= 13).toBe(true);
        }
        return false;
      },
      600,
    );
  });
});

describe('blockages and rerouting', () => {
  it('re-plans an active route when a segment ahead is blocked', () => {
    const engine = quietEngine();
    const incident = engine.createIncident({ type: 'medical', nodeId: 'J35', autoDispatch: true });
    const unit = engine.getUnit(incident.assignedUnitIds[0]);
    engine.stepOnce();
    const ahead = [...unit.route];
    expect(ahead.length).toBeGreaterThan(1);
    const edgeId = engine.network.edges[engine.graph.edgeBetween(ahead[0], ahead[1])].id;
    engine.blockEdge(edgeId, 'crash');
    const edges = unit.route
      .slice(0, -1)
      .map((n, i) => engine.network.edges[engine.graph.edgeBetween(n, unit.route[i + 1])].id);
    expect(edges).not.toContain(edgeId);
  });
});

describe('persistence', () => {
  it('restores an exported state and continues deterministically', () => {
    const a = new Engine({ seed: 11, simTime: new Date(2026, 0, 5, 9, 0).getTime() });
    for (let i = 0; i < 300; i++) a.stepOnce();
    const restored = new Engine({ state: structuredClone(a.exportState()) });
    for (let i = 0; i < 300; i++) {
      a.stepOnce();
      restored.stepOnce();
    }
    expect(restored.snapshot().units.map((u) => u.position)).toEqual(a.snapshot().units.map((u) => u.position));
    expect(restored.snapshot().incidents.map((i) => i.id)).toEqual(a.snapshot().incidents.map((i) => i.id));
  });
});
