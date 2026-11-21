import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useRoute } from 'wouter';
import {
  INCIDENT_TYPES,
  UNIT_KIND_LABEL,
  formatClock,
  formatDistance,
  formatDuration,
  type Incident,
  type IncidentType,
  type UnitKind,
} from '@corridor/core';
import { toast } from 'sonner';
import { Ban, BrainCircuit, CheckCircle2, Hospital, MapPinned, PhoneCall, RotateCcw, Send, X } from 'lucide-react';
import { CityMap } from '@/components/CityMap';
import { Badge, EmptyState, Lifecycle, Loading, PageHeader, Panel, reportError } from '@/components/common';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLive } from '@/lib/live';
import { INCIDENT_STATUS_LABEL, INCIDENT_STATUS_TONE, UNIT_ICON, UNIT_STATUS_LABEL, severityTone } from '@/lib/labels';
import { IncidentList } from './OverviewPage';

const ACTIVE = new Set(['reported', 'verified', 'dispatched', 'on_scene', 'transporting']);

export default function DispatchPage() {
  const { snapshot, network } = useLive();
  const [, params] = useRoute('/dispatch/:id');
  const selectedId = params?.id ?? null;
  const [pickedNode, setPickedNode] = useState<string | null>(null);

  if (!snapshot || !network) return <Loading />;
  const selected = selectedId ? snapshot.incidents.find((i) => i.id === selectedId) : undefined;
  const active = snapshot.incidents.filter((i) => ACTIVE.has(i.status));

  return (
    <>
      <PageHeader
        eyebrow="112 ERSS integration"
        title="Dispatch console"
        description="Log emergency calls, review AI unit recommendations ranked by predicted ETA, and coordinate multi-agency responses."
      />
      <div className="dispatch-grid">
        <div className="grid gap-[14px] content-start">
          {selectedId ? (
            selected ? (
              <IncidentDetail incident={selected} />
            ) : (
              <ArchivedIncident id={selectedId} />
            )
          ) : (
            <IntakeForm nodeId={pickedNode} onNodeChange={setPickedNode} />
          )}
          <Panel
            title="Incident queue"
            subtitle="Highest severity first — the AI dispatcher works this list when auto-dispatch is on"
          >
            <IncidentList incidents={active} snapshot={snapshot} />
          </Panel>
        </div>
        <Panel
          title={selected ? `${selected.id} · ${selected.location}` : 'Pick the incident location'}
          subtitle={
            selected
              ? 'Assigned units and their predicted corridors'
              : 'Click a junction on the map or choose from the list'
          }
          bodyClassName=""
          className="sticky-panel"
        >
          <div className="map-wrap tall">
            <CityMap
              network={network}
              snapshot={snapshot}
              selectedNodeId={selected ? selected.nodeId : pickedNode}
              onSelectNode={selectedId ? undefined : setPickedNode}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}

function IntakeForm({ nodeId, onNodeChange }: { nodeId: string | null; onNodeChange: (id: string) => void }) {
  const { network, snapshot } = useLive();
  const globalAuto = snapshot?.settings.autoDispatch ?? false;
  const { can } = useAuth();
  const [, navigate] = useLocation();
  const [type, setType] = useState<IncidentType>('road_accident');
  const [severity, setSeverity] = useState(INCIDENT_TYPES.road_accident.defaultSeverity);
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSeverity(INCIDENT_TYPES[type].defaultSeverity), [type]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nodeId) {
      toast.error('Choose the incident location first');
      return;
    }
    setBusy(true);
    try {
      const { incident } = await api.createIncident({
        type,
        nodeId,
        severity,
        callerName: callerName || null,
        callerPhone: callerPhone || null,
        notes,
        source: 'erss_112',
        autoDispatch: globalAuto || autoDispatch,
      });
      toast.success(`${incident.id} logged`, {
        description: globalAuto || autoDispatch ? 'AI dispatch applied' : 'Review recommendations to dispatch',
      });
      setCallerName('');
      setCallerPhone('');
      setNotes('');
      navigate(`/dispatch/${incident.id}`);
    } catch (err) {
      reportError(err, 'Could not log the call');
    } finally {
      setBusy(false);
    }
  };

  const info = INCIDENT_TYPES[type];
  return (
    <Panel
      title="New 112 call"
      subtitle="Caller details are stored with the incident record"
      actions={<PhoneCall size={16} className="text-amber-300" />}
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="inc-type">Incident type</label>
          <select id="inc-type" value={type} onChange={(e) => setType(e.target.value as IncidentType)}>
            {(Object.keys(INCIDENT_TYPES) as IncidentType[]).map((t) => (
              <option key={t} value={t}>
                {INCIDENT_TYPES[t].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inc-sev">Severity (S)</label>
          <select id="inc-sev" value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((s) => (
              <option key={s} value={s}>
                S{s} · {['', 'Minor', 'Low', 'Moderate', 'Serious', 'Life-threatening'][s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field full">
          <label htmlFor="inc-node">Location</label>
          <div className="input-with-icon">
            <MapPinned size={15} />
            <select id="inc-node" value={nodeId ?? ''} onChange={(e) => onNodeChange(e.target.value)} required>
              <option value="" disabled>
                Select a junction or click the map
              </option>
              {network?.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.id})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="inc-caller">Caller name</label>
          <input id="inc-caller" value={callerName} onChange={(e) => setCallerName(e.target.value)} maxLength={80} />
        </div>
        <div className="field">
          <label htmlFor="inc-phone">Caller phone</label>
          <input
            id="inc-phone"
            value={callerPhone}
            onChange={(e) => setCallerPhone(e.target.value)}
            placeholder="+91"
            maxLength={20}
            pattern="[+0-9 ()-]*"
          />
        </div>
        <div className="field full">
          <label htmlFor="inc-notes">Situation notes</label>
          <textarea
            id="inc-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            placeholder="What is happening, how many people involved, hazards…"
          />
        </div>
        <div className="full flex flex-wrap items-center justify-between gap-3">
          <div className="muted text-[11px]">
            Requires:{' '}
            {Object.entries(info.units)
              .map(([k, n]) => `${n} × ${UNIT_KIND_LABEL[k as UnitKind]}`)
              .join(', ')}
            {info.needsHospital ? ' · hospital transport' : ''}
          </div>
          {globalAuto ? (
            <span className="checkbox-row">
              AI auto-dispatch is on · units are assigned as soon as the call is verified
            </span>
          ) : (
            <label className="checkbox-row">
              <input type="checkbox" checked={autoDispatch} onChange={(e) => setAutoDispatch(e.target.checked)} /> Apply
              AI dispatch immediately
            </label>
          )}
        </div>
        <div className="form-actions full">
          <button className="btn btn-primary" type="submit" disabled={busy || !can('incident:write')}>
            <Send size={15} /> {busy ? 'Logging…' : 'Log call'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function IncidentDetail({ incident }: { incident: Incident }) {
  const { snapshot } = useLive();
  const { can } = useAuth();
  const [, navigate] = useLocation();
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const open = ACTIVE.has(incident.status);
  const plan = useQuery({
    queryKey: ['recommendations', incident.id, incident.assignedUnitIds.join()],
    queryFn: () => api.recommendations(incident.id),
    enabled: open,
    refetchInterval: 5000,
  });
  const units = useMemo(() => new Map(snapshot!.units.map((u) => [u.id, u])), [snapshot]);
  const hospital = snapshot!.hospitals.find((h) => h.id === incident.hospitalId);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setChosen([]);
      plan.refetch();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {incident.id} · {incident.title}
        </span>
      }
      subtitle={`${incident.location} · reported ${formatClock(incident.reportedAt)} via ${incident.source.replace('_', ' ').toUpperCase()}`}
      actions={
        <>
          <Badge tone={severityTone(incident.severity)}>S{incident.severity}</Badge>
          <Badge tone={INCIDENT_STATUS_TONE[incident.status]}>{INCIDENT_STATUS_LABEL[incident.status]}</Badge>
          <Link href="/dispatch" className="btn btn-quiet" aria-label="Close">
            <X size={14} />
          </Link>
        </>
      }
    >
      <Lifecycle stage={incident.stage} />

      <div className="detail-grid mt-4">
        <Detail
          label="Caller"
          value={incident.callerName ? `${incident.callerName} · ${incident.callerPhone ?? ''}` : 'Automatic detection'}
        />
        <Detail
          label="Response time"
          value={
            incident.responseSeconds != null
              ? `${formatDuration(incident.responseSeconds)} (baseline ${formatDuration(incident.baselineResponseSeconds)})`
              : '—'
          }
        />
        <Detail label="Receiving hospital" value={hospital?.name ?? '—'} />
        <Detail label="Notes" value={incident.notes || '—'} />
      </div>

      {incident.assignedUnitIds.length > 0 && (
        <>
          <div className="section-label">Assigned units</div>
          <div className="grid gap-2">
            {incident.assignedUnitIds.map((id) => {
              const u = units.get(id);
              if (!u) return null;
              const Icon = UNIT_ICON[u.kind];
              const engaged = u.incidentId === incident.id;
              return (
                <div key={id} className="assigned-row">
                  <span className={`type-icon type-${u.kind}`}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-100">{u.callSign}</div>
                    <div className="mono text-[10px] muted">
                      {engaged ? UNIT_STATUS_LABEL[u.status] : 'Released'}
                      {engaged && u.etaSeconds ? ` · ETA ${formatDuration(u.etaSeconds)}` : ''}
                      {engaged && u.speed ? ` · ${u.speed} km/h` : ''}
                      {engaged && u.priorityScore ? ` · P=${u.priorityScore.toFixed(2)}` : ''}
                    </div>
                  </div>
                  {engaged && open && can('dispatch') && ['en_route', 'on_scene'].includes(u.status) && (
                    <button
                      className="btn btn-quiet btn-danger"
                      disabled={busy}
                      onClick={() => run(() => api.recall(u.id), `${u.callSign} recalled`)}
                    >
                      <RotateCcw size={12} /> Recall
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {open && can('dispatch') && (
        <>
          <div className="section-label flex items-center gap-2">
            <BrainCircuit size={13} /> AI recommendations · ranked by predicted ETA
          </div>
          {plan.isLoading ? (
            <div className="muted text-xs">Scoring routes…</div>
          ) : (
            <div className="rec-grid">
              {(['ambulance', 'fire', 'police'] as UnitKind[]).map((kind) => {
                const recs = plan.data?.recommendations[kind] ?? [];
                const need = incident.requiredUnits[kind] ?? 0;
                return (
                  <div key={kind} className="rec-col">
                    <div className="rec-head">
                      {UNIT_KIND_LABEL[kind]} {need ? <Badge tone="badge-high">need {need}</Badge> : null}
                    </div>
                    {recs.length ? (
                      recs.map((r, idx) => (
                        <label key={r.unitId} className={`rec-row ${chosen.includes(r.unitId) ? 'chosen' : ''}`}>
                          <input
                            type="checkbox"
                            checked={chosen.includes(r.unitId)}
                            onChange={() => toggle(r.unitId)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-slate-100">
                              {r.callSign} {idx === 0 && <span className="text-[9px] text-teal-300">BEST</span>}
                            </div>
                            <div className="mono text-[10px] muted">
                              {formatDuration(r.etaSeconds)} · {formatDistance(r.distanceMeters)}
                            </div>
                            <div className="mono text-[10px] text-teal-300">
                              −{formatDuration(Math.max(0, r.baselineEtaSeconds - r.etaSeconds))} vs no corridor
                            </div>
                          </div>
                        </label>
                      ))
                    ) : (
                      <div className="muted text-[11px] p-2">None free</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {plan.data?.hospital && (
            <div className="hospital-rec">
              <Hospital size={15} />
              <span>
                Best receiving hospital: <strong>{plan.data.hospital.name}</strong> ·{' '}
                {formatDuration(plan.data.hospital.etaSeconds)} from scene
              </span>
            </div>
          )}
          <div className="form-actions">
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(() => api.cancel(incident.id), `${incident.id} cancelled`)}
            >
              <Ban size={14} /> Cancel incident
            </button>
            {incident.arrivedAt && (
              <button
                className="btn btn-teal"
                disabled={busy}
                onClick={() => run(() => api.resolve(incident.id), `${incident.id} resolved`)}
              >
                <CheckCircle2 size={14} /> Close
              </button>
            )}
            <button
              className="btn"
              disabled={busy || !chosen.length}
              onClick={() => run(() => api.dispatch(incident.id, chosen), 'Selected units dispatched')}
            >
              <Send size={14} /> Dispatch selected ({chosen.length})
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(() => api.dispatch(incident.id), 'AI dispatch applied')}
            >
              <BrainCircuit size={14} /> AI dispatch
            </button>
          </div>
        </>
      )}

      <div className="section-label">Timeline</div>
      <ol className="timeline">
        {[...incident.timeline].reverse().map((t, i) => (
          <li key={i}>
            <span className="mono">{formatClock(t.at)}</span> {t.label}
          </li>
        ))}
      </ol>
      {!open && (
        <div className="form-actions">
          <button className="btn" onClick={() => navigate('/dispatch')}>
            Log a new call
          </button>
        </div>
      )}
    </Panel>
  );
}

function ArchivedIncident({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['incident', id], queryFn: () => api.incident(id) });
  if (query.isLoading) return <Loading label="Loading incident…" />;
  if (!query.data) return <EmptyState title={`Incident ${id} not found`} />;
  return <IncidentDetail incident={query.data.incident} />;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <div className="eyebrow">{label}</div>
      <div className="text-xs text-slate-200 mt-1">{value}</div>
    </div>
  );
}
