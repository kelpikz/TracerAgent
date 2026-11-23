import { CircleAlert, Play, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CaseHeatmap } from '@/components/benchmark/CaseHeatmap';
import { EffortChart } from '@/components/benchmark/EffortChart';
import { FailMark } from '@/components/benchmark/Glyphs';
import { Leaderboard } from '@/components/benchmark/Leaderboard';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  benchmarkBadge, formatCost, formatTokens, formatWall, isFailed, minutesLeft, scoreDomain, shortModel, variantStats,
} from '@/lib/benchmark';
import { formatAgo, formatTime } from '@/lib/format';
import type { Benchmark } from '@/lib/types';

interface Props {
  benchmark: Benchmark;
  onAction: (action: 'stop' | 'resume') => Promise<void>;
  onOpenRun: (caseId: string, runId: string) => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function BenchmarkView({ benchmark, onAction, onOpenRun }: Props) {
  const [busy, setBusy] = useState<'stop' | 'resume' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const stats = useMemo(() => variantStats(benchmark), [benchmark]);
  const domain = useMemo(() => scoreDomain(stats), [stats]);
  const { config, cells, status } = benchmark;
  const running = status === 'running';
  const results = cells.map(cell => cell.result).filter(result => result !== null);
  const failed = results.filter(isFailed).length;
  const cost = results.reduce((sum, result) => sum + (result.cost_usd ?? 0), 0);
  const tokens = results.reduce((sum, result) => sum + (result.tokens ?? 0), 0);
  const badge = benchmarkBadge(status);

  const act = async (action: 'stop' | 'resume') => {
    if (action === 'stop' && !window.confirm('Stop the benchmark? The runs in progress stop now. Resume runs them again.')) return;
    setBusy(action);
    setActionError(null);
    try {
      await onAction(action);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{benchmark.name || `Benchmark ${formatTime(benchmark.created_at)}`}</h1>
              <StatusBadge status={badge.status} label={badge.label} />
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-muted-foreground">
              <span>{plural(cells.length, 'run')}</span>
              <span>{plural(stats.length, 'variant')}</span>
              <span>{plural(config.cases.length, 'case')}</span>
              <span>{plural(config.repeats, 'repeat')}</span>
              <span>Judge <span className="font-mono">{shortModel(config.judge.model)}</span> · {config.judge.thinking}</span>
              <span>{config.parallel} in parallel</span>
              <span>{benchmark.ended_at ? `Ended ${formatAgo(benchmark.ended_at)}` : `Started ${formatAgo(benchmark.created_at)}`}</span>
              {cost > 0 && <span>Cost {formatCost(cost)}</span>}
              {tokens > 0 && <span>Tokens {formatTokens(tokens)}</span>}
              {failed > 0 && <span className="inline-flex items-center gap-1.5 text-foreground"><FailMark />{plural(failed, 'run')} failed</span>}
            </div>
          </div>
          {running ? (
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void act('stop')}>
              <Square /> {busy === 'stop' ? 'Stopping…' : 'Stop'}
            </Button>
          ) : results.length < cells.length && (
            <Button size="sm" disabled={busy !== null} onClick={() => void act('resume')}>
              <Play /> {busy === 'resume' ? 'Starting…' : 'Resume'}
            </Button>
          )}
        </div>

        {results.length < cells.length && (
          <div className="max-w-xl space-y-1.5">
            <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
              <span>{results.length} of {cells.length} runs finished</span>
              {running && <span>{formatWall(minutesLeft(benchmark))} left</span>}
            </div>
            <Progress value={(results.length / cells.length) * 100} indicatorClassName={running ? 'bg-info' : 'bg-muted-foreground'} />
          </div>
        )}

        {(benchmark.error || actionError) && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{actionError ?? benchmark.error}</AlertDescription>
          </Alert>
        )}
      </div>

      <section>
        <h2 className="text-sm font-semibold">Score by effort</h2>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          A dot is the average over all cases. A bar is the lowest to the highest of the {plural(config.repeats, 'pass', 'passes')}.
          One pass is one run of every case.{running && ' Only full passes show while the benchmark runs.'}
        </p>
        <EffortChart stats={stats} models={config.models} architectures={config.architectures} efforts={config.efforts} domain={domain} />
      </section>

      <section>
        <h2 className="text-sm font-semibold">Leaderboard</h2>
        <p className="mb-3 text-[12.5px] text-muted-foreground">Variants from best to worst average score. Failed runs are not in the averages.</p>
        <Leaderboard stats={stats} domain={domain} />
      </section>

      <section>
        <h2 className="text-sm font-semibold">Cases</h2>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          Average score of the runs for each case. Click a cell to see its runs.
        </p>
        <CaseHeatmap config={config} stats={stats} running={running} onOpenRun={onOpenRun} />
      </section>
    </div>
  );
}
