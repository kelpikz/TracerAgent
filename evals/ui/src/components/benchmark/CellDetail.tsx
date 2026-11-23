import { LoaderCircle } from 'lucide-react';
import { FailMark, VariantDot } from '@/components/benchmark/Glyphs';
import {
  cellState, formatCost, formatMinutes, formatScore, isFailed, mean, rubricAverages, type VariantStats,
} from '@/lib/benchmark';

interface Props {
  stat: VariantStats;
  caseId: string;
  /** The other architecture at the same model and effort, for the rubric comparison. */
  other: VariantStats | null;
  running: boolean;
  onOpenRun: (caseId: string, runId: string) => void;
}

function Meter({ value, color }: { value: number | null; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full" style={{ width: `${(value ?? 0) * 100}%`, background: color }} />
      </span>
      <span className="tabular-nums">{formatScore(value, 2)}</span>
    </span>
  );
}

const waiting: Record<string, string> = { pending: 'Waiting to start.', running: 'Running.', stopped: 'Stopped before it finished.' };

export function CellDetail({ stat, caseId, other, running, onOpenRun }: Props) {
  const runs = stat.cells.filter(cell => cell.case_id === caseId).sort((a, b) => a.repeat - b.repeat);
  const ok = runs.map(cell => cell.result).filter(result => result !== null && !isFailed(result));
  const otherRuns = other?.cells.filter(cell => cell.case_id === caseId) ?? [];
  const mine = rubricAverages(runs);
  const theirs = rubricAverages(otherRuns);
  const items = [...new Set([...mine.keys(), ...theirs.keys()])];
  const cell = 'border-b px-2 py-1.5 text-right whitespace-nowrap';
  const head = `${cell} text-xs font-medium text-muted-foreground`;

  return (
    <div className="mt-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-semibold"><span className="font-mono">{caseId}</span> · {stat.label}</span>
        <span className="text-[13px] text-muted-foreground">
          Average <b className="text-lg text-foreground tabular-nums">{formatScore(mean(ok.map(result => result!.total)))}</b> / 10
        </span>
      </div>

      <h4 className="mt-3.5 mb-1 text-xs font-semibold text-muted-foreground">Runs</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] tabular-nums">
          <thead>
            <tr>
              <th className={`${head} text-left`}>Run</th>
              <th className={head}>Score</th>
              <th className={head}>Outcome</th>
              <th className={head}>Trajectory</th>
              <th className={head}>Time</th>
              <th className={head}>Cost</th>
              <th className={head}>Steps</th>
              <th className={head} />
            </tr>
          </thead>
          <tbody>
            {runs.map(run => {
              const state = cellState(run, running);
              const result = run.result;
              const open = run.run_id && (
                <button type="button" className="underline underline-offset-2 hover:text-brand" onClick={() => onOpenRun(caseId, run.run_id!)}>
                  Open run
                </button>
              );
              return (
                <tr key={run.repeat}>
                  <td className={`${cell} text-left`}>{run.repeat + 1}</td>
                  {state === 'done' && result ? (
                    <>
                      <td className={cell}><b>{formatScore(result.total)}</b></td>
                      <td className={cell}>{formatScore(result.outcome)}</td>
                      <td className={cell}>{formatScore(result.trajectory)}</td>
                      <td className={cell}>{formatMinutes(result.duration_s === null ? null : result.duration_s / 60)}</td>
                      <td className={cell}>{formatCost(result.cost_usd)}</td>
                      <td className={cell}>{result.steps ?? '—'}</td>
                    </>
                  ) : (
                    <td colSpan={6} className={`${cell} max-w-0 truncate text-left text-muted-foreground`} title={result?.error ?? undefined}>
                      {state === 'failed' ? (
                        <span className="inline-flex items-center gap-1.5"><FailMark />Failed. {result?.error ?? 'The run has no score.'}</span>
                      ) : state === 'running' ? (
                        <span className="inline-flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" />{waiting[state]}</span>
                      ) : waiting[state]}
                    </td>
                  )}
                  <td className={cell}>{open}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {items.length > 0 && (
        <>
          <h4 className="mt-3.5 mb-1 text-xs font-semibold text-muted-foreground">Outcome rubric · average of the runs</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr>
                  <th className={`${head} text-left`}>Item</th>
                  <th className={`${head} text-left`}>
                    <span className="inline-flex items-center gap-1.5"><VariantDot shape={stat.archIndex} color={stat.color} />{stat.architecture} · {stat.effort}</span>
                  </th>
                  {other && (
                    <>
                      <th className={`${head} text-left`}>
                        <span className="inline-flex items-center gap-1.5"><VariantDot shape={other.archIndex} color={other.color} />{other.architecture} · {other.effort}</span>
                      </th>
                      <th className={head}>Difference</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const a = mine.get(item) ?? null;
                  const b = theirs.get(item) ?? null;
                  const diff = a !== null && b !== null ? a - b : null;
                  return (
                    <tr key={item}>
                      <td className={`${cell} text-left font-mono`}>{item}</td>
                      <td className={`${cell} text-left`}><Meter value={a} color={stat.color} /></td>
                      {other && (
                        <>
                          <td className={`${cell} text-left`}><Meter value={b} color="color-mix(in oklab, var(--muted-foreground) 70%, transparent)" /></td>
                          <td className={`${cell} tabular-nums`}>
                            {diff === null ? '—' : Math.abs(diff) < 0.005
                              ? <span className="text-muted-foreground">0</span>
                              : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}`}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
