// Wraps the plain telemetry tools as one pi-durable extension.
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { telemetryTools } from '../telemetry/tools.js';

export const TELEMETRY_EXTENSION = 'telemetry';

/**
 * @param {import('../telemetry/store.js').TelemetryStore} store
 * @param {{ only?: string[] }} [options] Pick a subset of tools by name.
 */
export function createTelemetryExtension(store, { only } = {}) {
  const picked = only ? telemetryTools.filter(t => only.includes(t.name)) : telemetryTools;
  return defineExtension({
    name: TELEMETRY_EXTENSION,
    tools: picked.map(tool => defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      // Read-only, so a call cut off by a crash can run again.
      replay: 'safe',
      async execute(args) {
        const started = performance.now();
        // A throw becomes an error result that the model can read.
        const result = tool.run(store, args ?? {});
        return {
          output: [{ type: 'text', text: JSON.stringify(result) }],
          details: { duration_ms: Math.round(performance.now() - started) },
        };
      },
    })),
  });
}
