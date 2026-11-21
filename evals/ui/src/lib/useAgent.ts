import { useState } from 'react';
import type { AgentChoice, JudgeOptions } from './types';

const STORAGE_KEY = 'evals.agent';

function readSaved(): Partial<AgentChoice> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function useAgent(options: JudgeOptions | null) {
  const [saved, setSaved] = useState<Partial<AgentChoice>>(readSaved);
  const defaults = options?.agent_default;
  const models = options && defaults
    ? [...new Set([defaults.model, ...options.models])].sort()
    : [];
  const choice = options && defaults ? {
    model: saved.model && models.includes(saved.model) ? saved.model : defaults.model,
    effort: saved.effort && options.thinking.includes(saved.effort) ? saved.effort : defaults.effort,
  } : null;

  function change(patch: Partial<AgentChoice>) {
    if (!choice) return;
    const next = { ...choice, ...patch };
    setSaved(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The choice stays in memory.
    }
  }

  return { models, choice, change };
}
