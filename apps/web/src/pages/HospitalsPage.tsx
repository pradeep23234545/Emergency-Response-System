import { INCIDENT_TYPES, formatDuration, type Hospital, type HospitalBeds } from '@corridor/core';
import { toast } from 'sonner';
import { BedDouble, Building2, Check, Minus, Plus, Siren } from 'lucide-react';
import { AlertList } from '@/components/AlertList';
import { Badge, EmptyState, Loading, PageHeader, Panel, reportError } from '@/components/common';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLive } from '@/lib/live';

const STATUS_TONE = { normal: 'badge-active', busy: 'badge-high', diverting: 'badge-critical' } as const;

export default function HospitalsPage() {
  const { snapshot } = useLive();
  if (!snapshot) return <Loading />;
  const hospitalAlerts = snapshot.alerts.filter((a) => a.channel === 'hospital');
  const inbound = snapshot.hospitals.reduce((n, h) => n + h.incoming.length, 0);
  return (
    <>
      <PageHeader
        eyebrow="Hospital ETA alerts"
        title="Receiving hospitals"
        description="Hospitals get a pre-arrival notice with patient category and live ETA the moment an ambulance is dispatched, and beds are reserved automatically for critical patients."
        actions={<Badge tone={inbound ? 'badge-critical' : 'badge-muted'}>{inbound} patients inbound</Badge>}
      />
      <div className="hospital-grid">
        {snapshot.hospitals.map((h) => (
          <HospitalCard key={h.id} hospital={h} />
        ))}
      </div>
      <div className="mt-[14px]">
        <Panel title="Hospital notifications" subtitle="Acknowledge to confirm the receiving team is ready">
          <AlertList alerts={hospitalAlerts.slice(0, 15)} ackable />
        </Panel>
      </div>
    </>
  );
}

function HospitalCard({ hospital }: { hospital: Hospital }) {
  const { can } = useAuth();
  const { snapshot } = useLive();
  const units = new Map(snapshot!.units.map((u) => [u.id, u]));
  const incidents = new Map(snapshot!.incidents.map((i) => [i.id, i]));
  const editable = can('hospital:write');
  const update = (input: Parameters<typeof api.updateHospital>[1]) =>
    api.updateHospital(hospital.id, input).catch(reportError);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Building2 size={15} /> {hospital.name}
        </span>
      }
      subtitle={hospital.specialties.map((s) => INCIDENT_TYPES[s].label).join(' · ')}
      actions={
        editable ? (
          <select
            className="mini-select"
            value={hospital.status}
            onChange={(e) =>
              update({ ward: 'icu', status: e.target.value as Hospital['status'] }).then(() =>
                toast.success('Status updated'),
              )
            }
            aria-label="Hospital status"
          >
            <option value="normal">Accepting</option>
            <option value="busy">Busy</option>
            <option value="diverting">Diverting</option>
          </select>
        ) : (
          <Badge tone={STATUS_TONE[hospital.status]}>{hospital.status}</Badge>
        )
      }
    >
      <Ward
        label="ICU"
        beds={hospital.icu}
        editable={editable}
        onChange={(occupied) => update({ ward: 'icu', occupied })}
      />
      <Ward
        label="Emergency"
        beds={hospital.emergency}
        editable={editable}
        onChange={(occupied) => update({ ward: 'emergency', occupied })}
      />
      <div className="section-label flex items-center gap-2">
        <Siren size={12} /> Inbound
      </div>
      {hospital.incoming.length ? (
        <div className="grid gap-2">
          {hospital.incoming.map((x) => {
            const unit = units.get(x.unitId);
            const incident = incidents.get(x.incidentId);
            return (
              <div key={x.incidentId} className="inbound-row">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-100">
                    {x.category} {incident && <span className="mono text-[10px] muted">S{incident.severity}</span>}
                  </div>
                  <div className="mono text-[10px] muted">
                    {unit?.callSign} ·{' '}
                    {unit?.status === 'transporting'
                      ? 'patient on board'
                      : unit?.status === 'on_scene'
                        ? 'at scene'
                        : 'en route to scene'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="mono text-sm text-amber-300">{formatDuration(x.etaSeconds)}</div>
                  {x.acknowledged ? (
                    <span className="mono text-[9px] text-teal-300">
                      <Check size={10} className="inline" /> team ready
                    </span>
                  ) : (
                    <span className="mono text-[9px] text-red-300">awaiting ack</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No inbound patients" icon={BedDouble} />
      )}
    </Panel>
  );
}

function Ward({
  label,
  beds,
  editable,
  onChange,
}: {
  label: string;
  beds: HospitalBeds;
  editable: boolean;
  onChange: (occupied: number) => void;
}) {
  const free = beds.total - beds.occupied - beds.reserved;
  const occPct = (beds.occupied / beds.total) * 100;
  const resPct = (beds.reserved / beds.total) * 100;
  return (
    <div className="ward">
      <div className="flex items-center justify-between mb-1">
        <span className="eyebrow">{label}</span>
        <span className="mono text-[11px]">
          <span className={free <= 2 ? 'text-red-300' : 'text-teal-300'}>{free} free</span>
          <span className="muted">
            {' '}
            · {beds.occupied} occ · {beds.reserved} res / {beds.total}
          </span>
        </span>
      </div>
      <div className="bed-bar">
        <span className="occ" style={{ width: `${occPct}%` }} />
        <span className="res" style={{ width: `${resPct}%` }} />
      </div>
      {editable && (
        <div className="flex gap-1 mt-2 justify-end">
          <button
            className="btn btn-quiet"
            onClick={() => onChange(Math.max(0, beds.occupied - 1))}
            aria-label={`Discharge ${label}`}
          >
            <Minus size={12} /> Discharge
          </button>
          <button
            className="btn btn-quiet"
            disabled={free <= 0}
            onClick={() => onChange(beds.occupied + 1)}
            aria-label={`Admit ${label}`}
          >
            <Plus size={12} /> Admit
          </button>
        </div>
      )}
    </div>
  );
}
