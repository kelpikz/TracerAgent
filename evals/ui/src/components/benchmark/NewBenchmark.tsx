import { CircleAlert, Minus, Plus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatWall, maxModels, minutesFor, modelColor, shortModel } from '@/lib/benchmark';
import type { BenchmarkConfig, CaseSummary, JudgeChoice, JudgeOptions, TimeEstimates } from '@/lib/types';
import { cn } from '@/lib/utils';

const DEFAULT_EFFORTS = ['low', 'medium', 'high', 'max'];
const LONG_MINUTES = 8 * 60;

interface Props {
  options: JudgeOptions | null;
  /** Agent models: the default model and the models that pi lists. */
  models: string[];
  judge: JudgeChoice | null;
  cases: CaseSummary[] | null;
  onCancel: () => void;
  onCreate: (config: BenchmarkConfig) => Promise<void>;
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 border-t py-3 sm:grid-cols-[118px_minmax(0,1fr)]">
      <div className="pt-1.5 text-[13px] font-medium">{label}</div>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function Chip({ on, onClick, mono, children }: { on: boolean; onClick: () => void; mono?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        mono && 'font-mono text-xs',
        on ? 'border-foreground/20 bg-secondary text-foreground' : 'border-dashed text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="inline-flex h-8 items-center rounded-md border" role="group" aria-label={label}>
      <button type="button" aria-label="Less" disabled={value <= min} onClick={() => onChange(value - 1)} className="grid h-full w-8 place-items-center disabled:opacity-40">
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-7 text-center text-sm font-semibold tabular-nums">{value}</span>
      <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange(value + 1)} className="grid h-full w-8 place-items-center disabled:opacity-40">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function Pick({ value, values, onChange, label, placeholder }: {
  value: string; values: string[]; onChange: (value: string) => void; label: string; placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-8 min-w-32 font-mono text-[12.5px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {values.map(item => <SelectItem key={item} value={item} className="font-mono text-[12.5px]">{item}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function NewBenchmark({ options, models: modelOptions, judge: savedJudge, cases, onCancel, onCreate }: Props) {
  const efforts = options?.thinking ?? [];
  const architectures = options?.architectures?.map(a => a.name) ?? [];
  const [name, setName] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [archs, setArchs] = useState<string[] | null>(null);
  const [chosenEfforts, setEfforts] = useState<string[] | null>(null);
  const [chosenCases, setCases] = useState<string[] | null>(null);
  const [repeats, setRepeats] = useState(3);
  const [parallel, setParallel] = useState(2);
  const [judge, setJudge] = useState<JudgeChoice | null>(null);
  const [estimates, setEstimates] = useState<TimeEstimates | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.estimates().then(setEstimates).catch(() => setEstimates(null));
  }, []);

  // Defaults, until the user changes a value.
  const M = models ?? (options ? [options.agent_default.model] : []);
  const A = archs ?? architectures;
  const E = chosenEfforts ?? DEFAULT_EFFORTS.filter(e => efforts.includes(e));
  const C = chosenCases ?? cases?.map(c => c.id) ?? [];
  const J = judge ?? savedJudge ?? options?.default ?? null;

  const variants = M.length * A.length * E.length;
  const runs = variants * C.length * repeats;
  const perArch = A.map(arch => M.reduce((sum, model) => (
    sum + E.reduce((s, effort) => s + minutesFor(estimates, model, arch, effort), 0)
  ), 0) * C.length * repeats);
  const total = perArch.reduce((a, b) => a + b, 0);
  const wall = total / parallel;
  const fromPast = estimates && Object.keys(estimates.variants).length > 0;
  const shade = (index: number) => `color-mix(in oklab, var(--foreground) ${A.length > 1 ? 35 + (35 * index) / (A.length - 1) : 50}%, var(--background))`;

  const start = async () => {
    if (!runs || !J) return;
    setStarting(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), models: M, architectures: A, efforts: E, cases: C, repeats, parallel, judge: J });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Cannot start the benchmark.');
      setStarting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">New benchmark</h1>
      <p className="mt-1 mb-4 text-[13px] text-muted-foreground">
        Each variant is one model, one architecture and one effort. Each variant runs every case.
      </p>

      <Row label="Name">
        <Input value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="For example: sol vs luna, effort sweep" className="h-8 max-w-sm text-[13px]" />
      </Row>

      <Row label="Models" hint="Each model gets one color in the charts.">
        <div className="flex flex-wrap items-center gap-1.5">
          {M.map((model, index) => (
            <span key={model} className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-foreground/20 bg-secondary pr-1 pl-3 font-mono text-xs">
              <span className="size-2 rounded-full" style={{ background: modelColor(index) }} />
              {shortModel(model)}
              <button
                type="button"
                aria-label={`Remove ${model}`}
                disabled={M.length === 1}
                onClick={() => setModels(M.filter(m => m !== model))}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {M.length < maxModels && modelOptions.some(m => !M.includes(m)) && (
            <Pick
              key={M.join(',')}
              value=""
              values={modelOptions.filter(m => !M.includes(m))}
              onChange={model => setModels([...M, model])}
              label="Add a model"
              placeholder="Add a model"
            />
          )}
        </div>
      </Row>

      <Row label="Architecture" hint="In a multi-agent architecture, all agents use the model and effort of the variant.">
        <div className="flex flex-wrap gap-1.5">
          {architectures.map(arch => (
            <Chip key={arch} on={A.includes(arch)} onClick={() => setArchs(toggle(A, arch))}>{arch}</Chip>
          ))}
        </div>
      </Row>

      <Row label="Effort">
        <div className="flex flex-wrap gap-1.5">
          {efforts.map(effort => (
            <Chip key={effort} on={E.includes(effort)} onClick={() => setEfforts(efforts.filter(e => toggle(E, effort).includes(e)))}>{effort}</Chip>
          ))}
        </div>
      </Row>

      <Row label="Cases">
        <div className="flex flex-wrap gap-1.5">
          {cases?.map(c => (
            <Chip key={c.id} mono on={C.includes(c.id)} onClick={() => setCases(toggle(C, c.id))}>{c.id}</Chip>
          ))}
        </div>
        <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setCases(cases?.map(c => c.id) ?? [])}>All</button>
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setCases([])}>None</button>
        </div>
      </Row>

      <Row label="Repeats">
        <div className="flex flex-wrap items-center gap-2">
          <Stepper label="Repeats" value={repeats} min={1} max={10} onChange={setRepeats} />
          <span className="text-xs text-muted-foreground">runs of each case for each variant</span>
        </div>
      </Row>

      <Row label="Judge" hint="One judge scores all runs, so you can compare the scores.">
        {J && options && options.models.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Pick value={J.model} values={options.models} onChange={model => setJudge({ ...J, model })} label="Judge model" />
            <Pick value={J.thinking} values={options.thinking} onChange={thinking => setJudge({ ...J, thinking })} label="Judge thinking" />
          </div>
        ) : (
          <p className="pt-1.5 font-mono text-[12.5px]">{J ? `${J.model} · ${J.thinking}` : '—'}</p>
        )}
      </Row>

      <Row label="Parallel">
        <div className="flex flex-wrap items-center gap-2">
          <Stepper label="Parallel runs" value={parallel} min={1} max={20} onChange={setParallel} />
          <span className="text-xs text-muted-foreground">runs at the same time</span>
        </div>
      </Row>

      <div className="mt-1.5 rounded-xl border bg-card p-4">
        <div className="text-[13px] leading-7 text-muted-foreground tabular-nums">
          {plural(M.length, 'model')} × {plural(A.length, 'architecture')} × {plural(E.length, 'effort')} = <b className="text-foreground">{plural(variants, 'variant')}</b>
          <br />
          {plural(variants, 'variant')} × {plural(C.length, 'case')} × {plural(repeats, 'repeat')} = <b className="text-foreground">{plural(runs, 'run')}</b>
        </div>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-2xl font-semibold tracking-tight">{runs ? formatWall(wall) : '—'}</span>
          <span className="text-xs text-muted-foreground">
            {runs ? `with ${parallel} in parallel · ${fromPast ? 'estimate from past benchmarks' : 'rough estimate'}` : 'Choose at least one of each.'}
          </span>
        </div>
        {total > 0 && (
          <>
            <div className="mt-2.5 mb-1.5 flex h-2 gap-0.5 overflow-hidden rounded">
              {A.map((arch, index) => <div key={arch} style={{ flex: perArch[index], background: shade(index) }} />)}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {A.map((arch, index) => (
                <span key={arch} className="inline-flex items-center gap-1.5">
                  <i className="inline-block size-2 rounded-sm" style={{ background: shade(index) }} />
                  {arch} {Math.round((perArch[index] / total) * 100)}% of the time
                </span>
              ))}
            </div>
          </>
        )}
        {wall >= LONG_MINUTES && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-warning/10 px-2.5 py-2 text-[13px]">
            <TriangleAlert className="mt-px size-4 shrink-0 text-warning" />
            <span><b>Long benchmark.</b> Remove some efforts, models or cases to make it shorter.</span>
          </div>
        )}
        {error && (
          <Alert variant="destructive" className="mt-3">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="mt-3.5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!runs || !J || starting} onClick={() => void start()}>
            {starting ? 'Starting…' : runs ? `Start ${plural(runs, 'run')}` : 'Start'}
          </Button>
        </div>
      </div>
    </div>
  );
}
