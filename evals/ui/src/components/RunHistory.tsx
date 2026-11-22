import { Bot, Coins, Footprints, History, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ScoreChip } from '@/components/ScoreChip';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAgo, formatDuration, formatTime, runStatusLabel } from '@/lib/format';
import type { CaseDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

interface RunHistoryProps {
  runs: CaseDetail['runs'] | null;
  runId: string | null;
  onSelect: (runId: string) => void;
}

/** The model name without its provider, such as "gpt-5.6-sol". */
const shortModel = (model?: string | null) => model?.split('/').pop() ?? 'Unknown model';

/** The current time, updated each 30 seconds, so "ago" labels stay correct. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function RunHistory({ runs, runId, onSelect }: RunHistoryProps) {
  const now = useNow();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-5 pt-6 pb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        <span className="flex items-center gap-1.5">
          <History className="size-3.5" /> Runs
        </span>
        {runs && <span className="tabular-nums">{runs.length}</span>}
      </div>

      <nav aria-label="Run history" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!runs && (
          <div className="space-y-1">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        )}
        {runs?.length === 0 && <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">No runs yet.</p>}
        <ul className="space-y-0.5">
          {runs?.map(run => {
            const active = run.run_id === runId;
            return (
              <li key={run.run_id}>
                <button
                  type="button"
                  onClick={() => onSelect(run.run_id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'relative w-full rounded-lg border border-transparent px-3 py-2.5 text-left text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    active ? 'border-border bg-card shadow-xs' : 'hover:bg-accent/70',
                  )}
                >
                  {active && <span className="absolute top-3 bottom-3 -left-px w-0.5 rounded-full bg-brand" />}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium whitespace-nowrap tabular-nums" title={formatTime(run.started_at)}>
                      {formatAgo(run.started_at, now)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <ScoreChip total={run.score_total} />
                      <StatusBadge status={run.status} label={runStatusLabel(run)} className="px-1.5 py-0 text-[11px]" />
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={run.agent?.model ?? undefined}>
                    <Bot className="size-3.5 shrink-0" />
                    <span className="truncate font-mono">{shortModel(run.agent?.model)}</span>
                    {run.agent?.effort && <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[11px]">{run.agent.effort}</span>}
                    {run.agent?.name && <span className="shrink-0 rounded border px-1.5 py-px font-mono text-[11px]">{run.agent.name}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                    {run.ended_at && (
                      <span className="flex items-center gap-1">
                        <Timer className="size-3.5" /> {formatDuration(run.started_at, run.ended_at)}
                      </span>
                    )}
                    {run.steps != null && (
                      <span className="flex items-center gap-1">
                        <Footprints className="size-3.5" /> {run.steps} steps
                      </span>
                    )}
                    {run.cost_usd != null && (
                      <span className="flex items-center gap-1">
                        <Coins className="size-3.5" /> ${run.cost_usd.toFixed(3)}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
