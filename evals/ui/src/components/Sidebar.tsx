import { Activity, Monitor, Moon, Search, SearchX, Sun } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ScoreChip } from '@/components/ScoreChip';
import { StatusBadge } from '@/components/StatusBadge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme, type Theme } from '@/lib/theme';
import type { CaseSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm ring-1 ring-black/10 ring-inset',
        className,
      )}
      aria-hidden="true"
    >
      <Activity className="size-[18px]" strokeWidth={2.4} />
    </div>
  );
}

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-[3px]">
      {themes.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40',
            theme === value && 'bg-card text-foreground shadow-xs',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

interface SidebarProps {
  cases: CaseSummary[] | null;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SidebarContent({ cases, error, selectedId, onSelect }: SidebarProps) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!cases || !q) return cases;
    return cases.filter(c => [c.title, c.id, ...c.tags].some(text => text.toLowerCase().includes(q)));
  }, [cases, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <Logo />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight">TracerAgent Evals</div>
          <div className="text-xs text-muted-foreground">Agent test cases</div>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search cases"
            aria-label="Search cases"
            className="h-8 bg-background pl-8 text-[13px]"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-5 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        <span>Cases</span>
        {cases && <span className="tabular-nums">{cases.length}</span>}
      </div>

      <nav aria-label="Cases" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {error && <p className="px-3 py-2 text-[13px] text-destructive">{error}</p>}
        {!cases && !error && (
          <div className="space-y-1">
            {[0, 1, 2].map(i => (
              <div key={i} className="space-y-2 rounded-lg px-3 py-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        )}
        {visible && visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center text-[13px] text-muted-foreground">
            <SearchX className="size-5" />
            {cases?.length ? 'No cases match.' : 'No cases yet.'}
          </div>
        )}
        <ul className="space-y-0.5">
          {visible?.map(testCase => {
            const active = testCase.id === selectedId;
            return (
              <li key={testCase.id}>
                <button
                  type="button"
                  onClick={() => onSelect(testCase.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                    active ? 'border-border bg-card shadow-xs' : 'hover:bg-accent/70',
                  )}
                >
                  {active && <span className="absolute top-3 bottom-3 -left-px w-0.5 rounded-full bg-brand" />}
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-[13.5px] leading-snug font-medium">{testCase.title}</span>
                    <span className="mt-px flex shrink-0 items-center gap-1.5">
                      <ScoreChip total={testCase.last_run?.score_total} />
                      <StatusBadge status={testCase.last_run?.status ?? 'none'} className="px-1.5 py-0 text-[11px]" />
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{testCase.id}</div>
                  {testCase.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {testCase.tags.map(tag => (
                        <span key={tag} className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex items-center justify-between border-t px-4 py-3">
        <span className="text-xs text-muted-foreground">Theme</span>
        <ThemeToggle />
      </div>
    </div>
  );
}
