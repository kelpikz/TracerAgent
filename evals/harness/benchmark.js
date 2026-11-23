// A benchmark runs every variant (model x architecture x effort) on every case, a number of times.
// A detached worker (cli.js bench <id>) runs the cells. It writes a short result into each cell,
// so the UI reads one file and not hundreds of run files.
import { listArchitectures } from './agent.js';
import { ensureData } from './data.js';
import { judgeDefaults, judgeThinkingLevels, validateJudge, validateModel } from './judge.js';
import { killTree, processAlive } from './process.js';
import { runCase } from './runner.js';
import {
  listBenchmarkIds, newRunId, readBenchmark, readCase, readRun, validId, writeBenchmark,
} from './storage.js';

export const benchmarkLimits = { models: 6, repeats: 10, parallel: 20 };
// A new worker has this long to write its PID before the benchmark counts as interrupted.
const startingMs = 60_000;

function fail(message) {
  throw new Error(message);
}

function uniqueList(value, label, check) {
  if (!Array.isArray(value) || value.length === 0) fail(`Choose at least one ${label}.`);
  if (new Set(value).size !== value.length) fail(`Choose each ${label} once.`);
  value.forEach(check);
  return value;
}

function count(value, label, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) fail(`Use ${label} from 1 to ${max}.`);
  return value;
}

/** Checks a benchmark config from the UI and fills in the judge defaults. */
export async function validateBenchmarkConfig(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Use a JSON object.');
  const fields = ['name', 'models', 'architectures', 'efforts', 'cases', 'repeats', 'parallel', 'judge'];
  const unknown = Object.keys(body).filter(key => !fields.includes(key));
  if (unknown.length) fail(`Unknown field ${unknown.join(', ')}.`);

  const name = body.name ?? '';
  if (typeof name !== 'string' || name.length > 120) fail('Use a name of 120 characters or less.');
  const models = uniqueList(body.models, 'model', model => {
    if (typeof model !== 'string') fail('Use models in provider/model format.');
    validateModel(model, 'models');
  });
  if (models.length > benchmarkLimits.models) fail(`Choose ${benchmarkLimits.models} models or less.`);

  const known = (await listArchitectures()).items.map(item => item.name);
  const architectures = uniqueList(body.architectures, 'architecture', name => {
    if (!known.includes(name)) fail(`Architecture ${name} does not exist.`);
  });
  const efforts = uniqueList(body.efforts, 'effort', effort => {
    if (!judgeThinkingLevels.includes(effort)) fail(`Use these efforts: ${judgeThinkingLevels.join(', ')}.`);
  });
  const cases = uniqueList(body.cases, 'case', id => {
    if (!validId(id)) fail('Invalid case ID.');
  });
  for (const id of cases) {
    if (!await readCase(id)) fail(`Case ${id} does not exist.`);
  }

  const judge = body.judge ?? {};
  if (!judge || typeof judge !== 'object' || Array.isArray(judge)
      || Object.keys(judge).some(key => key !== 'model' && key !== 'thinking')) {
    fail('Use a judge object with optional model and thinking fields.');
  }
  validateJudge(judge);
  const defaults = judgeDefaults();
  return {
    name: name.trim(),
    models,
    architectures: known.filter(item => architectures.includes(item)),
    efforts: judgeThinkingLevels.filter(level => efforts.includes(level)),
    cases: [...cases].sort(),
    repeats: count(body.repeats, 'repeats', benchmarkLimits.repeats),
    parallel: count(body.parallel ?? 2, 'parallel runs', benchmarkLimits.parallel),
    judge: { model: judge.model ?? defaults.model, thinking: judge.thinking ?? defaults.thinking },
  };
}

/** Cells in pass order: all cells of repeat 1, then repeat 2. In a repeat: case, then variant. */
function planCells({ models, architectures, efforts, cases, repeats }) {
  const cells = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const case_id of cases) {
      for (const model of models) {
        for (const architecture of architectures) {
          for (const effort of efforts) {
            cells.push({ repeat, case_id, model, architecture, effort, run_id: null, result: null });
          }
        }
      }
    }
  }
  return cells;
}

