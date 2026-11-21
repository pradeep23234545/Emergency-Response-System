import type { Axis, Facility, RoadEdge, RoadNetwork, RoadNode } from '@corridor/core';

/**
 * A fictional mid-size Indian city laid out on a perturbed 6 x 4 arterial grid
 * plus two diagonal link roads. 1 drawing unit = 8 metres, so the city spans
 * roughly 8 km x 5 km. The layout is deterministic so that snapshots, tests and
 * benchmarks are reproducible.
 */

const SCALE = 8;
const COLS = [80, 250, 420, 590, 760, 930];
const ROWS = [80, 240, 400, 560];
const COL_NAMES = ['Nehru Marg', 'Tilak Rd', 'Gandhi Path', 'Ambedkar Rd', 'Patel Marg', 'Bose Rd'];
const ROW_NAMES = ['Ring Rd', 'MG Rd', 'Station Rd', 'Airport Rd'];
const FAST_ROWS = new Set([0, 3]);
const WIDE_ROWS = new Set([0, 1, 3]);

/* deterministic jitter so the grid does not look machine-drawn */
const JITTER: [number, number][] = [
  [0, 0],
  [6, -8],
  [-4, 6],
  [10, 2],
  [-6, -4],
  [0, 8],
  [8, 4],
  [-10, 6],
  [4, -6],
  [-6, 10],
  [12, -4],
  [-4, 0],
  [-8, 2],
  [6, 10],
  [-12, -6],
  [8, 6],
  [-4, -10],
  [6, 4],
  [0, -4],
  [-6, 2],
  [10, -6],
  [-8, 4],
  [4, 6],
  [0, 0],
];

const nodeId = (r: number, c: number) => `J${r}${c}`;

function buildNodes(): RoadNode[] {
  const nodes: RoadNode[] = [];
  ROWS.forEach((y, r) => {
    COLS.forEach((x, c) => {
      const [jx, jy] = JITTER[r * COLS.length + c];
      const corner = (r === 0 || r === ROWS.length - 1) && (c === 0 || c === COLS.length - 1);
      nodes.push({
        id: nodeId(r, c),
        name: `${COL_NAMES[c]} × ${ROW_NAMES[r]}`,
        x: x + jx,
        y: y + jy,
        hasSignal: !corner,
        hasCamera: (r + c) % 2 === 0 || r === 1,
      });
    });
  });
  return nodes;
}

function buildEdges(nodes: RoadNode[]): RoadEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: RoadEdge[] = [];
  const add = (from: string, to: string, name: string, speedLimit: number, lanes: number) => {
    const a = byId.get(from)!;
    const b = byId.get(to)!;
    const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y) * SCALE);
    edges.push({ id: `E-${from}-${to}`, from, to, name, length, speedLimit, lanes });
  };
  ROWS.forEach((_, r) => {
    for (let c = 0; c < COLS.length - 1; c++) {
      add(nodeId(r, c), nodeId(r, c + 1), ROW_NAMES[r], FAST_ROWS.has(r) ? 60 : 50, WIDE_ROWS.has(r) ? 3 : 2);
    }
  });
  COLS.forEach((_, c) => {
    for (let r = 0; r < ROWS.length - 1; r++) {
      add(nodeId(r, c), nodeId(r + 1, c), COL_NAMES[c], c === 0 || c === COLS.length - 1 ? 60 : 50, 2);
    }
  });
  add('J01', 'J12', 'Link Rd', 50, 2);
  add('J23', 'J34', 'Canal Rd', 50, 2);
  return edges;
}

const FACILITIES: Omit<Facility, 'x' | 'y'>[] = [
  { id: 'H1', name: 'City General Hospital', nodeId: 'J11', kind: 'hospital' },
  { id: 'H2', name: 'Sahyadri Cardiac Institute', nodeId: 'J14', kind: 'hospital' },
  { id: 'H3', name: 'Ruby Trauma & Burns Centre', nodeId: 'J22', kind: 'hospital' },
  { id: 'H4', name: 'District Civil Hospital', nodeId: 'J30', kind: 'hospital' },
  { id: 'FS1', name: 'Fire Station No. 1', nodeId: 'J02', kind: 'fire_station' },
  { id: 'FS2', name: 'Fire Station No. 2', nodeId: 'J25', kind: 'fire_station' },
  { id: 'FS3', name: 'Fire Station No. 3', nodeId: 'J33', kind: 'fire_station' },
  { id: 'PS1', name: 'North Police Chowki', nodeId: 'J04', kind: 'police_station' },
  { id: 'PS2', name: 'Central Police Station', nodeId: 'J21', kind: 'police_station' },
  { id: 'PS3', name: 'South Police Chowki', nodeId: 'J35', kind: 'police_station' },
  { id: 'PS4', name: 'Traffic Police HQ', nodeId: 'J13', kind: 'police_station' },
  { id: 'AB1', name: '108 Ambulance Base East', nodeId: 'J05', kind: 'ambulance_base' },
];

export function buildNetwork(): RoadNetwork {
  const nodes = buildNodes();
  const edges = buildEdges(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const facilities = FACILITIES.map((f) => ({ ...f, x: byId.get(f.nodeId)!.x, y: byId.get(f.nodeId)!.y }));
  return { width: 1010, height: 640, scale: SCALE, nodes, edges, facilities };
}

export interface Neighbor {
  nodeId: string;
  edge: RoadEdge;
  edgeIndex: number;
}

/** Pre-computed lookup structure around the immutable network. */
export class Graph {
  readonly nodes: Map<string, RoadNode>;
  readonly adjacency: Map<string, Neighbor[]>;
  readonly edgeIndex: Map<string, number>;
  private readonly pairIndex: Map<string, number>;

  constructor(readonly network: RoadNetwork) {
    this.nodes = new Map(network.nodes.map((n) => [n.id, n]));
    this.adjacency = new Map(network.nodes.map((n) => [n.id, []]));
    this.edgeIndex = new Map();
    this.pairIndex = new Map();
    network.edges.forEach((edge, index) => {
      this.edgeIndex.set(edge.id, index);
      this.pairIndex.set(`${edge.from}|${edge.to}`, index);
      this.pairIndex.set(`${edge.to}|${edge.from}`, index);
      this.adjacency.get(edge.from)!.push({ nodeId: edge.to, edge, edgeIndex: index });
      this.adjacency.get(edge.to)!.push({ nodeId: edge.from, edge, edgeIndex: index });
    });
  }

  node(id: string): RoadNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown node ${id}`);
    return node;
  }

  /** Index of the edge joining two adjacent nodes. */
  edgeBetween(a: string, b: string): number {
    const index = this.pairIndex.get(`${a}|${b}`);
    if (index === undefined) throw new Error(`No edge between ${a} and ${b}`);
    return index;
  }

  edge(index: number): RoadEdge {
    return this.network.edges[index];
  }

  /** Axis of travel when moving from `a` to `b`. */
  axis(a: string, b: string): Axis {
    const na = this.node(a);
    const nb = this.node(b);
    return Math.abs(nb.x - na.x) >= Math.abs(nb.y - na.y) ? 'EW' : 'NS';
  }

  pathLength(path: string[]): number {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) total += this.edge(this.edgeBetween(path[i], path[i + 1])).length;
    return total;
  }
}
