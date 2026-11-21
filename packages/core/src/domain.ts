/**
 * Domain model for the AI-Powered Predictive Emergency Corridor & Multi-Vehicle
 * Coordination System. These types are shared by the API server (which owns
 * the authoritative state) and the web client (which renders it).
 */

export type UnitKind = 'ambulance' | 'fire' | 'police';

export type UnitStatus =
  'available' | 'dispatched' | 'en_route' | 'on_scene' | 'transporting' | 'at_hospital' | 'returning' | 'offline';

export type IncidentType = 'cardiac' | 'stroke' | 'trauma' | 'road_accident' | 'fire' | 'hazmat' | 'crime' | 'medical';

export type IncidentStatus =
  'reported' | 'verified' | 'dispatched' | 'on_scene' | 'transporting' | 'resolved' | 'cancelled';

/** Where an incident was first detected (PDF "Data Inputs"). */
export type IncidentSource = 'erss_112' | 'cctv' | 'gps_iot' | 'manual';

/** Emergency corridor lifecycle from the technical approach. */
export type LifecycleStage = 'detect' | 'verify' | 'predict' | 'preclear' | 'green_wave' | 'restore';

export const LIFECYCLE: { id: LifecycleStage; label: string; detail: string }[] = [
  { id: 'detect', label: 'Detect', detail: 'Call / GPS / camera' },
  { id: 'verify', label: 'Verify', detail: 'Auth + vehicle ID' },
  { id: 'predict', label: 'Predict ETA', detail: 'Graph routing + live traffic' },
  { id: 'preclear', label: 'Pre-clear', detail: 'Flush queues early' },
  { id: 'green_wave', label: 'Green Wave', detail: 'Signals in sequence' },
  { id: 'restore', label: 'Restore', detail: 'Normal cycle resumes' },
];

/** Signal approach axis: north-south or east-west movement gets green. */
export type Axis = 'NS' | 'EW';

export type SignalMode = 'normal' | 'preclear' | 'green_wave' | 'restore' | 'manual' | 'flash';

export type UserRole = 'admin' | 'supervisor' | 'dispatcher' | 'hospital';

export interface Point {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Static road network                                                 */
/* ------------------------------------------------------------------ */

export interface RoadNode extends Point {
  id: string;
  name: string;
  hasSignal: boolean;
  hasCamera: boolean;
}

export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  name: string;
  /** metres */
  length: number;
  /** km/h */
  speedLimit: number;
  lanes: number;
}

export interface Facility extends Point {
  id: string;
  name: string;
  nodeId: string;
  kind: 'hospital' | 'fire_station' | 'police_station' | 'ambulance_base';
}

export interface RoadNetwork {
  /** Width/height of the drawing space, metres per unit given by `scale`. */
  width: number;
  height: number;
  /** metres per drawing unit */
  scale: number;
  nodes: RoadNode[];
  edges: RoadEdge[];
  facilities: Facility[];
}

/* ------------------------------------------------------------------ */
/* Live state                                                          */
/* ------------------------------------------------------------------ */

export interface Unit {
  id: string;
  callSign: string;
  kind: UnitKind;
  /** Registration plate used by ANPR verification. */
  plate: string;
  status: UnitStatus;
  homeNodeId: string;
  position: Point;
  /** degrees, 0 = east */
  heading: number;
  /** km/h */
  speed: number;
  /** remaining route node ids, first element is the next node */
  route: string[];
  /** full planned path for drawing (node ids) */
  plannedPath: string[];
  destinationNodeId: string | null;
  incidentId: string | null;
  hospitalId: string | null;
  etaSeconds: number | null;
  /** ETA the same trip would take with no corridor (signals + normal traffic). */
  baselineEtaSeconds: number | null;
  /** seconds spent stopped at signals on the current trip */
  waitSeconds: number;
  priorityScore: number;
  verified: boolean;
  lastGpsAt: number;
  distanceTravelled: number;
}

