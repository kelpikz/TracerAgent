import { Fragment, useState } from 'react';
import { FailMark, VariantDot } from '@/components/benchmark/Glyphs';
import { cellState, isFailed, mean, modelColor, shortModel, variantKey, type VariantStats } from '@/lib/benchmark';
import type { BenchmarkConfig } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CellDetail } from './CellDetail';

/** Fill strength for a score: low scores are pale, high scores are strong. */
// The fill stops at 70%, so the normal text color stays readable on every model color.
const strength = (score: number) => Math.min(70, Math.max(6, 6 + ((score - 1.5) / 8) * 64));
const fill = (color: string, score: number) => `color-mix(in oklab, ${color} ${Math.round(strength(score))}%, var(--background))`;
const ink = () => 'var(--foreground)';

interface Props {
  config: BenchmarkConfig;
  stats: VariantStats[];
  running: boolean;
  onOpenRun: (caseId: string, runId: string) => void;
}

export function CaseHeatmap({ config, stats, running, onOpenRun }: Props) {
  const [modelIndex, setModelIndex] = useState(0);
  const [selected, setSelected] = useState<{ arch: string; effort: string; caseId: string } | null>(null);
  const model = config.models[Math.min(modelIndex, config.models.length - 1)];
  const color = modelColor(config.models.indexOf(model));
  const statOf = (arch: string, effort: string) => stats.find(v => v.key === variantKey(model, arch, effort))!;
  const runsOf = (v: VariantStats, caseId: string) => v.cells.filter(cell => cell.case_id === caseId);
  const selectedStat = selected && statOf(selected.arch, selected.effort);

  const renderCell = (v: VariantStats, caseId: string) => {
    const runs = runsOf(v, caseId);
    const results = runs.map(cell => cell.result).filter(result => result !== null);
    const score = mean(results.filter(result => !isFailed(result)).map(result => result.total));
    const failed = results.filter(isFailed).length;
    const busy = runs.some(cell => cellState(cell, running) === 'running');
    const active = selected?.arch === v.architecture && selected.effort === v.effort && selected.caseId === caseId;
    const title = `${caseId} · ${v.architecture} · ${v.effort}: ${score === null ? 'no score yet' : score.toFixed(1)}`
      + `${failed ? `, ${failed} failed` : ''}`;
    return (
      <button
        type="button"
        title={title}
        aria-pressed={active}
        onClick={() => setSelected({ arch: v.architecture, effort: v.effort, caseId })}
        className={cn(
          'relative grid h-7 w-[46px] place-items-center rounded font-semibold tabular-nums outline-2 outline-offset-1 outline-transparent hover:outline-foreground/40 focus-visible:outline-ring',
          score === null && 'bg-muted/70 text-muted-foreground',
          active && 'outline-foreground hover:outline-foreground',
        )}
        style={score === null ? undefined : { background: fill(color, score), color: ink() }}
      >
        {score !== null ? score.toFixed(1) : busy ? <span className="size-1.5 animate-pulse rounded-full bg-info" /> : failed ? '—' : ''}
        {failed > 0 && <FailMark className="absolute -top-1 -right-1 ring-2 ring-background" />}
      </button>
    );
  };

  return (
    <div>
      {config.models.length > 1 && (
        <div role="radiogroup" aria-label="Model" className="mb-2.5 inline-flex flex-wrap gap-0.5 rounded-md bg-muted p-[3px]">
          {config.models.map((item, index) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={item === model}
              onClick={() => setModelIndex(index)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12.5px] text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                item === model && 'bg-card text-foreground shadow-xs',
              )}
            >
              <span className="size-2 rounded-full" style={{ background: modelColor(index) }} />
              {shortModel(item)}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto pt-1">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th />
              {config.architectures.map((arch, index) => (
                <Fragment key={arch}>
                  {index > 0 && <th className="w-1.5" />}
                  <th colSpan={config.efforts.length} className="border-b pb-1 text-xs font-medium">
                    <span className="inline-flex items-center gap-1.5"><VariantDot shape={index} color={color} />{arch}</span>
                  </th>
                </Fragment>
              ))}
            </tr>
            <tr>
              <th />
              {config.architectures.map((arch, index) => (
                <Fragment key={arch}>
                  {index > 0 && <th />}
                  {config.efforts.map(effort => <th key={effort} className="py-0.5 text-[11.5px] font-medium text-muted-foreground">{effort}</th>)}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.cases.map(caseId => (
              <tr key={caseId}>
                <td title={caseId} className="max-w-44 min-w-30 truncate pr-2 font-mono text-[11.5px]">{caseId}</td>
                {config.architectures.map((arch, index) => (
                  <Fragment key={arch}>
                    {index > 0 && <td />}
                    {config.efforts.map(effort => <td key={effort}>{renderCell(statOf(arch, effort), caseId)}</td>)}
                  </Fragment>
                ))}
              </tr>
            ))}
            <tr>
              <td className="pt-1 pr-2 text-xs font-semibold">All cases</td>
              {config.architectures.map((arch, index) => (
                <Fragment key={arch}>
                  {index > 0 && <td />}
                  {config.efforts.map(effort => {
                    const v = statOf(arch, effort);
                    return (
                      <td key={effort} className="pt-1">
                        <span
                          title={`All cases · ${arch} · ${effort}: ${v.avg === null ? 'no full pass yet' : v.avg.toFixed(1)}`}
                          className={cn('grid h-7 w-[46px] place-items-center rounded font-semibold tabular-nums', v.avg === null && 'bg-muted/70 text-muted-foreground')}
                          style={v.avg === null ? undefined : { background: fill(color, v.avg), color: ink() }}
                        >
                          {v.avg === null ? '' : v.avg.toFixed(1)}
                        </span>
                      </td>
                    );
                  })}
                </Fragment>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
        <span>2</span>
        <span className="h-2 w-30 rounded" style={{ background: `linear-gradient(90deg, ${fill(color, 2)}, ${fill(color, 9.5)})` }} />
        <span>10</span>
        <span className="ml-3 inline-flex items-center gap-1.5"><FailMark /> a run failed</span>
        <span className="ml-3 inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-info" /> running</span>
      </div>

      {selected && selectedStat ? (
        <CellDetail
          stat={selectedStat}
          caseId={selected.caseId}
          other={config.architectures.length > 1
            ? statOf(config.architectures.find(arch => arch !== selected.arch)!, selected.effort)
            : null}
          running={running}
          onOpenRun={onOpenRun}
        />
      ) : (
        <p className="mt-4 text-[13px] text-muted-foreground">Click a cell to see its runs.</p>
      )}
    </div>
  );
}

