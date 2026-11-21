import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatClock } from '@corridor/core';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { Construction, LineChart, TrafficCone, Unlock } from 'lucide-react';
import { Badge, EmptyState, Loading, Meter, PageHeader, Panel, reportError } from '@/components/common';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLive, useNetworkIndex } from '@/lib/live';
import { SIGNAL_MODE_LABEL, SIGNAL_MODE_TONE, congestionColor } from '@/lib/labels';

export default function TrafficPage() {
  const { snapshot } = useLive();
  const { can } = useAuth();
  const { nodes, edges } = useNetworkIndex();
  const hotspots = useQuery({ queryKey: ['hotspots'], queryFn: api.hotspots, refetchInterval: 8000 });
  const blockages = useQuery({ queryKey: ['blockages'], queryFn: api.blockages, refetchInterval: 5000 });
  const [edgeId, setEdgeId] = useState<string | null>(null);

  useEffect(() => {
    if (!edgeId && hotspots.data?.hotspots[0]) setEdgeId(hotspots.data.hotspots[0].edgeId);
  }, [edgeId, hotspots.data]);

  if (!snapshot) return <Loading />;
  const units = new Map(snapshot.units.map((u) => [u.id, u]));
  const signals = [...snapshot.signals].sort((a, b) => modeRank(a.mode) - modeRank(b.mode));

  return (
    <>
      <PageHeader
        eyebrow="Predict · AI congestion forecasting"
        title="Traffic & signal control"
        description="Short-horizon forecasts price every road segment at the moment an emergency vehicle is predicted to reach it. Signals are pre-empted in sequence along each corridor."
      />
      <div className="section-grid">
        <Panel
          title="Congestion forecast"
          subtitle="Last hour observed and the next 30 minutes predicted, with uncertainty band"
          actions={<LineChart size={16} className="text-teal-300" />}
        >
          {edgeId ? <ForecastChart edgeId={edgeId} /> : <Loading label="Loading forecast…" />}
        </Panel>
        <Panel title="Predicted hotspots" subtitle="Highest forecast congestion in 10 minutes">
          <div className="grid gap-1">
            {hotspots.data?.hotspots.map((h) => (
              <button
                key={h.edgeId}
                className={`hotspot-row ${edgeId === h.edgeId ? 'active' : ''}`}
                onClick={() => setEdgeId(h.edgeId)}
              >
                <div className="min-w-0 text-left">
                  <div className="text-xs font-bold text-slate-200 truncate">{h.name}</div>
                  <div className="text-[10px] muted truncate">
                    {h.from.split(' × ')[0]} ↔ {h.to.split(' × ')[0]}
                  </div>
                </div>
                <div className="w-28 shrink-0">
                  <div className="flex justify-between mono text-[10px]">
                    <span style={{ color: congestionColor(h.congestion) }}>{Math.round(h.congestion * 100)}%</span>
                    <span className="muted">→</span>
                    <span style={{ color: congestionColor(h.forecast10, h.blocked) }}>
                      {h.blocked ? 'BLOCKED' : `${Math.round(h.forecast10 * 100)}%`}
                    </span>
                  </div>
                  <Meter
                    value={h.forecast10 * 100}
                    tone={h.forecast10 > 0.7 ? 'red' : h.forecast10 > 0.5 ? 'amber' : 'teal'}
                  />
                </div>
              </button>
            )) ?? <Loading label="Scoring segments…" />}
          </div>
        </Panel>
      </div>

      <div className="section-grid-wide">
        <Panel
          title="Signal controllers"
          subtitle={`${signals.length} connected junctions · adaptive control with emergency pre-emption`}
          bodyClassName="table-wrap"
        >
          <table>
            <thead>
              <tr>
                <th>Junction</th>
                <th>Mode</th>
                <th>Green</th>
                <th>Holder</th>
                <th>Claims</th>
                <th>Queue</th>
                {can('signal:override') && <th />}
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="font-bold text-slate-200">{s.name}</div>
                    <div className="mono text-[10px] muted">{s.id}</div>
                  </td>
                  <td>
                    <Badge tone={SIGNAL_MODE_TONE[s.mode]}>{SIGNAL_MODE_LABEL[s.mode]}</Badge>
                  </td>
                  <td className="mono">{s.mode === 'flash' ? '—' : s.greenAxis}</td>
                  <td>{s.holderUnitId ? units.get(s.holderUnitId)?.callSign : '—'}</td>
                  <td className="mono">{s.claims.length || '—'}</td>
                  <td className="mono">{s.queue}</td>
                  {can('signal:override') && (
                    <td>
                      <select
                        className="mini-select"
                        value=""
                        onChange={(e) =>
                          api
                            .overrideSignal(s.id, e.target.value as 'force_ns' | 'force_ew' | 'flash' | 'release')
                            .then(() => toast.success(`${s.name} updated`))
                            .catch(reportError)
                        }
                        aria-label={`Override ${s.name}`}
                      >
                        <option value="" disabled>
                          Override…
                        </option>
                        <option value="force_ns">Force N–S green</option>
                        <option value="force_ew">Force E–W green</option>
                        <option value="flash">Flash red</option>
                        <option value="release">Release to adaptive</option>
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel
          title="Road blockages"
          subtitle="Reported closures — routing avoids them immediately"
          actions={<Construction size={16} className="text-red-300" />}
        >
          {blockages.data?.blockages.length ? (
            <div className="grid gap-2">
              {blockages.data.blockages.map((b) => {
                const edge = edges.get(b.edgeId)?.edge;
                return (
                  <div key={b.edgeId} className="assigned-row">
                    <span className="type-icon type-ambulance">
                      <TrafficCone size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-100">{edge?.name ?? b.edgeId}</div>
                      <div className="text-[10px] muted">
                        {edge ? `${nodes.get(edge.from)?.name} → ${nodes.get(edge.to)?.name}` : ''} · {b.reason}
                      </div>
                    </div>
                    {can('network:write') && (
                      <button
                        className="btn btn-quiet btn-teal"
                        onClick={() =>
                          api
                            .clearBlockage(b.edgeId)
                            .then(() => (toast.success('Road reopened'), blockages.refetch()))
                            .catch(reportError)
                        }
                      >
                        <Unlock size={12} /> Reopen
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No blockages" detail="Report one from the Live Corridor map." icon={Construction} />
          )}
        </Panel>
      </div>
    </>
  );
}

function ForecastChart({ edgeId }: { edgeId: string }) {
  const query = useQuery({
    queryKey: ['forecast', edgeId],
    queryFn: () => api.forecast(edgeId),
    refetchInterval: 10_000,
  });
  if (!query.data) return <Loading label="Loading forecast…" />;
  const { history, forecast, name } = query.data;
  const now = forecast[0]?.t ?? 0;
  const data = [
    ...history.slice(-45).map((h) => ({ t: h.t, observed: Math.round(h.c * 100) })),
    ...forecast.map((f) => ({
      t: f.t,
      predicted: Math.round(f.c * 100),
      band: [Math.round(f.lo * 100), Math.round(f.hi * 100)] as [number, number],
    })),
  ];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-slate-200">{name}</div>
        <div className="mono text-[10px] muted">Holt smoothing + diurnal prior · model-agnostic interface</div>
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="rgba(140,170,185,.1)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t) => formatClock(t).slice(0, 5)}
              stroke="#5d7381"
              fontSize={10}
            />
            <YAxis domain={[0, 100]} stroke="#5d7381" fontSize={10} unit="%" />
            <Tooltip
              contentStyle={{ background: '#102131', border: '1px solid #26394a', borderRadius: 8, fontSize: 11 }}
              labelFormatter={(t) => formatClock(Number(t))}
              formatter={(v, k) => [
                Array.isArray(v) ? `${v[0]}–${v[1]}%` : `${v}%`,
                k === 'band' ? 'Confidence' : String(k),
              ]}
            />
            <Area dataKey="band" stroke="none" fill="#36d0a9" fillOpacity={0.12} isAnimationActive={false} />
            <Line dataKey="observed" stroke="#f0b949" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              dataKey="predicted"
              stroke="#36d0a9"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <ReferenceLine
              x={now}
              stroke="#8fa3ad"
              strokeDasharray="2 3"
              label={{ value: 'now', fill: '#8fa3ad', fontSize: 10, position: 'top' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function modeRank(mode: string) {
  return ['green_wave', 'preclear', 'manual', 'flash', 'restore', 'normal'].indexOf(mode);
}
