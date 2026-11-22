import { parseArgs } from 'node:util';
import { validateAgent } from './agent.js';
import { generateData } from './data.js';
import { validateJudge } from './judge.js';
import { runCase } from './runner.js';
import { graderKinds, listCases, readCase, validId, validRunId } from './storage.js';

function printRun(run) {
  console.log(`${run.case_id}  ${run.status}  ${run.run_id}`);
  const { total, trajectory, outcome } = run.score;
  console.log(total === null ? '  score  n/a' :
    `  score  ${total.toFixed(2)}/10 (trajectory ${trajectory.score.toFixed(2)}/5, outcome ${outcome.score.toFixed(2)}/5)`);
  if (run.error) console.error(`  ${run.error.message}`);
  for (const kind of graderKinds) {
    for (const [method, grade] of Object.entries(run.graders[kind])) {
      const scores = grade.items.map(({ name, score }) => `${name}=${score ?? 'error'}`);
      const detail = [grade.error?.message ?? grade.reason, ...scores].filter(Boolean).join(', ');
      console.log(`  ${kind} ${method}  ${grade.status}${detail ? `  ${detail}` : ''}`);
    }
  }
}

function parseRunArgs(args) {
  const { values, positionals, tokens } = parseArgs({
    args,
    options: {
      all: { type: 'boolean' },
      'run-id': { type: 'string' },
      'judge-model': { type: 'string' },
      'judge-thinking': { type: 'string' },
      'agent-model': { type: 'string' },
      'agent-effort': { type: 'string' },
      'agent-arch': { type: 'string' },
      'agent-roles': { type: 'string' },
    },
    allowPositionals: true,
    tokens: true,
  });
  const flags = tokens.filter(token => token.kind === 'option').map(token => token.name);
  if (new Set(flags).size !== flags.length) throw new Error('Use each run flag once.');
  if (values.all ? positionals.length !== 0 : positionals.length !== 1 || !validId(positionals[0])) {
    throw new Error('Use run <case-id> or run --all.');
  }
  const runId = values['run-id'];
  if (runId !== undefined && !validRunId(runId)) throw new Error('Invalid run ID.');
  const judge = { model: values['judge-model'], thinking: values['judge-thinking'] };
  let agents;
  try {
    agents = values['agent-roles'] === undefined ? undefined : JSON.parse(values['agent-roles']);
  } catch {
    throw new Error('Use JSON for --agent-roles, for example {"critic":{"effort":"xhigh"}}.');
  }
  const agent = { model: values['agent-model'], effort: values['agent-effort'], architecture: values['agent-arch'], agents };
  validateJudge(judge);
  validateAgent(agent);
  return { all: values.all, id: positionals[0], runId, judge, agent };
}

async function main([command, ...args]) {
  if (command === 'list' && args.length === 0) {
    for (const testCase of await listCases()) console.log(`${testCase.id}  ${testCase.title}`);
    return;
  }
  if (command === 'data') {
    const all = args.length === 1 && args[0] === '--all';
    if (!all && (args.length !== 1 || !validId(args[0]))) throw new Error('Use data <case-id> or data --all.');
    const cases = all ? await listCases() : [await readCase(args[0])];
    if (!cases[0] && !all) throw new Error(`Case ${args[0]} does not exist.`);
    for (const testCase of cases) await generateData(testCase);
    return;
  }
  if (command !== 'run') throw new Error('Use list, data <case-id>, data --all, run <case-id>, or run --all.');
  const { all, id, runId, judge, agent } = parseRunArgs(args);
  const cases = all ? await listCases() : [await readCase(id)];
  if (!cases[0] && !all) throw new Error(`Case ${id} does not exist.`);
  for (const testCase of cases) {
    const run = await runCase(testCase, runId, judge, agent);
    printRun(run);
    if (run.status === 'error') process.exitCode = 1;
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
