import { Link } from 'wouter';
import { formatClock, formatDuration, type Incident, type Snapshot } from '@corridor/core';
import { Activity, ArrowRight, Gauge, Megaphone, Siren, Timer } from 'lucide-react';
import { CityMap, MapLegend } from '@/components/CityMap';
import { Badge, EmptyState, Lifecycle, Loading, Metric, PageHeader, Panel } from '@/components/common';
import { AlertList } from '@/components/AlertList';
import { useLive } from '@/lib/live';
import { INCIDENT_STATUS_LABEL, INCIDENT_STATUS_TONE, UNIT_ICON, severityTone } from '@/lib/labels';

const ACTIVE = new Set(['reported', 'verified', 'dispatched', 'on_scene', 'transporting']);

export function OverviewPage() {
  const { snapshot, network, audit } = useLive();
  if (!snapshot || !network) return <Loading />;
  const m = snapshot.metrics;
  const active = snapshot.incidents.filter((i) => ACTIVE.has(i.status));
  const totalUnits = m.unitsTotal.ambulance + m.unitsTotal.fire + m.unitsTotal.police;
  const freeUnits = m.unitsAvailable.ambulance + m.unitsAvailable.fire + m.unitsAvailable.police;
  const corridors = snapshot.signals.filter((s) => s.mode === 'green_wave' || s.mode === 'preclear').length;

  return (
    <>
      <PageHeader
        eyebrow={`Sim clock ${formatClock(snapshot.simTime)}`}
        title="City operating picture"
        description="Detect → verify → predict → pre-clear → green wave → restore. Every active emergency is tracked through the corridor lifecycle in real time."
        actions={
          <Link href="/dispatch" className="btn btn-primary">
            <Siren size={15} /> New 112 call
          </Link>
        }
      />

      <div className="metric-grid">
        <Metric
          label="Active incidents"
          value={m.activeIncidents}
          icon={Siren}
          tone="red"
          hint={<span className="muted">{m.resolvedIncidents} resolved this session</span>}
        />
        <Metric
          label="Avg response"
          value={formatDuration(m.avgResponseSeconds)}
          icon={Timer}
          tone="teal"
          hint={
            m.improvementPct != null ? (
              <span className="delta-good">
                {m.improvementPct.toFixed(0)}% faster than baseline ({formatDuration(m.avgBaselineSeconds)})
              </span>
            ) : (
              <span className="muted">Waiting for first resolved incident</span>
            )
          }
        />
        <Metric
          label="Units available"
          value={`${freeUnits}/${totalUnits}`}
          icon={Gauge}
          tone="amber"
          hint={
            <span className="muted">
              AMB {m.unitsAvailable.ambulance} · FIRE {m.unitsAvailable.fire} · POL {m.unitsAvailable.police}
            </span>
          }
        />
        <Metric
          label="Drivers alerted"
          value={m.civiliansAlerted.toLocaleString()}
          icon={Megaphone}
          tone="blue"
          hint={<span className="muted">{corridors} signals in corridor mode now</span>}
        />
      </div>

      <div className="section-grid">
        <Panel
          title="Live corridor map"
          subtitle="Road colour = congestion · glowing green = active emergency corridor"
          bodyClassName=""
          actions={
            <Link href="/corridor" className="btn btn-quiet">
              Open full map <ArrowRight size={13} />
            </Link>
          }
        >
          <div className="map-wrap">
            <CityMap network={network} snapshot={snapshot} compact />
            <MapLegend />
          </div>
        </Panel>
        <Panel
          title="Active incidents"
          subtitle="Ordered by severity"
          actions={<Badge tone="badge-critical">{active.length} open</Badge>}
        >
          <IncidentList incidents={active} snapshot={snapshot} />
        </Panel>
      </div>

      <div className="section-grid-wide">
        <Panel title="Alerts & notifications" subtitle="Driver, public, hospital and system channels">
          <AlertList alerts={snapshot.alerts.slice(0, 8)} />
        </Panel>
        <Panel
          title="Audit trail"
          subtitle="Every operator and AI decision"
          actions={
            <Link href="/audit" className="btn btn-quiet">
              View all
            </Link>
          }
        >
          {audit.length ? (
            <div className="audit-list">
              {audit.slice(0, 8).map((e) => (
                <div key={e.id} className="audit-item">
                  <span className={`audit-mark cat-${e.category}`} />
                  <div>
                    <div className="audit-text">
                      <strong>{e.action}</strong> — {e.detail}
                    </div>
                    <div className="audit-time">
                      {formatClock(e.at)} · {e.actor}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No activity yet" icon={Activity} />
          )}
        </Panel>
      </div>
    </>
  );
}

export function IncidentList({ incidents, snapshot }: { incidents: Incident[]; snapshot: Snapshot }) {
  if (!incidents.length)
    return <EmptyState title="No active incidents" detail="The city is quiet. New 112 calls appear here instantly." />;
  const units = new Map(snapshot.units.map((u) => [u.id, u]));
  return (
    <div className="incident-list">
      {[...incidents]
        .sort((a, b) => b.severity - a.severity || a.reportedAt - b.reportedAt)
        .map((i) => {
          const assigned = i.assignedUnitIds.map((id) => units.get(id)).filter((u) => u && u.incidentId === i.id);
          const lead = assigned.find((u) => u!.status === 'en_route' || u!.status === 'transporting');
          return (
            <Link key={i.id} href={`/dispatch/${i.id}`} className="incident-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="incident-id">
                    {i.id} · {formatClock(i.reportedAt)}
                  </div>
                  <div className="incident-name">{i.title}</div>
                  <div className="incident-location truncate">{i.location}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={severityTone(i.severity)}>S{i.severity}</Badge>
                  <Badge tone={INCIDENT_STATUS_TONE[i.status]}>{INCIDENT_STATUS_LABEL[i.status]}</Badge>
                </div>
              </div>
              <Lifecycle stage={i.stage} compact />
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {assigned.map((u) => {
                  const Icon = UNIT_ICON[u!.kind];
                  return (
                    <span key={u!.id} className="unit-chip">
                      <Icon size={11} /> {u!.callSign}
                    </span>
                  );
                })}
                {lead?.etaSeconds != null && (
                  <span className="mono text-[10px] text-amber-300 ml-auto">ETA {formatDuration(lead.etaSeconds)}</span>
                )}
              </div>
            </Link>
          );
        })}
    </div>
  );
}
