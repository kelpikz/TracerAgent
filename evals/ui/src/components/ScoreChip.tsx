import { scoreOf, scoreTone } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A small score such as "7.3". Shows nothing when the run has no score. */
export function ScoreChip({ total, className }: { total: number | null | undefined; className?: string }) {
  if (typeof total !== 'number') return null;
  return (
    <span
      title={`Score ${scoreOf(total)} of 10`}
      className={cn('font-mono text-[11px] font-semibold tabular-nums', scoreTone(total / 10).text, className)}
    >
      {scoreOf(total)}
      <span className="font-normal text-muted-foreground">/10</span>
    </span>
  );
}