export interface IncidentTimeline {
  at: number;
  label: string;
}

export interface Incident {
  id: string;
  type: IncidentType;
  title: string;
  severity: number; // 1..5
  status: IncidentStatus;
  source: IncidentSource;
  nodeId: string;
  location: string;
  position: Point;
  callerName: string | null;
  callerPhone: string | null;
  notes: string;
  requiredUnits: Partial<Record<UnitKind, number>>;
  assignedUnitIds: string[];
  hospitalId: string | null;
  stage: LifecycleStage;
  reportedAt: number;
  dispatchedAt: number | null;
  arrivedAt: number | null;
  resolvedAt: number | null;
  /** Response time in seconds (dispatch -> first unit on scene). */
  responseSeconds: number | null;
  /** Estimated response time for the same trip without the corridor system. */
  baselineResponseSeconds: number | null;
  timeline: IncidentTimeline[];
  createdBy: string | null;
}

export interface SignalClaim {
  unitId: string;
  axis: Axis;
  etaSeconds: number;
  priority: number;
}

export interface TrafficSignal {
  id: string;
  nodeId: string;
  name: string;
  mode: SignalMode;
  /** axis currently showing green */
  greenAxis: Axis;
  /** seconds into the current normal-cycle phase */
  phaseElapsed: number;
  holderUnitId: string | null;
  claims: SignalClaim[];
  /** queued civilian vehicles (estimated) */
  queue: number;
  restoreRemaining: number;
  manualAxis: Axis | null;
}

export interface HospitalBeds {
  total: number;
  occupied: number;
  reserved: number;
}

export interface Hospital {
  id: string;
  name: string;
  nodeId: string;
  position: Point;
  specialties: IncidentType[];
  icu: HospitalBeds;
  emergency: HospitalBeds;
  /** active pre-arrival notifications */
  incoming: { unitId: string; incidentId: string; etaSeconds: number; category: string; acknowledged: boolean }[];
  status: 'normal' | 'busy' | 'diverting';
}

export type AlertChannel = 'v2x' | 'vms' | 'app_push' | 'hospital' | 'crew' | 'system';
export type AlertLevel = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  at: number;
  channel: AlertChannel;
  level: AlertLevel;
  title: string;
  detail: string;
  /** civilian vehicles reached by public alerts */
  reach?: number;
  unitId?: string;
  incidentId?: string;
  hospitalId?: string;
  acknowledged: boolean;
}

export interface Detection {
  id: string;
  at: number;
  source: 'cctv_anpr' | 'gps' | 'erss_112';
  nodeId: string | null;
  plate: string | null;
  unitId: string | null;
  label: string;
  confidence: number;
  latencyMs: number;
  verified: boolean;
}

export interface EdgeTraffic {
  /** current congestion 0..1 */
  c: number;
  /** forecast congestion in 10 minutes 0..1 */
  f: number;
  blocked: boolean;
  /** an emergency corridor is active on this edge */
  corridor: boolean;
}

export interface SimulationSettings {
  running: boolean;
  speed: number;
  corridorEnabled: boolean;
  autoIncidents: boolean;
  autoDispatch: boolean;
  vehicleAuth: boolean;
}

export interface MetricsSummary {
  resolvedIncidents: number;
  activeIncidents: number;
  avgResponseSeconds: number | null;
  avgBaselineSeconds: number | null;
  improvementPct: number | null;
  signalWaitSavedSeconds: number;
  avgDetectionLatencyMs: number | null;
  detectionAccuracy: number | null;
  idleReductionPct: number | null;
  civiliansAlerted: number;
  unitsAvailable: Record<UnitKind, number>;
  unitsTotal: Record<UnitKind, number>;
}

export interface ResponseOutcome {
  incidentId: string;
  type: IncidentType;
  severity: number;
  resolvedAt: number;
  responseSeconds: number;
  baselineSeconds: number;
  /** seconds stopped at signals vs. the expected stop time without a corridor */
  idleSeconds: number;
  baselineIdleSeconds: number;
  corridorEnabled: boolean;
}

