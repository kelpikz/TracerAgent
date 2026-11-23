import type { Benchmark, BenchmarkCell, BenchmarkStatus, CellResult, Status, TimeEstimates } from './types';

/** Rough minutes for one run when no past benchmark has the variant. */
const fallbackMinutes: Record<string, Record<string, number>> = {
  single: { off: 1, minimal: 1, low: 1.5, medium: 2, high: 2.5, xhigh: 3, max: 3 },
  multi: { off: 5, minimal: 5, low: 6, medium: 8, high: 10, xhigh: 15, max: 20 },
};

export const maxModels = 6;

export function modelColor(index: number) {
  return `var(--chart-${(index % maxModels) + 1})`;
}

/** "openai-codex/gpt-6.2-sol" becomes "gpt-6.2-sol". */
export function shortModel(model: string) {
  return model.split('/').pop() ?? model;
}

export const variantKey = (model: string, architecture: string, effort: string) => `${model}|${architecture}|${effort}`;

export function isFailed(result: CellResult) {
  return result.status !== 'done' || result.total === null;
}

const numbers = (values: Array<number | null | undefined>) => values.filter((v): v is number => typeof v === 'number');

export function mean(values: Array<number | null | undefined>) {
  const list = numbers(values);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

export type CellState = 'pending' | 'running' | 'stopped' | 'done' | 'failed';

export function cellState(cell: BenchmarkCell, running: boolean): CellState {
  if (cell.result) return isFailed(cell.result) ? 'failed' : 'done';
  if (cell.run_id) return running ? 'running' : 'stopped';
  return 'pending';
}

export interface VariantStats {
  key: string;
  model: string;
  modelIndex: number;
  architecture: string;
  archIndex: number;
  effort: string;
  label: string;
  color: string;
  /** Average score of each full pass. A pass is one run of every case. */
  passes: number[];
  avg: number | null;
  lo: number | null;
  hi: number | null;
  outcome: number | null;
  trajectory: number | null;
  minutes: number | null;
  cost: number | null;
  finished: number;
  failed: number;
  total: number;
  cells: BenchmarkCell[];
}

/**
 * Scores for each variant. Only full passes count: every case of that repeat has a result,
 * and at least one run did not fail. Failed runs are not in the averages.
 */
export function variantStats(benchmark: Benchmark): VariantStats[] {
  const { config, cells } = benchmark;
  const groups = new Map<string, BenchmarkCell[]>();
  for (const cell of cells) {
    const key = variantKey(cell.model, cell.architecture, cell.effort);
    groups.set(key, [...(groups.get(key) ?? []), cell]);
  }
  const stats: VariantStats[] = [];
  config.models.forEach((model, modelIndex) => {
    config.architectures.forEach((architecture, archIndex) => {
      for (const effort of config.efforts) {
        const key = variantKey(model, architecture, effort);
        const own = groups.get(key) ?? [];
        const passes: number[] = [];
        const passResults: CellResult[] = [];
        for (let repeat = 0; repeat < config.repeats; repeat++) {
          const pass = own.filter(cell => cell.repeat === repeat);
          if (!pass.length || pass.some(cell => !cell.result)) continue;
          const ok = pass.map(cell => cell.result!).filter(result => !isFailed(result));
          if (!ok.length) continue;
          passes.push(mean(ok.map(result => result.total))!);
          passResults.push(...ok);
        }
        const finished = own.filter(cell => cell.result);
        const minutes = mean(passResults.map(result => result.duration_s));
        stats.push({
          key, model, modelIndex, architecture, archIndex, effort,
          label: `${shortModel(model)} · ${architecture} · ${effort}`,
          color: modelColor(modelIndex),
          passes,
          avg: mean(passes),
          lo: passes.length ? Math.min(...passes) : null,
          hi: passes.length ? Math.max(...passes) : null,
          outcome: mean(passResults.map(result => result.outcome)),
          trajectory: mean(passResults.map(result => result.trajectory)),
          minutes: minutes === null ? null : minutes / 60,
          cost: mean(passResults.map(result => result.cost_usd)),
          finished: finished.length,
          failed: finished.filter(cell => isFailed(cell.result!)).length,
          total: own.length,
          cells: own,
        });
      }
    });
  });
  return stats;
}

/** The y range for scores: whole numbers around all pass averages, inside 0 to 10. */
export function scoreDomain(stats: VariantStats[]): [number, number] {
  const values = numbers(stats.flatMap(v => [v.lo, v.hi]));
  if (!values.length) return [0, 10];
  let lo = Math.max(0, Math.floor(Math.min(...values) - 0.2));
  let hi = Math.min(10, Math.ceil(Math.max(...values) + 0.2));
  if (hi - lo < 2) {
    lo = Math.max(0, lo - 1);
    hi = Math.min(10, lo + 2);
  }
  return [lo, hi];
}

/** Average outcome rubric score of each item, in rubric order. */
export function rubricAverages(cells: BenchmarkCell[]) {
  const scores = new Map<string, number[]>();
  for (const cell of cells) {
    if (!cell.result || isFailed(cell.result)) continue;
    for (const item of cell.result.rubric) {
      if (!scores.has(item.name)) scores.set(item.name, []);
      if (typeof item.score === 'number') scores.get(item.name)!.push(item.score);
    }
  }
  return new Map([...scores].map(([name, values]) => [name, mean(values)]));
}

/** Minutes for one run: the variant median, then the architecture median, then a rough value. */
export function minutesFor(estimates: TimeEstimates | null, model: string, architecture: string, effort: string) {
  return estimates?.variants[variantKey(model, architecture, effort)]
    ?? estimates?.architectures[`${architecture}|${effort}`]
    ?? (fallbackMinutes[architecture] ?? fallbackMinutes.single)[effort]
    ?? 2;
}

/** Minutes until all cells finish, from the runs of this benchmark that finished. */
export function minutesLeft(benchmark: Benchmark) {
  const byVariant = new Map<string, number[]>();
  const byArch = new Map<string, number[]>();
  for (const cell of benchmark.cells) {
    const seconds = cell.result?.duration_s;
    if (cell.result?.status !== 'done' || typeof seconds !== 'number') continue;
    const add = (map: Map<string, number[]>, key: string) => map.set(key, [...(map.get(key) ?? []), seconds / 60]);
    add(byVariant, variantKey(cell.model, cell.architecture, cell.effort));
    add(byArch, `${cell.architecture}|${cell.effort}`);
  }
  const estimates: TimeEstimates = {
    variants: Object.fromEntries([...byVariant].map(([key, values]) => [key, mean(values)!])),
    architectures: Object.fromEntries([...byArch].map(([key, values]) => [key, mean(values)!])),
  };
  const total = benchmark.cells
    .filter(cell => !cell.result)
    .reduce((sum, cell) => sum + minutesFor(estimates, cell.model, cell.architecture, cell.effort), 0);
  return total / benchmark.config.parallel;
}

/** A long time, such as "about 40 min", "about 1 h 20 min" or "about 9 h". */
export function formatWall(minutes: number) {
  const mins = Math.max(1, Math.round(minutes));
  if (mins >= 120) return `about ${Math.round(mins / 60)} h`;
  if (mins >= 60) return `about 1 h ${mins - 60} min`;
  return `about ${mins} min`;
}

/** Time for one run, such as "2.4 min" or "14 min". */
export function formatMinutes(minutes: number | null) {
  if (minutes === null) return '—';
  return minutes >= 10 ? `${Math.round(minutes)} min` : `${minutes.toFixed(1)} min`;
}

export function formatCost(dollars: number | null) {
  if (dollars === null) return '—';
  return dollars >= 1 ? `$${dollars.toFixed(2)}` : `$${dollars.toFixed(3)}`;
}

/** Token count, such as "850K" or "12.4M". */
export function formatTokens(tokens: number) {
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}K`;
  return String(tokens);
}

export function formatScore(score: number | null, digits = 1) {
  return score === null ? '—' : score.toFixed(digits);
}

/** The badge status and label for a benchmark status. */
export function benchmarkBadge(status: BenchmarkStatus): { status: Status; label: string } {
  if (status === 'stopped') return { status: 'skipped', label: 'Stopped' };
  return { status, label: status[0].toUpperCase() + status.slice(1) };
}

export const dashes = ['', '6 4', '2 3', '10 3 2 3'];
