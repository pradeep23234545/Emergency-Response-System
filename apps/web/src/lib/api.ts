import type {
  AuditEntry,
  BenchmarkResult,
  BlockageInput,
  CreateIncidentInput,
  DispatchPlan,
  ForecastSeries,
  Hospital,
  Incident,
  LoginInput,
  MetricsSummary,
  PublicUser,
  RegisterInput,
  ResponseOutcome,
  RoadNetwork,
  SignalOverrideInput,
  SimulationSettings,
  SimulationSettingsInput,
  BedUpdateInput,
  UserRole,
} from '@corridor/core';

const BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText, data.issues);
  return data as T;
}

export const streamUrl = `${BASE}/stream`;

export interface Hotspot {
  edgeId: string;
  name: string;
  from: string;
  to: string;
  congestion: number;
  forecast10: number;
  blocked: boolean;
}

export const api = {
  me: () => request<{ user: PublicUser }>('GET', '/auth/me'),
  login: (input: LoginInput) => request<{ user: PublicUser }>('POST', '/auth/login', input),
  register: (input: RegisterInput) => request<{ user: PublicUser }>('POST', '/auth/register', input),
  logout: () => request<void>('POST', '/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/auth/password', { currentPassword, newPassword }),

  users: () => request<{ users: PublicUser[] }>('GET', '/users'),
  updateUser: (id: number, patch: { role?: UserRole; zone?: string }) =>
    request<{ user: PublicUser }>('PATCH', `/users/${id}`, patch),

  network: () => request<RoadNetwork>('GET', '/network'),

  incidents: (params: { status?: string; type?: string; q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)]),
    );
    return request<{ items: Incident[]; total: number }>('GET', `/incidents?${qs}`);
  },
  incident: (id: string) => request<{ incident: Incident }>('GET', `/incidents/${id}`),
  createIncident: (input: CreateIncidentInput) => request<{ incident: Incident }>('POST', '/incidents', input),
  recommendations: (id: string) => request<DispatchPlan>('GET', `/incidents/${id}/recommendations`),
  dispatch: (id: string, unitIds?: string[]) =>
    request<{ incident: Incident }>('POST', `/incidents/${id}/dispatch`, { unitIds }),
  cancel: (id: string, reason?: string) =>
    request<{ incident: Incident }>('POST', `/incidents/${id}/cancel`, { reason }),
  resolve: (id: string) => request<{ incident: Incident }>('POST', `/incidents/${id}/resolve`, {}),

  recall: (unitId: string) => request<unknown>('POST', `/units/${unitId}/recall`, {}),
  overrideSignal: (signalId: string, mode: SignalOverrideInput['mode']) =>
    request<unknown>('POST', `/signals/${signalId}/override`, { mode }),

  addBlockage: (input: BlockageInput) => request<unknown>('POST', '/network/blockages', input),
  clearBlockage: (edgeId: string) => request<unknown>('DELETE', `/network/blockages/${edgeId}`),
  blockages: () => request<{ blockages: { edgeId: string; reason: string }[] }>('GET', '/network/blockages'),

  hotspots: () => request<{ hotspots: Hotspot[] }>('GET', '/traffic/hotspots'),
  forecast: (edgeId: string) => request<ForecastSeries>('GET', `/traffic/forecast/${edgeId}`),

  updateHospital: (id: string, input: BedUpdateInput) =>
    request<{ hospital: Hospital }>('PATCH', `/hospitals/${id}`, input),
  ackAlert: (id: string) => request<unknown>('POST', `/alerts/${id}/ack`, {}),

  updateSimulation: (patch: SimulationSettingsInput) =>
    request<{ settings: SimulationSettings }>('PATCH', '/simulation', patch),
  resetSimulation: () => request<unknown>('POST', '/simulation/reset', {}),
  stepSimulation: (seconds: number) => request<unknown>('POST', '/simulation/step', { seconds }),

  analytics: () =>
    request<{ metrics: MetricsSummary; outcomes: ResponseOutcome[]; benchmark: BenchmarkResult | null }>(
      'GET',
      '/analytics',
    ),
  runBenchmark: () => request<{ benchmark: BenchmarkResult }>('POST', '/analytics/benchmark', {}),

  audit: (params: { limit?: number; before?: number; category?: string }) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)]),
    );
    return request<{ entries: AuditEntry[] }>('GET', `/audit?${qs}`);
  },
};
