import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { JudgeChoice, JudgeOptions } from './types';

const STORAGE_KEY = 'evals.judge';

function readSaved(): Partial<JudgeChoice> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function save(choice: JudgeChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Storage is not available. The choice stays in memory.
  }
}

export function judgeLabel(choice: { model: string; thinking: string }) {
  return `${choice.model.split('/').pop()} · ${choice.thinking}`;
}

/** Loads the judge options once. The user choice is saved in localStorage. */
export function useJudge() {
  const [options, setOptions] = useState<JudgeOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Partial<JudgeChoice>>(readSaved);

  useEffect(() => {
    let live = true;
    api
      .judgeOptions()
      .then(next => live && setOptions(next))
      .catch(error => live && setLoadError(error instanceof Error ? error.message : 'Cannot load the judge options.'));
    return () => {
      live = false;
    };
  }, []);

  // With no model list, the server defaults are used. We send no choice.
  const choice = useMemo<JudgeChoice | null>(() => {
    if (!options || options.models.length === 0) return null;
    const model = saved.model && options.models.includes(saved.model) ? saved.model : options.default.model;
    const thinking = saved.thinking && options.thinking.includes(saved.thinking) ? saved.thinking : options.default.thinking;
    return { model, thinking };
  }, [options, saved]);

  const change = useCallback(
    (patch: Partial<JudgeChoice>) => {
      if (!choice) return;
      const next = { ...choice, ...patch };
      setSaved(next);
      save(next);
    },
    [choice],
  );

  return { options, error: options?.error ?? loadError, choice, change };
}
