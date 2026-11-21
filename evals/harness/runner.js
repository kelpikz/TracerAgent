import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { agentDefaults, runAgent, validateAgent } from './agent.js';
import { ensureData } from './data.js';
import { errorDetails } from './errors.js';
import { gradeWithJudge, judgeDefaults } from './judge.js';
import { scoreRun } from './score.js';
import { caseDir, graderKinds, newRunId, readJson, readOptional, writeRun } from './storage.js';

const deterministicTimeoutMs = 30_000;

function runDeterministic(path, runId, transcript, testCase, labels, outputToStderr) {
  const url = pathToFileURL(path);
  url.searchParams.set('run', runId);
  const worker = new Worker(new URL('./deterministic-worker.js', import.meta.url), {
    workerData: { url: url.href, transcript, testCase, labels },
    execArgv: [],
    stdout: outputToStderr,
  });
  if (outputToStderr) worker.stdout.pipe(process.stderr, { end: false });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Deterministic grader timed out after 30 s.')),
      deterministicTimeoutMs);
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => reject(new Error(`Grader exited with code ${code} before it returned scores.`)));
    worker.once('exit', () => clearTimeout(timeout));
  }).finally(() => worker.terminate());
}

export async function gradeDeterministic(path, runId, transcript, testCase, labels, { outputToStderr = false } = {}) {
  try {
    if (await readOptional(path) === null) return { status: 'missing', items: [], error: null };
    return await runDeterministic(path, runId, transcript, testCase, labels, outputToStderr);
  } catch (error) {
    return { status: 'error', items: [], error: errorDetails(error) };
  }
}

async function gradeRubric(path, input, transcript, judge) {
  const base = { ...judge, items: [], summary: null, raw_output: null, error: null };
  try {
    const rubric = await readOptional(path);
    if (rubric === null) return { ...base, status: 'missing' };
    return await gradeWithJudge(rubric, input, transcript, judge.model, judge.thinking);
  } catch (error) {
    return { ...base, status: 'error', error: errorDetails(error) };
  }
}

export function createRun(caseId, runId = newRunId(), { model, thinking } = {}, agent = {}) {
  const defaults = judgeDefaults();
  const judge = { model: model ?? defaults.model, thinking: thinking ?? defaults.thinking };
  const agentDefault = agentDefaults();
  const run = {
    run_id: runId,
    case_id: caseId,
    status: 'running',
    started_at: new Date().toISOString(),
    ended_at: null,
    agent: null,
    agent_settings: { model: agent.model ?? agentDefault.model, effort: agent.effort ?? agentDefault.effort },
    transcript: null,
    judge,
    graders: Object.fromEntries(graderKinds.map(kind => [kind, {
      deterministic: { status: 'pending', items: [], error: null },
      llm: { status: 'pending', ...judge, items: [], summary: null, raw_output: null, error: null },
    }])),
    error: null,
  };
  run.score = scoreRun(run);
  return run;
}

export function failRun(run, error) {
  run.status = 'error';
  run.ended_at = new Date().toISOString();
  run.error = errorDetails(error);
  for (const graders of Object.values(run.graders)) {
    for (const grade of Object.values(graders)) {
      if (grade.status === 'pending') {
        grade.status = 'skipped';
        grade.reason = 'The run failed before this grader ran.';
      }
    }
  }
  run.score = scoreRun(run);
  return run;
}

export async function runCase(testCase, runId, judge, agent) {
  const run = createRun(testCase.id, runId, judge, agent);
  await writeRun(run, { initial: true });
  try {
    validateAgent(run.agent_settings);
    const dataDir = await ensureData(testCase);
    run.transcript = await runAgent(testCase, dataDir, run.agent_settings);
    run.agent = run.transcript.agent ?? null;
    const labels = await readJson(join(dataDir, 'labels.json'));
    await Promise.all(graderKinds.map(async kind => {
      const dir = join(caseDir(testCase.id), kind);
      const [deterministic, llm] = await Promise.all([
        gradeDeterministic(join(dir, 'tests.js'), run.run_id, run.transcript, testCase, labels),
        gradeRubric(join(dir, 'prompt.md'), testCase.input, run.transcript, run.judge),
      ]);
      run.graders[kind] = { deterministic, llm };
    }));
    run.score = scoreRun(run);
    run.status = 'done';
    run.ended_at = new Date().toISOString();
  } catch (error) {
    failRun(run, error);
  }
  await writeRun(run);
  return run;
}
