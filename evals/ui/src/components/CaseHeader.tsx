import { AudioWaveform, History, Layers, LoaderCircle, Play, Tag, Timer } from 'lucide-react';
import { RunSettings, type RunSettingsProps } from '@/components/RunSettings';
import { ScoreChip } from '@/components/ScoreChip';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTime } from '@/lib/format';
import type { CaseDetail } from '@/lib/types';

interface CaseHeaderProps {
  detail: CaseDetail | null;
  runId: string | null;
  running: boolean;
  settings: RunSettingsProps;
  onRun: () => void;
  onSelectRun: (runId: string) => void;
}

export function CaseHeaderSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-2/3 max-w-md" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-24 rounded-md" />
        <Skeleton className="h-6 w-28 rounded-md" />
      </div>
    </div>
  );
}

export function CaseHeader({ detail, runId, running, settings, onRun, onSelectRun }: CaseHeaderProps) {
  if (!detail) return <CaseHeaderSkeleton />;
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-80">
          <p className="mb-1 truncate font-mono text-xs text-muted-foreground">{detail.id}</p>
          <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[1.75rem] sm:leading-9">
            {detail.title}
          </h1>
          <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{detail.description}</p>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Select value={runId ?? undefined} onValueChange={onSelectRun} disabled={detail.runs.length === 0}>
            <SelectTrigger className="min-w-52 max-w-full overflow-hidden" aria-label="Run history">
              <History className="size-4 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="No runs yet" />
            </SelectTrigger>
            <SelectContent>
              {detail.runs.map(run => (
                <SelectItem key={run.run_id} value={run.run_id}>
                  <span className="tabular-nums">{formatTime(run.started_at)}</span>
                  <StatusBadge status={run.status} className="px-1.5 py-0 text-[11px]" />
                  <ScoreChip total={run.score_total} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <RunSettings {...settings} disabled={running} />
            <Button onClick={onRun} disabled={running} className="min-w-24">
              {running ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}
              {running ? 'Running' : 'Run'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="gap-1.5 py-1 font-normal">
          <Layers /> Scenario <span className="font-mono font-medium">{detail.scenario}</span>
        </Badge>
        {detail.noise.map(id => (
          <Badge key={id} variant="outline" className="gap-1.5 py-1 font-normal">
            <AudioWaveform /> Noise <span className="font-mono font-medium">{id}</span>
          </Badge>
        ))}
        <Badge variant="outline" className="gap-1.5 py-1 font-normal">
          <Timer /> <span className="tabular-nums">{detail.timeout_s} s</span> limit
        </Badge>
        {detail.tags.map(tag => (
          <Badge key={tag} variant="muted" className="gap-1 py-1 font-normal">
            <Tag /> {tag}
          </Badge>
        ))}
      </div>
    </header>
  );
}
