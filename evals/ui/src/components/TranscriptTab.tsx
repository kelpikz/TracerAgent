import { ArrowRight, Bot, ChevronRight, Clock, Flag, LayoutDashboard, LoaderCircle, MessagesSquare, Server, Users, Wrench, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CodeBlock } from '@/components/CodeBlock';
import { CopyButton } from '@/components/CopyButton';
import { EmptyState } from '@/components/EmptyState';
import { ErrorAlert } from '@/components/ErrorAlert';
import { Markdown } from '@/components/Markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatMs, serviceOf } from '@/lib/format';
import type { Run, Step } from '@/lib/types';
import { cn } from '@/lib/utils';

function Node({ icon: Icon, tone = 'muted', children }: { icon: LucideIcon; tone?: 'muted' | 'brand' | 'success'; children: ReactNode }) {
  return (
    <li className="relative pb-6 pl-12 last:pb-0">
      <span
        className={cn(
          'absolute top-0 left-0 grid size-8 place-items-center rounded-full border bg-card shadow-xs',
          tone === 'brand' && 'border-brand/30 bg-brand/10 text-brand',
          tone === 'success' && 'border-success/30 bg-success/10 text-success',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
      {children}
    </li>
  );
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{children}</p>;
}

interface DashboardRef {
  kind: 'trace' | 'order';
  id: string;
}

const MAX_REFS = 6;

/** Find trace and order IDs: top level of the args and result, and the objects in the first-level arrays. */
function dashboardRefs(step: Step): DashboardRef[] {
  const result = step.result;
  const objects: unknown[] = [step.args, result];
  if (Array.isArray(result)) objects.push(...result);
  else if (result && typeof result === 'object') {
    for (const value of Object.values(result)) if (Array.isArray(value)) objects.push(...value);
  }
  const refs = new Map<string, DashboardRef>();
  for (const object of objects) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) continue;
    for (const [field, kind] of [['trace_id', 'trace'], ['order_id', 'order']] as const) {
      const id = (object as Record<string, unknown>)[field];
      if (typeof id === 'string' && id && !refs.has(`${kind}/${id}`)) refs.set(`${kind}/${id}`, { kind, id });
    }
  }
  return [...refs.values()];
}

function DashboardLinks({ refs, onOpen }: { refs: DashboardRef[]; onOpen: (hash: string) => void }) {
  if (refs.length === 0) return null;
  return (
    <div className="min-w-0">
      <Label>View in dashboard</Label>
      <div className="flex flex-wrap gap-1.5">
        {refs.slice(0, MAX_REFS).map(ref => (
          <Button
            key={`${ref.kind}/${ref.id}`}
            variant="outline"
            size="sm"
            className="h-7 font-mono text-xs"
            onClick={() => onOpen(`#${ref.kind === 'trace' ? 'traces' : 'orders'}/${ref.id}`)}
          >
            <LayoutDashboard /> {ref.kind === 'trace' ? 'Trace' : 'Order'} {ref.id}
          </Button>
        ))}
        {refs.length > MAX_REFS && <span className="self-center text-xs text-muted-foreground">+{refs.length - MAX_REFS} more</span>}
      </div>
    </div>
  );
}

