import { Bot, ChevronRight, CircleSlash, Clock, Code2, Flag, Gauge, LoaderCircle, MessageSquareText, Play, Route, Scale, Sparkles, Timer, Trophy, Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CodeBlock } from '@/components/CodeBlock';
import { CopyButton } from '@/components/CopyButton';
import { EmptyState } from '@/components/EmptyState';
import { ErrorAlert } from '@/components/ErrorAlert';
import { Markdown } from '@/components/Markdown';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { average, formatDuration, formatTime, scoreOf, scoreText, scoreTone } from '@/lib/format';
import { judgeLabel } from '@/lib/useJudge';
import type { Grade, GradeItem, GraderKind, Run, ScorePart } from '@/lib/types';
import { cn } from '@/lib/utils';

function ScorePartView({ title, icon: Icon, part }: { title: string; icon: typeof Route; part: ScorePart | undefined }) {
  const hasScore = typeof part?.score === 'number';
  const ratio = hasScore ? (part as ScorePart).score! / (part?.max || 5) : 0;
  const tone = scoreTone(ratio);
  const avg = (value: number | null | undefined) => (typeof value === 'number' ? value.toFixed(2) : '—');
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-3.5 text-muted-foreground" /> {title}
        </span>
        <span className="flex items-baseline gap-1 font-mono tabular-nums">
          <span className={cn('text-sm font-semibold', hasScore && tone.text)}>{scoreOf(part?.score)}</span>
          <span className="text-xs text-muted-foreground">/ {part?.max ?? 5}</span>
        </span>
      </div>
      <Progress value={Math.round(ratio * 100)} indicatorClassName={tone.bar} aria-label={`${title} score`} />
      <p className="text-xs text-muted-foreground tabular-nums">
        Checks {avg(part?.deterministic)} · Judge {avg(part?.llm)}
      </p>
    </div>
  );
}

function ScoreCard({ run }: { run: Run }) {
  const score = run.score;
  const hasTotal = typeof score?.total === 'number';
  const tone = scoreTone(hasTotal ? score!.total! / (score?.max || 10) : 0);
  return (
    <Card className="gap-0 overflow-hidden">
      <div className="grid gap-5 p-5 @xl:grid-cols-[auto_1fr_1fr] @xl:items-center @xl:gap-8">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Trophy className="size-3.5" /> Score
          </p>
          {score ? (
            <p className="flex items-baseline gap-1.5 font-mono tabular-nums">
              <span className={cn('text-4xl font-semibold tracking-tight', hasTotal && tone.text)}>{scoreOf(score.total)}</span>
              <span className="text-base text-muted-foreground">/ {score.max ?? 10}</span>
            </p>
          ) : (
            <p className="text-sm font-medium text-muted-foreground">
              {run.status === 'running' ? 'Waiting for the graders…' : 'No score'}
            </p>
          )}
        </div>
        {score && (
          <>
            <ScorePartView title="Trajectory" icon={Route} part={score.trajectory} />
            <ScorePartView title="Outcome" icon={Flag} part={score.outcome} />
          </>
        )}
      </div>
    </Card>
  );
}

const COLLAPSED_PX = 288;

function AgentAnswer({ run }: { run: Run }) {
  const text = run.transcript?.final_output ?? '';
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const check = () => setLong(el.offsetHeight > COLLAPSED_PX);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  if (!run.transcript) return null;
  const clipped = long && !open;
  return (
    <Card className="gap-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-5 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <MessageSquareText className="size-4 text-muted-foreground" /> Agent answer
        </p>
        {text && <CopyButton text={text} />}
      </div>
      <div className="relative px-5 py-4">
        <div className={cn(clipped && 'overflow-hidden')} style={clipped ? { maxHeight: COLLAPSED_PX } : undefined}>
          <div ref={inner}>
            {text ? <Markdown>{text}</Markdown> : <p className="text-sm text-muted-foreground">The agent gave no answer.</p>}
          </div>
        </div>
        {clipped && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />}
      </div>
      {long && (
        <div className="border-t px-5 py-2">
          <Button variant="ghost" size="sm" className="-ml-2 h-7 text-xs" onClick={() => setOpen(value => !value)}>
            {open ? 'Show less' : 'Show more'}
          </Button>
        </div>
      )}
    </Card>
  );
}

