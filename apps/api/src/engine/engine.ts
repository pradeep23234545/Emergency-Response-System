import {
  INCIDENT_TYPES,
  priorityScore,
  type Alert,
  type AlertChannel,
  type AlertLevel,
  type AuditEntry,
  type Detection,
  type DispatchPlan,
  type EdgeTraffic,
  type Hospital,
  type Incident,
  type IncidentSource,
  type IncidentType,
  type MetricsSummary,
  type ResponseOutcome,
  type RoadNetwork,
  type SignalClaim,
  type SimulationSettings,
  type Snapshot,
  type TrafficSignal,
  type Unit,
  type UnitKind,
  type UnitRecommendation,
  type ForecastSeries,
} from '@corridor/core';
import { DomainError, conflict, notFound } from './errors';
import {
  GREEN_WINDOW_S,
  HANDOVER_TIME_S,
  MAX_CAUTIOUS_WAIT_S,
  NORMAL_PHASE_S,
  PRECLEAR_WINDOW_S,
  REPLAN_GAIN,
  REPLAN_INTERVAL_S,
  RESTORE_DURATION_S,
  SCENE_TIME_S,
  alertReach,
  emergencySpeed,
  expectedSignalDelay,
  queueEstimate,
} from './model';
import { Graph, buildNetwork } from './network';
import { Random } from './random';
import { findRoute, type RouteResult } from './routing';
import { CALLER_NAMES, FLEET_REGISTRY, INCIDENT_MIX, INCIDENT_NOTES, seedHospitals, seedUnits } from './seed';
import { TrafficModel, type TrafficState } from './traffic';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type EngineEvent =
  | { type: 'audit'; entry: Omit<AuditEntry, 'id'> }
  | { type: 'incident'; incident: Incident }
  | { type: 'outcome'; outcome: ResponseOutcome }
  | { type: 'alert'; alert: Alert };

/** Per-unit movement state that is not part of the public `Unit` shape. */
interface Motion {
  prev: string;
  edgeOffset: number;
  waitAtNode: number;
  sceneTimer: number;
  replanIn: number;
  tripStartedAt: number;
  tripBaselineSeconds: number;
  tripBaselineIdle: number;
  alertedEdges: string[];
  lastAlertId: string | null;
  lastAlertAt: number;
}

interface IncidentMeta {
  verifyAt: number | null;
  transportEstimate: number;
  /** stop time of the first arriving unit vs. its no-corridor estimate */
  idleSeconds: number;
  baselineIdleSeconds: number;
  corridorEnabled: boolean;
}

export interface EngineState {
  tick: number;
  simTime: number;
  carry: number;
  rng: { traffic: number; calls: number; misc: number };
  settings: SimulationSettings;
  units: Unit[];
  motion: Record<string, Motion>;
  incidents: Incident[];
  incidentMeta: Record<string, IncidentMeta>;
  signals: TrafficSignal[];
  hospitals: Hospital[];
  traffic: TrafficState;
  blocked: { edgeIndex: number; reason: string }[];
  alerts: Alert[];
  detections: Detection[];
  outcomes: ResponseOutcome[];
  seq: { incident: number; alert: number; detection: number };
  stats: { civiliansAlerted: number; detections: number; detectionsCorrect: number; latencySum: number };
  timers: { nextCallAt: number; nextSpoofAt: number; nextBedEventAt: number };
  conflictKeys: Record<string, string>;
}

export interface EngineOptions {
  seed?: number;
  simTime?: number;
  settings?: Partial<SimulationSettings>;
  state?: EngineState;
}

export interface CreateIncidentParams {
  type: IncidentType;
  nodeId: string;
  severity?: number;
  callerName?: string | null;
  callerPhone?: string | null;
  notes?: string;
  source?: IncidentSource;
  autoDispatch?: boolean;
}

const DEFAULT_SETTINGS: SimulationSettings = {
  running: true,
  speed: 4,
  corridorEnabled: true,
  autoIncidents: true,
  autoDispatch: true,
  vehicleAuth: true,
};

const ACTIVE_INCIDENT = new Set(['reported', 'verified', 'dispatched', 'on_scene', 'transporting']);
const EMERGENCY_TRIP = new Set(['en_route', 'transporting']);
const MAX_ALERTS = 60;
const MAX_DETECTIONS = 60;
const MAX_OUTCOMES = 400;
const RECENT_WINDOW_MS = 15 * 60_000;

