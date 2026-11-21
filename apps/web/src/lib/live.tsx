import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Alert, AuditEntry, RoadNetwork, Snapshot } from '@corridor/core';
import { toast } from 'sonner';
import { api, streamUrl } from './api';

type ConnectionState = 'connecting' | 'live' | 'reconnecting';

interface LiveContextValue {
  network: RoadNetwork | undefined;
  snapshot: Snapshot | undefined;
  audit: AuditEntry[];
  connection: ConnectionState;
}

const LiveContext = createContext<LiveContextValue | null>(null);

/**
 * Subscribes to the server's event stream. The server is authoritative; the
 * client only renders the latest snapshot and surfaces urgent alerts as toasts.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const network = useQuery({ queryKey: ['network'], queryFn: api.network, staleTime: Infinity });
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const seenAlerts = useRef(new Set<string>());

  useEffect(() => {
    api
      .audit({ limit: 40 })
      .then((r) => setAudit(r.entries))
      .catch(() => undefined);

    const source = new EventSource(streamUrl, { withCredentials: true });
    source.addEventListener('open', () => setConnection('live'));
    source.addEventListener('error', () => setConnection('reconnecting'));
    source.addEventListener('snapshot', (e) => {
      setConnection('live');
      setSnapshot(JSON.parse((e as MessageEvent).data));
    });
    source.addEventListener('audit', (e) => {
      const entry = JSON.parse((e as MessageEvent).data) as AuditEntry;
      setAudit((current) => [entry, ...current.filter((x) => x.id !== entry.id)].slice(0, 80));
    });
    source.addEventListener('alert', (e) => {
      const alert = JSON.parse((e as MessageEvent).data) as Alert;
      if (seenAlerts.current.has(alert.id)) return;
      seenAlerts.current.add(alert.id);
      if (alert.level === 'critical') toast.error(alert.title, { description: alert.detail });
      else if (alert.channel === 'system' && alert.level === 'warning')
        toast.warning(alert.title, { description: alert.detail });
    });
    return () => source.close();
  }, []);

  const value = useMemo(
    () => ({ network: network.data, snapshot, audit, connection }),
    [network.data, snapshot, audit, connection],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used inside LiveProvider');
  return ctx;
}

/** Convenience lookups derived from the static network. */
export function useNetworkIndex() {
  const { network } = useLive();
  return useMemo(() => {
    const nodes = new Map(network?.nodes.map((n) => [n.id, n]) ?? []);
    const edges = new Map(network?.edges.map((e, i) => [e.id, { edge: e, index: i }]) ?? []);
    return { nodes, edges };
  }, [network]);
}
