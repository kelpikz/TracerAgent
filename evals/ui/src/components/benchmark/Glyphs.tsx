import { dashes } from '@/lib/benchmark';
import { cn } from '@/lib/utils';

interface MarkerProps {
  /** The architecture index sets the shape: circle, square, diamond, triangle. */
  shape: number;
  x: number;
  y: number;
  size?: number;
  color: string;
  stroke?: string;
}

/** A point marker inside an SVG. */
export function Marker({ shape, x, y, size = 5, color, stroke = 'var(--background)' }: MarkerProps) {
  const common = { fill: color, stroke, strokeWidth: stroke === 'none' ? 0 : 2 };
  switch (shape % 4) {
    case 1:
      return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} rx={1.5} {...common} />;
    case 2: {
      const r = size * 1.3;
      return <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`} {...common} />;
    }
    case 3: {
      const r = size * 1.25;
      return <polygon points={`${x},${y - r} ${x + r},${y + r * 0.8} ${x - r},${y + r * 0.8}`} {...common} />;
    }
    default:
      return <circle cx={x} cy={y} r={size} {...common} />;
  }
}

/** The marker alone, for a table row or a legend. */
export function VariantDot({ shape, color, size = 12 }: { shape: number; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" className="shrink-0 overflow-visible" aria-hidden="true">
      <Marker shape={shape} x={6} y={6} size={4.5} color={color} stroke="none" />
    </svg>
  );
}

/** A line with a marker, for the chart legend. */
export function SeriesGlyph({ shape, color, width = 26 }: { shape: number; color: string; width?: number }) {
  return (
    <svg width={width} height={12} viewBox={`0 0 ${width} 12`} className="shrink-0 overflow-visible" aria-hidden="true">
      <line x1={0} y1={6} x2={width} y2={6} stroke={color} strokeWidth={2} strokeDasharray={dashes[shape % dashes.length] || undefined} />
      <Marker shape={shape} x={width / 2} y={6} size={4.5} color={color} stroke="none" />
    </svg>
  );
}

/** A small "!" that marks a failed run. */
export function FailMark({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn('inline-grid size-[13px] shrink-0 place-items-center rounded-full bg-warning text-[9.5px] font-bold text-background', className)}
    >
      !
    </span>
  );
}
