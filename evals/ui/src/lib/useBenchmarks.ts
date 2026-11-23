import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Benchmark, BenchmarkConfig, BenchmarkSummary } from './types';

const FAST_MS = 3000;
const SLOW_MS = 15000;

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Loads the benchmark list and one benchmark. Checks again often while a benchmark runs. */
export function useBenchmarks(active: boolean, selectedId: string | null) {
  const [list, setList] = useState<BenchmarkSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Benchmark | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!active) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let running = false;
      try {
        const next = await api.benchmarks();
        if (!live) return;
        setList(next);
        setListError(null);
        running = next.some(item => item.status === 'running');
      } catch (error) {
        if (live) setListError(message(error, 'Cannot load the benchmarks.'));
      }
      if (live) timer = setTimeout(load, running ? FAST_MS : SLOW_MS);
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, reload]);

  const id = active && selectedId && selectedId !== 'new' ? selectedId : null;
  useEffect(() => {
    setDetail(current => (current?.id === id ? current : null));
    setDetailError(null);
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let again = true;
      try {
        const next = await api.benchmark(id);
        if (!live) return;
        setDetail(next);
        setDetailError(null);
        again = next.status === 'running';
      } catch (error) {
        if (live) setDetailError(message(error, 'Cannot load the benchmark.'));
      }
      if (live && again) timer = setTimeout(load, FAST_MS);
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, reload]);

  const refresh = useCallback(() => setReload(n => n + 1), []);

  const create = useCallback(async (config: BenchmarkConfig) => {
    const { id: created } = await api.createBenchmark(config);
    refresh();
    return created;
  }, [refresh]);

  const act = useCallback(async (target: string, action: 'stop' | 'resume') => {
    try {
      await api.benchmarkAction(target, action);
    } finally {
      refresh();
    }
  }, [refresh]);

  return { list, listError, detail, detailError, create, act };
}
