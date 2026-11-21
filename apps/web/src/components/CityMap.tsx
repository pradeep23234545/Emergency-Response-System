import { memo, useMemo } from 'react';
import type { Incident, RoadNetwork, Snapshot, TrafficSignal, Unit } from '@corridor/core';
import { UNIT_COLOR, congestionColor } from '@/lib/labels';

export interface CityMapProps {
  network: RoadNetwork;
  snapshot: Snapshot;
  compact?: boolean;
  selectedUnitId?: string | null;
  selectedEdgeId?: string | null;
  selectedNodeId?: string | null;
  showForecast?: boolean;
  onSelectUnit?: (unit: Unit) => void;
  onSelectEdge?: (edgeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  onSelectSignal?: (signal: TrafficSignal) => void;
  onSelectIncident?: (incident: Incident) => void;
}

const ACTIVE_INCIDENT = new Set(['reported', 'verified', 'dispatched', 'on_scene', 'transporting']);
const MOVING = new Set(['en_route', 'transporting', 'returning']);

function CityMapImpl({
  network,
  snapshot,
  compact,
  selectedUnitId,
  selectedEdgeId,
  selectedNodeId,
  showForecast,
  onSelectUnit,
  onSelectEdge,
  onSelectNode,
  onSelectSignal,
  onSelectIncident,
}: CityMapProps) {
  const nodes = useMemo(() => new Map(network.nodes.map((n) => [n.id, n])), [network]);
  const blocks = useMemo(() => cityBlocks(network), [network]);
  const signalsByNode = useMemo(() => new Map(snapshot.signals.map((s) => [s.nodeId, s])), [snapshot.signals]);

  return (
    <svg
      viewBox={`0 0 ${network.width} ${network.height}`}
      className="city-map"
      role="img"
      aria-label="Live city map with traffic, signals and emergency vehicles"
    >
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* city blocks */}
      {blocks.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={10} className="map-block" />
      ))}

      {/* roads, coloured by current (or forecast) congestion */}
      {network.edges.map((edge, i) => {
        const a = nodes.get(edge.from)!;
        const b = nodes.get(edge.to)!;
        const t = snapshot.traffic[i];
        if (!t) return null;
        const c = showForecast ? t.f : t.c;
        const selected = selectedEdgeId === edge.id;
        return (
          <g key={edge.id} className="map-edge" onClick={onSelectEdge ? () => onSelectEdge(edge.id) : undefined}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="road-base" strokeWidth={edge.lanes * 4 + 6} />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={congestionColor(c, t.blocked)}
              strokeWidth={edge.lanes * 2 + 1}
              strokeOpacity={0.85}
              strokeLinecap="round"
            />
            {t.corridor && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="road-corridor" filter="url(#glow)" />}
            {t.blocked && <BlockMarker x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} />}
            {selected && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="road-selected" />}
            {onSelectEdge && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={22} />}
          </g>
        );
      })}

      {/* planned routes */}
      {snapshot.units
        .filter((u) => MOVING.has(u.status) && u.route.length)
        .map((u) => {
          const pts = [u.position, ...u.route.map((id) => nodes.get(id)!)];
          return (
            <polyline
              key={`route-${u.id}`}
              points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
              className={`unit-route ${u.status === 'returning' ? 'returning' : ''} ${selectedUnitId === u.id ? 'selected' : ''}`}
              stroke={UNIT_COLOR[u.kind]}
            />
          );
        })}

      {/* junctions + signals */}
      {network.nodes.map((n) => {
        const signal = signalsByNode.get(n.id);
        const selected = selectedNodeId === n.id;
        return (
          <g
            key={n.id}
            transform={`translate(${n.x} ${n.y})`}
            className={onSelectNode || (signal && onSelectSignal) ? 'map-node clickable' : 'map-node'}
            onClick={() => {
              if (onSelectNode) onSelectNode(n.id);
              else if (signal && onSelectSignal) onSelectSignal(signal);
            }}
          >
            {selected && <circle r={18} className="node-selected" />}
            {signal ? <SignalGlyph signal={signal} /> : <circle r={4} className="node-plain" />}
            {n.hasCamera && !compact && <rect x={7} y={-12} width={6} height={5} rx={1} className="camera-glyph" />}
            {onSelectNode && <circle r={16} fill="transparent" />}
          </g>
        );
      })}

      {/* facilities */}
      {network.facilities.map((f) => (
        <g
          key={f.id}
          transform={`translate(${f.x + (f.kind === 'hospital' ? -22 : 14)} ${f.y + 14})`}
          className="facility"
        >
          <rect x={-9} y={-9} width={18} height={18} rx={4} className={`facility-${f.kind}`} />
          <text y={4} textAnchor="middle" className="facility-glyph">
            {f.kind === 'hospital' ? 'H' : f.kind === 'fire_station' ? 'F' : f.kind === 'police_station' ? 'P' : 'A'}
          </text>
          {!compact && f.kind === 'hospital' && (
            <text y={24} textAnchor="middle" className="facility-label">
              {f.name.split(' ').slice(0, 2).join(' ')}
            </text>
          )}
        </g>
      ))}

      {/* incidents */}
      {snapshot.incidents
        .filter((i) => ACTIVE_INCIDENT.has(i.status))
        .map((i) => (
          <g
            key={i.id}
            transform={`translate(${i.position.x} ${i.position.y - 2})`}
            className="incident-marker"
            onClick={onSelectIncident ? () => onSelectIncident(i) : undefined}
          >
            <circle r={20} className={`incident-pulse sev-${i.severity}`} />
            <path d="M0 -15 L12 7 L-12 7 Z" className={`incident-glyph sev-${i.severity}`} />
            <text y={4} textAnchor="middle" className="incident-bang">
              !
            </text>
            {!compact && (
              <text y={24} textAnchor="middle" className="incident-label">
                {i.id}
              </text>
            )}
          </g>
        ))}

      {/* vehicles */}
      {snapshot.units
        .filter((u) => u.status !== 'available' || !compact)
        .map((u) => (
          <g
            key={u.id}
            className={`unit-marker ${u.status} ${selectedUnitId === u.id ? 'selected' : ''}`}
            style={{ transform: `translate(${u.position.x}px, ${u.position.y}px)` }}
            onClick={onSelectUnit ? () => onSelectUnit(u) : undefined}
          >
            {(u.status === 'en_route' || u.status === 'transporting') && (
              <circle r={15} className="unit-halo" stroke={UNIT_COLOR[u.kind]} />
            )}
            <circle r={u.status === 'available' ? 5 : 8} fill={UNIT_COLOR[u.kind]} className="unit-dot" />
            {u.status !== 'available' && (
              <text y={-13} textAnchor="middle" className="unit-callsign">
                {u.callSign}
              </text>
            )}
          </g>
        ))}
    </svg>
  );
}

