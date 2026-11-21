import { ExternalLink, Layers, PanelRight } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import type { DashboardLink } from '@/lib/types';
import { cn } from '@/lib/utils';

export function dashboardUrl(scenario: string, noise: string[], hash = '') {
  const params = new URLSearchParams({ scenario });
  const query = noise.length ? `${params}&noise=${noise.map(encodeURIComponent).join(',')}` : String(params);
  return `/dashboard/index.html?${query}${hash}`;
}

interface DashboardTabProps {
  scenario: string;
  noise: string[];
  link: DashboardLink | null;
  split: boolean;
  onSplit: (split: boolean) => void;
}

export function DashboardTab({ scenario, noise, link, split, onSplit }: DashboardTabProps) {
  const { resolved } = useTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const url = dashboardUrl(scenario, noise, link?.hash);

  // The frame is on the same origin, so the page can set its theme.
  const syncTheme = useCallback(() => {
    try {
      const root = frame.current?.contentDocument?.documentElement;
      if (root) root.dataset.theme = resolved;
    } catch {
      // The frame is not readable. Do nothing.
    }
  }, [resolved]);

  useEffect(syncTheme, [syncTheme]);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Layers className="size-4 shrink-0" />
          <span className="truncate">
            Scenario: <span className="font-mono font-medium text-foreground">{scenario}</span>
            {' · '}Noise: <span className="font-mono font-medium text-foreground">{noise.length ? noise.join(', ') : 'none'}</span>
          </span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={split ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={split}
            onClick={() => onSplit(!split)}
            className="hidden min-[1400px]:inline-flex"
          >
            <PanelRight /> Split view
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> Open in new tab
            </a>
          </Button>
        </div>
      </div>
      <iframe
        // A new key loads the page again, so a deep link always works.
        key={`${scenario}|${noise.join(',')}|${link?.nonce ?? 0}`}
        ref={frame}
        src={url}
        title="Telemetry dashboard"
        onLoad={syncTheme}
        className={cn('block w-full border-0 bg-background', 'h-[calc(100dvh-8rem)] min-h-[32rem]')}
      />
    </div>
  );
}