// One color for each agent of the multi architecture. Other names use the neutral style.
const AGENT_COLORS: Record<string, string> = {
  orchestrator: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  observability: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  dependency: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  reasoning: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  critic: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  reporting: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

/** Tools that start a subagent, and the agent they start. */
const AGENT_TOOLS: Record<string, string> = {
  ask_observability: 'observability',
  ask_dependency: 'dependency',
  ask_reasoning: 'reasoning',
  ask_critic: 'critic',
  write_report: 'reporting',
};

function AgentBadge({ name, className }: { name: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1 font-mono font-normal capitalize', AGENT_COLORS[name], className)}>
      {name}
    </Badge>
  );
}

function ToolCall({ step, index, onOpenDashboard }: { step: Step; index: number; onOpenDashboard: (hash: string) => void }) {
  const service = serviceOf(step);
  const hasResult = 'result' in step;
  const refs = dashboardRefs(step);
  return (
    <Collapsible asChild>
      <Card className="min-w-0 gap-0 overflow-hidden">
        <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-4 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/60">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="font-mono text-sm font-semibold [overflow-wrap:anywhere]">{step.tool ?? 'tool'}</span>
          {step.tool && AGENT_TOOLS[step.tool] && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <ArrowRight className="size-3.5" /> <AgentBadge name={AGENT_TOOLS[step.tool]} />
            </span>
          )}
          {service && (
            <Badge variant="outline" className="gap-1 font-mono font-normal">
              <Server /> {service}
            </Badge>
          )}
          {step.error && (
            <Badge variant="destructive">Failed</Badge>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            {typeof step.duration_ms === 'number' && (
              <span className="flex items-center gap-1 tabular-nums">
                <Clock className="size-3.5" /> {formatMs(step.duration_ms)}
              </span>
            )}
            <span className="hidden font-mono tabular-nums sm:inline">#{index}</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4 border-t bg-muted/30 px-4 py-4">
            <div className="min-w-0">
              <Label>Arguments</Label>
              <CodeBlock code={json(step.args ?? {})} lang="json" numbers={false} maxHeight="18rem" className="bg-card" />
            </div>
            {hasResult && (
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Result</p>
                  <CopyButton text={typeof step.result === 'string' ? step.result : json(step.result)} />
                </div>
                {typeof step.result === 'string' ? (
                  <div className="max-h-96 overflow-y-auto rounded-md border bg-card px-4 py-3">
                    <Markdown>{step.result}</Markdown>
                  </div>
                ) : (
                  <CodeBlock code={json(step.result)} lang="json" numbers={false} maxHeight="24rem" className="bg-card" />
                )}
              </div>
            )}
            <DashboardLinks refs={refs} onOpen={onOpenDashboard} />
            {step.error && <ErrorAlert error={step.error} title="Tool error" />}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function TranscriptTab({ run, onOpenDashboard }: { run: Run | null; onOpenDashboard: (hash: string) => void }) {
  const transcript = run?.transcript;
  if (!transcript) {
    return run?.status === 'running' ? (
      <EmptyState icon={LoaderCircle} title="The agent is working">
        The transcript shows here when the agent is done.
      </EmptyState>
    ) : (
      <EmptyState icon={MessagesSquare} title="No transcript">
        {run ? 'This run has no transcript.' : 'Run the case to see what the agent did.'}
      </EmptyState>
    );
  }

  // In a multi-agent run, the first step is the root agent. Steps of other agents are a subagent's work.
  const rootAgent = transcript.steps.find(step => step.agent)?.agent;
  const groups: Array<{ agent: string | null; steps: Array<{ step: Step; index: number }> }> = [];
  transcript.steps.forEach((step, index) => {
    const agent = step.agent && step.agent !== rootAgent ? step.agent : null;
    const last = groups.at(-1);
    if (last && last.agent === agent) last.steps.push({ step, index });
    else groups.push({ agent, steps: [{ step, index }] });
  });

  let toolIndex = 0;
  const renderStep = (step: Step, index: number) => {
    if (step.type === 'tool_call') {
      toolIndex += 1;
      return (
        <Node key={step.id ?? index} icon={Wrench}>
          <ToolCall step={step} index={toolIndex} onOpenDashboard={onOpenDashboard} />
        </Node>
      );
    }
    const assistant = (step.role ?? 'assistant') === 'assistant';
    return (
      <Node key={index} icon={Bot} tone={assistant ? 'brand' : 'muted'}>
        <p className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground capitalize">
          {step.role ?? step.type ?? 'Step'}
          {step.agent && <AgentBadge name={step.agent} />}
        </p>
        {step.text ? (
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{step.text}</p>
        ) : (
          <CodeBlock code={json(step)} lang="json" numbers={false} maxHeight="12rem" />
        )}
      </Node>
    );
  };

  return (
    <div className="relative">
      <span className="absolute top-4 bottom-4 left-4 w-px bg-border" aria-hidden="true" />
      <ol className="relative">
        {groups.map((group, g) => group.agent === null
          ? group.steps.map(({ step, index }) => renderStep(step, index))
          : (
            <Node key={`group-${g}`} icon={Users}>
              <section aria-label={`${group.agent} agent`} className={cn('rounded-xl border border-dashed p-3 sm:p-4', AGENT_COLORS[group.agent]?.split(' ').filter(c => c.startsWith('border-')).join(' '))}>
                <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <AgentBadge name={group.agent} />
                  agent · {group.steps.filter(({ step }) => step.type === 'tool_call').length} tool calls
                </p>
                <div className="relative">
                  <span className="absolute top-4 bottom-4 left-4 w-px bg-border" aria-hidden="true" />
                  <ol className="relative">
                    {group.steps.map(({ step, index }) => renderStep(step, index))}
                  </ol>
                </div>
              </section>
            </Node>
          ))}
        <Node icon={Flag} tone="success">
          <Card className="gap-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b bg-success/[0.06] px-5 py-2.5">
              <p className="text-sm font-semibold tracking-tight">Final answer</p>
              <CopyButton text={transcript.final_output} />
            </div>
            <div className="px-5 py-4">
              <Markdown>{transcript.final_output}</Markdown>
            </div>
          </Card>
        </Node>
      </ol>
    </div>
  );
}
