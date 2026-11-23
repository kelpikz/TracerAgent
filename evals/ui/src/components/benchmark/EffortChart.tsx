import { ChartLine, Table2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Marker, SeriesGlyph, VariantDot } from '@/components/benchmark/Glyphs';
import {
  dashes, formatCost, formatMinutes, formatScore, modelColor, shortModel, variantKey, type VariantStats,
} from '@/lib/benchmark';
import { cn } from '@/lib/utils';

interface Props {
  stats: VariantStats[];
  models: string[];
  architectures: string[];
  efforts: string[];
  domain: [number, number];
}

interface Series {
  key: string;
  label: string;
  color: string;
  shape: number;
  points: Array<VariantStats | undefined>;
}

const HEIGHT = 340;

export function EffortChart({ stats, models, architectures, efforts, domain }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const series: Series[] = models.flatMap((model, modelIndex) => architectures.map((architecture, archIndex) => ({
    key: `${model}|${architecture}`,
    label: `${shortModel(model)} · ${architecture}`,
    color: modelColor(modelIndex),
    shape: archIndex,
    points: efforts.map(effort => stats.find(v => v.key === variantKey(model, architecture, effort))),
  })));
  const drawn = series.filter(s => s.points.some(v => v?.avg != null));
  const waiting = stats.filter(v => v.avg === null).length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
          {models.map((model, index) => (
            <span key={model} className="inline-flex items-center gap-1.5">
              <SeriesGlyph shape={0} color={modelColor(index)} />
              {shortModel(model)}
            </span>
          ))}
          {architectures.length > 1 && (
            <>
              <span className="h-3.5 w-px bg-border" />
              {architectures.map((architecture, index) => (
                <span key={architecture} className="inline-flex items-center gap-1.5">
                  <SeriesGlyph shape={index} color="var(--muted-foreground)" />
                  {architecture}
                </span>
              ))}
            </>
          )}
        </div>
        <div role="radiogroup" aria-label="View" className="inline-flex gap-0.5 rounded-md bg-muted p-[3px]">
          {([['chart', ChartLine, 'Chart'], ['table', Table2, 'Table']] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={view === value}
              onClick={() => setView(value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                view === value && 'bg-card text-foreground shadow-xs',
              )}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {drawn.length === 0 ? (
        <div className="grid h-40 place-items-center rounded-lg border border-dashed text-center text-[13px] text-muted-foreground">
          No full pass yet. A variant shows here after it runs every case once.
        </div>
      ) : view === 'chart' ? (
        <Chart series={drawn} efforts={efforts} domain={domain} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="border-b px-2 py-1.5 text-left font-medium">Series</th>
                {efforts.map(effort => <th key={effort} className="border-b px-2 py-1.5 text-right font-medium">{effort}</th>)}
              </tr>
            </thead>
            <tbody>
              {drawn.map(s => (
                <tr key={s.key}>
                  <td className="border-b px-2 py-1.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2 font-medium"><VariantDot shape={s.shape} color={s.color} />{s.label}</span>
                  </td>
                  {s.points.map((v, index) => (
                    <td key={efforts[index]} className="border-b px-2 py-1.5 text-right whitespace-nowrap">
                      {v?.avg == null ? <span className="text-muted-foreground">—</span> : (
                        <>
                          <b>{v.avg.toFixed(2)}</b>
                          {v.passes.length > 1 && <span className="text-muted-foreground"> ({formatScore(v.lo)}–{formatScore(v.hi)})</span>}
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {drawn.length > 0 && waiting > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {waiting} {waiting === 1 ? 'variant is' : 'variants are'} not in the chart yet. A variant shows after it runs every case once.
        </p>
      )}
    </div>
  );
}

interface Hover {
  series: string;
  x: number;
  y: number;
  v: VariantStats;
}

function Chart({ series, efforts, domain }: { series: Series[]; efforts: string[]; domain: [number, number] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const W = width;
  const H = HEIGHT;
  // On a narrow screen there is no space for end labels. The legend names the series.
  const narrow = W < 560;
  const m = { l: 34, r: narrow ? 16 : 150, t: 10, b: 42 };
  const pw = Math.max(10, W - m.l - m.r);
  const ph = H - m.t - m.b;
  const band = pw / efforts.length;
  // Move the series of one effort a little apart, so their bars do not hide each other.
  const n = series.length;
  const step = n > 1 ? Math.min(12, (band * 0.45) / (n - 1)) : 0;
  const [y0, y1] = domain;
  const xAt = (index: number) => m.l + band * (index + 0.5);
  const yAt = (value: number) => m.t + ph * (1 - (value - y0) / (y1 - y0));
  const tick = y1 - y0 > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let value = y0; value <= y1; value += tick) ticks.push(value);

  const layout = series.map((s, index) => {
    const offset = (index - (n - 1) / 2) * step;
    const points = s.points.flatMap((v, effort) => (v?.avg == null ? [] : [{
      v, x: xAt(effort) + offset, y: yAt(v.avg), lo: yAt(v.lo!), hi: yAt(v.hi!),
    }]));
    return { s, points };
  });
  // Put a label at the end of each line. Push the labels apart so they do not touch.
  const labels = layout.map(({ s, points }) => ({ s, y: points.at(-1)!.y })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + 16);

  const faded = (key: string) => (hover && hover.series !== key ? 0.15 : 1);
  const flip = hover && hover.x + 240 > W;

  return (
    <div ref={box} className="relative" style={{ height: H }}>
      {W > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block overflow-visible">
          <g>
            {ticks.map(value => (
              <g key={value}>
                <line x1={m.l} x2={m.l + pw + 8} y1={yAt(value)} y2={yAt(value)} stroke="var(--border)" />
                <text x={m.l - 8} y={yAt(value) + 4} textAnchor="end" fontSize={12} fill="var(--muted-foreground)">{value}</text>
              </g>
            ))}
            {efforts.map((effort, index) => (
              <text key={effort} x={xAt(index)} y={H - m.b + 20} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">{effort}</text>
            ))}
            <text x={m.l + pw / 2} y={H - 2} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">Thinking effort</text>
          </g>
          {layout.map(({ s, points }) => (
            <g key={s.key} opacity={faded(s.key)} className="transition-opacity duration-150">
              <polyline
                points={points.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" opacity={0.85}
                strokeDasharray={dashes[s.shape % dashes.length] || undefined}
              />
              {points.map(p => (
                <g key={p.v.key} stroke={s.color} strokeWidth={2} strokeLinecap="round" opacity={0.5}>
                  <line x1={p.x} x2={p.x} y1={p.lo} y2={p.hi} />
                  <line x1={p.x - 4} x2={p.x + 4} y1={p.lo} y2={p.lo} />
                  <line x1={p.x - 4} x2={p.x + 4} y1={p.hi} y2={p.hi} />
                </g>
              ))}
              {points.map(p => <Marker key={p.v.key} shape={s.shape} x={p.x} y={p.y} color={s.color} />)}
              {points.map(p => {
                const top = Math.min(p.hi, p.y - 10);
                return (
                  <rect
                    key={p.v.key}
                    x={p.x - 7} y={top} width={14} height={Math.max(p.lo, p.y + 10) - top} fill="transparent"
                    onPointerEnter={() => setHover({ series: s.key, x: p.x, y: p.y, v: p.v })}
                    onPointerLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
          ))}
          {!narrow && labels.map(({ s, y }) => (
            <g key={s.key} opacity={faded(s.key)} className="transition-opacity duration-150">
              <Marker shape={s.shape} x={m.l + pw + 16} y={y} size={4} color={s.color} />
              <text x={m.l + pw + 25} y={y + 4.5} fontSize={12.5} fontWeight={600} fill="var(--foreground)">{s.label}</text>
            </g>
          ))}
        </svg>
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-2.5 py-2 text-xs leading-relaxed whitespace-nowrap text-popover-foreground shadow-lg"
          style={{
            left: flip ? hover.x - 14 : hover.x + 14,
            top: Math.max(0, Math.min(H - 100, hover.y - 44)),
            transform: flip ? 'translateX(-100%)' : undefined,
          }}
        >
          <div className="font-semibold">{hover.v.label}</div>
          <div>Average <b className="tabular-nums">{formatScore(hover.v.avg, 2)}</b><span className="text-muted-foreground"> / 10</span></div>
          <div><span className="text-muted-foreground">Passes</span> <span className="tabular-nums">{hover.v.passes.map(p => p.toFixed(1)).join(', ')}</span></div>
          <div>
            <span className="text-muted-foreground">Time/run</span> {formatMinutes(hover.v.minutes)}
            {' · '}<span className="text-muted-foreground">Cost/run</span> {formatCost(hover.v.cost)}
          </div>
          {hover.v.failed > 0 && <div className="text-warning">{hover.v.failed} of {hover.v.total} runs failed</div>}
        </div>
      )}
    </div>
  );
}