export function newBenchmark(config) {
  const now = new Date().toISOString();
  return {
    id: newRunId(),
    name: config.name,
    created_at: now,
    status: 'running',
    worker_pid: null,
    worker_started_at: now,
    ended_at: null,
    error: null,
    config,
    cells: planCells(config),
  };
}

/** The status to show. A running benchmark without a live worker is "interrupted". */
export function benchmarkStatus(benchmark) {
  if (benchmark.status !== 'running') return benchmark.status;
  const alive = benchmark.worker_pid
    ? processAlive(benchmark.worker_pid)
    : Date.now() - Date.parse(benchmark.worker_started_at) < startingMs;
  return alive ? 'running' : 'interrupted';
}

const failed = result => result.status !== 'done' || result.total === null;

export function benchmarkSummary(benchmark) {
  const { id, name, created_at, ended_at, config, cells } = benchmark;
  const results = cells.map(cell => cell.result).filter(Boolean);
  return {
    id, name, created_at, ended_at,
    status: benchmarkStatus(benchmark),
    models: config.models,
    architectures: config.architectures,
    efforts: config.efforts,
    case_count: config.cases.length,
    repeats: config.repeats,
    runs: cells.length,
    finished: results.length,
    failed: results.filter(failed).length,
  };
}

/** Input, output and cache-read tokens of one run, or null if the run has no usage. */
export function runTokens(usage) {
  if (!usage) return null;
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_read_tokens ?? 0);
}

/** The short result that the benchmark keeps for one run. */
function summarizeRun(run) {
  const duration = Date.parse(run.ended_at) - Date.parse(run.started_at);
  return {
    status: run.status,
    total: run.score?.total ?? null,
    outcome: run.score?.outcome?.score ?? null,
    trajectory: run.score?.trajectory?.score ?? null,
    duration_s: Number.isFinite(duration) ? Math.round(duration / 1000) : null,
    cost_usd: run.transcript?.usage?.cost_usd ?? null,
    tokens: runTokens(run.transcript?.usage),
    steps: run.transcript?.steps?.length ?? null,
    rubric: (run.graders?.outcome?.llm?.items ?? []).map(({ name, score }) => ({ name, score })),
    error: run.error?.message ?? null,
  };
}

function errorResult(error) {
  return {
    status: 'error', total: null, outcome: null, trajectory: null, duration_s: null,
    cost_usd: null, tokens: null, steps: null, rubric: [], error: error instanceof Error ? error.message : String(error),
  };
}

