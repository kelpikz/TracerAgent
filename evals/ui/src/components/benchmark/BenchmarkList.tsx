import { Plus } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { benchmarkBadge, modelColor, shortModel } from '@/lib/benchmark';
import { formatAgo, formatTime } from '@/lib/format';
import type { BenchmarkSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  list: BenchmarkSummary[] | null;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function BenchmarkList({ list, error, selectedId, onSelect }: Props) {
  return (
    <>
      <div className="px-3 pb-3">
        <Button size="sm" className="w-full" variant={selectedId === 'new' ? 'secondary' : 'default'} onClick={() => onSelect('new')}>
          <Plus /> New benchmark
        </Button>
      </div>

      <div className="flex items-center justify-between px-5 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        <span>Benchmarks</span>
        {list && <span className="tabular-nums">{list.length}</span>}
      </div>

      <nav aria-label="Benchmarks" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {error && <p className="px-3 py-2 text-[13px] text-destructive">{error}</p>}
        {!list && !error && (
          <div className="space-y-1">
            {[0, 1].map(i => (
              <div key={i} className="space-y-2 rounded-lg px-3 py-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        )}
        {list?.length === 0 && <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">No benchmarks yet.</p>}
        <ul className="space-y-0.5">
          {list?.map(item => {
            const active = item.id === selectedId;
            const badge = benchmarkBadge(item.status);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    active ? 'border-border bg-card shadow-xs' : 'hover:bg-accent/70',
                  )}
                >
                  {active && <span className="absolute top-3 bottom-3 -left-px w-0.5 rounded-full bg-brand" />}
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-[13.5px] leading-snug font-medium">{item.name || `Benchmark ${formatTime(item.created_at)}`}</span>
                    <StatusBadge status={badge.status} label={badge.label} className="mt-px px-1.5 py-0 text-[11px]" />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      {item.models.map((model, index) => (
                        <span key={model} title={shortModel(model)} className="size-2 rounded-full" style={{ background: modelColor(index) }} />
                      ))}
                    </span>
                    <span>{item.finished}/{item.runs} runs</span>
                    {item.failed > 0 && <span className="text-warning">{item.failed} failed</span>}
                    <span>{formatAgo(item.created_at)}</span>
                  </div>
                  {item.status === 'running' && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-info transition-[width] duration-500" style={{ width: `${(item.finished / item.runs) * 100}%` }} />
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
