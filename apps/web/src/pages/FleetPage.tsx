import { useState } from 'react';
import { Link } from 'wouter';
import { UNIT_KIND_LABEL, formatDistance, formatDuration, type UnitKind } from '@corridor/core';
import { toast } from 'sonner';
import { RotateCcw, ShieldCheck, ShieldX } from 'lucide-react';
import { Badge, Loading, PageHeader, Panel, reportError } from '@/components/common';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLive, useNetworkIndex } from '@/lib/live';
import { UNIT_ICON, UNIT_STATUS_LABEL, UNIT_STATUS_TONE } from '@/lib/labels';

export default function FleetPage() {
  const { snapshot } = useLive();
  const { nodes } = useNetworkIndex();
  const { can } = useAuth();
  const [kind, setKind] = useState<UnitKind | 'all'>('all');
  if (!snapshot) return <Loading />;
  const units = snapshot.units.filter((u) => kind === 'all' || u.kind === kind);
  const m = snapshot.metrics;

  return (
    <>
      <PageHeader
        eyebrow="Multi-vehicle coordination"
        title="Emergency fleet"
        description="Ambulance, fire and police units with live GPS, authenticated identity and corridor priority. Returning units can be re-tasked mid-route."
        actions={
          <div className="tabs">
            {(['all', 'ambulance', 'fire', 'police'] as const).map((k) => (
              <button key={k} className={`tab ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
                {k === 'all' ? 'All units' : UNIT_KIND_LABEL[k]}
                {k !== 'all' && (
                  <span className="mono muted ml-1">
                    {m.unitsAvailable[k]}/{m.unitsTotal[k]}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      />
      <Panel bodyClassName="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Status</th>
              <th>Assignment</th>
              <th>Position</th>
              <th>Speed</th>
              <th>ETA</th>
              <th>Priority</th>
              <th>Identity</th>
              <th>Distance</th>
              {can('dispatch') && <th />}
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const Icon = UNIT_ICON[u.kind];
              const next = u.route[0] ? nodes.get(u.route[0])?.name : nodes.get(u.homeNodeId)?.name;
              return (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className={`type-icon type-${u.kind}`}>
                        <Icon size={14} />
                      </span>
                      <div>
                        <div className="font-bold text-slate-100">{u.callSign}</div>
                        <div className="mono text-[10px] muted">{u.plate}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge tone={UNIT_STATUS_TONE[u.status]}>{UNIT_STATUS_LABEL[u.status]}</Badge>
                  </td>
                  <td>
                    {u.incidentId ? (
                      <Link href={`/dispatch/${u.incidentId}`} className="link">
                        {u.incidentId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="max-w-[220px] truncate">
                    {u.route.length ? `→ ${next}` : `at ${nodes.get(u.homeNodeId)?.name ?? '—'}`}
                  </td>
                  <td className="mono">{u.speed ? `${u.speed} km/h` : '—'}</td>
                  <td className="mono">{u.route.length ? formatDuration(u.etaSeconds) : '—'}</td>
                  <td className="mono">{u.priorityScore ? u.priorityScore.toFixed(2) : '—'}</td>
                  <td>
                    {u.verified ? (
                      <span className="text-teal-300 flex items-center gap-1 text-[11px]">
                        <ShieldCheck size={13} /> Verified
                      </span>
                    ) : (
                      <span className="text-red-300 flex items-center gap-1 text-[11px]">
                        <ShieldX size={13} /> Unverified
                      </span>
                    )}
                  </td>
                  <td className="mono">{formatDistance(u.distanceTravelled)}</td>
                  {can('dispatch') && (
                    <td>
                      {['en_route', 'on_scene'].includes(u.status) && (
                        <button
                          className="btn btn-quiet btn-danger"
                          onClick={() =>
                            api
                              .recall(u.id)
                              .then(() => toast.success(`${u.callSign} recalled`))
                              .catch(reportError)
                          }
                        >
                          <RotateCcw size={12} /> Recall
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
