import { spawn } from 'node:child_process';
import { closeSync, createReadStream, openSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { extname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { agentDefaults, listArchitectures, validateAgent } from './harness/agent.js';
import {
  benchmarkStatus, benchmarkSummary, newBenchmark, prepareResume, stopBenchmark, timeEstimates,
  validateBenchmarkConfig,
} from './harness/benchmark.js';
import { judgeDefaults, judgeThinkingLevels, runPi, validateJudge } from './harness/judge.js';
import { createRun, failRun } from './harness/runner.js';
import {
  benchmarkLogPath, caseDir, evalsDir, graderKinds, listBenchmarkIds, listCases, listRuns, newRunId, readBenchmark,
  readCase, readJson, readOptional, readRun, readRunStatus, repoDir, validId, validRunId, writeBenchmark, writeRun,
} from './harness/storage.js';

const distDir = join(evalsDir, 'ui', 'dist');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function sendText(response, status, text) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(text);
}

async function readDist(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (['ENOENT', 'EISDIR', 'ENOTDIR', 'EINVAL', 'ENAMETOOLONG'].includes(error.code)) return null;
    throw error;
  }
}

async function serveStatic(path, response) {
  const decoded = decodeURIComponent(path);
  if (decoded.includes('\0')) return sendText(response, 400, 'Invalid URL.');
  const target = normalize(join(distDir, decoded));
  if (target !== distDir && !target.startsWith(distDir + sep)) {
    return sendText(response, 403, 'Forbidden.');
  }
  let file = target;
  let content = await readDist(file);
  if (content === null) {
    // An unknown asset is an error. Any other path opens the app.
    if (path.startsWith('/assets/')) return sendText(response, 404, 'File not found.');
    file = join(distDir, 'index.html');
    content = await readDist(file);
    if (content === null) return sendText(response, 503, 'The UI is not built. Run npm run ui:build');
  }
  const type = contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const cache = file.startsWith(join(distDir, 'assets') + sep)
    ? 'public, max-age=31536000, immutable' : 'no-cache';
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
  response.end(content);
}

const dashboardFile = join(repoDir, 'dashboard', 'index.html');
const dataDir = join(repoDir, 'data');
const dataTypes = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
};

async function sendFile(response, file, type, cache) {
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EINVAL', 'ENAMETOOLONG'].includes(error.code)) return sendText(response, 404, 'File not found.');
    throw error;
  }
  if (!info.isFile()) return sendText(response, 404, 'File not found.');
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': cache });
  // Stream the file. data.js is about 5 MB.
  await pipeline(createReadStream(file), response).catch(() => {});
}

// Serve /data/<scenario>/<file> from the repo data folder. Read-only.
async function serveData(path, response) {
  const parts = decodeURIComponent(path).split('/').slice(2);
  const [scenario, name, ...rest] = parts;
  const type = name && dataTypes[extname(name).toLowerCase()];
  if (parts.length !== 2 || rest.length || !type
      || !/^[A-Za-z0-9._-]+$/.test(scenario) || !/^[A-Za-z0-9._-]+$/.test(name)
      || scenario.startsWith('.') || name.startsWith('.')) {
    return sendText(response, 404, 'File not found.');
  }
  const target = normalize(join(dataDir, scenario, name));
  if (!target.startsWith(dataDir + sep)) return sendText(response, 403, 'Forbidden.');
  return sendFile(response, target, type, 'public, max-age=60');
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

/** Reads a JSON body. Returns undefined for an empty body. */
async function readBody(request, limitKb) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limitKb * 1024) {
      request.resume();
      throw new Error(`The request body must be ${limitKb} KB or less.`);
    }
    chunks.push(buffer);
  }
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new Error('Use a valid JSON request body.');
  }
}

async function readRunSettings(request) {
  const body = await readBody(request, 4);
  if (body === undefined) return { judge: {}, agent: {} };
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => key !== 'judge' && key !== 'agent')) {
    throw new Error('Use a JSON object with optional judge and agent fields.');
  }
  const { judge = {}, agent = {} } = body;
  if (!judge || typeof judge !== 'object' || Array.isArray(judge)
      || Object.keys(judge).some(key => key !== 'model' && key !== 'thinking')) {
    throw new Error('Use a judge object with optional model and thinking fields.');
  }
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)
      || Object.keys(agent).some(key => !['model', 'effort', 'architecture', 'agents'].includes(key))) {
    throw new Error('Use an agent object with optional model, effort, architecture and agents fields.');
  }
  validateJudge(judge);
  validateAgent(agent);
  return { judge, agent };
}

let cachedModelList;

async function listJudgeModels(command) {
  try {
    const { code, stdout } = await runPi(command, ['--list-models', '--offline'], 10);
    if (code !== 0) throw new Error('pi model list failed.');
    const models = [];
    for (const line of stdout.split(/\r?\n/)) {
      const [provider, model, , , thinking] = line.trim().split(/\s+/);
      if (thinking === 'yes') models.push(`${provider}/${model}`);
    }
    return { models, error: null };
  } catch {
    return { models: [], error: 'Could not list pi models.' };
  }
}