function RawReply({ text }: { text: string }) {
  const isJson = (() => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  })();
  return (
    <Collapsible className="group/raw rounded-lg border">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]/raw:rotate-90" />
          Raw reply
        </CollapsibleTrigger>
        <CopyButton text={text} />
      </div>
      <CollapsibleContent>
        <CodeBlock code={text} lang={isJson ? 'json' : 'text'} numbers={false} wrap bare maxHeight="20rem" className="border-t bg-code px-1 py-2" />
      </CollapsibleContent>
    </Collapsible>
  );
}

function ItemRow({ item, mono }: { item: GradeItem; mono: boolean }) {
  const hasScore = typeof item.score === 'number';
  const tone = hasScore ? scoreTone(item.score as number) : null;
  const reason = [item.reason, item.error].filter(Boolean).join(' ');
  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <span className={cn('min-w-0 text-sm font-medium [overflow-wrap:anywhere]', mono && 'font-mono text-[13px]')}>
          {item.name}
        </span>
        {hasScore && tone ? (
          <span className={cn('font-mono text-sm font-semibold tabular-nums', tone.text)}>{scoreText(item.score as number)}</span>
        ) : (
          <StatusBadge status="error" />
        )}
      </div>
      {hasScore && tone && (
        <Progress
          value={Math.round((item.score as number) * 100)}
          indicatorClassName={tone.bar}
          className="mt-2"
          aria-label={`Score for ${item.name}`}
        />
      )}
      {reason && <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{reason}</p>}
    </li>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map(i => (
        <div key={i} className="space-y-2">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-8" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

function Note({ icon: Icon, title, children }: { icon: typeof CircleSlash; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/40 p-4 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children && <p className="mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{children}</p>}
      </div>
    </div>
  );
}

function GradeCard({ kind, grade }: { kind: 'deterministic' | 'llm'; grade: Grade }) {
  const llm = kind === 'llm';
  const scores = grade.items.flatMap(item => (typeof item.score === 'number' ? [item.score] : []));
  const avg = average(scores);
  const tone = avg === null ? null : scoreTone(avg);
  const Icon = llm ? Sparkles : Code2;

  let body: ReactNode;
  if (grade.status === 'pending' || grade.status === 'running') {
    body = <SkeletonRows />;
  } else if (grade.status === 'skipped') {
    body = (
      <Note icon={CircleSlash} title="Skipped">
        {grade.reason ?? grade.error?.message ?? 'This grader did not run.'}
      </Note>
    );
  } else if (grade.status === 'missing') {
    body = (
      <Note icon={CircleSlash} title="No grader file">
        {llm ? 'This case has no prompt.md for this grader.' : 'This case has no tests.js for this grader.'}
      </Note>
    );
  } else {
    body = (
      <div className="space-y-4">
        {grade.error && <ErrorAlert error={grade.error} title="Grader error" />}
        {grade.items.length > 0 ? (
          <ul className="divide-y">
            {grade.items.map((item, index) => (
              <ItemRow key={`${item.name}-${index}`} item={item} mono={!llm} />
            ))}
          </ul>
        ) : (
          !grade.error && <Note icon={CircleSlash} title="No items" />
        )}
        {grade.summary && (
          <div className="rounded-lg bg-muted/60 p-3.5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" /> Summary
            </p>
            <p className="text-[13px] leading-relaxed [overflow-wrap:anywhere]">{grade.summary}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="min-w-0 gap-4">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('grid size-8 shrink-0 place-items-center rounded-lg', llm ? 'bg-brand/10 text-brand' : 'bg-muted text-foreground/70')}>
            <Icon className="size-4" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{llm ? 'LLM judge' : 'Deterministic'}</CardTitle>
            <p className="truncate text-xs text-muted-foreground">
              {llm ? (grade.model ? <span className="font-mono">{grade.model}</span> : 'Scored by a model') : 'JavaScript checks'}
            </p>
          </div>
        </div>
        <StatusBadge status={grade.status} />
      </CardHeader>
      {avg !== null && tone && (
        <div className="mx-5 flex items-center justify-between rounded-lg border bg-muted/40 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Gauge className="size-3.5" /> Average score
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className={cn('font-mono text-base font-semibold tabular-nums', tone.text)}>{scoreText(avg)}</span>
            <span className="text-xs text-muted-foreground">of 1 · {scores.length} {scores.length === 1 ? 'item' : 'items'}</span>
          </span>
        </div>
      )}
      <CardContent className="space-y-4">
        {body}
        {llm && grade.raw_output && <RawReply text={grade.raw_output} />}
      </CardContent>
    </Card>
  );
}

function Section({ icon: Icon, title, description, score, children }: { icon: typeof Route; title: string; description: string; score?: ScorePart; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <span className="hidden text-[13px] text-muted-foreground @md:inline">{description}</span>
        {score && (
          <span className="ml-auto font-mono text-sm font-semibold tabular-nums">
            <span className={typeof score.score === 'number' ? scoreTone(score.score / (score.max || 5)).text : 'text-muted-foreground'}>{scoreOf(score.score)}</span>
            <span className="font-normal text-muted-foreground"> / {score.max ?? 5}</span>
          </span>
        )}
      </div>
      <div className="grid gap-4 @3xl:grid-cols-2">{children}</div>
    </section>
  );
}

function Meta({ icon: Icon, label, className, children }: { icon: typeof Clock; label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0 space-y-1 bg-card px-3 py-3 @xl:px-4', className)}>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <div className="text-sm font-medium [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function RunMeta({ run }: { run: Run }) {
  const agent = [run.agent?.name, run.agent?.model].filter(Boolean).join(' · ');
  const agentSettings = run.agent_settings;
  const calls = run.transcript?.steps.filter(step => step.type === 'tool_call').length;
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-border @xl:grid-cols-5">
        <Meta icon={Bot} label="Agent" className="col-span-2 @xl:col-span-1">
          {agentSettings && (
            <div className="font-mono text-[13px]" title={agentSettings.model}>
              {agentSettings.model.split('/').pop()} · {agentSettings.effort}
            </div>
          )}
          {agent && <div className="font-mono text-[13px]">{agent}</div>}
          {!agentSettings && !agent && <span className="text-muted-foreground">Not started</span>}
        </Meta>
        <Meta icon={Scale} label="Judge">
          {run.judge ? <span className="font-mono text-[13px]" title={`${run.judge.model} · ${run.judge.thinking}`}>{judgeLabel(run.judge)}</span> : <span className="text-muted-foreground">—</span>}
        </Meta>
        <Meta icon={Clock} label="Started"><span className="tabular-nums">{formatTime(run.started_at) || '—'}</span></Meta>
        <Meta icon={Timer} label="Duration">
          {run.status === 'running' ? <span className="text-muted-foreground">Running…</span> : <span className="tabular-nums">{formatDuration(run.started_at, run.ended_at) || '—'}</span>}
        </Meta>
        <Meta icon={Wrench} label="Tool calls"><span className="tabular-nums">{calls ?? '—'}</span></Meta>
      </div>
    </Card>
  );
}

export function ResultsTab({ run, loading, hasRuns, onRun, running }: { run: Run | null; loading: boolean; hasRuns: boolean; onRun: () => void; running: boolean }) {
  if (!run) {
    if (loading) {
      return (
        <div className="@container space-y-4">
          <Skeleton className="h-[66px] w-full rounded-xl" />
          <div className="grid gap-4 @3xl:grid-cols-2">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      );
    }
    return (
      <EmptyState
        icon={hasRuns ? Flag : Play}
        title={hasRuns ? 'Select a run' : 'No runs yet'}
        action={
          !hasRuns && (
            <Button size="sm" onClick={onRun} disabled={running}>
              <Play className="fill-current" /> Run
            </Button>
          )
        }
      >
        {hasRuns ? 'Pick a run in the history list.' : 'Click Run to start the first run of this case.'}
      </EmptyState>
    );
  }

  const groups: { kind: GraderKind; title: string; description: string; icon: typeof Route }[] = [
    { kind: 'trajectory', title: 'Trajectory', description: 'How the agent worked.', icon: Route },
    { kind: 'outcome', title: 'Outcome', description: 'What the agent answered.', icon: Flag },
  ];

  return (
    <div className="@container space-y-6">
      {run.status === 'running' && (
        <Alert className="border-info/30 bg-info/[0.06] text-info">
          <LoaderCircle className="animate-spin" />
          <AlertDescription className="text-info">The agent and the graders are working. This page updates by itself.</AlertDescription>
        </Alert>
      )}
      {run.error && <ErrorAlert error={run.error} title="The run failed" />}
      <ScoreCard run={run} />
      <RunMeta run={run} />
      <AgentAnswer run={run} />
      {run.graders &&
        groups.map(({ kind, title, description, icon }) => (
          <Section key={kind} icon={icon} title={title} description={description} score={run.score?.[kind]}>
            <GradeCard kind="deterministic" grade={run.graders![kind].deterministic} />
            <GradeCard kind="llm" grade={run.graders![kind].llm} />
          </Section>
        ))}
    </div>
  );
}
