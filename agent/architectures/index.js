// Agent architectures. Add a file and list it here to test a new one.
//
// An architecture is an object with:
//   name, description
//   extensions({ store })  -> pi-durable extensions to install (tools, prompt sections, hooks, subagents)
//   agent({ store })       -> optional per-conversation choices (instructions, maxTurns, tools, ...)
//   run(ctx)               -> optional. Replaces the default "submit the incident and wait" flow.
//                             ctx: { harness, root, input, context }. Return the settled submission.
import single from './single-agent.js';

export const architectures = { [single.name]: single };

export const DEFAULT_ARCHITECTURE = single.name;

export function getArchitecture(name = DEFAULT_ARCHITECTURE) {
  const arch = architectures[name];
  if (!arch) throw new Error(`No architecture "${name}". Known: ${Object.keys(architectures).join(', ')}`);
  return arch;
}
