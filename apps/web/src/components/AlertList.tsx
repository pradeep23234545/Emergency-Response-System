import { formatClock, type Alert } from '@corridor/core';
import { BellOff, Building2, Check, Megaphone, Radio, ShieldAlert, Signpost, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { CHANNEL_LABEL } from '@/lib/labels';
import { EmptyState, reportError } from './common';

const CHANNEL_ICON = {
  v2x: Megaphone,
  vms: Signpost,
  app_push: Radio,
  hospital: Building2,
  crew: Truck,
  system: ShieldAlert,
};

export function AlertList({ alerts, ackable }: { alerts: Alert[]; ackable?: boolean }) {
  if (!alerts.length) return <EmptyState title="No alerts" icon={BellOff} />;
  return (
    <div className="alert-list">
      {alerts.map((a) => {
        const Icon = CHANNEL_ICON[a.channel];
        return (
          <div key={a.id} className={`alert-row level-${a.level} ${a.acknowledged ? 'acked' : ''}`}>
            <span className={`alert-icon ch-${a.channel}`}>
              <Icon size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <strong className="text-xs text-slate-100">{a.title}</strong>
                <span className="mono text-[10px] muted shrink-0">{formatClock(a.at)}</span>
              </div>
              <div className="text-[11px] muted mt-0.5 leading-snug">{a.detail}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="mono text-[9px] uppercase tracking-wider text-slate-500">
                  {CHANNEL_LABEL[a.channel]}
                </span>
                {a.reach ? <span className="mono text-[9px] text-sky-300">{a.reach} reached</span> : null}
              </div>
            </div>
            {ackable && !a.acknowledged && (
              <button
                className="btn btn-quiet btn-teal"
                onClick={() => api.ackAlert(a.id).catch(reportError)}
                aria-label="Acknowledge"
              >
                <Check size={13} /> Ack
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
