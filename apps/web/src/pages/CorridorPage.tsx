import { useState } from 'react';
import { formatDuration, priorityBreakdown, type Snapshot, type TrafficSignal, type Unit } from '@corridor/core';
import { toast } from 'sonner';
import {
  Construction,
  Eye,
  Gauge,
  Lock,
  MousePointerClick,
  Navigation,
  Pause,
  Play,
  TrafficCone,
  Unlock,
} from 'lucide-react';
import { CityMap, MapLegend } from '@/components/CityMap';
import { Badge, EmptyState, Loading, Meter, PageHeader, Panel, reportError } from '@/components/common';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLive, useNetworkIndex } from '@/lib/live';
import {
  SIGNAL_MODE_LABEL,
  SIGNAL_MODE_TONE,
  UNIT_ICON,
  UNIT_STATUS_LABEL,
  UNIT_STATUS_TONE,
  congestionColor,
} from '@/lib/labels';

type Selection = { kind: 'unit'; id: string } | { kind: 'signal'; id: string } | { kind: 'edge'; id: string } | null;

export default function CorridorPage() {
  const { snapshot, network } = useLive();
  const { can } = useAuth();
  const [selection, setSelection] = useState<Selection>(null);
  const [forecast, setForecast] = useState(false);
  const [blockMode, setBlockMode] = useState(false);

  if (!snapshot || !network) return <Loading />;

  const onEdge = async (edgeId: string) => {
    if (!blockMode) {
      setSelection({ kind: 'edge', id: edgeId });
      return;
    }
    const idx = network.edges.findIndex((e) => e.id === edgeId);
    try {
      if (snapshot.traffic[idx]?.blocked) {
        await api.clearBlockage(edgeId);
        toast.success('Road reopened');
      } else {
        await api.addBlockage({ edgeId, reason: 'Accident blockage reported by control room' });
        toast.warning('Blockage reported', { description: 'Affected emergency routes are re-planned automatically.' });
      }
    } catch (err) {
      reportError(err);
    }
  };

  const moving = snapshot.units.filter((u) => u.status === 'en_route' || u.status === 'transporting');
  const corridorSignals = snapshot.signals.filter((s) => s.mode === 'green_wave' || s.mode === 'preclear');

  return (
    <>
      <PageHeader
        eyebrow="Green-wave orchestration"
        title="Live corridor"
        description="Signals ahead of each verified emergency vehicle pre-clear queues and switch to green in sequence. Click vehicles, junctions or roads to inspect them."
        actions={
          <>
            <button className={`btn ${forecast ? 'btn-teal' : ''}`} onClick={() => setForecast((f) => !f)}>
              <Eye size={14} /> {forecast ? 'Showing +10 min forecast' : 'Show forecast'}
            </button>
            {can('network:write') && (
              <button className={`btn ${blockMode ? 'btn-danger' : ''}`} onClick={() => setBlockMode((b) => !b)}>
                <Construction size={14} /> {blockMode ? 'Click a road to block / reopen' : 'Report blockage'}
              </button>
            )}
            {can('simulation') && <SimControls snapshot={snapshot} />}
          </>
        }
      />
      <div className="corridor-grid">
        <Panel bodyClassName="" className="map-panel">
          <div className="map-wrap full">
            {blockMode && (
              <div className="map-kicker">
                <MousePointerClick size={12} /> Block mode · click a road segment
              </div>
            )}
            <CityMap
              network={network}
              snapshot={snapshot}
              showForecast={forecast}
              selectedUnitId={selection?.kind === 'unit' ? selection.id : null}
              selectedEdgeId={selection?.kind === 'edge' ? selection.id : null}
              onSelectUnit={(u) => setSelection({ kind: 'unit', id: u.id })}
              onSelectSignal={(s) => setSelection({ kind: 'signal', id: s.id })}
              onSelectEdge={onEdge}
            />
            <MapLegend forecast={forecast} />
          </div>
        </Panel>
        <div className="grid gap-[14px] content-start">
          <Inspector selection={selection} snapshot={snapshot} />
          <Panel
            title="Active corridors"
            subtitle={`${moving.length} vehicles · ${corridorSignals.length} signals pre-empted`}
          >
            {moving.length ? (
              <div className="grid gap-2">
                {moving.map((u) => (
                  <UnitRow
                    key={u.id}
                    unit={u}
                    onClick={() => setSelection({ kind: 'unit', id: u.id })}
                    active={selection?.kind === 'unit' && selection.id === u.id}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No emergency vehicles moving"
                detail="Corridors open automatically when a unit is dispatched."
                icon={Navigation}
              />
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function SimControls({ snapshot }: { snapshot: Snapshot }) {
  const { running, speed } = snapshot.settings;
  const set = (patch: { running?: boolean; speed?: number }) => api.updateSimulation(patch).catch(reportError);
  return (
    <div className="sim-controls">
      <button
        className="btn btn-quiet"
        onClick={() => set({ running: !running })}
        aria-label={running ? 'Pause' : 'Resume'}
      >
        {running ? <Pause size={14} /> : <Play size={14} />}
      </button>
      {[1, 4, 10].map((s) => (
        <button key={s} className={`btn btn-quiet ${speed === s ? 'btn-teal' : ''}`} onClick={() => set({ speed: s })}>
          {s}×
        </button>
      ))}
    </div>
  );
}

function UnitRow({ unit, onClick, active }: { unit: Unit; onClick: () => void; active?: boolean }) {
  const Icon = UNIT_ICON[unit.kind];
  const saved = unit.baselineEtaSeconds && unit.etaSeconds != null ? unit.baselineEtaSeconds - unit.etaSeconds : null;
  return (
    <button className={`unit-row-btn ${active ? 'active' : ''}`} onClick={onClick}>
      <span className={`type-icon type-${unit.kind}`}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-100">{unit.callSign}</span>
          <Badge tone={UNIT_STATUS_TONE[unit.status]}>{UNIT_STATUS_LABEL[unit.status]}</Badge>
        </div>
        <div className="mono text-[10px] muted mt-1">
          ETA {formatDuration(unit.etaSeconds)} · {unit.speed} km/h · P={unit.priorityScore.toFixed(2)}
          {saved && saved > 0 ? <span className="text-teal-300"> · saving {formatDuration(saved)}</span> : null}
        </div>
      </div>
    </button>
  );
}

function Inspector({ selection, snapshot }: { selection: Selection; snapshot: Snapshot }) {
  if (!selection)
    return (
      <Panel title="Inspector">
        <EmptyState
          title="Nothing selected"
          detail="Select a vehicle, signal or road on the map."
          icon={MousePointerClick}
        />
      </Panel>
    );
  if (selection.kind === 'unit') {
    const unit = snapshot.units.find((u) => u.id === selection.id);
    return unit ? <UnitInspector unit={unit} snapshot={snapshot} /> : null;
  }
  if (selection.kind === 'signal') {
    const signal = snapshot.signals.find((s) => s.id === selection.id);
    return signal ? <SignalInspector signal={signal} snapshot={snapshot} /> : null;
  }
  return <EdgeInspector edgeId={selection.id} snapshot={snapshot} />;
}

function UnitInspector({ unit, snapshot }: { unit: Unit; snapshot: Snapshot }) {
  const { nodes } = useNetworkIndex();
  const incident = snapshot.incidents.find((i) => i.id === unit.incidentId);
  const ahead = snapshot.signals.filter((s) => s.claims.some((c) => c.unitId === unit.id));
  const claim = ahead
    .map((s) => s.claims.find((c) => c.unitId === unit.id)!)
    .sort((a, b) => a.etaSeconds - b.etaSeconds)[0];
  const breakdown =
    incident && claim
      ? priorityBreakdown({
          severity: unit.status === 'transporting' ? Math.max(4, incident.severity) : incident.severity,
          etaSeconds: claim.etaSeconds,
          waitSeconds: unit.waitSeconds,
        })
      : null;
  const Icon = UNIT_ICON[unit.kind];
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Icon size={15} /> {unit.callSign}
        </span>
      }
      subtitle={`${unit.plate} · ${unit.verified ? 'authenticated' : 'NOT verified'}`}
      actions={<Badge tone={UNIT_STATUS_TONE[unit.status]}>{UNIT_STATUS_LABEL[unit.status]}</Badge>}
    >
      <div className="kv">
        <span>Assignment</span>
        <strong>{incident ? `${incident.id} · ${incident.title}` : '—'}</strong>
        <span>Destination</span>
        <strong>{unit.destinationNodeId ? nodes.get(unit.destinationNodeId)?.name : '—'}</strong>
        <span>ETA (corridor)</span>
        <strong>{formatDuration(unit.etaSeconds)}</strong>
        <span>ETA without corridor</span>
        <strong>{formatDuration(unit.baselineEtaSeconds)}</strong>
        <span>Time stopped at signals</span>
        <strong>{formatDuration(unit.waitSeconds)}</strong>
        <span>Speed</span>
        <strong>{unit.speed} km/h</strong>
      </div>
      {breakdown && (
        <>
          <div className="section-label">Priority score at next junction</div>
          <div className="formula">
            P = 0.5·S + 0.3·(1/ETA) + 0.2·W = <strong>{breakdown.score.toFixed(3)}</strong>
          </div>
          <div className="grid gap-2 mt-2">
            <Term label="Severity" value={breakdown.severityTerm} max={0.5} tone="red" />
            <Term label="1 / ETA" value={breakdown.etaTerm} max={0.3} tone="amber" />
            <Term label="Waiting" value={breakdown.waitTerm} max={0.2} tone="blue" />
          </div>
        </>
      )}
      {ahead.length > 0 && (
        <>
          <div className="section-label">Signals ahead</div>
          <div className="grid gap-1">
            {ahead
              .map((s) => ({ s, c: s.claims.find((c) => c.unitId === unit.id)! }))
              .sort((a, b) => a.c.etaSeconds - b.c.etaSeconds)
              .map(({ s, c }) => (
                <div key={s.id} className="flex items-center justify-between text-[11px] py-1 border-b border-white/5">
                  <span className="text-slate-300 truncate">{s.name}</span>
                  <span className="mono muted">
                    {c.etaSeconds}s ·{' '}
                    {s.holderUnitId === unit.id ? (
                      <span className="text-teal-300">{SIGNAL_MODE_LABEL[s.mode]}</span>
                    ) : (
                      <span className="text-amber-300">yielding</span>
                    )}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function Term({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'red' | 'amber' | 'blue';
}) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mono muted mb-1">
        <span>{label}</span>
        <span>
          {value.toFixed(3)} / {max}
        </span>
      </div>
      <Meter value={(value / max) * 100} tone={tone} />
    </div>
  );
}

function SignalInspector({ signal, snapshot }: { signal: TrafficSignal; snapshot: Snapshot }) {
  const { can } = useAuth();
  const units = new Map(snapshot.units.map((u) => [u.id, u]));
  const override = (mode: 'force_ns' | 'force_ew' | 'flash' | 'release') =>
    api
      .overrideSignal(signal.id, mode)
      .then(() => toast.success('Signal plan updated'))
      .catch(reportError);
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <TrafficCone size={15} /> {signal.name}
        </span>
      }
      subtitle={signal.id}
      actions={<Badge tone={SIGNAL_MODE_TONE[signal.mode]}>{SIGNAL_MODE_LABEL[signal.mode]}</Badge>}
    >
      <div className="kv">
        <span>Green axis</span>
        <strong>
          {signal.mode === 'flash' ? 'All red (flash)' : signal.greenAxis === 'NS' ? 'North – South' : 'East – West'}
        </strong>
        <span>Corridor holder</span>
        <strong>{signal.holderUnitId ? units.get(signal.holderUnitId)?.callSign : '—'}</strong>
        <span>Queued vehicles</span>
        <strong>{signal.queue}</strong>
      </div>
      {signal.claims.length > 0 && (
        <>
          <div className="section-label">Priority claims</div>
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Axis</th>
                <th>ETA</th>
                <th>P</th>
              </tr>
            </thead>
            <tbody>
              {signal.claims.map((c) => (
                <tr key={c.unitId} className={c.unitId === signal.holderUnitId ? 'row-win' : ''}>
                  <td>{units.get(c.unitId)?.callSign}</td>
                  <td>{c.axis}</td>
                  <td>{c.etaSeconds}s</td>
                  <td>{c.priority.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {can('signal:override') && (
        <>
          <div className="section-label">Manual override</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-quiet" onClick={() => override('force_ns')}>
              <Lock size={12} /> N–S green
            </button>
            <button className="btn btn-quiet" onClick={() => override('force_ew')}>
              <Lock size={12} /> E–W green
            </button>
            <button className="btn btn-quiet btn-danger" onClick={() => override('flash')}>
              Flash red
            </button>
            <button className="btn btn-quiet btn-teal" onClick={() => override('release')}>
              <Unlock size={12} /> Adaptive
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

function EdgeInspector({ edgeId, snapshot }: { edgeId: string; snapshot: Snapshot }) {
  const { edges, nodes } = useNetworkIndex();
  const { can } = useAuth();
  const entry = edges.get(edgeId);
  if (!entry) return null;
  const t = snapshot.traffic[entry.index];
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Gauge size={15} /> {entry.edge.name}
        </span>
      }
      subtitle={`${nodes.get(entry.edge.from)?.name} → ${nodes.get(entry.edge.to)?.name}`}
      actions={
        t.blocked ? (
          <Badge tone="badge-critical">Blocked</Badge>
        ) : t.corridor ? (
          <Badge tone="badge-active">Corridor</Badge>
        ) : null
      }
    >
      <div className="kv">
        <span>Length</span>
        <strong>
          {(entry.edge.length / 1000).toFixed(2)} km · {entry.edge.lanes} lanes
        </strong>
        <span>Speed limit</span>
        <strong>{entry.edge.speedLimit} km/h</strong>
        <span>Congestion now</span>
        <strong style={{ color: congestionColor(t.c) }}>{Math.round(t.c * 100)}%</strong>
        <span>Forecast +10 min</span>
        <strong style={{ color: congestionColor(t.f) }}>{Math.round(t.f * 100)}%</strong>
      </div>
      {can('network:write') && (
        <div className="form-actions">
          {t.blocked ? (
            <button
              className="btn btn-teal"
              onClick={() =>
                api
                  .clearBlockage(edgeId)
                  .then(() => toast.success('Road reopened'))
                  .catch(reportError)
              }
            >
              <Unlock size={13} /> Reopen road
            </button>
          ) : (
            <button
              className="btn btn-danger"
              onClick={() =>
                api
                  .addBlockage({ edgeId, reason: 'Blockage reported by control room' })
                  .then(() => toast.warning('Blockage reported'))
                  .catch(reportError)
              }
            >
              <Construction size={13} /> Mark blocked
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}
