import { useState } from 'react';
import { Marker, VariantDot } from '@/components/benchmark/Glyphs';
import { formatCost, formatMinutes, formatScore, type VariantStats } from '@/lib/benchmark';
import { cn } from '@/lib/utils';

const TOP = 8;

/** A small bar from the lowest to the highest pass, with the average as a dot. */
function RangeBar({ v, domain: [lo, hi] }: { v: VariantStats; domain: [number, number] }) {
  const x = (value: number) => 4 + ((value - lo) / (hi - lo)) * 72;
  return (
    <svg width={80} height={12} viewBox="0 0 80 12" className="shrink-0 overflow-visible" aria-hidden="true">
      <line x1={4} x2={76} y1={6} y2={6} stroke="var(--border)" strokeWidth={2} strokeLinecap="round" />
      <line x1={x(v.lo!)} x2={x(v.hi!)} y1={6} y2={6} stroke={v.color} strokeWidth={4} strokeLinecap="round" opacity={0.55} />
      <Marker shape={v.archIndex} x={x(v.avg!)} y={6} size={4} color={v.color} stroke="none" />
    </svg>
  );
}

export function Leaderboard({ stats, domain }: { stats: VariantStats[]; domain: [number, number] }) {
  const [all, setAll] = useState(false);
  const ranked = stats.filter(v => v.avg !== null).sort((a, b) => b.avg! - a.avg!);
  const waiting = stats.length - ranked.length;
  const rows = all ? ranked : ranked.slice(0, TOP);
  const cell = 'border-b px-2 py-1.5 text-right whitespace-nowrap';

  if (!ranked.length) {
    return <p className="text-[13px] text-muted-foreground">No variant has a full pass yet.</p>;
  }
  return (
    <div>
      <div className={cn('overflow-x-auto', all && 'max-h-80 overflow-y-auto')}>
        <table className="w-full text-[12.5px] tabular-nums">
          <thead className="sticky top-0 bg-background">
            <tr className="text-xs text-muted-foreground">
              <th className={cn(cell, 'w-6 text-left font-medium')} />
              <th className={cn(cell, 'text-left font-medium')}>Variant</th>
              <th className={cn(cell, 'text-left font-medium')}>Score / 10</th>
              <th className={cn(cell, 'font-medium')}>Outcome / 5</th>
              <th className={cn(cell, 'font-medium')}>Trajectory / 5</th>
              <th className={cn(cell, 'font-medium')}>Time/run</th>
              <th className={cn(cell, 'font-medium')}>Cost/run</th>
              <th className={cn(cell, 'font-medium')}>Failed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v, index) => (
              <tr key={v.key}>
                <td className={cn(cell, 'text-left text-muted-foreground')}>{index + 1}</td>
                <td className={cn(cell, 'text-left')}>
                  <span className="inline-flex items-center gap-2 font-medium"><VariantDot shape={v.archIndex} color={v.color} />{v.label}</span>
                </td>
                <td className={cn(cell, 'text-left')}>
                  <span className="inline-flex items-center gap-2 font-semibold"><RangeBar v={v} domain={domain} />{formatScore(v.avg, 2)}</span>
                </td>
                <td className={cell}>{formatScore(v.outcome, 2)}</td>
                <td className={cell}>{formatScore(v.trajectory, 2)}</td>
                <td className={cell}>{formatMinutes(v.minutes)}</td>
                <td className={cell}>{formatCost(v.cost)}</td>
                <td className={cn(cell, !v.failed && 'text-muted-foreground')}>{v.failed ? `${v.failed} of ${v.total}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
        {ranked.length > TOP && (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setAll(!all)}>
            {all ? `Show top ${TOP}` : `Show all ${ranked.length}`}
          </button>
        )}
        {waiting > 0 && <span>{waiting} more {waiting === 1 ? 'variant has' : 'variants have'} no full pass yet.</span>}
      </div>
    </div>
  );
}
