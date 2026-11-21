import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatClock, type AuditEntry } from '@corridor/core';
import { ListChecks } from 'lucide-react';
import { EmptyState, Loading, PageHeader, Panel } from '@/components/common';
import { api } from '@/lib/api';

const CATEGORIES: (AuditEntry['category'] | '')[] = [
  '',
  'incident',
  'dispatch',
  'corridor',
  'signal',
  'hospital',
  'auth',
  'system',
];

export default function AuditPage() {
  const [category, setCategory] = useState<string>('');
  const query = useInfiniteQuery({
    queryKey: ['audit', category],
    queryFn: ({ pageParam }) => api.audit({ limit: 50, before: pageParam, category: category || undefined }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.entries.length === 50 ? last.entries.at(-1)!.id : undefined),
    refetchInterval: 15_000,
  });
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Accountability"
        title="Audit trail"
        description="An append-only record of every operator command and every automated AI decision, stored in the database."
        actions={
          <div className="tabs">
            {CATEGORIES.map((c) => (
              <button
                key={c || 'all'}
                className={`tab ${category === c ? 'active' : ''}`}
                onClick={() => setCategory(c)}
              >
                {c || 'all'}
              </button>
            ))}
          </div>
        }
      />
      <Panel bodyClassName="table-wrap">
        {query.isLoading ? (
          <Loading label="Loading audit log…" />
        ) : entries.length ? (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Sim time</th>
                <th>Category</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono muted">{e.id}</td>
                  <td className="mono">{formatClock(e.at)}</td>
                  <td>
                    <span className={`cat-pill cat-${e.category}`}>{e.category}</span>
                  </td>
                  <td>{e.actor}</td>
                  <td className="font-bold text-slate-200">{e.action}</td>
                  <td className="whitespace-normal min-w-[280px] text-slate-300">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No entries" icon={ListChecks} />
        )}
        {query.hasNextPage && (
          <div className="p-4 text-center">
            <button className="btn" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
            </button>
          </div>
        )}
      </Panel>
    </>
  );
}