function SignalGlyph({ signal }: { signal: TrafficSignal }) {
  const mode = signal.mode;
  const ring =
    mode === 'green_wave'
      ? 'sig-green'
      : mode === 'preclear'
        ? 'sig-preclear'
        : mode === 'restore'
          ? 'sig-restore'
          : mode === 'manual'
            ? 'sig-manual'
            : mode === 'flash'
              ? 'sig-flash'
              : 'sig-normal';
  return (
    <g className={`signal-glyph ${ring}`}>
      <circle r={mode === 'normal' ? 6 : 9} className="sig-body" />
      {mode !== 'flash' && (
        <line
          x1={signal.greenAxis === 'EW' ? -5 : 0}
          y1={signal.greenAxis === 'EW' ? 0 : -5}
          x2={signal.greenAxis === 'EW' ? 5 : 0}
          y2={signal.greenAxis === 'EW' ? 0 : 5}
          className="sig-axis"
        />
      )}
    </g>
  );
}

function BlockMarker({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="block-marker">
      <rect x={-11} y={-11} width={22} height={22} rx={5} />
      <path d="M-5 -5 L5 5 M5 -5 L-5 5" />
    </g>
  );
}

/** Background rectangles filling the gaps between the arterial grid. */
function cityBlocks(network: RoadNetwork) {
  const cluster = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const v of sorted) {
      const last = groups.at(-1);
      if (last && v - last[last.length - 1] < 50) last.push(v);
      else groups.push([v]);
    }
    return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
  };
  const xs = cluster(network.nodes.map((n) => n.x));
  const ys = cluster(network.nodes.map((n) => n.y));
  const blocks: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      blocks.push({ x: xs[i] + 22, y: ys[j] + 22, w: xs[i + 1] - xs[i] - 44, h: ys[j + 1] - ys[j] - 44 });
    }
  }
  return blocks.filter((b) => b.w > 20 && b.h > 20);
}

export const CityMap = memo(CityMapImpl);

export function MapLegend({ forecast }: { forecast?: boolean }) {
  return (
    <div className="map-legend">
      <span className="legend-key">
        <span className="legend-swatch" style={{ background: '#2fbf8f' }} /> Free
      </span>
      <span className="legend-key">
        <span className="legend-swatch" style={{ background: '#f0a13c' }} /> Heavy
      </span>
      <span className="legend-key">
        <span className="legend-swatch" style={{ background: '#ef5a4c' }} /> Jam{forecast ? ' (+10 min)' : ''}
      </span>
      <span className="legend-key">
        <span className="legend-swatch corridor" /> Corridor
      </span>
      <span className="legend-key">
        <span className="legend-dot" style={{ background: UNIT_COLOR.ambulance }} /> Ambulance
      </span>
      <span className="legend-key">
        <span className="legend-dot" style={{ background: UNIT_COLOR.fire }} /> Fire
      </span>
      <span className="legend-key">
        <span className="legend-dot" style={{ background: UNIT_COLOR.police }} /> Police
      </span>
    </div>
  );
}
