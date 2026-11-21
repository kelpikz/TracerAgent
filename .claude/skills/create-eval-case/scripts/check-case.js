import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gradeWithJudge, judgeDefaults, validateJudge } from '../../../../evals/harness/judge.js';
import { gradeDeterministic } from '../../../../evals/harness/runner.js';
import { hasData } from '../../../../evals/harness/data.js';
import { scoreRun } from '../../../../evals/harness/score.js';
import {
  caseDir, graderKinds, newRunId, readCase, readJson, readOptional, repoDir,
} from '../../../../evals/harness/storage.js';

const usage = 'Usage: node .claude/skills/create-eval-case/scripts/check-case.js <case-id> '
  + '[--transcript <path>] [--judge] [--judge-model <provider/id>] [--judge-thinking <level>] [--json]';
const emptyTranscript = { steps: [], final_output: '' };
const symbols = { ok: '✓', warning: '⚠', error: '✗' };
// Keep this list in sync with the hash routes in dashboard/index.html.
const dashboardHash = /^#(?:(?:overview|map|services|deps|business|logs|changes|noise)|traces(?:\/[a-f0-9]+)?|orders(?:\/ord_[A-Z0-9]+)?)$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseOptions(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      transcript: { type: 'string' },
      judge: { type: 'boolean' },
      'judge-model': { type: 'string' },
      'judge-thinking': { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length !== 1) throw new Error(usage);
  validateJudge({ model: values['judge-model'], thinking: values['judge-thinking'] });
  const defaults = judgeDefaults();
  return {
    id: positionals[0],
    transcriptPath: values.transcript,
    judge: values.judge ? {
      model: values['judge-model'] ?? defaults.model,
      thinking: values['judge-thinking'] ?? defaults.thinking,
    } : null,
  };
}

async function checkNoise(testCase, dataDir, labels, add) {
  if (testCase.noise.length === 0) return;
  const overlayFile = await readOptional(join(dataDir, 'noise.js'));
  // The dashboard loads the generator's JSON as a JavaScript assignment.
  const overlayJson = overlayFile?.match(/^\s*window\.TRACER_NOISE\s*=\s*([\s\S]+);\s*$/)?.[1];
  const overlays = overlayJson === undefined ? null : JSON.parse(overlayJson);
  const catalogs = [labels, overlays].filter(Array.isArray);
  const ids = new Set(catalogs.flat().map(entry => entry?.id).filter(id => typeof id === 'string'));
  const invalid = testCase.noise.filter(id => typeof id !== 'string' || id.trim() === '');
  const unknown = testCase.noise.filter(id => typeof id === 'string' && id.trim() && !ids.has(id));

  if (invalid.length) add('error', 'noise', 'Use nonempty strings for noise IDs.');
  if (catalogs.length === 0) {
    add('warning', 'noise', 'No noise catalog is available for this scenario.');
  } else if (unknown.length) {
    add('error', 'noise', `Unknown noise ID for ${testCase.scenario}: ${unknown.join(', ')}.`);
  } else if (invalid.length === 0) {
    add('ok', 'noise', testCase.noise.join(', '));
  }
}

function checkIncidents(testCase, labels, info, add) {
  const ids = testCase.incidents ?? [];
  if (ids.length === 0) return;
  const known = new Map((Array.isArray(labels) ? labels : []).map(label => [label?.id, label]));
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) {
    add('error', 'incidents', `No label for ${unknown.join(', ')} in data/${testCase.scenario}/labels.json. `
      + 'Add the incident to seed/incidents.py and generate the data again.');
    return;
  }
  add('ok', 'incidents', ids.join(', '));
  for (const id of ids) {
    const generated = known.get(id).info;
    if (!generated) add('warning', `incident ${id}`, 'Set c.info in the incident so the Info tab can show it.');
    const signals = (info ?? generated)?.signals ?? [];
    signals.forEach(({ when, dashboard }, index) => {
      if (!when?.trim() || !dashboard) {
        add('warning', `incident ${id} signals[${index}]`, 'Give each signal a UTC time and a dashboard link.');
      }
    });
  }
}