/** 08:30 local time today — the morning peak makes for an interesting start. */
export function defaultStartTime(): number {
  const d = new Date();
  d.setHours(8, 30, 0, 0);
  return d.getTime();
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

/**
 * Authoritative simulation of the city: traffic, signals, fleet movement,
 * incidents and hospitals. It is pure in-memory logic with no I/O; persistence
 * and transport subscribe through `onEvent` and `exportState`.
 */
export class Engine {
  readonly network: RoadNetwork;
  readonly graph: Graph;
  private state: EngineState;
  private traffic: TrafficModel;
  private trafficRng: Random;
  private callRng: Random;
  private rng: Random;
  private listeners = new Set<(event: EngineEvent) => void>();
  private signalIndex = new Map<string, TrafficSignal>();
  private unitIndex = new Map<string, Unit>();
  private corridorEdges = new Set<number>();
  version = 0;

  constructor(options: EngineOptions = {}) {
    this.network = buildNetwork();
    this.graph = new Graph(this.network);
    const seed = options.seed ?? 20260;
    if (options.state) {
      this.state = options.state;
    } else {
      const simTime = options.simTime ?? defaultStartTime();
      this.state = this.freshState(seed, simTime, { ...DEFAULT_SETTINGS, ...options.settings });
    }
    this.trafficRng = new Random(this.state.rng.traffic);
    this.callRng = new Random(this.state.rng.calls);
    this.rng = new Random(this.state.rng.misc);
    this.traffic = new TrafficModel(
      this.network,
      this.trafficRng,
      this.state.simTime,
      options.state ? this.state.traffic : undefined,
    );
    this.state.traffic = this.traffic.state;
    for (const b of this.state.blocked) this.traffic.blocked.add(b.edgeIndex);
    this.reindex();
  }

  private freshState(seed: number, simTime: number, settings: SimulationSettings): EngineState {
    const units = seedUnits(this.graph, simTime);
    const signals: TrafficSignal[] = this.network.nodes
      .filter((n) => n.hasSignal)
      .map((n, i) => ({
        id: `SIG-${n.id}`,
        nodeId: n.id,
        name: n.name,
        mode: 'normal',
        greenAxis: i % 2 ? 'NS' : 'EW',
        phaseElapsed: (i * 7) % NORMAL_PHASE_S,
        holderUnitId: null,
        claims: [],
        queue: 8,
        restoreRemaining: 0,
        manualAxis: null,
      }));
    const motion: Record<string, Motion> = {};
    for (const unit of units) motion[unit.id] = this.idleMotion(unit.homeNodeId);
    return {
      tick: 0,
      simTime,
      carry: 0,
      rng: { traffic: seed * 3 + 1, calls: seed * 7 + 3, misc: seed * 11 + 5 },
      settings,
      units,
      motion,
      incidents: [],
      incidentMeta: {},
      signals,
      hospitals: seedHospitals(this.graph),
      traffic: undefined as unknown as TrafficState,
      blocked: [],
      alerts: [],
      detections: [],
      outcomes: [],
      seq: { incident: 1000, alert: 0, detection: 0 },
      stats: { civiliansAlerted: 0, detections: 0, detectionsCorrect: 0, latencySum: 0 },
      timers: { nextCallAt: simTime + 20_000, nextSpoofAt: simTime + 240_000, nextBedEventAt: simTime + 90_000 },
      conflictKeys: {},
    };
  }

  private idleMotion(nodeId: string): Motion {
    return {
      prev: nodeId,
      edgeOffset: 0,
      waitAtNode: 0,
      sceneTimer: 0,
      replanIn: REPLAN_INTERVAL_S,
      tripStartedAt: 0,
      tripBaselineSeconds: 0,
      tripBaselineIdle: 0,
      alertedEdges: [],
      lastAlertId: null,
      lastAlertAt: 0,
    };
  }

  private reindex() {
    this.signalIndex = new Map(this.state.signals.map((s) => [s.nodeId, s]));
    this.unitIndex = new Map(this.state.units.map((u) => [u.id, u]));
  }

  /* --------------------------- events ----------------------------- */

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private audit(action: string, detail: string, category: AuditEntry['category'], actor = 'system') {
    this.emit({ type: 'audit', entry: { at: this.state.simTime, actor, action, detail, category } });
  }

  private pushAlert(
    channel: AlertChannel,
    level: AlertLevel,
    title: string,
    detail: string,
    extra: Partial<Alert> = {},
  ): Alert {
    const alert: Alert = {
      id: `ALR-${++this.state.seq.alert}`,
      at: this.state.simTime,
      channel,
      level,
      title,
      detail,
      acknowledged: false,
      ...extra,
    };
    this.state.alerts.unshift(alert);
    if (this.state.alerts.length > MAX_ALERTS) this.state.alerts.length = MAX_ALERTS;
    this.emit({ type: 'alert', alert });
    return alert;
  }

  private pushDetection(d: Omit<Detection, 'id' | 'at'>) {
    const detection: Detection = { id: `DET-${++this.state.seq.detection}`, at: this.state.simTime, ...d };
    this.state.detections.unshift(detection);
    if (this.state.detections.length > MAX_DETECTIONS) this.state.detections.length = MAX_DETECTIONS;
    if (d.source === 'cctv_anpr') {
      this.state.stats.detections++;
      this.state.stats.latencySum += d.latencyMs;
      if (d.verified || d.unitId === null) this.state.stats.detectionsCorrect++;
    }
  }

  private touchIncident(incident: Incident, label?: string) {
    if (label) incident.timeline.push({ at: this.state.simTime, label });
    this.emit({ type: 'incident', incident });
  }

  /* --------------------------- accessors -------------------------- */

  get settings(): SimulationSettings {
    return this.state.settings;
  }

  get simTime(): number {
    return this.state.simTime;
  }

  get outcomes(): ResponseOutcome[] {
    return this.state.outcomes;
  }

  getIncident(id: string): Incident {
    const incident = this.state.incidents.find((i) => i.id === id);
    if (!incident) throw notFound(`Incident ${id}`);
    return incident;
  }

  getUnit(id: string): Unit {
    const unit = this.unitIndex.get(id);
    if (!unit) throw notFound(`Unit ${id}`);
    return unit;
  }

  exportState(): EngineState {
    this.state.rng = { traffic: this.trafficRng.state, calls: this.callRng.state, misc: this.rng.state };
    this.state.blocked = this.state.blocked.filter((b) => this.traffic.blocked.has(b.edgeIndex));
    return this.state;
  }

  /** Seed historical outcomes (e.g. loaded from the database after a restart). */
  loadOutcomes(outcomes: ResponseOutcome[]) {
    this.state.outcomes = outcomes.slice(-MAX_OUTCOMES);
  }

  /* --------------------------- clock ------------------------------ */

  /** Advance by `realSeconds` of wall-clock time, scaled by the simulation speed. */
  advance(realSeconds: number) {
    if (!this.state.settings.running) return;
    this.state.carry += realSeconds * this.state.settings.speed;
    let steps = Math.floor(this.state.carry);
    this.state.carry -= steps;
    steps = Math.min(steps, 60);
    for (let i = 0; i < steps; i++) this.stepOnce();
    if (steps) this.version++;
  }

  /** Advance exactly one simulated second. */
  stepOnce() {
    const s = this.state;
    s.tick++;
    s.simTime += 1000;
    this.traffic.step(s.simTime, 1);
    this.generateCalls();
    this.verifyIncidents();
    if (s.settings.autoDispatch) this.autoDispatch();
    this.updateSignals();
    for (const unit of s.units) this.moveUnit(unit);
    for (const unit of s.units) this.runTimers(unit);
    this.updateHospitals();
    this.updateIncidentStages();
    this.securityChecks();
    this.pruneIncidents();
  }

  /* ------------------------ travel model -------------------------- */

  private isEmergencyTrip(unit: Unit) {
    return EMERGENCY_TRIP.has(unit.status);
  }

  private hasCorridor(unit: Unit) {
    return this.state.settings.corridorEnabled && unit.verified && this.isEmergencyTrip(unit);
  }

  private edgeSeconds(edgeIndex: number, corridor: boolean, congestion = this.traffic.congestion(edgeIndex)) {
    const edge = this.graph.edge(edgeIndex);
    const v = emergencySpeed(edge.speedLimit, congestion, corridor);
    return v > 0 ? edge.length / v : Infinity;
  }

  private nodeDelay(nodeId: string, prev: string): number {
    if (!this.graph.node(nodeId).hasSignal) return 0;
    return expectedSignalDelay(this.traffic.congestion(this.graph.edgeBetween(prev, nodeId)));
  }

  /** Plan a route. With the corridor, edges are priced with *forecast* congestion at arrival time. */
  planRoute(from: string, to: string, corridor: boolean, startOffset = 0): RouteResult | null {
    const blocked = this.traffic.blocked;
    return findRoute(
      this.graph,
      from,
      to,
      (edgeIndex, _a, _b, offset) => {
        if (blocked.has(edgeIndex)) return Infinity;
        const c = corridor ? this.traffic.forecast(edgeIndex, this.state.simTime, offset + startOffset).c : undefined;
        return this.edgeSeconds(edgeIndex, corridor, c);
      },
      corridor ? () => 0 : (node, prev) => this.nodeDelay(node, prev),
      startOffset,
    );
  }

  /** Time for the same path without any corridor support (normal traffic, signal waits). */
  baselineSeconds(path: string[], startOffset = 0): { seconds: number; idle: number } {
    let seconds = startOffset;
    let idle = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const ei = this.graph.edgeBetween(path[i], path[i + 1]);
      seconds += this.edgeSeconds(ei, false, Math.min(this.traffic.congestion(ei), 0.97));
      if (i + 1 < path.length - 1) {
        const delay = this.nodeDelay(path[i + 1], path[i]);
        seconds += delay;
        idle += delay;
      }
    }
    return { seconds, idle };
  }

  /** Where a unit can start a new route from and how long until it gets there. */
  private routeOrigin(unit: Unit): { node: string; offset: number; prev: string } {
    const m = this.state.motion[unit.id];
    if (!unit.route.length) return { node: m.prev, offset: 0, prev: m.prev };
    const ei = this.graph.edgeBetween(m.prev, unit.route[0]);
    const edge = this.graph.edge(ei);
    const remaining = Math.max(0, edge.length - m.edgeOffset);
    const v = emergencySpeed(edge.speedLimit, this.traffic.congestion(ei), this.hasCorridor(unit));
    return { node: unit.route[0], offset: v > 0 ? remaining / v : 0, prev: m.prev };
  }

  /** Remaining ETA along the unit's current route. */
  private remainingEta(unit: Unit): number | null {
    if (!unit.route.length) return null;
    const corridor = this.hasCorridor(unit);
    const m = this.state.motion[unit.id];
    const origin = this.routeOrigin(unit);
    let t = origin.offset;
    let prev = m.prev;
    for (let i = 0; i < unit.route.length; i++) {
      const node = unit.route[i];
      if (i > 0) t += this.edgeSeconds(this.graph.edgeBetween(prev, node), corridor);
      if (!corridor && i < unit.route.length - 1) t += this.nodeDelay(node, prev);
      prev = node;
    }
    return Math.round(t);
  }

  /* ------------------------- incidents ---------------------------- */

  createIncident(params: CreateIncidentParams, actor = 'system'): Incident {
    const node = this.graph.nodes.get(params.nodeId);
    if (!node) throw new DomainError(`Unknown location ${params.nodeId}`);
    const info = INCIDENT_TYPES[params.type];
    const s = this.state;
    const source = params.source ?? 'erss_112';
    const id = `INC-${++s.seq.incident}`;
    const instantVerify = source === 'cctv' || source === 'gps_iot' || params.autoDispatch === true;
    const incident: Incident = {
      id,
      type: params.type,
      title: info.label,
      severity: params.severity ?? info.defaultSeverity,
      status: instantVerify ? 'verified' : 'reported',
      source,
      nodeId: node.id,
      location: node.name,
      position: { x: node.x, y: node.y },
      callerName: params.callerName ?? null,
      callerPhone: params.callerPhone ?? null,
      notes: params.notes ?? '',
      requiredUnits: { ...info.units },
      assignedUnitIds: [],
      hospitalId: null,
      stage: instantVerify ? 'verify' : 'detect',
      reportedAt: s.simTime,
      dispatchedAt: null,
      arrivedAt: null,
      resolvedAt: null,
      responseSeconds: null,
      baselineResponseSeconds: null,
      timeline: [{ at: s.simTime, label: `Reported via ${sourceLabel(source)}` }],
      createdBy: actor,
    };
    s.incidents.unshift(incident);
    s.incidentMeta[id] = {
      verifyAt: instantVerify ? null : s.simTime + this.rng.int(4, 9) * 1000,
      transportEstimate: 0,
      idleSeconds: 0,
      baselineIdleSeconds: 0,
      corridorEnabled: s.settings.corridorEnabled,
    };
    if (instantVerify) incident.timeline.push({ at: s.simTime, label: 'Verified' });

    if (source === 'erss_112') {
      this.pushDetection({
        source: 'erss_112',
        nodeId: node.id,
        plate: null,
        unitId: null,
        label: `112 ERSS call · ${info.label}`,
        confidence: 1,
        latencyMs: this.rng.int(150, 400),
        verified: true,
      });
    }
    // incidents on the road disturb nearby traffic
    if (['road_accident', 'fire', 'hazmat'].includes(params.type)) {
      for (const { edgeIndex } of this.graph.adjacency.get(node.id)!) this.traffic.disturb(edgeIndex, 0.18);
    }
    this.pushAlert(
      'system',
      incident.severity >= 4 ? 'critical' : 'warning',
      `New incident ${id}`,
      `${info.label} at ${node.name}`,
      { incidentId: id },
    );
    this.audit('Incident created', `${id} ${info.label} at ${node.name} (S${incident.severity})`, 'incident', actor);
    this.touchIncident(incident);
    if (params.autoDispatch) {
      try {
        this.dispatch(id, undefined, actor);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        this.touchIncident(incident, 'Queued by priority · no suitable unit free');
      }
    }
    return incident;
  }

  private generateCalls() {
    const s = this.state;
    if (!s.settings.autoIncidents || s.simTime < s.timers.nextCallAt) return;
    const active = s.incidents.filter((i) => ACTIVE_INCIDENT.has(i.status)).length;
    const gap = Math.min(420, Math.max(45, -Math.log(1 - this.callRng.next()) * 170));
    s.timers.nextCallAt = s.simTime + gap * 1000;
    if (active >= 6) return; // keep the city manageable
    const type = this.callRng.weighted(INCIDENT_MIX);
    const facilityNodes = new Set(this.network.facilities.map((f) => f.nodeId));
    const candidates = this.network.nodes.filter((n) => !facilityNodes.has(n.id));
    const node = this.callRng.pick(candidates);
    const info = INCIDENT_TYPES[type];
    const severity = Math.max(1, Math.min(5, info.defaultSeverity + this.callRng.pick([-1, 0, 0, 0, 1])));
    const fromCamera = type === 'road_accident' && node.hasCamera && this.callRng.chance(0.35);
    this.createIncident({
      type,
      nodeId: node.id,
      severity,
      callerName: fromCamera ? null : this.callRng.pick(CALLER_NAMES),
      callerPhone: fromCamera ? null : `+91 9${this.callRng.int(100000000, 999999999)}`,
      notes: this.callRng.pick(INCIDENT_NOTES[type]),
      source: fromCamera ? 'cctv' : 'erss_112',
    });
    if (fromCamera) {
      this.pushDetection({
        source: 'cctv_anpr',
        nodeId: node.id,
        plate: null,
        unitId: null,
        label: 'Collision detected by YOLO vision model',
        confidence: round(this.rng.range(0.88, 0.97)),
        latencyMs: this.rng.int(90, 190),
        verified: true,
      });
    }
  }

  private verifyIncidents() {
    const s = this.state;
    for (const incident of s.incidents) {
      const meta = s.incidentMeta[incident.id];
      if (incident.status !== 'reported' || !meta?.verifyAt || s.simTime < meta.verifyAt) continue;
      incident.status = 'verified';
      meta.verifyAt = null;
      this.touchIncident(incident, 'Call verified (caller location + duplicate check)');
    }
  }

  cancelIncident(id: string, actor = 'system', reason = 'Cancelled by operator') {
    const incident = this.getIncident(id);
    if (!ACTIVE_INCIDENT.has(incident.status)) throw conflict(`${id} is already ${incident.status}`);
    for (const unitId of incident.assignedUnitIds) {
      const unit = this.unitIndex.get(unitId);
      if (unit && unit.incidentId === id && unit.status !== 'available') this.sendHome(unit);
    }
    this.clearHospitalNotice(incident);
    incident.status = 'cancelled';
    incident.stage = 'restore';
    incident.resolvedAt = this.state.simTime;
    this.touchIncident(incident, reason);
    this.audit('Incident cancelled', `${id}: ${reason}`, 'incident', actor);
    return incident;
  }

  resolveIncident(id: string, actor = 'system') {
    const incident = this.getIncident(id);
    if (!ACTIVE_INCIDENT.has(incident.status)) throw conflict(`${id} is already ${incident.status}`);
    if (!incident.arrivedAt) throw conflict('Cannot resolve before a unit reaches the scene; cancel instead');
    for (const unitId of incident.assignedUnitIds) {
      const unit = this.unitIndex.get(unitId);
      if (unit && unit.incidentId === id && unit.status === 'on_scene') this.sendHome(unit);
    }
    this.finishIncident(incident, 'Closed by operator', actor);
    return incident;
  }

  private finishIncident(incident: Incident, label: string, actor = 'system') {
    incident.status = 'resolved';
    incident.stage = 'restore';
    incident.resolvedAt = this.state.simTime;
    this.clearHospitalNotice(incident);
    this.touchIncident(incident, label);
    this.audit(
      'Incident resolved',
      `${incident.id} ${incident.title} · response ${Math.round(incident.responseSeconds ?? 0)} s`,
      'incident',
      actor,
    );
    const meta = this.state.incidentMeta[incident.id];
    if (incident.responseSeconds != null && incident.baselineResponseSeconds != null && meta) {
      const outcome: ResponseOutcome = {
        incidentId: incident.id,
        type: incident.type,
        severity: incident.severity,
        resolvedAt: this.state.simTime,
        responseSeconds: incident.responseSeconds,
        baselineSeconds: incident.baselineResponseSeconds,
        idleSeconds: meta.idleSeconds,
        baselineIdleSeconds: meta.baselineIdleSeconds,
        corridorEnabled: meta.corridorEnabled,
      };
      this.state.outcomes.push(outcome);
      if (this.state.outcomes.length > MAX_OUTCOMES) this.state.outcomes.shift();
      this.emit({ type: 'outcome', outcome });
    }
  }

  private pruneIncidents() {
    const s = this.state;
    if (s.tick % 30) return;
    const cutoff = s.simTime - RECENT_WINDOW_MS;
    s.incidents = s.incidents.filter((i) => ACTIVE_INCIDENT.has(i.status) || (i.resolvedAt ?? 0) > cutoff).slice(0, 40);
    const ids = new Set(s.incidents.map((i) => i.id));
    for (const key of Object.keys(s.incidentMeta)) if (!ids.has(key)) delete s.incidentMeta[key];
  }

  /* -------------------------- dispatch ---------------------------- */

  recommend(incidentId: string): DispatchPlan {
    const incident = this.getIncident(incidentId);
    const corridor = this.state.settings.corridorEnabled;
    const recommendations: DispatchPlan['recommendations'] = { ambulance: [], fire: [], police: [] };
    for (const unit of this.state.units) {
      if (unit.status !== 'available' && unit.status !== 'returning') continue;
      const origin = this.routeOrigin(unit);
      const route = this.planRoute(origin.node, incident.nodeId, corridor, origin.offset);
      if (!route) continue;
      const baseline = this.baselineSeconds(route.path, origin.offset);
      recommendations[unit.kind].push({
        unitId: unit.id,
        callSign: unit.callSign,
        kind: unit.kind,
        etaSeconds: Math.round(route.seconds),
        baselineEtaSeconds: Math.round(baseline.seconds),
        distanceMeters: route.meters,
        path: route.path,
      });
    }
    for (const kind of Object.keys(recommendations) as UnitKind[]) {
      recommendations[kind].sort((a, b) => a.etaSeconds - b.etaSeconds);
      recommendations[kind] = recommendations[kind].slice(0, 4);
    }
    const hospital = INCIDENT_TYPES[incident.type].needsHospital ? this.chooseHospital(incident) : null;
    return { incidentId, recommendations, hospital };
  }

  /** Pick the receiving hospital by ETA, specialty match and free capacity. */
  chooseHospital(incident: Incident): DispatchPlan['hospital'] {
    let best: DispatchPlan['hospital'] = null;
    const critical = incident.severity >= 4;
    for (const h of this.state.hospitals) {
      const ward = critical ? h.icu : h.emergency;
      const free = ward.total - ward.occupied - ward.reserved;
      if (free <= 0 || h.status === 'diverting') continue;
      const route = this.planRoute(incident.nodeId, h.nodeId, this.state.settings.corridorEnabled);
      if (!route) continue;
      const load = (ward.occupied + ward.reserved) / ward.total;
      const score =
        route.seconds / 60 + (h.specialties.includes(incident.type) ? 0 : 6) + (h.status === 'busy' ? 4 : 0) + load * 4;
      if (!best || score < best.score)
        best = { hospitalId: h.id, name: h.name, etaSeconds: Math.round(route.seconds), score: round(score) };
    }
    return best;
  }

  dispatch(incidentId: string, unitIds: string[] | undefined, actor = 'system'): Incident {
    const incident = this.getIncident(incidentId);
    if (!['reported', 'verified', 'dispatched', 'on_scene'].includes(incident.status)) {
      throw conflict(`${incidentId} cannot receive units while ${incident.status}`);
    }
    let chosen: UnitRecommendation[];
    const plan = this.recommend(incidentId);
    const all = Object.values(plan.recommendations).flat();
    if (unitIds?.length) {
      chosen = unitIds.map((id) => {
        const unit = this.getUnit(id);
        const rec = all.find((r) => r.unitId === id);
        if (!rec) throw conflict(`${unit.callSign} is ${unit.status.replace('_', ' ')} and cannot be dispatched`);
        return rec;
      });
    } else {
      chosen = [];
      for (const [kind, needed] of Object.entries(incident.requiredUnits) as [UnitKind, number][]) {
        const already = incident.assignedUnitIds.filter((id) => {
          const u = this.unitIndex.get(id);
          return u?.kind === kind && u.incidentId === incident.id;
        }).length;
        chosen.push(...plan.recommendations[kind].slice(0, Math.max(0, needed - already)));
      }
      if (!chosen.length) throw conflict('No suitable units are available right now');
    }

    if (incident.status === 'reported') {
      incident.status = 'verified';
      this.state.incidentMeta[incident.id].verifyAt = null;
      incident.timeline.push({ at: this.state.simTime, label: 'Verified by dispatcher' });
    }

    for (const rec of chosen) this.assignUnit(this.getUnit(rec.unitId), incident, rec);

    if (incident.status === 'verified') incident.status = 'dispatched';
    incident.dispatchedAt ??= this.state.simTime;
    incident.stage = 'predict';

    // Hospital pre-arrival notice for patients who will need transport
    if (INCIDENT_TYPES[incident.type].needsHospital && !incident.hospitalId && plan.hospital) {
      const ambulance = chosen.find((r) => r.kind === 'ambulance');
      if (ambulance)
        this.notifyHospital(
          incident,
          plan.hospital.hospitalId,
          ambulance.unitId,
          ambulance.etaSeconds + SCENE_TIME_S.ambulance + plan.hospital.etaSeconds,
          plan.hospital.etaSeconds,
        );
    }
    this.touchIncident(incident, `Dispatched ${chosen.map((c) => c.callSign).join(', ')}`);
    this.audit(
      'Units dispatched',
      `${incident.id}: ${chosen.map((c) => `${c.callSign} (ETA ${Math.round(c.etaSeconds)} s)`).join(', ')}`,
      'dispatch',
      actor,
    );
    return incident;
  }

  private assignUnit(unit: Unit, incident: Incident, rec: UnitRecommendation) {
    const m = this.state.motion[unit.id];
    const origin = this.routeOrigin(unit);
    unit.status = 'en_route';
    unit.incidentId = incident.id;
    unit.destinationNodeId = incident.nodeId;
    unit.waitSeconds = 0;
    this.setRoute(unit, rec.path, origin);
    const baseline = this.baselineSeconds(rec.path, origin.offset);
    m.tripStartedAt = this.state.simTime;
    m.tripBaselineSeconds = baseline.seconds;
    m.tripBaselineIdle = baseline.idle;
    m.alertedEdges = [];
    m.lastAlertId = null;
    m.replanIn = REPLAN_INTERVAL_S;
    unit.etaSeconds = rec.etaSeconds;
    unit.baselineEtaSeconds = Math.round(baseline.seconds);
    if (!incident.assignedUnitIds.includes(unit.id)) incident.assignedUnitIds.push(unit.id);
    this.verifyVehicle(unit);
    this.pushAlert(
      'crew',
      'info',
      `${unit.callSign} dispatched`,
      `${incident.title} at ${incident.location} · ETA ${fmt(rec.etaSeconds)}`,
      {
        unitId: unit.id,
        incidentId: incident.id,
      },
    );
  }

  private verifyVehicle(unit: Unit) {
    if (!this.state.settings.vehicleAuth) {
      unit.verified = true;
      return;
    }
    const registered = FLEET_REGISTRY.has(unit.plate);
    unit.verified = registered;
    this.pushDetection({
      source: 'gps',
      nodeId: this.state.motion[unit.id].prev,
      plate: unit.plate,
      unitId: unit.id,
      label: registered
        ? `${unit.callSign} authenticated · fleet registry + signed GPS token`
        : `${unit.callSign} failed authentication`,
      confidence: 1,
      latencyMs: this.rng.int(20, 60),
      verified: registered,
    });
  }

  /** Install a path on a unit; `path[0]` is either the current node or the next node of the current edge. */
  private setRoute(unit: Unit, path: string[], origin: { node: string; prev: string; offset: number }) {
    const m = this.state.motion[unit.id];
    if (unit.route.length) {
      // currently on an edge towards route[0] == path[0]
      unit.route = path.slice();
      unit.plannedPath = [m.prev, ...path];
    } else {
      m.prev = origin.node;
      m.edgeOffset = 0;
      unit.route = path.slice(1);
      unit.plannedPath = path.slice();
    }
    m.waitAtNode = 0;
  }

  recallUnit(unitId: string, actor = 'system') {
    const unit = this.getUnit(unitId);
    if (unit.status === 'available' || unit.status === 'returning')
      throw conflict(`${unit.callSign} is already ${unit.status}`);
    const incident = unit.incidentId ? this.state.incidents.find((i) => i.id === unit.incidentId) : undefined;
    this.sendHome(unit);
    if (incident && ACTIVE_INCIDENT.has(incident.status)) {
      if (unit.kind === 'ambulance') this.clearHospitalNotice(incident, unit.id);
      const stillActive = incident.assignedUnitIds.some((id) => {
        const u = this.unitIndex.get(id);
        return u && u.incidentId === incident.id && ['en_route', 'on_scene', 'transporting'].includes(u.status);
      });
      if (!stillActive && !incident.arrivedAt) {
        incident.status = 'verified';
        incident.assignedUnitIds = incident.assignedUnitIds.filter((id) => id !== unit.id);
        incident.stage = 'verify';
        incident.dispatchedAt = null;
      } else {
        this.checkResolution(incident);
      }
      this.touchIncident(incident, `${unit.callSign} recalled`);
    }
    this.audit('Unit recalled', `${unit.callSign} returning to base`, 'dispatch', actor);
    return unit;
  }

  private sendHome(unit: Unit) {
    const origin = this.routeOrigin(unit);
    unit.status = 'returning';
    unit.destinationNodeId = unit.homeNodeId;
    unit.hospitalId = null;
    const route = this.planRoute(origin.node, unit.homeNodeId, false, origin.offset);
    if (!route || (route.path.length === 1 && !unit.route.length)) {
      this.makeAvailable(unit);
      return;
    }
    this.setRoute(unit, route.path, origin);
    unit.etaSeconds = Math.round(route.seconds);
    unit.baselineEtaSeconds = null;
  }

  private makeAvailable(unit: Unit) {
    const m = this.state.motion[unit.id];
    unit.status = 'available';
    unit.incidentId = null;
    unit.hospitalId = null;
    unit.destinationNodeId = null;
    unit.route = [];
    unit.plannedPath = [];
    unit.etaSeconds = null;
    unit.baselineEtaSeconds = null;
    unit.speed = 0;
    unit.priorityScore = 0;
    unit.waitSeconds = 0;
    m.edgeOffset = 0;
  }

  private autoDispatch() {
    const s = this.state;
    if (s.tick % 3) return;
    const queue = s.incidents
      .filter(
        (i) => i.status === 'verified' && !i.assignedUnitIds.some((id) => this.unitIndex.get(id)?.incidentId === i.id),
      )
      .sort((a, b) => b.severity - a.severity || a.reportedAt - b.reportedAt);
    for (const incident of queue) {
      try {
        this.dispatch(incident.id, undefined, 'AI dispatcher');
      } catch {
        // no units free; incident stays queued by priority
      }
    }
  }

  /* -------------------------- hospitals --------------------------- */

  private notifyHospital(
    incident: Incident,
    hospitalId: string,
    unitId: string,
    etaSeconds: number,
    transportSeconds: number,
  ) {
    const hospital = this.state.hospitals.find((h) => h.id === hospitalId);
    if (!hospital) return;
    const ward = incident.severity >= 4 ? hospital.icu : hospital.emergency;
    ward.reserved++;
    incident.hospitalId = hospital.id;
    this.state.incidentMeta[incident.id].transportEstimate = transportSeconds;
    hospital.incoming = hospital.incoming.filter((x) => x.incidentId !== incident.id);
    hospital.incoming.push({
      unitId,
      incidentId: incident.id,
      etaSeconds,
      category: INCIDENT_TYPES[incident.type].label,
      acknowledged: false,
    });
    this.pushAlert(
      'hospital',
      incident.severity >= 4 ? 'critical' : 'warning',
      `Pre-arrival notice · ${hospital.name}`,
      `${INCIDENT_TYPES[incident.type].label} (S${incident.severity}) · ${incident.severity >= 4 ? 'ICU' : 'ER'} bed reserved · ETA ${fmt(etaSeconds)}`,
      { hospitalId: hospital.id, incidentId: incident.id, unitId },
    );
    this.audit(
      'Hospital notified',
      `${hospital.name} reserved ${incident.severity >= 4 ? 'ICU' : 'ER'} bed for ${incident.id}`,
      'hospital',
    );
  }

  private clearHospitalNotice(incident: Incident, unitId?: string) {
    if (!incident.hospitalId) return;
    const hospital = this.state.hospitals.find((h) => h.id === incident.hospitalId);
    if (!hospital) return;
    const before = hospital.incoming.length;
    hospital.incoming = hospital.incoming.filter(
      (x) => !(x.incidentId === incident.id && (!unitId || x.unitId === unitId)),
    );
    if (hospital.incoming.length < before) {
      const ward = incident.severity >= 4 ? hospital.icu : hospital.emergency;
      ward.reserved = Math.max(0, ward.reserved - 1);
      incident.hospitalId = null;
    }
  }

  acknowledgeAlert(alertId: string, actor = 'system') {
    const alert = this.state.alerts.find((a) => a.id === alertId);
    if (!alert) throw notFound(`Alert ${alertId}`);
    alert.acknowledged = true;
    if (alert.hospitalId && alert.incidentId) {
      const h = this.state.hospitals.find((x) => x.id === alert.hospitalId);
      const entry = h?.incoming.find((x) => x.incidentId === alert.incidentId);
      if (entry) entry.acknowledged = true;
    }
    this.audit('Alert acknowledged', `${alert.title}`, alert.channel === 'hospital' ? 'hospital' : 'system', actor);
    this.version++;
    return alert;
  }

  updateBeds(
    hospitalId: string,
    update: { ward: 'icu' | 'emergency'; occupied?: number; total?: number; status?: Hospital['status'] },
    actor = 'system',
  ) {
    const hospital = this.state.hospitals.find((h) => h.id === hospitalId);
    if (!hospital) throw notFound(`Hospital ${hospitalId}`);
    const ward = hospital[update.ward];
    if (update.total !== undefined) ward.total = update.total;
    if (update.occupied !== undefined) ward.occupied = update.occupied;
    if (ward.occupied + ward.reserved > ward.total) throw new DomainError('Occupied + reserved beds exceed capacity');
    if (update.status) hospital.status = update.status;
    this.audit(
      'Hospital capacity updated',
      `${hospital.name} ${update.ward.toUpperCase()} ${ward.occupied}/${ward.total}${update.status ? ` · ${update.status}` : ''}`,
      'hospital',
      actor,
    );
    this.version++;
    return hospital;
  }

  private updateHospitals() {
    const s = this.state;
    for (const hospital of s.hospitals) {
      for (const entry of hospital.incoming) {
        const unit = this.unitIndex.get(entry.unitId);
        if (!unit) continue;
        if (unit.status === 'transporting') entry.etaSeconds = unit.etaSeconds ?? entry.etaSeconds;
        else if (unit.status === 'en_route')
          entry.etaSeconds =
            (unit.etaSeconds ?? 0) +
            SCENE_TIME_S.ambulance +
            (s.incidentMeta[entry.incidentId]?.transportEstimate ?? 0);
        else if (unit.status === 'on_scene')
          entry.etaSeconds =
            this.state.motion[unit.id].sceneTimer + (s.incidentMeta[entry.incidentId]?.transportEstimate ?? 0);
      }
      if (hospital.status !== 'diverting') {
        const load = (hospital.icu.occupied + hospital.icu.reserved) / hospital.icu.total;
        hospital.status = load >= 0.95 ? 'busy' : 'normal';
      }
    }
    // background admissions and discharges keep capacity realistic
    if (s.simTime >= s.timers.nextBedEventAt) {
      s.timers.nextBedEventAt = s.simTime + this.rng.int(80, 200) * 1000;
      const h = this.rng.pick(s.hospitals);
      const ward = this.rng.chance(0.5) ? h.icu : h.emergency;
      const load = ward.occupied / ward.total;
      if (this.rng.chance(load > 0.75 ? 0.7 : 0.35)) ward.occupied = Math.max(0, ward.occupied - 1);
      else if (ward.occupied + ward.reserved < ward.total) ward.occupied++;
    }
  }

  /* ---------------------- signals / corridor ---------------------- */

  private updateSignals() {
    const s = this.state;
    const claims = new Map<string, SignalClaim[]>();
    this.corridorEdges.clear();

    for (const unit of s.units) {
      unit.priorityScore = 0;
      if (!this.hasCorridor(unit) || !unit.route.length) continue;
      const severity = this.unitSeverity(unit);
      const m = s.motion[unit.id];
      let t = this.routeOrigin(unit).offset;
      let prev = m.prev;
      for (let i = 0; i < unit.route.length; i++) {
        const node = unit.route[i];
        const ei = this.graph.edgeBetween(prev, node);
        if (i > 0) t += this.edgeSeconds(ei, true);
        if (t > PRECLEAR_WINDOW_S) break;
        this.corridorEdges.add(ei);
        const isDestination = i === unit.route.length - 1;
        if (!isDestination && this.signalIndex.has(node)) {
          const priority = priorityScore({ severity, etaSeconds: t, waitSeconds: unit.waitSeconds });
          if (!unit.priorityScore) unit.priorityScore = priority;
          const list = claims.get(node) ?? [];
          list.push({ unitId: unit.id, axis: this.graph.axis(prev, node), etaSeconds: Math.round(t), priority });
          claims.set(node, list);
        }
        prev = node;
      }
      if (!unit.priorityScore)
        unit.priorityScore = priorityScore({
          severity,
          etaSeconds: unit.etaSeconds ?? 60,
          waitSeconds: unit.waitSeconds,
        });
      this.publicAlerts(unit);
    }

    for (const signal of s.signals) {
      const list = (claims.get(signal.nodeId) ?? []).sort((a, b) => b.priority - a.priority);
      signal.claims = list;
      const avgC = this.avgCongestion(signal.nodeId);

      if (signal.mode === 'manual' || signal.mode === 'flash') {
        signal.holderUnitId = null;
        if (signal.mode === 'manual' && signal.manualAxis) signal.greenAxis = signal.manualAxis;
        continue;
      }

      if (list.length) {
        let holder = list[0];
        const current = list.find((c) => c.unitId === signal.holderUnitId);
        // do not switch away from a vehicle that is already committed to the junction
        if (current && current !== holder && current.etaSeconds <= GREEN_WINDOW_S / 2) holder = current;
        const rival = list.find((c) => c.unitId !== holder.unitId && c.axis !== holder.axis);
        if (rival) this.reportArbitration(signal, holder, rival);
        signal.holderUnitId = holder.unitId;
        signal.greenAxis = holder.axis;
        signal.mode = holder.etaSeconds <= GREEN_WINDOW_S ? 'green_wave' : 'preclear';
        signal.queue = Math.max(0, signal.queue - 2);
        signal.restoreRemaining = 0;
        continue;
      }

      signal.holderUnitId = null;
      delete s.conflictKeys[signal.id];
      if (signal.mode === 'preclear' || signal.mode === 'green_wave') {
        signal.mode = 'restore';
        signal.restoreRemaining = RESTORE_DURATION_S;
        signal.greenAxis = signal.greenAxis === 'NS' ? 'EW' : 'NS'; // serve the held cross traffic first
      } else if (signal.mode === 'restore') {
        signal.restoreRemaining--;
        if (signal.restoreRemaining <= 0) {
          signal.mode = 'normal';
          signal.phaseElapsed = 0;
        }
      } else {
        signal.phaseElapsed++;
        if (signal.phaseElapsed >= NORMAL_PHASE_S) {
          signal.phaseElapsed = 0;
          signal.greenAxis = signal.greenAxis === 'NS' ? 'EW' : 'NS';
        }
      }
      const target = queueEstimate(avgC);
      signal.queue += Math.sign(target - signal.queue);
    }
  }

  private reportArbitration(signal: TrafficSignal, winner: SignalClaim, loser: SignalClaim) {
    const key = `${winner.unitId}>${loser.unitId}`;
    if (this.state.conflictKeys[signal.id] === key) return;
    this.state.conflictKeys[signal.id] = key;
    const w = this.unitIndex.get(winner.unitId)!;
    const l = this.unitIndex.get(loser.unitId)!;
    const detail = `${signal.name}: ${w.callSign} (P=${winner.priority.toFixed(2)}, ETA ${winner.etaSeconds}s) granted over ${l.callSign} (P=${loser.priority.toFixed(2)}, ETA ${loser.etaSeconds}s)`;
    this.pushAlert('system', 'info', 'Multi-vehicle conflict resolved', detail, { unitId: w.id });
    this.audit('Priority arbitration', detail, 'signal', 'AI arbiter');
  }

  private avgCongestion(nodeId: string): number {
    const adj = this.graph.adjacency.get(nodeId)!;
    return adj.reduce((sum, n) => sum + this.traffic.congestion(n.edgeIndex), 0) / adj.length;
  }

  private unitSeverity(unit: Unit): number {
    const incident = unit.incidentId ? this.state.incidents.find((i) => i.id === unit.incidentId) : undefined;
    if (!incident) return 2;
    // a patient on board keeps the priority high
    return unit.status === 'transporting' ? Math.max(incident.severity, 4) : incident.severity;
  }

  private publicAlerts(unit: Unit) {
    const m = this.state.motion[unit.id];
    let prev = m.prev;
    const fresh: number[] = [];
    let t = this.routeOrigin(unit).offset;
    for (let i = 0; i < unit.route.length; i++) {
      const ei = this.graph.edgeBetween(prev, unit.route[i]);
      if (i > 0) t += this.edgeSeconds(ei, true);
      if (t > PRECLEAR_WINDOW_S) break;
      const id = this.graph.edge(ei).id;
      if (!m.alertedEdges.includes(id)) {
        m.alertedEdges.push(id);
        fresh.push(ei);
      }
      prev = unit.route[i];
    }
    if (!fresh.length) return;
    const reach = fresh.reduce((sum, ei) => {
      const e = this.graph.edge(ei);
      return sum + alertReach(e.length, e.lanes, this.traffic.congestion(ei));
    }, 0);
    this.state.stats.civiliansAlerted += reach;
    const roads = [...new Set(fresh.map((ei) => this.graph.edge(ei).name))].join(', ');
    const existing = m.lastAlertId ? this.state.alerts.find((a) => a.id === m.lastAlertId) : undefined;
    if (existing && this.state.simTime - m.lastAlertAt < 30_000) {
      existing.reach = (existing.reach ?? 0) + reach;
      existing.detail = `${existing.reach} drivers notified via V2X, VMS boards & navigation apps · ${roads}`;
      return;
    }
    const alert = this.pushAlert(
      'v2x',
      'warning',
      `Yield: ${unit.callSign} approaching`,
      `${reach} drivers notified via V2X, VMS boards & navigation apps · ${roads}`,
      {
        unitId: unit.id,
        incidentId: unit.incidentId ?? undefined,
        reach,
      },
    );
    m.lastAlertId = alert.id;
    m.lastAlertAt = this.state.simTime;
  }

  overrideSignal(signalId: string, mode: 'force_ns' | 'force_ew' | 'flash' | 'release', actor = 'system') {
    const signal = this.state.signals.find((s) => s.id === signalId);
    if (!signal) throw notFound(`Signal ${signalId}`);
    if (mode === 'release') {
      signal.mode = 'normal';
      signal.manualAxis = null;
      signal.phaseElapsed = 0;
    } else if (mode === 'flash') {
      signal.mode = 'flash';
      signal.manualAxis = null;
    } else {
      signal.mode = 'manual';
      signal.manualAxis = mode === 'force_ns' ? 'NS' : 'EW';
      signal.greenAxis = signal.manualAxis;
    }
    const label = {
      force_ns: 'forced N–S green',
      force_ew: 'forced E–W green',
      flash: 'set to flashing red',
      release: 'returned to adaptive control',
    }[mode];
    this.audit('Signal override', `${signal.name} ${label}`, 'signal', actor);
    this.version++;
    return signal;
  }

  /* -------------------------- blockages --------------------------- */

  blockEdge(edgeId: string, reason: string, actor = 'system') {
    const index = this.graph.edgeIndex.get(edgeId);
    if (index === undefined) throw notFound(`Road segment ${edgeId}`);
    if (this.traffic.blocked.has(index)) throw conflict('Segment is already blocked');
    this.traffic.blocked.add(index);
    this.state.blocked.push({ edgeIndex: index, reason });
    const edge = this.graph.edge(index);
    const from = this.graph.node(edge.from).name;
    this.pushAlert(
      'vms',
      'warning',
      `Road blocked · ${edge.name}`,
      `${reason} near ${from}. Affected routes are being re-planned.`,
    );
    this.audit('Blockage reported', `${edge.name} (${edge.id}): ${reason}`, 'corridor', actor);
    for (const unit of this.state.units) if (unit.route.length) this.maybeReplan(unit, true);
    this.version++;
  }

  clearBlockage(edgeId: string, actor = 'system') {
    const index = this.graph.edgeIndex.get(edgeId);
    if (index === undefined || !this.traffic.blocked.has(index)) throw notFound(`Blockage on ${edgeId}`);
    this.traffic.blocked.delete(index);
    this.state.blocked = this.state.blocked.filter((b) => b.edgeIndex !== index);
    this.audit('Blockage cleared', `${this.graph.edge(index).name} (${edgeId}) reopened`, 'corridor', actor);
    this.version++;
  }

  blockages() {
    return this.state.blocked.map((b) => ({ edgeId: this.graph.edge(b.edgeIndex).id, reason: b.reason }));
  }

  /* --------------------------- movement --------------------------- */

  private moveUnit(unit: Unit) {
    const m = this.state.motion[unit.id];
    unit.lastGpsAt = this.state.simTime;
    if (!unit.route.length) {
      unit.speed = 0;
      // a trip whose destination is the current node completes immediately
      if (unit.status === 'en_route' || unit.status === 'transporting' || unit.status === 'returning')
        this.arrive(unit);
      return;
    }
    let budget = 1; // seconds of movement left in this step
    while (budget > 0 && unit.route.length) {
      const next = unit.route[0];
      const ei = this.graph.edgeBetween(m.prev, next);
      const edge = this.graph.edge(ei);
      const corridor = this.hasCorridor(unit);
      if (m.edgeOffset >= edge.length) {
        // waiting at the stop line of `next`
        if (unit.route.length > 1 && !this.canPass(unit, m.prev, next, m.waitAtNode)) {
          m.waitAtNode += budget;
          unit.waitSeconds += budget;
          unit.speed = 0;
          break;
        }
        this.passNode(unit, next);
        continue;
      }
      // a unit already on a segment that gets blocked creeps through to its end
      let v = emergencySpeed(edge.speedLimit, Math.min(this.traffic.congestion(ei), 0.95), corridor);
      if (!this.isEmergencyTrip(unit)) v *= 0.8; // returning units drive normally
      const step = v * budget;
      const remaining = edge.length - m.edgeOffset;
      if (step >= remaining && v > 0) {
        budget -= remaining / v;
        m.edgeOffset = edge.length;
        unit.distanceTravelled += remaining;
        if (unit.route.length === 1) {
          this.passNode(unit, next);
          break;
        }
      } else {
        m.edgeOffset += step;
        unit.distanceTravelled += step;
        budget = 0;
      }
      unit.speed = Math.round(v * 3.6);
    }
    this.updatePosition(unit);
    unit.etaSeconds = this.remainingEta(unit);
    // like-for-like comparison: remaining time on the same path without the corridor
    unit.baselineEtaSeconds =
      this.isEmergencyTrip(unit) && unit.route.length
        ? Math.round(this.baselineSeconds(unit.route, this.routeOrigin(unit).offset).seconds)
        : null;

    if (this.isEmergencyTrip(unit) && --m.replanIn <= 0) {
      m.replanIn = REPLAN_INTERVAL_S;
      this.maybeReplan(unit, false);
    }
  }

  private canPass(unit: Unit, prev: string, node: string, waited: number): boolean {
    const signal = this.signalIndex.get(node);
    if (!signal) return true;
    if (signal.mode === 'flash') return waited >= 3;
    if (signal.greenAxis === this.graph.axis(prev, node)) return true;
    // without pre-emption an emergency vehicle eventually crosses on red, carefully
    return this.isEmergencyTrip(unit) && waited >= MAX_CAUTIOUS_WAIT_S;
  }

  private passNode(unit: Unit, node: string) {
    const m = this.state.motion[unit.id];
    m.prev = node;
    m.edgeOffset = 0;
    m.waitAtNode = 0;
    unit.route.shift();
    const graphNode = this.graph.node(node);
    if (this.isEmergencyTrip(unit) && graphNode.hasCamera && unit.route.length) {
      const misread = this.rng.chance(0.04);
      this.pushDetection({
        source: 'cctv_anpr',
        nodeId: node,
        plate: misread ? unit.plate.replace(/\d$/, '8') : unit.plate,
        unitId: unit.id,
        label: misread
          ? `ANPR misread at ${graphNode.name} · GPS cross-check confirmed ${unit.callSign}`
          : `${unit.callSign} detected at ${graphNode.name}`,
        confidence: round(misread ? this.rng.range(0.55, 0.72) : this.rng.range(0.9, 0.995)),
        latencyMs: this.rng.int(70, 190),
        verified: !misread,
      });
    }
    if (!unit.route.length) this.arrive(unit);
  }

  private updatePosition(unit: Unit) {
    const m = this.state.motion[unit.id];
    const a = this.graph.node(m.prev);
    if (!unit.route.length) {
      unit.position = { x: a.x, y: a.y };
      return;
    }
    const b = this.graph.node(unit.route[0]);
    const edge = this.graph.edge(this.graph.edgeBetween(m.prev, unit.route[0]));
    const f = Math.min(1, m.edgeOffset / edge.length);
    unit.position = { x: round(a.x + (b.x - a.x) * f), y: round(a.y + (b.y - a.y) * f) };
    unit.heading = Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  }

  private maybeReplan(unit: Unit, force: boolean) {
    if (!unit.destinationNodeId || !unit.route.length) return;
    const m = this.state.motion[unit.id];
    const blocked = this.traffic.blocked;
    let onBlocked = false;
    let prev = m.prev;
    for (let i = 0; i < unit.route.length; i++) {
      // the edge the unit is already on cannot be avoided
      if (i > 0 && blocked.has(this.graph.edgeBetween(prev, unit.route[i]))) onBlocked = true;
      prev = unit.route[i];
    }
    if (force && !onBlocked) return;
    const origin = this.routeOrigin(unit);
    const corridor = this.hasCorridor(unit);
    const route = this.planRoute(origin.node, unit.destinationNodeId, corridor, origin.offset);
    if (!route) return;
    const current = this.remainingEta(unit) ?? Infinity;
    const same = route.path.join() === unit.route.join();
    if (same) return;
    if (!onBlocked && !(route.seconds < current * (1 - REPLAN_GAIN))) return;
    this.setRoute(unit, route.path, origin);
    unit.etaSeconds = Math.round(route.seconds);
    if (!this.isEmergencyTrip(unit)) return;
    const via = [
      ...new Set(
        route.path.slice(0, -1).map((n, i) => this.graph.edge(this.graph.edgeBetween(n, route.path[i + 1])).name),
      ),
    ]
      .slice(0, 3)
      .join(' → ');
    const why = onBlocked ? 'blockage ahead' : `predicted congestion, saves ${Math.round(current - route.seconds)} s`;
    this.pushAlert('crew', 'warning', `Automatic rerouting · ${unit.callSign}`, `New route via ${via} (${why})`, {
      unitId: unit.id,
      incidentId: unit.incidentId ?? undefined,
    });
    this.audit('Route re-planned', `${unit.callSign} via ${via} (${why})`, 'corridor', 'AI router');
  }

  /* ------------------------- arrivals ----------------------------- */

  private arrive(unit: Unit) {
    const m = this.state.motion[unit.id];
    unit.speed = 0;
    unit.etaSeconds = 0;
    const incident = unit.incidentId ? this.state.incidents.find((i) => i.id === unit.incidentId) : undefined;

    if (unit.status === 'en_route' && incident) {
      unit.status = 'on_scene';
      m.sceneTimer = SCENE_TIME_S[unit.kind];
      if (!incident.arrivedAt) {
        incident.arrivedAt = this.state.simTime;
        incident.responseSeconds = Math.round((this.state.simTime - (incident.dispatchedAt ?? m.tripStartedAt)) / 1000);
        incident.baselineResponseSeconds = Math.round(
          m.tripBaselineSeconds + (m.tripStartedAt - (incident.dispatchedAt ?? m.tripStartedAt)) / 1000,
        );
        const meta = this.state.incidentMeta[incident.id];
        if (meta) {
          meta.idleSeconds = unit.waitSeconds;
          meta.baselineIdleSeconds = m.tripBaselineIdle;
          meta.corridorEnabled = this.state.settings.corridorEnabled;
        }
        incident.status = 'on_scene';
        this.audit(
          'Unit on scene',
          `${unit.callSign} reached ${incident.id} in ${fmt(incident.responseSeconds)} (baseline ${fmt(incident.baselineResponseSeconds)})`,
          'dispatch',
        );
      }
      this.touchIncident(incident, `${unit.callSign} on scene`);
      return;
    }

    if (unit.status === 'transporting' && incident) {
      unit.status = 'at_hospital';
      m.sceneTimer = HANDOVER_TIME_S;
      const hospital = this.state.hospitals.find((h) => h.id === unit.hospitalId);
      if (hospital) {
        const ward = incident.severity >= 4 ? hospital.icu : hospital.emergency;
        const had = hospital.incoming.some((x) => x.incidentId === incident.id);
        hospital.incoming = hospital.incoming.filter((x) => x.incidentId !== incident.id);
        if (had) ward.reserved = Math.max(0, ward.reserved - 1);
        ward.occupied = Math.min(ward.total, ward.occupied + 1);
        this.pushAlert(
          'hospital',
          'info',
          `Patient handed over · ${hospital.name}`,
          `${unit.callSign} completed handover for ${incident.id}`,
          {
            hospitalId: hospital.id,
            incidentId: incident.id,
            unitId: unit.id,
          },
        );
      }
      this.touchIncident(incident, `${unit.callSign} arrived at ${hospital?.name ?? 'hospital'}`);
      incident.hospitalId = hospital?.id ?? incident.hospitalId;
      this.checkResolution(incident);
      return;
    }

    if (unit.status === 'returning') this.makeAvailable(unit);
  }

  private runTimers(unit: Unit) {
    if (unit.status !== 'on_scene' && unit.status !== 'at_hospital') return;
    const m = this.state.motion[unit.id];
    if (--m.sceneTimer > 0) return;
    const incident = unit.incidentId ? this.state.incidents.find((i) => i.id === unit.incidentId) : undefined;

    if (
      unit.status === 'on_scene' &&
      unit.kind === 'ambulance' &&
      incident &&
      INCIDENT_TYPES[incident.type].needsHospital
    ) {
      this.startTransport(unit, incident);
      return;
    }
    this.sendHome(unit);
    if (incident) this.checkResolution(incident);
  }

  private startTransport(unit: Unit, incident: Incident) {
    let hospitalId = incident.hospitalId;
    if (!hospitalId) {
      const choice = this.chooseHospital(incident);
      if (choice) {
        this.notifyHospital(incident, choice.hospitalId, unit.id, choice.etaSeconds, choice.etaSeconds);
        hospitalId = choice.hospitalId;
      }
    }
    const hospital = this.state.hospitals.find((h) => h.id === hospitalId);
    if (!hospital) {
      this.sendHome(unit);
      this.checkResolution(incident);
      return;
    }
    const m = this.state.motion[unit.id];
    const route = this.planRoute(m.prev, hospital.nodeId, this.state.settings.corridorEnabled);
    if (!route) {
      this.sendHome(unit);
      this.checkResolution(incident);
      return;
    }
    unit.status = 'transporting';
    unit.hospitalId = hospital.id;
    unit.destinationNodeId = hospital.nodeId;
    unit.waitSeconds = 0;
    m.alertedEdges = [];
    m.lastAlertId = null;
    this.setRoute(unit, route.path, { node: m.prev, prev: m.prev, offset: 0 });
    unit.etaSeconds = Math.round(route.seconds);
    unit.baselineEtaSeconds = Math.round(this.baselineSeconds(route.path).seconds);
    const entry = hospital.incoming.find((x) => x.incidentId === incident.id);
    if (entry) {
      entry.unitId = unit.id;
      entry.etaSeconds = unit.etaSeconds;
    }
    incident.status = 'transporting';
    this.pushAlert(
      'hospital',
      'warning',
      `Patient inbound · ${hospital.name}`,
      `${unit.callSign} transporting ${INCIDENT_TYPES[incident.type].label.toLowerCase()} patient · ETA ${fmt(unit.etaSeconds)}`,
      {
        hospitalId: hospital.id,
        incidentId: incident.id,
        unitId: unit.id,
      },
    );
    this.touchIncident(incident, `${unit.callSign} transporting to ${hospital.name}`);
  }

  private checkResolution(incident: Incident) {
    if (!ACTIVE_INCIDENT.has(incident.status) || !incident.arrivedAt) return;
    const busy = incident.assignedUnitIds.some((id) => {
      const u = this.unitIndex.get(id);
      return u && u.incidentId === incident.id && ['en_route', 'on_scene', 'transporting'].includes(u.status);
    });
    if (!busy) this.finishIncident(incident, 'All units cleared');
  }

  /* --------------------------- stages ----------------------------- */

  private updateIncidentStages() {
    for (const incident of this.state.incidents) {
      if (!ACTIVE_INCIDENT.has(incident.status)) continue;
      if (incident.status === 'reported') {
        incident.stage = 'detect';
        continue;
      }
      if (incident.status === 'verified') {
        incident.stage = 'verify';
        continue;
      }
      if (incident.status === 'on_scene') {
        incident.stage = 'restore';
        continue;
      }
      const moving = incident.assignedUnitIds.filter((id) => {
        const u = this.unitIndex.get(id);
        return u && u.incidentId === incident.id && this.isEmergencyTrip(u);
      });
      const held = this.state.signals.filter((s) => s.holderUnitId && moving.includes(s.holderUnitId));
      incident.stage = held.some((s) => s.mode === 'green_wave')
        ? 'green_wave'
        : held.length
          ? 'preclear'
          : moving.length
            ? 'predict'
            : 'restore';
    }
  }

  /* --------------------------- security --------------------------- */

  private securityChecks() {
    const s = this.state;
    if (!s.settings.vehicleAuth || s.simTime < s.timers.nextSpoofAt) return;
    s.timers.nextSpoofAt = s.simTime + this.rng.int(360, 720) * 1000;
    if (!this.rng.chance(0.6)) return;
    const node = this.rng.pick(this.network.nodes.filter((n) => n.hasCamera));
    const plate = `MH14${this.rng.pick(['AB', 'CK', 'DZ', 'GT'])}${this.rng.int(1000, 9999)}`;
    this.pushDetection({
      source: 'cctv_anpr',
      nodeId: node.id,
      plate,
      unitId: null,
      label: `Unregistered vehicle using emergency beacon at ${node.name}`,
      confidence: round(this.rng.range(0.9, 0.98)),
      latencyMs: this.rng.int(80, 170),
      verified: false,
    });
    this.pushAlert(
      'system',
      'warning',
      'Priority request rejected',
      `Plate ${plate} at ${node.name} is not in the emergency fleet registry. Signal pre-emption denied; traffic police notified.`,
    );
    this.audit('Spoofing attempt blocked', `${plate} at ${node.name}`, 'system', 'Vehicle auth');
  }

  /* --------------------------- settings --------------------------- */

  updateSettings(patch: Partial<SimulationSettings>, actor = 'system') {
    const before = { ...this.state.settings };
    Object.assign(this.state.settings, patch);
    const changes = (Object.keys(patch) as (keyof SimulationSettings)[])
      .filter((k) => before[k] !== this.state.settings[k])
      .map((k) => `${k}: ${before[k]} → ${this.state.settings[k]}`);
    if (changes.length) this.audit('Simulation settings changed', changes.join(', '), 'system', actor);
    if (patch.vehicleAuth !== undefined) for (const u of this.state.units) u.verified = true;
    this.version++;
    return this.state.settings;
  }

  /* --------------------------- read models ------------------------ */

  forecastFor(edgeId: string): ForecastSeries {
    const index = this.graph.edgeIndex.get(edgeId);
    if (index === undefined) throw notFound(`Road segment ${edgeId}`);
    return this.traffic.series(index, this.state.simTime);
  }

  /** Busiest segments right now, for the traffic dashboard. */
  hotspots(limit = 8) {
    return this.network.edges
      .map((edge, i) => ({
        edgeId: edge.id,
        name: edge.name,
        from: this.graph.node(edge.from).name,
        to: this.graph.node(edge.to).name,
        congestion: round(this.traffic.congestion(i)),
        forecast10: round(this.traffic.forecast(i, this.state.simTime, 600).c),
        blocked: this.traffic.blocked.has(i),
      }))
      .sort((a, b) => b.forecast10 - a.forecast10)
      .slice(0, limit);
  }

  metrics(): MetricsSummary {
    const s = this.state;
    const withCorridor = s.outcomes.filter((o) => o.corridorEnabled);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const avgResponse = avg(withCorridor.map((o) => o.responseSeconds));
    const avgBaseline = avg(withCorridor.map((o) => o.baselineSeconds));
    const idle = withCorridor.reduce((sum, o) => sum + o.idleSeconds, 0);
    const baselineIdle = withCorridor.reduce((sum, o) => sum + o.baselineIdleSeconds, 0);
    const kinds: UnitKind[] = ['ambulance', 'fire', 'police'];
    const count = (pred: (u: Unit) => boolean) =>
      Object.fromEntries(kinds.map((k) => [k, s.units.filter((u) => u.kind === k && pred(u)).length])) as Record<
        UnitKind,
        number
      >;
    return {
      resolvedIncidents: s.outcomes.length,
      activeIncidents: s.incidents.filter((i) => ACTIVE_INCIDENT.has(i.status)).length,
      avgResponseSeconds: avgResponse && Math.round(avgResponse),
      avgBaselineSeconds: avgBaseline && Math.round(avgBaseline),
      improvementPct: avgResponse && avgBaseline ? round((1 - avgResponse / avgBaseline) * 100) : null,
      signalWaitSavedSeconds: Math.round(Math.max(0, baselineIdle - idle)),
      avgDetectionLatencyMs: s.stats.detections ? Math.round(s.stats.latencySum / s.stats.detections) : null,
      detectionAccuracy: s.stats.detections ? round((s.stats.detectionsCorrect / s.stats.detections) * 100) : null,
      idleReductionPct: baselineIdle > 0 ? round((1 - idle / baselineIdle) * 100) : null,
      civiliansAlerted: s.stats.civiliansAlerted,
      unitsAvailable: count((u) => u.status === 'available'),
      unitsTotal: count(() => true),
    };
  }

  snapshot(): Snapshot {
    const s = this.state;
    const traffic: EdgeTraffic[] = this.network.edges.map((_, i) => ({
      c: round(this.traffic.congestion(i)),
      f: round(this.traffic.forecast(i, s.simTime, 600).c),
      blocked: this.traffic.blocked.has(i),
      corridor: this.corridorEdges.has(i),
    }));
    return {
      version: this.version,
      tick: s.tick,
      simTime: s.simTime,
      settings: s.settings,
      units: s.units,
      incidents: s.incidents,
      signals: s.signals,
      hospitals: s.hospitals,
      traffic,
      alerts: s.alerts.slice(0, 40),
      detections: s.detections.slice(0, 40),
      metrics: this.metrics(),
    };
  }
}

/* ------------------------------------------------------------------ */

const round = (v: number) => Math.round(v * 1000) / 1000;

function fmt(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

function sourceLabel(source: IncidentSource) {
  return { erss_112: '112 ERSS call', cctv: 'CCTV analytics', gps_iot: 'GPS / IoT sensor', manual: 'control room' }[
    source
  ];
}
