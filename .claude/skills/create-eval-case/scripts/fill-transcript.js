// Fill the results of a draft transcript with the real agent tools on the case data.
// Usage: node .claude/skills/create-eval-case/scripts/fill-transcript.js <case-id> <draft.json> [--out <path>]
// The draft has `steps` with { type: "tool_call", tool, args } and a `final_output` string.
// The script sets `result` and `error` for each tool call. It writes to --out, or to standard output.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { TelemetryStore } from '../../../../agent/telemetry/store.js';
import { telemetryTools } from '../../../../agent/telemetry/tools.js';
import { ensureData } from '../../../../evals/harness/data.js';
import { readCase, readJson } from '../../../../evals/harness/storage.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
if (positionals.length !== 2) {
  console.error('Usage: fill-transcript.js <case-id> <draft.json> [--out <path>]');
  process.exit(1);
}
const [id, draftPath] = positionals;
const testCase = await readCase(id);
if (!testCase) throw new Error(`Case ${id} does not exist.`);
const store = new TelemetryStore(await ensureData(testCase));
const tools = new Map(telemetryTools.map(tool => [tool.name, tool]));
const draft = await readJson(resolve(draftPath));
if (!Array.isArray(draft?.steps)) throw new Error('The draft needs a steps array.');

for (const step of draft.steps) {
  if (step.type !== 'tool_call') continue;
  const tool = tools.get(step.tool);
  try {
    if (!tool) throw new Error(`Unknown tool ${step.tool}.`);
    step.result = await tool.run(store, step.args ?? {});
    step.error = null;
  } catch (error) {
    step.result = null;
    step.error = error.message;
  }
}
draft.final_output ??= '';
const text = `${JSON.stringify(draft, null, 2)}\n`;
if (values.out) await writeFile(resolve(values.out), text);
else process.stdout.write(text);
