// Runs one incident through an architecture on a durable pi harness.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { getArchitecture } from './architectures/index.js';
import { createModels, parseModelRef } from './models.js';
import { TelemetryStore } from './telemetry/store.js';
import { toTranscript } from './transcript.js';

const RUNS_DIR = resolve(import.meta.dirname, '..', '.agent-runs');

/**
 * @param {object} options
 * @param {string} options.input         The incident text.
 * @param {string} options.dataDir       Scenario folder with telemetry.
 * @param {string} options.model         "provider/model-id".
 * @param {string} [options.effort]      Thinking level.
 * @param {string} [options.now]         Current time for the data. Default: meta.json or the data end.
 * @param {string} [options.architecture]
 * @param {string} [options.runId]       Same ID = same storage. A crashed run resumes.
 * @param {(line: string) => void} [options.log]
 */
export async function runIncident({ input, dataDir, model, effort = 'high', now, architecture, runId, log = () => {} }) {
  const arch = getArchitecture(architecture);
  const store = new TelemetryStore(dataDir, { now });
  const context = BACKGROUND_CONTEXT;
  const startedAt = new Date();

  const registry = createRegistry();
  for (const extension of arch.extensions({ store })) registry.install(extension);

  mkdirSync(RUNS_DIR, { recursive: true });
  const id = runId ?? `${arch.name}-${startedAt.toISOString().replace(/[:.]/g, '-')}`;
  const file = join(RUNS_DIR, `${id}.sqlite`);
  log(`architecture=${arch.name} model=${model} effort=${effort} store=${file}`);

  const harness = await Harness.open(await openNodeSqliteStorage(file), {
    models: createModels(),
    registry,
    identity: { attribution: null },
    onReport: report => log(`report: ${report.kind} ${report.error?.message ?? ''}`),
  }, context);

  try {
    const root = await harness.root(context, {
      agent: { model: parseModelRef(model), thinkingLevel: effort, ...arch.agent?.({ store }) },
    });
    harness.resume(); // continue work that a crashed earlier run left
    const settled = arch.run
      ? await arch.run({ harness, root, input, context })
      : await (await root.submit({ type: 'input', content: input, requestId: 'incident' }, context)).wait(context);
    if (settled.status !== 'done') log(`run ended without an answer: ${JSON.stringify(settled.settlement ?? settled)}`);

    const entries = [];
    let cursor;
    do {
      const page = await root.entries({ order: 'ascending' }, 500, cursor, context);
      entries.push(...page.items);
      cursor = page.next;
    } while (cursor);

    return toTranscript({
      entries,
      input,
      agent: { name: arch.name, model, effort },
      usage: await harness.usage(context),
      startedAt,
      endedAt: new Date(),
      runFile: file,
    });
  } finally {
    await harness.close(context);
  }
}