async function loadTranscript(path) {
  let transcript;
  try {
    transcript = await readJson(path);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
  if (transcript === null) throw new Error(`Missing transcript or null JSON in ${path}.`);
  if (!Array.isArray(transcript.steps) || typeof transcript.final_output !== 'string') {
    throw new Error('Use a steps array and a final_output string.');
  }
  for (const [index, step] of transcript.steps.entries()) {
    if (!isObject(step)) throw new Error(`steps[${index}] must be an object.`);
    if (step.type === 'tool_call'
        && (typeof step.tool !== 'string' || !step.tool.trim() || !isObject(step.args))) {
      throw new Error(`steps[${index}] is a tool_call. Give it a nonempty tool name and an args object.`);
    }
  }
  return transcript;
}

function lintRubric(rubric, name, add) {
  const sections = rubric.split(/^ {0,3}(?:#{1,6}\s+)?\d+[.)]\s+/m).slice(1);
  if (sections.length === 0) {
    add('warning', name, 'Add numbered rubric items.');
    return;
  }
  const missing = sections.flatMap((section, index) => {
    const anchors = new Set(Array.from(section.matchAll(
      /^\s*(?:[-+*]\s+)?(?:\*\*|\x60)?(0\.5|[01])(?:\*\*|\x60)?(?:[.):=](?!\d)|\s+-\s+)/gm,
    ), match => match[1]));
    const required = ['1', '0'].filter(score => !anchors.has(score));
    const title = section.split(/\r?\n/, 1)[0].trim();
    return required.length ? [`Item ${index + 1} (${title}) needs score anchors for ${required.join(', ')}.`] : [];
  });
  for (const message of missing) add('warning', name, message);
  if (missing.length === 0) add('ok', name, `${sections.length} items with score anchors.`);
}

function reportGrade(grade, name, add, { empty = false } = {}) {
  const { status, items, summary } = grade;
  if (status === 'missing') {
    if (!empty) add('warning', name, 'File is missing.');
    return grade;
  }
  const error = grade.error?.message ?? grade.reason;
  if (status !== 'done' || items.length === 0) {
    const message = error ?? 'Returned zero items.';
    add('error', name, message, { items });
    return { ...grade, status: 'error' };
  }
  const positive = empty && items.some(item => item.score > 0);
  const message = positive ? 'The empty transcript earned credit.' : summary ?? `${items.length} scored items.`;
  add(positive ? 'warning' : 'ok', name, message, { items });
  return grade;
}

async function checkGrader(kind, { testCase, transcript, labels, judge }, add) {
  const dir = join(caseDir(testCase.id), kind);
  const testPath = join(dir, 'tests.js');
  const testName = `${kind}/tests.js`;
  const promptName = `${kind}/prompt.md`;
  const rubric = await readOptional(join(dir, 'prompt.md'));
  if (rubric === null) add('warning', promptName, 'File is missing.');
  else lintRubric(rubric, promptName, add);

  const judgeResult = judge && rubric !== null
    ? gradeWithJudge(rubric, testCase.input, transcript, judge.model, judge.thinking)
    : null;
  const runId = newRunId();
  const workerOptions = { outputToStderr: true };
  const grade = await gradeDeterministic(testPath, runId, transcript, testCase, labels, workerOptions);
  const deterministic = reportGrade(grade, testName, add);
  if (grade.status !== 'missing') {
    const empty = await gradeDeterministic(testPath, runId, emptyTranscript, testCase, labels, workerOptions);
    reportGrade(empty, `${testName} (empty transcript)`, add, { empty: true });
  }
  const llm = judgeResult && reportGrade(await judgeResult, `${promptName} (judge)`, add);
  return { deterministic, llm };
}

async function checkCase(args, report, add) {
  const { id, transcriptPath, judge } = parseOptions(args);
  report.case_id = id;
  report.judge = judge;

  let testCase;
  try {
    testCase = await readCase(id);
    if (testCase === null) throw new Error(`Missing case.json or null JSON for ${id}.`);
    add('ok', 'case.json', testCase.title);
  } catch (error) {
    add('error', 'case.json', error.message);
    return;
  }

  if (!testCase.info && testCase.incidents?.length) {
    add('ok', 'info', 'The Info tab uses the info from the incident.');
  } else if (!testCase.info) {
    add('warning', 'info', 'Add an info object for the Info tab.');
  } else {
    add('ok', 'info', 'Case info has valid fields.');
    for (const [index, { dashboard }] of testCase.info.signals.entries()) {
      if (dashboard && !dashboardHash.test(dashboard)) {
        add('warning', `info.signals[${index}].dashboard`, `Unsupported dashboard hash: ${dashboard}`);
      }
    }
  }

  const dataDir = join(repoDir, 'data', testCase.scenario);
  if (!(await hasData(testCase))) {
    add('error', 'scenario', `No data in data/${testCase.scenario}/. Run: npm run eval -- data ${id}`);
    return;
  }
  if (testCase.scenario !== id) {
    add('warning', 'scenario', `Use the case ID (${id}) as the scenario, so the case has its own data.`);
  } else {
    add('ok', 'scenario', `data/${testCase.scenario}/`);
  }
  const labels = await readJson(join(dataDir, 'labels.json'));
  await checkNoise(testCase, dataDir, labels, add);
  checkIncidents(testCase, labels, testCase.info, add);

  const path = transcriptPath === undefined ? join(caseDir(id), 'fixtures', 'good_transcript.json') : resolve(transcriptPath);
  let transcript;
  try {
    transcript = await loadTranscript(path);
    add('ok', 'transcript', `${transcript.steps.length} steps in ${transcriptPath ?? 'fixtures/good_transcript.json'}.`);
  } catch (error) {
    add('error', 'transcript', error.message);
    return;
  }

  const graders = {};
  for (const kind of graderKinds) {
    graders[kind] = await checkGrader(kind, { testCase, transcript, labels, judge }, add);
  }
  report.score = scoreRun({ graders });
}

function printReport({ case_id: id, judge, checks, score }) {
  if (id) console.log(`Case ${id}${judge ? ` (judge: ${judge.model}, effort: ${judge.thinking})` : ''}`);
  for (const { status, name, message, items } of checks) {
    console.log(`${symbols[status]} ${name}: ${message}`);
    for (const item of items ?? []) {
      const detail = [item.reason, item.error].filter(Boolean).join(' ');
      console.log(`  ${item.name}: ${item.score ?? 'error'}${detail ? ` (${detail})` : ''}`);
    }
  }
  if (score) {
    const points = result => result.score === null ? 'n/a' : `${result.score.toFixed(2)}/${result.max}`;
    console.log(`Score: ${points({ score: score.total, max: score.max })} `
      + `(trajectory ${points(score.trajectory)}, outcome ${points(score.outcome)})`);
  }
}

const args = process.argv.slice(2);
const report = { case_id: null, judge: null, checks: [], score: null };
const add = (status, name, message, details) => report.checks.push({ status, name, message, ...details });
try {
  await checkCase(args, report, add);
} catch (error) {
  add('error', 'check-case', error.message);
}

if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else printReport(report);
process.exitCode = report.checks.some(check => check.status === 'error') ? 1 : 0;