export interface BenchmarkResult {
  ranAt: number;
  simulatedSeconds: number;
  incidents: number;
  withCorridor: { avgResponseSeconds: number; avgIdleSeconds: number; completed: number };
  withoutCorridor: { avgResponseSeconds: number; avgIdleSeconds: number; completed: number };
  improvementPct: number;
  byType: { type: IncidentType; withCorridor: number; withoutCorridor: number }[];
}

export interface Snapshot {
  version: number;
  tick: number;
  simTime: number;
  settings: SimulationSettings;
  units: Unit[];
  incidents: Incident[];
  signals: TrafficSignal[];
  hospitals: Hospital[];
  /** aligned with RoadNetwork.edges by index */
  traffic: EdgeTraffic[];
  alerts: Alert[];
  detections: Detection[];
  metrics: MetricsSummary;
}

export interface AuditEntry {
  id: number;
  at: number;
  actor: string;
  action: string;
  detail: string;
  category: 'dispatch' | 'corridor' | 'signal' | 'hospital' | 'auth' | 'system' | 'incident';
}

export interface PublicUser {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  zone: string;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface UnitRecommendation {
  unitId: string;
  callSign: string;
  kind: UnitKind;
  etaSeconds: number;
  baselineEtaSeconds: number;
  distanceMeters: number;
  path: string[];
}

export interface DispatchPlan {
  incidentId: string;
  recommendations: Record<UnitKind, UnitRecommendation[]>;
  hospital: { hospitalId: string; name: string; etaSeconds: number; score: number } | null;
}

export interface ForecastSeries {
  edgeId: string;
  name: string;
  history: { t: number; c: number }[];
  forecast: { t: number; c: number; lo: number; hi: number }[];
}

/* ------------------------------------------------------------------ */
/* Static lookups                                                      */
/* ------------------------------------------------------------------ */

export const INCIDENT_TYPES: Record<
  IncidentType,
  { label: string; defaultSeverity: number; units: Partial<Record<UnitKind, number>>; needsHospital: boolean }
> = {
  cardiac: { label: 'Cardiac arrest', defaultSeverity: 5, units: { ambulance: 1 }, needsHospital: true },
  stroke: { label: 'Stroke', defaultSeverity: 5, units: { ambulance: 1 }, needsHospital: true },
  trauma: { label: 'Major trauma', defaultSeverity: 4, units: { ambulance: 1, police: 1 }, needsHospital: true },
  road_accident: {
    label: 'Road accident',
    defaultSeverity: 4,
    units: { ambulance: 1, police: 1 },
    needsHospital: true,
  },
  fire: { label: 'Structure fire', defaultSeverity: 5, units: { fire: 2, ambulance: 1 }, needsHospital: false },
  hazmat: { label: 'Hazardous material', defaultSeverity: 4, units: { fire: 1, police: 1 }, needsHospital: false },
  crime: { label: 'Crime in progress', defaultSeverity: 3, units: { police: 2 }, needsHospital: false },
  medical: { label: 'Medical emergency', defaultSeverity: 3, units: { ambulance: 1 }, needsHospital: true },
};

export const UNIT_KIND_LABEL: Record<UnitKind, string> = {
  ambulance: 'Ambulance',
  fire: 'Fire brigade',
  police: 'Police',
};

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin: ['incident:write', 'dispatch', 'signal:override', 'network:write', 'simulation', 'hospital:write', 'users'],
  supervisor: ['incident:write', 'dispatch', 'signal:override', 'network:write', 'simulation', 'hospital:write'],
  dispatcher: ['incident:write', 'dispatch'],
  hospital: ['hospital:write'],
};

export type Permission =
  'incident:write' | 'dispatch' | 'signal:override' | 'network:write' | 'simulation' | 'hospital:write' | 'users';

export function can(role: UserRole | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}