async function judgeOptions() {
  const command = process.env.EVAL_PI_CMD || 'pi';
  if (cachedModelList?.command !== command || cachedModelList.expiresAt <= Date.now()) {
    const entry = { command, expiresAt: Infinity };
    entry.result = listJudgeModels(command).finally(() => { entry.expiresAt = Date.now() + 5 * 60_000; });
    cachedModelList = entry;
  }
  const { models, error } = await cachedModelList.result;
  const defaults = judgeDefaults();
  const architectures = await listArchitectures();
  return {
    default: defaults,
    agent_default: { ...agentDefaults(), architecture: architectures.default ?? undefined },
    architectures: architectures.items,
    models: models.length ? [...new Set([...models, defaults.model])].sort() : models,
    thinking: judgeThinkingLevels,
    error,
  };
}

async function recordProcessError(caseId, runId, { judge, agent }, error) {
  try {
    const run = await readRun(caseId, runId);
    if (run && run.status !== 'running') return;
    await writeRun(failRun(run ?? createRun(caseId, runId, judge, agent), error), { initial: !run });
  } catch (writeError) {
    console.error(writeError);
  }
}

function launchRun(caseId, runId, settings) {
  const { judge, agent } = settings;
  const args = [join(evalsDir, 'harness', 'cli.js'), 'run', caseId, '--run-id', runId];
  if (judge.model !== undefined) args.push('--judge-model', judge.model);
  if (judge.thinking !== undefined) args.push('--judge-thinking', judge.thinking);
  if (agent.model !== undefined) args.push('--agent-model', agent.model);
  if (agent.effort !== undefined) args.push('--agent-effort', agent.effort);
  if (agent.architecture !== undefined) args.push('--agent-arch', agent.architecture);
  if (agent.agents !== undefined) args.push('--agent-roles', JSON.stringify(agent.agents));
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: repoDir, stdio: 'ignore', windowsHide: true, detached: true,
    });
  } catch (error) {
    void recordProcessError(caseId, runId, settings, error);
    return;
  }
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.once('close', (code, signal) => {
    if (code === 0) return;
    const error = spawnError ?? new Error(`Run process exited with ${signal ?? `code ${code}`}.`);
    void recordProcessError(caseId, runId, settings, error);
  });
  child.unref();
}

function isLocalPage(request) {
  const { origin, host } = request.headers;
  return !origin || (/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && origin === `http://${host}`);
}

async function markBenchmarkError(id, error) {
  try {
    const benchmark = await readBenchmark(id);
    if (!benchmark || benchmark.worker_pid) return;
    await writeBenchmark({ ...benchmark, status: 'error', error: `Could not start the worker. ${error.message}` });
  } catch (writeError) {
    console.error(writeError);
  }
}

function launchBenchmark(id) {
  let child;
  try {
    // The worker writes one line for each finished run to a log file next to the benchmark.
    const log = openSync(benchmarkLogPath(id), 'a');
    try {
      child = spawn(process.execPath, [join(evalsDir, 'harness', 'cli.js'), 'bench', id], {
        cwd: repoDir, stdio: ['ignore', log, log], windowsHide: true, detached: true,
      });
    } finally {
      closeSync(log);
    }
  } catch (error) {
    void markBenchmarkError(id, error);
    return;
  }
  child.once('error', error => void markBenchmarkError(id, error));
  child.unref();
}

// Stop and resume requests for one benchmark run one at a time.
const busyBenchmarks = new Set();

