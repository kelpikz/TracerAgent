import { randomBytes } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const evalsDir = fileURLToPath(new URL('../', import.meta.url));
export const repoDir = fileURLToPath(new URL('../../', import.meta.url));
export const graderKinds = ['trajectory', 'outcome'];

const infoText = z.string().refine(value => value.trim().length > 0, 'Use a nonempty string.');
const caseInfo = z.object({
  failure: infoText,
  trigger: infoText,
  affected: z.array(z.object({
    name: infoText,
    kind: z.enum(['service', 'database', 'job', 'provider']),
    impact: infoText,
  })),
  signals: z.array(z.object({
    source: z.enum(['metric', 'log', 'trace', 'event', 'alert', 'order', 'business']),
    where: infoText,
    what: infoText,
    when: infoText,
    dashboard: infoText.optional(),
  })),
  expected: z.object({ root_cause: infoText, impact: infoText, next_steps: infoText }),
});

export function validId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(id);
}

export function validRunId(id) {
  return typeof id === 'string' && /^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(id);
}

export function newRunId() {
  return `${new Date().toISOString().replace(/[-:.]/g, '')}-${randomBytes(4).toString('hex')}`;
}

export function caseDir(id) {
  if (!validId(id)) throw new Error('Invalid case ID.');
  return join(evalsDir, 'cases', id);
}

function resultPath(id, runId) {
  if (!validId(id) || !validRunId(runId)) throw new Error('Invalid case or run ID.');
  return join(evalsDir, 'results', id, `${runId}.json`);
}

export async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readJson(path) {
  const content = await readOptional(path);
  return content === null ? null : JSON.parse(content);
}

export async function readCase(id) {
  const path = join(caseDir(id), 'case.json');
  const testCase = await readJson(path);
  if (testCase === null) return null;
  const rules = {
    id: [testCase.id === id, `must match the folder name (${id})`],
    scenario: [validId(testCase.scenario), 'must be a valid scenario ID'],
    input: [typeof testCase.input === 'string', 'must be a string'],
    title: [typeof testCase.title === 'string', 'must be a string'],
    description: [typeof testCase.description === 'string', 'must be a string'],
    noise: [Array.isArray(testCase.noise), 'must be an array'],
    incidents: [testCase.incidents === undefined || (Array.isArray(testCase.incidents)
      && testCase.incidents.every(validId)), 'must be an array of incident IDs'],
    tags: [Array.isArray(testCase.tags), 'must be an array'],
    timeout_s: [Number.isFinite(testCase.timeout_s) && testCase.timeout_s > 0
      && testCase.timeout_s * 1000 <= 2_147_483_647, 'must be a positive number within the Node.js timer limit'],
  };
  const errors = Object.entries(rules).flatMap(([field, [valid, rule]]) => {
    if (valid) return [];
    return [Object.hasOwn(testCase, field) ? `${field} ${rule}` : `missing ${field}`];
  });
  if (Object.hasOwn(testCase, 'info')) {
    const result = caseInfo.safeParse(testCase.info);
    if (!result.success) {
      errors.push(...result.error.issues.map(({ path, message }) => (
        `${['info', ...path].join('.')}: ${message.replace(/\.$/, '')}`
      )));
    }
  }
  if (errors.length) {
    throw new Error(`Invalid case.json for ${id}. ${errors.join(', ')}.`);
  }
  return testCase;
}

export async function listCases() {
  const entries = await readdir(join(evalsDir, 'cases'), { withFileTypes: true });
  const ids = entries.filter(entry => entry.isDirectory() && validId(entry.name))
    .map(entry => entry.name).sort();
  return (await Promise.all(ids.map(readCase))).filter(Boolean);
}

export async function listRuns(id, limit = Infinity) {
  if (!validId(id)) throw new Error('Invalid case ID.');
  const dir = join(evalsDir, 'results', id);
  const files = await readdir(dir).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const ids = files.filter(file => file.endsWith('.json') && validRunId(file.slice(0, -5)))
    .map(file => file.slice(0, -5)).sort().reverse().slice(0, limit);
  const runs = await Promise.all(ids.map(runId => readRun(id, runId)));
  return runs.filter(Boolean).map(({ run_id, status, started_at, ended_at, agent, score }) => (
    { run_id, status, started_at, ended_at, agent, score_total: score?.total ?? null }
  ));
}

export function readRun(id, runId) {
  return readJson(resultPath(id, runId));
}

export async function writeRun(run, { initial = false } = {}) {
  const path = resultPath(run.case_id, run.run_id);
  const content = `${JSON.stringify(run, null, 2)}\n`;
  if (initial) {
    await mkdir(join(evalsDir, 'results', run.case_id), { recursive: true });
  }
  const temporaryPath = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporaryPath, content, { flag: 'wx' });
  try {
    if (initial) await link(temporaryPath, path);
    else await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
