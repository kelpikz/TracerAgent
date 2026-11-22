import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { AgentChoice, CaseDetail, CaseSummary, JudgeChoice, Run, RunSummary } from './types';

const POLL_MS = 1500;
const SLOW_POLL_MS = 5000;
const CONNECTION_NOTICE = 'Lost contact with the eval server. Trying again.';

function summaryOf(run: Run): RunSummary {
  const { run_id, status, started_at, ended_at, agent } = run;
  return {
    run_id, status, started_at, ended_at, agent,
    judge_model: run.judge?.model ?? null,
    steps: run.transcript?.steps.length ?? null,
    cost_usd: run.transcript?.usage?.cost_usd ?? null,
    score_total: run.score?.total ?? null,
  };
}

function readHash() {
  const [caseId, runId] = location.hash.replace(/^#\/?/, '').split('/');
  return { caseId: caseId ? decodeURIComponent(caseId) : null, runId: runId ? decodeURIComponent(runId) : null };
}

function writeHash(caseId: string | null, runId: string | null) {
  try {
    const hash = caseId ? `#/${encodeURIComponent(caseId)}${runId ? `/${encodeURIComponent(runId)}` : ''}` : '';
    history.replaceState(null, '', `${location.pathname}${hash}`);
  } catch {
    // The URL cannot change. Do nothing.
  }
}

export function useEvals() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Async callbacks read the current selection here, so they never use stale values.
  const selection = useRef<{ caseId: string | null; runId: string | null }>({ caseId: null, runId: null });
  const watches = useRef(new Set<string>());

  const select = useCallback((nextCase: string | null, nextRun: string | null) => {
    selection.current = { caseId: nextCase, runId: nextRun };
    setCaseId(nextCase);
    setRunId(nextRun);
    writeHash(nextCase, nextRun);
  }, []);

  const applyRun = useCallback((forCase: string, next: Run) => {
    const summary = summaryOf(next);
    setCases(list => list?.map(item => (
      item.id === forCase && (!item.last_run || item.last_run.run_id <= summary.run_id)
        ? { ...item, last_run: summary }
        : item
    )) ?? list);
    setDetail(current => {
      if (!current || current.id !== forCase) return current;
      const runs = [summary, ...current.runs.filter(item => item.run_id !== summary.run_id)]
        .sort((a, b) => b.run_id.localeCompare(a.run_id));
      return { ...current, runs };
    });
    if (selection.current.caseId === forCase && selection.current.runId === next.run_id) setRun(next);
  }, []);

  const watchRun = useCallback((forCase: string, forRun: string) => {
    if (watches.current.has(forRun)) return;
    watches.current.add(forRun);
    let failures = 0;
    const check = async () => {
      try {
        const next = await api.run(forCase, forRun);
        if (failures >= 8) setNotice(current => current === CONNECTION_NOTICE ? null : current);
        failures = 0;
        applyRun(forCase, next);
        if (next.status !== 'running') {
          watches.current.delete(forRun);
          return;
        }
      } catch {
        // Keep checking after a server restart, even if it takes a while to come back.
        failures += 1;
        if (failures === 8 && selection.current.caseId === forCase && selection.current.runId === forRun) {
          setNotice(CONNECTION_NOTICE);
        }
      }
      setTimeout(check, failures >= 8 ? SLOW_POLL_MS : POLL_MS);
    };
    setTimeout(check, POLL_MS);
  }, [applyRun]);

  const selectRun = useCallback(async (forCase: string, forRun: string) => {
    select(forCase, forRun);
    setRun(null);
    setRunLoading(true);
    try {
      const next = await api.run(forCase, forRun);
      if (selection.current.caseId !== forCase || selection.current.runId !== forRun) return;
      applyRun(forCase, next);
      setRun(next);
      if (next.status === 'running') watchRun(forCase, forRun);
    } catch (error) {
      if (selection.current.runId === forRun) setNotice(error instanceof Error ? error.message : 'Cannot read the run.');
    } finally {
      if (selection.current.runId === forRun) setRunLoading(false);
    }
  }, [applyRun, select, watchRun]);

  const openCase = useCallback(async (id: string, preferredRun: string | null = null) => {
    setNotice(null);
    setDetail(null);
    setRun(null);
    select(id, null);
    try {
      const next = await api.case(id);
      if (selection.current.caseId !== id) return;
      setDetail(next);
      const target = next.runs.find(item => item.run_id === preferredRun) ?? next.runs[0];
      if (target) {
        if (target.status === 'running') watchRun(id, target.run_id);
        await selectRun(id, target.run_id);
      }
    } catch (error) {
      if (selection.current.caseId === id) setNotice(error instanceof Error ? error.message : 'Cannot open the case.');
    }
  }, [select, selectRun, watchRun]);

  const startRun = useCallback(async (judge?: JudgeChoice | null, agent?: AgentChoice | null) => {
    const id = selection.current.caseId;
    if (!id) return;
    setNotice(null);
    setStarting(id);
    try {
      const { run_id } = await api.start(id, judge, agent);
      const now = new Date().toISOString();
      const placeholder = {
        run_id, status: 'running', started_at: now, ended_at: null, agent: null, transcript: null, error: null,
        agent_settings: agent ?? undefined,
      } satisfies Run;
      if (selection.current.caseId === id) {
        select(id, run_id);
        setRun(placeholder);
        setRunLoading(false);
      }
      applyRun(id, placeholder);
      watchRun(id, run_id);
    } catch (error) {
      if (selection.current.caseId === id) setNotice(error instanceof Error ? error.message : 'Cannot start the run.');
    } finally {
      setStarting(null);
    }
  }, [applyRun, select, watchRun]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = await api.cases();
        if (!live) return;
        setCases(list);
        for (const item of list) {
          if (item.last_run?.status === 'running') watchRun(item.id, item.last_run.run_id);
        }
        const hash = readHash();
        const first = list.find(item => item.id === hash.caseId) ?? list[0];
        if (first) await openCase(first.id, first.id === hash.caseId ? hash.runId : null);
      } catch (error) {
        if (live) setCasesError(error instanceof Error ? error.message : 'Cannot load the cases.');
      }
    })();
    return () => {
      live = false;
    };
  }, [openCase, watchRun]);

  const lastStatus = cases?.find(item => item.id === caseId)?.last_run?.status;
  const running = starting === caseId && caseId !== null ? true : lastStatus === 'running';

  return {
    cases, casesError, caseId, detail, runId, run, runLoading, notice, running,
    dismissNotice: () => setNotice(null),
    openCase: (id: string) => { if (id !== selection.current.caseId) void openCase(id); },
    selectRun: (id: string) => { if (selection.current.caseId) void selectRun(selection.current.caseId, id); },
    startRun,
  };
}
