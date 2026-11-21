import type { Graph } from './network';

/**
 * Time-dependent shortest path (Dijkstra). `edgeCost` receives the departure
 * offset (seconds from now) at which the edge would be entered, which lets the
 * caller price edges using *forecast* congestion at the predicted arrival time
 * instead of the congestion right now.
 */
export interface RouteResult {
  path: string[];
  seconds: number;
  meters: number;
}

export type EdgeCost = (edgeIndex: number, from: string, to: string, departOffsetSeconds: number) => number;
export type NodeCost = (nodeId: string, prev: string, next: string | null, arriveOffsetSeconds: number) => number;

export function findRoute(
  graph: Graph,
  origin: string,
  destination: string,
  edgeCost: EdgeCost,
  nodeCost: NodeCost = () => 0,
  startOffset = 0,
): RouteResult | null {
  if (origin === destination) return { path: [origin], seconds: 0, meters: 0 };
  const dist = new Map<string, number>([[origin, startOffset]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  const queue = new MinQueue();
  queue.push(origin, startOffset);

  while (queue.size) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === destination) break;
    const t = dist.get(current)!;
    for (const { nodeId: next, edgeIndex } of graph.adjacency.get(current)!) {
      if (visited.has(next)) continue;
      const travel = edgeCost(edgeIndex, current, next, t - startOffset);
      if (!Number.isFinite(travel)) continue;
      // delay incurred when passing through `current` (signal wait); none at the origin
      const through = current === origin ? 0 : nodeCost(current, prev.get(current)!, next, t - startOffset);
      const candidate = t + through + travel;
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        prev.set(next, current);
        queue.push(next, candidate);
      }
    }
  }

  if (!dist.has(destination)) return null;
  const path = [destination];
  while (path[0] !== origin) path.unshift(prev.get(path[0])!);
  return { path, seconds: dist.get(destination)! - startOffset, meters: graph.pathLength(path) };
}

/** Tiny binary heap keyed by number. */
class MinQueue {
  private items: { key: string; p: number }[] = [];

  get size() {
    return this.items.length;
  }

  push(key: string, p: number) {
    const items = this.items;
    items.push({ key, p });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].p <= items[i].p) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): string | undefined {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l].p < items[m].p) m = l;
        if (r < items.length && items[r].p < items[m].p) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top.key;
  }
}
