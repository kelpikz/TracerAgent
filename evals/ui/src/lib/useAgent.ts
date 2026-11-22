import { useState } from 'react';
import type { AgentChoice, Architecture, JudgeOptions, RoleChoice } from './types';

const STORAGE_KEY = 'evals.agent';

function readSaved(): Partial<AgentChoice> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** Keeps only the agents of this architecture, and only models and efforts that the options list. */
function cleanAgents(agents: Record<string, RoleChoice> | undefined, arch: Architecture | undefined, models: string[], efforts: string[]) {
  const result: Record<string, RoleChoice> = {};
  for (const role of arch?.roles ?? []) {
    const choice = agents?.[role.name];
    const model = choice?.model && models.includes(choice.model) ? choice.model : undefined;
    const effort = choice?.effort && efforts.includes(choice.effort) ? choice.effort : undefined;
    if (model || effort) result[role.name] = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  }
  return Object.keys(result).length ? result : undefined;
}

export function useAgent(options: JudgeOptions | null) {
  const [saved, setSaved] = useState<Partial<AgentChoice>>(readSaved);
  const defaults = options?.agent_default;
  const architectures = options?.architectures ?? [];
  const models = options && defaults
    ? [...new Set([defaults.model, ...options.models])].sort()
    : [];

  let choice: AgentChoice | null = null;
  if (options && defaults) {
    const names = architectures.map(a => a.name);
    const architecture = saved.architecture && names.includes(saved.architecture)
      ? saved.architecture
      : defaults.architecture ?? names[0];
    const arch = architectures.find(a => a.name === architecture);
    choice = {
      model: saved.model && models.includes(saved.model) ? saved.model : defaults.model,
      effort: saved.effort && options.thinking.includes(saved.effort) ? saved.effort : defaults.effort,
      ...(architecture ? { architecture } : {}),
    };
    const agents = cleanAgents(saved.agents, arch, models, options.thinking);
    if (agents) choice.agents = agents;
  }
  const architecture = architectures.find(a => a.name === choice?.architecture) ?? null;

  function save(next: Partial<AgentChoice>) {
    setSaved(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The choice stays in memory.
    }
  }

  function change(patch: Partial<AgentChoice>) {
    if (!choice) return;
    // Keep the per-agent choices of other architectures, so a switch back restores them.
    save({ ...saved, ...choice, agents: saved.agents, ...patch });
  }

  /** Sets every agent at once. `undefined` fields use the run model and effort. */
  function changeAgents(agents: Record<string, RoleChoice>) {
    if (!choice) return;
    save({ ...saved, ...choice, agents: { ...saved.agents, ...agents } });
  }

  return { models, choice, change, changeAgents, architectures, architecture };
}