/** The worker. Runs the cells that have no result, `parallel` at a time. */
export async function runBenchmark(id, log = console.log) {
  const benchmark = await readBenchmark(id);
  if (!benchmark) fail(`Benchmark ${id} does not exist.`);
  if (benchmark.status !== 'running') return benchmark;
  if (benchmark.worker_pid && processAlive(benchmark.worker_pid)) fail('Another worker runs this benchmark.');

  // Write one copy at a time. Each write saves the latest state.
  let writes = Promise.resolve();
  const save = () => {
    const next = writes.then(() => writeBenchmark(benchmark));
    writes = next.catch(error => log(`Could not save the benchmark: ${error.message}`));
    return next;
  };
  benchmark.worker_pid = process.pid;
  await save();

  try {
    const { config } = benchmark;
    const roles = Object.fromEntries((await listArchitectures()).items
      .map(item => [item.name, item.roles.map(role => role.name)]));

    // Make the data before the runs start. Parallel runs must not make the same data.
    const cases = new Map();
    for (const caseId of config.cases) {
      try {
        const testCase = await readCase(caseId);
        if (!testCase) fail(`Case ${caseId} does not exist.`);
        await ensureData(testCase);
        cases.set(caseId, testCase);
      } catch (error) {
        cases.set(caseId, error);
      }
    }

    // A cell with a run ID but no result was stopped. Keep a run that finished, else run it again.
    for (const cell of benchmark.cells) {
      if (cell.result || !cell.run_id) continue;
      const run = await readRun(cell.case_id, cell.run_id).catch(() => null);
      if (run?.status === 'done' || run?.status === 'error') cell.result = summarizeRun(run);
      else cell.run_id = null;
    }
    await save();

    const pending = benchmark.cells.filter(cell => !cell.result);
    let next = 0;
    const lane = async () => {
      while (next < pending.length) {
        const cell = pending[next++];
        const testCase = cases.get(cell.case_id);
        if (testCase instanceof Error) {
          cell.result = errorResult(testCase);
          await save();
          continue;
        }
        // In a multi-agent architecture, every agent uses the model and effort of the variant.
        const agent = { model: cell.model, effort: cell.effort, architecture: cell.architecture };
        const archRoles = roles[cell.architecture] ?? [];
        if (archRoles.length) {
          agent.agents = Object.fromEntries(archRoles.map(role => [role, { model: cell.model, effort: cell.effort }]));
        }
        cell.run_id = newRunId();
        await save();
        try {
          const run = await runCase(testCase, cell.run_id, config.judge, agent,
            { benchmark: { id: benchmark.id, repeat: cell.repeat } });
          cell.result = summarizeRun(run);
        } catch (error) {
          cell.result = errorResult(error);
        }
        await save();
        const score = cell.result.total === null ? 'failed' : cell.result.total.toFixed(2);
        log(`${cell.case_id}  ${cell.model} ${cell.architecture} ${cell.effort}  repeat ${cell.repeat + 1}  ${score}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(config.parallel, pending.length) }, lane));
    benchmark.status = 'done';
  } catch (error) {
    benchmark.status = 'error';
    benchmark.error = error.message;
  }
  benchmark.worker_pid = null;
  benchmark.ended_at = new Date().toISOString();
  await save();
  return benchmark;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Kills the worker and all its runs, then marks the benchmark as stopped. */
export async function stopBenchmark(id) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const benchmark = await readBenchmark(id);
    if (!benchmark || benchmark.status !== 'running') return benchmark;
    const pid = benchmark.worker_pid;
    if (pid && processAlive(pid)) {
      await killTree(pid);
      for (let i = 0; i < 40 && processAlive(pid); i++) await sleep(100);
      continue;
    }
    // The worker is starting. Wait for its PID.
    if (!pid && benchmarkStatus(benchmark) === 'running') {
      await sleep(250);
      continue;
    }
    benchmark.status = 'stopped';
    benchmark.worker_pid = null;
    benchmark.ended_at = new Date().toISOString();
    await writeBenchmark(benchmark);
    return benchmark;
  }
  fail('The benchmark worker did not stop.');
}

/** Sets a stopped benchmark to running again, before the server starts a new worker. */
export async function prepareResume(id) {
  const benchmark = await readBenchmark(id);
  if (!benchmark) return null;
  if (benchmarkStatus(benchmark) === 'running') fail('The benchmark is already running.');
  Object.assign(benchmark, {
    status: 'running', worker_pid: null, worker_started_at: new Date().toISOString(), ended_at: null, error: null,
  });
  await writeBenchmark(benchmark);
  return benchmark;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median minutes for one run, from the runs of past benchmarks. */
export async function timeEstimates() {
  const variants = new Map();
  const architectures = new Map();
  const add = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const id of await listBenchmarkIds()) {
    const benchmark = await readBenchmark(id).catch(() => null);
    for (const cell of benchmark?.cells ?? []) {
      const seconds = cell.result?.duration_s;
      if (cell.result?.status !== 'done' || !Number.isFinite(seconds)) continue;
      add(variants, `${cell.model}|${cell.architecture}|${cell.effort}`, seconds / 60);
      add(architectures, `${cell.architecture}|${cell.effort}`, seconds / 60);
    }
  }
  const medians = map => Object.fromEntries([...map].map(([key, values]) => [key, median(values)]));
  return { variants: medians(variants), architectures: medians(architectures) };
}
