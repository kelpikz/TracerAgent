// Run one agent tool on the case data and print the result.
// Usage: node .claude/skills/create-eval-case/scripts/run-tool.js <case-id> <tool> ['<json args>']
//        node .claude/skills/create-eval-case/scripts/run-tool.js <case-id> --list
import { TelemetryStore } from '../../../../agent/telemetry/store.js';
import { telemetryTools } from '../../../../agent/telemetry/tools.js';
import { ensureData } from '../../../../evals/harness/data.js';
import { readCase } from '../../../../evals/harness/storage.js';

const [id, name, rawArgs = '{}'] = process.argv.slice(2);
if (!id || !name) {
  console.error("Usage: run-tool.js <case-id> <tool> ['<json args>'] | run-tool.js <case-id> --list");
  process.exit(1);
}
if (name === '--list') {
  for (const tool of telemetryTools) console.log(`${tool.name}: ${tool.description}`);
  process.exit(0);
}
const testCase = await readCase(id);
if (!testCase) throw new Error(`Case ${id} does not exist.`);
const tool = telemetryTools.find(t => t.name === name);
if (!tool) throw new Error(`Unknown tool ${name}. Use --list.`);
const store = new TelemetryStore(await ensureData(testCase));
try {
  console.log(JSON.stringify(await tool.run(store, JSON.parse(rawArgs)), null, 2));
} catch (error) {
  console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
