import { formatClock, PRIORITY_WEIGHTS, type Detection } from '@corridor/core';
import {
  BellRing,
  BrainCircuit,
  Camera,
  Cpu,
  Hospital,
  Phone,
  Radar,
  Satellite,
  ShieldAlert,
  TrafficCone,
} from 'lucide-react';
import { Badge, EmptyState, Loading, PageHeader, Panel } from '@/components/common';
import { useLive, useNetworkIndex } from '@/lib/live';

const SOURCE_LABEL: Record<Detection['source'], string> = {
  cctv_anpr: 'CCTV / ANPR',
  gps: 'GPS / IoT',
  erss_112: '112 ERSS',
};
const SOURCE_ICON = { cctv_anpr: Camera, gps: Satellite, erss_112: Phone };

export default function AiEnginePage() {
  const { snapshot } = useLive();
  const { nodes } = useNetworkIndex();
  if (!snapshot) return <Loading />;
  const m = snapshot.metrics;
  const detections = snapshot.detections;
  const bySource = (s: Detection['source']) => detections.filter((d) => d.source === s).length;
  const rejected = detections.filter((d) => !d.verified && d.unitId === null && d.source === 'cctv_anpr');
  const contested = snapshot.signals.filter((s) => s.claims.length > 1);
  const units = new Map(snapshot.units.map((u) => [u.id, u]));
  const actions = {
    green: snapshot.signals.filter((s) => s.mode === 'green_wave' || s.mode === 'preclear').length,
    public: snapshot.alerts.filter((a) => a.channel === 'v2x').length,
    hospital: snapshot.hospitals.reduce((n, h) => n + h.incoming.length, 0),
  };

  return (
    <>
      <PageHeader
        eyebrow="How the AI engine works"
        title="AI core engine"
        description="Data inputs feed three stages — detect, predict, prioritise — which drive the smart actions: green-wave signals, driver & public alerts and hospital ETA alerts."
      />

      <div className="pipeline reveal">
        <div className="pipeline-col">
          <div className="eyebrow mb-2">Data inputs</div>
          <PipeCard icon={Camera} title="CCTV / ANPR cameras" value={`${bySource('cctv_anpr')} recent reads`} />
          <PipeCard icon={Satellite} title="GPS & IoT sensors" value={`${snapshot.units.length} vehicles tracked`} />
          <PipeCard icon={Phone} title="112 ERSS calls" value={`${bySource('erss_112')} recent calls`} />
        </div>
        <div className="pipeline-arrow" aria-hidden />
        <div className="pipeline-core panel">
          <div className="flex items-center gap-2 text-slate-100 font-bold">
            <BrainCircuit size={18} className="text-amber-300" /> AI core engine
          </div>
          <div className="core-stages">
            <div className="core-stage detect">
              <strong>DETECT</strong>
              <span>Vision + ANPR</span>
              <em>{m.avgDetectionLatencyMs != null ? `${m.avgDetectionLatencyMs} ms avg` : '—'}</em>
            </div>
            <div className="core-stage predict">
              <strong>PREDICT</strong>
              <span>Congestion forecast + ETA</span>
              <em>30-min horizon</em>
            </div>
            <div className="core-stage prioritize">
              <strong>PRIORITISE</strong>
              <span>Severity score</span>
              <em>
                P = {PRIORITY_WEIGHTS.severity}S + {PRIORITY_WEIGHTS.eta}/ETA + {PRIORITY_WEIGHTS.wait}W
              </em>
            </div>
          </div>
        </div>
        <div className="pipeline-arrow" aria-hidden />
        <div className="pipeline-col">
          <div className="eyebrow mb-2">Smart actions</div>
          <PipeCard
            icon={TrafficCone}
            title="Green-wave signals"
            value={`${actions.green} junctions active`}
            tone="teal"
          />
          <PipeCard
            icon={BellRing}
            title="Driver & public alerts"
            value={`${m.civiliansAlerted.toLocaleString()} drivers reached`}
            tone="teal"
          />
          <PipeCard
            icon={Hospital}
            title="Hospital ETA alerts"
            value={`${actions.hospital} inbound notices`}
            tone="teal"
          />
        </div>
      </div>

      <div className="metric-grid mt-[14px]">
        <Stat
          label="Detection latency"
          value={m.avgDetectionLatencyMs != null ? `${m.avgDetectionLatencyMs} ms` : '—'}
          target="< 200 ms"
        />
        <Stat
          label="Detection accuracy"
          value={m.detectionAccuracy != null ? `${m.detectionAccuracy.toFixed(1)}%` : '—'}
          target="90%+"
        />
        <Stat label="Spoofing attempts blocked" value={String(rejected.length)} target="Vehicle auth" />
        <Stat label="Contested junctions now" value={String(contested.length)} target="Arbitrated by P" />
      </div>

      <div className="section-grid-wide">
        <Panel
          title="Detection stream"
          subtitle="Camera, GPS and call events with model confidence and latency"
          bodyClassName="table-wrap"
        >
          {detections.length ? (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Event</th>
                  <th>Plate</th>
                  <th>Conf.</th>
                  <th>Latency</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {detections.slice(0, 25).map((d) => {
                  const Icon = SOURCE_ICON[d.source];
                  return (
                    <tr key={d.id}>
                      <td className="mono">{formatClock(d.at)}</td>
                      <td>
                        <span className="flex items-center gap-1 text-[11px]">
                          <Icon size={12} /> {SOURCE_LABEL[d.source]}
                        </span>
                      </td>
                      <td className="max-w-[300px] truncate" title={d.label}>
                        {d.label}
                      </td>
                      <td className="mono">{d.plate ?? '—'}</td>
                      <td className="mono">{(d.confidence * 100).toFixed(0)}%</td>
                      <td className="mono">{d.latencyMs} ms</td>
                      <td>
                        {d.verified ? (
                          <Badge tone="badge-active">verified</Badge>
                        ) : (
                          <Badge tone="badge-critical">{d.unitId ? 'cross-checked' : 'rejected'}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState title="Waiting for detections" icon={Radar} />
          )}
        </Panel>
        <div className="grid gap-[14px] content-start">
          <Panel title="Priority arbitration" subtitle="Junctions with more than one emergency claim">
            {contested.length ? (
              <div className="grid gap-3">
                {contested.map((s) => (
                  <div key={s.id} className="arb-card">
                    <div className="text-xs font-bold text-slate-200 mb-1">{s.name}</div>
                    {s.claims.map((c) => (
                      <div key={c.unitId} className={`arb-row ${c.unitId === s.holderUnitId ? 'win' : ''}`}>
                        <span>{units.get(c.unitId)?.callSign}</span>
                        <span className="mono">
                          {c.axis} · {c.etaSeconds}s · P={c.priority.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No conflicts right now"
                detail="When two vehicles approach the same junction, the higher P gets the green."
                icon={Cpu}
              />
            )}
          </Panel>
          <Panel
            title="Vehicle authentication"
            subtitle="Fleet registry + signed GPS tokens prevent signal abuse"
            actions={
              snapshot.settings.vehicleAuth ? (
                <Badge tone="badge-active">enforced</Badge>
              ) : (
                <Badge tone="badge-critical">disabled</Badge>
              )
            }
          >
            {rejected.length ? (
              <div className="grid gap-2">
                {rejected.slice(0, 5).map((d) => (
                  <div key={d.id} className="flex items-start gap-2 text-[11px]">
                    <ShieldAlert size={14} className="text-red-300 shrink-0 mt-0.5" />
                    <span>
                      <span className="mono text-red-200">{d.plate}</span> at{' '}
                      {d.nodeId ? nodes.get(d.nodeId)?.name : '—'} · {formatClock(d.at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No spoofing attempts detected" icon={ShieldAlert} />
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function PipeCard({
  icon: Icon,
  title,
  value,
  tone = 'blue',
}: {
  icon: typeof Camera;
  title: string;
  value: string;
  tone?: 'blue' | 'teal';
}) {
  return (
    <div className={`pipe-card tone-${tone}`}>
      <Icon size={16} />
      <div>
        <div className="text-xs font-bold text-slate-100">{title}</div>
        <div className="mono text-[10px] muted">{value}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, target }: { label: string; value: string; target: string }) {
  return (
    <div className="panel metric-card">
      <span className="eyebrow">{label}</span>
      <div className="metric-value">{value}</div>
      <div className="metric-meta">
        <span className="muted">Target: {target}</span>
      </div>
    </div>
  );
}
