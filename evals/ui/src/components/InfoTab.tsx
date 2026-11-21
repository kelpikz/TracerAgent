import {
  Activity, ArrowUpRight, CircleAlert, ClipboardCheck, Clock3, Cloud, Database, Info,
  Layers, Server, Timer, Zap, type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Markdown } from '@/components/Markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { AffectedSystem, CaseInfo, NoiseLabel, TelemetrySignal } from '@/lib/types';

const systemIcons: Record<AffectedSystem['kind'], LucideIcon> = {
  service: Server,
  database: Database,
  job: Timer,
  provider: Cloud,
};

const sourceLabels: Record<TelemetrySignal['source'], string> = {
  metric: 'Metric', log: 'Log', trace: 'Trace', event: 'Event', alert: 'Alert', order: 'Order', business: 'Business KPI',
};

const alertTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});

function InfoCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          {title}
        </h2>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function LabelDetails({ label }: { label: NoiseLabel }) {
  return (
    <li className="min-w-0 space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{label.title}</h3>
        <span className="text-xs text-muted-foreground">{label.when}</span>
      </div>
      <dl className="grid gap-4 @xl:grid-cols-[1fr_2fr]">
        {[
          ['Looks like', label.looks_like],
          ['What happens', label.truth],
        ].map(([term, value]) => (
          <div key={term} className="min-w-0 space-y-1">
            <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
            <dd><Markdown>{value}</Markdown></dd>
          </div>
        ))}
      </dl>
      {label.alerts.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <h4 className="text-xs font-medium text-muted-foreground">Alert timeline</h4>
          <ul className="space-y-3 text-sm">
            {label.alerts.map(alert => (
              <li key={`${alert.name}-${alert.fired_at}`} className="space-y-1 wrap-anywhere">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{alert.name}</span>
                  <Badge variant="outline" className="capitalize">{alert.severity}</Badge>
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  <span>Fired <time dateTime={alert.fired_at}>{alertTime.format(new Date(alert.fired_at))}</time></span>
                  {alert.resolved_at ? <span>Resolved <time dateTime={alert.resolved_at}>{alertTime.format(new Date(alert.resolved_at))}</time></span> : <span>Still firing</span>}
                </p>
                <p className="font-mono text-xs text-muted-foreground">{alert.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function InfoTab({ info, labels = [], onOpenDashboard }: {
  info?: CaseInfo;
  labels?: NoiseLabel[];
  onOpenDashboard: (hash: string) => void;
}) {
  return (
    <div className="@container space-y-5">
      {info ? (
        <>
          <div className="grid gap-4 @xl:grid-cols-2">
            <InfoCard title="Failure" icon={CircleAlert}><Markdown>{info.failure}</Markdown></InfoCard>
            <InfoCard title="Trigger" icon={Zap}><Markdown>{info.trigger}</Markdown></InfoCard>
          </div>
          <InfoCard title="Affected systems" icon={Layers}>
            {info.affected.length > 0 ? (
              <ul className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-3">
                {info.affected.map(({ name, kind, impact }, index) => {
                  const Icon = systemIcons[kind];
                  return (
                    <li key={index} className="min-w-0 space-y-2 rounded-lg border bg-muted/30 p-3 wrap-anywhere">
                      <Badge variant="outline" className="capitalize"><Icon aria-hidden="true" />{kind}</Badge>
                      <h3 className="text-sm font-medium">{name}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{impact}</p>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No affected systems.</p>}
          </InfoCard>
          <InfoCard title="Telemetry signals" icon={Activity}>
            {info.signals.length > 0 ? (
              <ul className="divide-y">
                {info.signals.map(({ source, where, what, when, dashboard }, index) => (
                  <li key={index} className="grid gap-3 py-4 first:pt-0 last:pb-0 @2xl:grid-cols-[minmax(0,1fr)_auto] @2xl:items-center">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge variant="secondary">{sourceLabels[source]}</Badge>
                        <span className="min-w-0 font-mono text-sm font-medium wrap-anywhere">{where}</span>
                      </div>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />{when}
                      </p>
                      <Markdown>{what}</Markdown>
                    </div>
                    {dashboard && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="justify-self-start"
                        aria-label={`Open ${where} in dashboard`}
                        onClick={() => onOpenDashboard(dashboard)}
                      >
                        <ArrowUpRight /> Open in dashboard
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No telemetry signals listed.</p>}
          </InfoCard>
        </>
      ) : (
        <EmptyState icon={Info} title="No case info">
          Add an <code>info</code> object to this case's <code>case.json</code>.
        </EmptyState>
      )}
      {(info || labels.length > 0) && (
        <InfoCard title="Ground truth from the data" icon={Database}>
          {labels.length > 0 ? (
            <ul className="space-y-3">{labels.map(label => <LabelDetails key={label.id} label={label} />)}</ul>
          ) : <p className="text-sm text-muted-foreground">There are no noise labels for this case.</p>}
        </InfoCard>
      )}
      {info && (
        <InfoCard title="Expected answer" icon={ClipboardCheck}>
          <dl className="grid gap-4 @3xl:grid-cols-3">
            {[
              ['Root cause', info.expected.root_cause],
              ['Impact', info.expected.impact],
              ['Next steps', info.expected.next_steps],
            ].map(([term, value]) => (
              <div key={term} className="min-w-0 space-y-1 rounded-lg border bg-muted/30 p-3">
                <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
                <dd><Markdown>{value}</Markdown></dd>
              </div>
            ))}
          </dl>
        </InfoCard>
      )}
    </div>
  );
}
