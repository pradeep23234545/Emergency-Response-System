import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INCIDENT_TYPES, formatDuration, type BenchmarkResult } from '@corridor/core';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { FlaskConical, Fuel, Gauge, Megaphone, Timer, TrendingDown } from 'lucide-react';
import { EmptyState, Loading, Metric, PageHeader, Panel, reportError } from '@/components/common';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pct } from '@/lib/labels';

const tooltipStyle = { background: '#102131', border: '1px solid #26394a', borderRadius: 8, fontSize: 11 };

export default function AnalyticsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['analytics'], queryFn: api.analytics, refetchInterval: 10_000 });
  const bench = useMutation({
    mutationFn: api.runBenchmark,
    onSuccess: () => {
      toast.success('Benchmark complete');
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (err) => reportError(err),
  });
  if (!query.data) return <Loading />;
  const { metrics: m, outcomes, benchmark } = query.data;
  const recent = outcomes.slice(-20).map((o) => ({
    id: o.incidentId.replace('INC-', '#'),
    actual: Math.round(o.responseSeconds / 6) / 10,
    baseline: Math.round(o.baselineSeconds / 6) / 10,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Impact & benefits"
        title="Impact analytics"
        description="Every resolved incident is compared with the trip the same unit would have made without the corridor (normal traffic and signal waits). Targets are from the project proposal."
        actions={
          can('simulation') && (
            <button className="btn btn-primary" onClick={() => bench.mutate()} disabled={bench.isPending}>
              <FlaskConical size={15} /> {bench.isPending ? 'Simulating 2 × 3 h…' : 'Run A/B benchmark'}
            </button>
          )
        }
      />
      <div className="metric-grid">
        <Metric
          label="Faster response"
          value={pct(m.improvementPct)}
          icon={TrendingDown}
          tone="teal"
          hint={<span className="muted">Target 35–45% · live session</span>}
        />
        <Metric
          label="Avg response"
          value={formatDuration(m.avgResponseSeconds)}
          icon={Timer}
          tone="amber"
          hint={<span className="muted">baseline {formatDuration(m.avgBaselineSeconds)}</span>}
        />
        <Metric
          label="Signal idling cut"
          value={pct(m.idleReductionPct)}
          icon={Fuel}
          tone="blue"
          hint={
            <span className="muted">Target ~20% less idling · {formatDuration(m.signalWaitSavedSeconds)} saved</span>
          }
        />
        <Metric
          label="Drivers alerted"
          value={m.civiliansAlerted.toLocaleString()}
          icon={Megaphone}
          tone="red"
          hint={<span className="muted">V2X, VMS and app push</span>}
        />
      </div>

      <div className="section-grid">
        <Panel
          title="Response time per incident"
          subtitle="Minutes · with corridor vs. estimated without (last 20 resolved)"
        >
          {recent.length ? (
            <div style={{ height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={recent} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(140,170,185,.1)" vertical={false} />
                  <XAxis dataKey="id" stroke="#5d7381" fontSize={10} />
                  <YAxis stroke="#5d7381" fontSize={10} unit="m" />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="baseline" name="Without corridor" fill="#5b6f7d" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="actual" name="With corridor" fill="#36d0a9" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No resolved incidents yet"
              detail="Keep the simulation running — results appear as incidents close."
              icon={Gauge}
            />
          )}
        </Panel>
        <Panel title="Targets vs. measured" subtitle="Proposal KPIs against this deployment">
          <table>
            <thead>
              <tr>
                <th>KPI</th>
                <th>Target</th>
                <th>Measured</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Faster response</td>
                <td>35–45%</td>
                <td className="mono">{pct(benchmark?.improvementPct ?? m.improvementPct, 1)}</td>
              </tr>
              <tr>
                <td>Detection latency</td>
                <td>&lt; 200 ms</td>
                <td className="mono">{m.avgDetectionLatencyMs != null ? `${m.avgDetectionLatencyMs} ms` : '—'}</td>
              </tr>
              <tr>
                <td>Detection accuracy</td>
                <td>90%+</td>
                <td className="mono">{pct(m.detectionAccuracy, 1)}</td>
              </tr>
              <tr>
                <td>Idling & fuel</td>
                <td>~20% less</td>
                <td className="mono">{pct(m.idleReductionPct)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted text-[11px] mt-3 leading-relaxed">
            Measured values come from the city simulation (synthetic traffic and detection models). They validate the
            control logic, not field performance.
          </p>
        </Panel>
      </div>

      <div className="mt-[14px]">
        <BenchmarkPanel benchmark={benchmark} />
      </div>
    </>
  );
}

function BenchmarkPanel({ benchmark }: { benchmark: BenchmarkResult | null }) {
  if (!benchmark)
    return (
      <Panel title="A/B benchmark" subtitle="Same seed, same traffic, same 112 calls — corridor on vs. off">
        <EmptyState
          title="No benchmark yet"
          detail="Run one to compare 3 simulated hours with and without the corridor."
          icon={FlaskConical}
        />
      </Panel>
    );
  const data = benchmark.byType.map((t) => ({
    type: INCIDENT_TYPES[t.type].label,
    with: Math.round(t.withCorridor / 6) / 10,
    without: Math.round(t.withoutCorridor / 6) / 10,
  }));
  return (
    <Panel
      title="A/B benchmark"
      subtitle={`${benchmark.incidents} incidents over ${benchmark.simulatedSeconds / 3600} simulated hours · run ${new Date(benchmark.ranAt).toLocaleString()}`}
    >
      <div className="bench-summary">
        <div>
          <div className="eyebrow">With corridor</div>
          <div className="metric-value text-teal-300">{formatDuration(benchmark.withCorridor.avgResponseSeconds)}</div>
          <div className="muted text-[11px]">
            {benchmark.withCorridor.completed} responses · {benchmark.withCorridor.avgIdleSeconds}s stopped avg
          </div>
        </div>
        <div>
          <div className="eyebrow">Without corridor</div>
          <div className="metric-value">{formatDuration(benchmark.withoutCorridor.avgResponseSeconds)}</div>
          <div className="muted text-[11px]">
            {benchmark.withoutCorridor.completed} responses · {benchmark.withoutCorridor.avgIdleSeconds}s stopped avg
          </div>
        </div>
        <div>
          <div className="eyebrow">Improvement</div>
          <div className="metric-value text-amber-300">{benchmark.improvementPct}%</div>
          <div className="muted text-[11px]">faster average response</div>
        </div>
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="rgba(140,170,185,.1)" vertical={false} />
            <XAxis dataKey="type" stroke="#5d7381" fontSize={10} />
            <YAxis stroke="#5d7381" fontSize={10} unit="m" />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="without" name="Without corridor" fill="#5b6f7d" radius={[3, 3, 0, 0]} />
            <Bar dataKey="with" name="With corridor" fill="#f0b949" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