async function handleBenchmarks(request, response, rawId, action) {
  const { method } = request;
  if (method === 'GET' && rawId === undefined) {
    const benchmarks = await Promise.all((await listBenchmarkIds()).map(id => readBenchmark(id).catch(() => null)));
    return sendJson(response, 200, benchmarks.filter(Boolean).map(benchmarkSummary));
  }
  if (method === 'GET' && rawId === 'estimate' && action === undefined) {
    return sendJson(response, 200, await timeEstimates());
  }
  if (method === 'POST' && !isLocalPage(request)) {
    return sendJson(response, 403, { error: 'Use the local eval page.' });
  }
  if (method === 'POST' && rawId === undefined) {
    let config;
    try {
      config = await validateBenchmarkConfig(await readBody(request, 64));
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
    const benchmark = newBenchmark(config);
    await writeBenchmark(benchmark);
    launchBenchmark(benchmark.id);
    return sendJson(response, 202, { id: benchmark.id });
  }

  const id = decodeURIComponent(rawId ?? '');
  if (!validRunId(id)) return sendJson(response, 400, { error: 'Invalid benchmark ID.' });
  if (method === 'GET' && action === undefined) {
    const benchmark = await readBenchmark(id);
    if (!benchmark) return sendJson(response, 404, { error: 'Benchmark not found.' });
    return sendJson(response, 200, { ...benchmark, status: benchmarkStatus(benchmark) });
  }
  if (method !== 'POST' || !['stop', 'resume'].includes(action)) {
    return sendJson(response, 404, { error: 'Page not found.' });
  }
  if (busyBenchmarks.has(id)) return sendJson(response, 409, { error: 'Wait for the last request to finish.' });
  busyBenchmarks.add(id);
  try {
    const benchmark = action === 'stop' ? await stopBenchmark(id) : await prepareResume(id);
    if (!benchmark) return sendJson(response, 404, { error: 'Benchmark not found.' });
    if (action === 'resume') launchBenchmark(id);
    return sendJson(response, 200, { status: benchmarkStatus(benchmark) });
  } catch (error) {
    return sendJson(response, 409, { error: error.message });
  } finally {
    busyBenchmarks.delete(id);
  }
}

async function caseDetail(testCase) {
  const dir = caseDir(testCase.id);
  const [runs, graders, labels] = await Promise.all([
    listRuns(testCase.id),
    Promise.all(graderKinds.map(async kind => {
      const [tests, prompt] = await Promise.all([
        readOptional(join(dir, kind, 'tests.js')),
        readOptional(join(dir, kind, 'prompt.md')),
      ]);
      return [kind, { tests, prompt }];
    })),
    readJson(join(dataDir, testCase.scenario, 'labels.json')).catch(() => null),
  ]);
  const ids = [...(testCase.incidents ?? []), ...testCase.noise];
  const matching = (Array.isArray(labels) ? labels : []).filter(label => ids.includes(label?.id));
  // A case without its own info shows the info that the incident generator made.
  const incidentInfo = matching.find(label => testCase.incidents?.includes(label.id) && label.info)?.info;
  return {
    ...testCase,
    ...(testCase.info || !incidentInfo ? {} : { info: incidentInfo }),
    graders: Object.fromEntries(graders),
    runs,
    labels: matching.map(({ info: _info, ...label }) => label),
  };
}

export async function handleRequest(request, response) {
  try {
    const path = request.url.split('?')[0];
    const [, api, resource, rawCaseId, tail, ...extra] = path.split('/');
    const { method } = request;

    if (method === 'GET' && (path === '/dashboard/' || path === '/dashboard/index.html')) {
      return await sendFile(response, dashboardFile, contentTypes['.html'], 'no-cache');
    }
    if (method === 'GET' && path.startsWith('/data/')) return await serveData(path, response);

    if (method === 'GET' && path !== '/api' && !path.startsWith('/api/')) {
      return await serveStatic(path, response);
    }
    if (method === 'GET' && path === '/api/judge/options') {
      return sendJson(response, 200, await judgeOptions());
    }
    if (method === 'GET' && path === '/api/cases') {
      const cases = await listCases();
      const summaries = await Promise.all(cases.map(async ({ id, title, tags }) => {
        const [last_run = null] = await listRuns(id, 1);
        return { id, title, tags, last_run };
      }));
      return sendJson(response, 200, summaries);
    }

    if (api === 'api' && resource === 'benchmarks' && !extra.length) {
      return await handleBenchmarks(request, response, rawCaseId || undefined, tail);
    }
    if (api !== 'api' || !['cases', 'runs'].includes(resource) || extra.length || !rawCaseId) {
      return sendJson(response, 404, { error: 'Page not found.' });
    }
    const caseId = decodeURIComponent(rawCaseId);
    if (!validId(caseId)) return sendJson(response, 400, { error: 'Invalid case ID.' });

    if (method === 'GET' && resource === 'runs' && tail) {
      const runId = decodeURIComponent(tail);
      if (!validRunId(runId)) return sendJson(response, 400, { error: 'Invalid run ID.' });
      const run = await readRunStatus(caseId, runId);
      return run ? sendJson(response, 200, run) : sendJson(response, 404, { error: 'Run not found.' });
    }

    if (resource === 'cases' && ((method === 'GET' && tail === undefined)
        || (method === 'POST' && tail === 'run'))) {
      const testCase = await readCase(caseId);
      if (!testCase) return sendJson(response, 404, { error: 'Case not found.' });
      if (method === 'GET') return sendJson(response, 200, await caseDetail(testCase));

      if (!isLocalPage(request)) {
        return sendJson(response, 403, { error: 'Start the run from the local eval page.' });
      }
      let settings;
      try {
        settings = await readRunSettings(request);
      } catch (error) {
        return sendJson(response, 400, { error: error.message });
      }
      const run_id = newRunId();
      launchRun(caseId, run_id, settings);
      return sendJson(response, 202, { run_id });
    }
    return sendJson(response, 404, { error: 'Page not found.' });
  } catch (error) {
    if (error instanceof URIError) return sendJson(response, 400, { error: 'Invalid URL.' });
    console.error(error);
    return sendJson(response, 500, { error: error.message });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4317);
  createServer(handleRequest).listen(port, '127.0.0.1', () => {
    console.log(`Open http://127.0.0.1:${port}`);
  });
}
