// Runs one incident through an architecture on a durable pi harness.
import { randomBytes } from 'node:crypto';
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

async function readEntries(conversation, context) {
  const entries = [];
  let cursor;
  do {
    const page = await conversation.entries({ order: 'ascending' }, 500, cursor, context);
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return entries;
}

/** Entries of every subagent conversation, found through `details.conversationId` of tool results. */
async function readChildren(harness, entries, context, children = new Map()) {
  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      const id = (entry.data?.details ?? message.details)?.conversationId;
      if (message.role !== 'toolResult' || !id || children.has(id)) continue;
      const child = await harness.conversation(id, context);
      if (!child) continue;
      const childEntries = await readEntries(child, context);
      children.set(id, childEntries);
      await readChildren(harness, childEntries, context, children);
    }
  }
  return children;
}

/**
 * @param {object} options
 * @param {string} options.input         The incident text.
 * @param {string} options.dataDir       Scenario folder with telemetry.
 * @param {string} options.model         "provider/model-id".
 * @param {string} [options.effort]      Thinking level.
 * @param {string} [options.now]         Current time for the data. Default: meta.json or the data end.
 * @param {string} [options.architecture]
 * @param {string} [options.runId]       Same ID = same storage. A crashed run resumes.
 * @param {Record<string, { model?: string, effort?: string }>} [options.agents]
 *                                        Model and effort for each agent of a multi-agent architecture.
 * @param {(line: string) => void} [options.log]
 */
export async function runIncident({ input, dataDir, model, effort = 'high', now, architecture, runId, agents, models, log = () => {} }) {
  const arch = getArchitecture(architecture);
  const unknown = Object.keys(agents ?? {}).filter(role => !arch.roles?.some(r => r.name === role));
  if (unknown.length) throw new Error(`Architecture "${arch.name}" has no agent ${unknown.join(', ')}.`);
  const store = new TelemetryStore(dataDir, { now });
  const context = BACKGROUND_CONTEXT;
  const startedAt = new Date();

  const registry = createRegistry();
  for (const extension of arch.extensions({ store, agents })) registry.install(extension);

  mkdirSync(RUNS_DIR, { recursive: true });
  // The random suffix keeps parallel runs that start in the same ms apart.
  const id = runId ?? `${arch.name}-${startedAt.toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const file = join(RUNS_DIR, `${id}.sqlite`);
  log(`architecture=${arch.name} model=${model} effort=${effort} store=${file}`);
  if (agents) log(`agents=${JSON.stringify(agents)}`);

  const harness = await Harness.open(await openNodeSqliteStorage(file), {
    models: models ?? createModels(),
    registry,
    identity: { attribution: null },
    onReport: report => log(`report: ${report.kind} ${report.error?.message ?? ''}`),
  }, context);

  try {
    const root = await harness.root(context, {
      agent: { model: parseModelRef(model), thinkingLevel: effort, ...arch.agent?.({ store, agents }) },
    });
    harness.resume(); // continue work that a crashed earlier run left
    const settled = arch.run
      ? await arch.run({ harness, root, input, context })
      : await (await root.submit({ type: 'input', content: input, requestId: 'incident' }, context)).wait(context);
    if (settled.status !== 'done') log(`run ended without an answer: ${JSON.stringify(settled.settlement ?? settled)}`);

    const entries = await readEntries(root, context);
    const children = await readChildren(harness, entries, context);

    return toTranscript({
      entries,
      children,
      rootAgent: arch.rootAgent,
      finalTool: arch.finalTool,
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
