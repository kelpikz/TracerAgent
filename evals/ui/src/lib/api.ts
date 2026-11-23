import type {
  AgentChoice, Benchmark, BenchmarkConfig, BenchmarkStatus, BenchmarkSummary, CaseDetail, CaseSummary, JudgeChoice,
  JudgeOptions, Run, TimeEstimates,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // The body is not JSON. The error below shows the status.
  }
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export const api = {
  cases: () => request<CaseSummary[]>('/api/cases'),
  case: (id: string) => request<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`),
  run: (caseId: string, runId: string) =>
    request<Run>(`/api/runs/${encodeURIComponent(caseId)}/${encodeURIComponent(runId)}`),
  judgeOptions: () => request<JudgeOptions>('/api/judge/options'),
  start: (caseId: string, judge?: JudgeChoice | null, agent?: AgentChoice | null) =>
    request<{ run_id: string }>(`/api/cases/${encodeURIComponent(caseId)}/run`, {
      method: 'POST',
      ...(judge || agent ? {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judge: judge ?? undefined, agent: agent ?? undefined }),
      } : {}),
    }),
  benchmarks: () => request<BenchmarkSummary[]>('/api/benchmarks'),
  benchmark: (id: string) => request<Benchmark>(`/api/benchmarks/${encodeURIComponent(id)}`),
  estimates: () => request<TimeEstimates>('/api/benchmarks/estimate'),
  createBenchmark: (config: BenchmarkConfig) =>
    request<{ id: string }>('/api/benchmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),
  benchmarkAction: (id: string, action: 'stop' | 'resume') =>
    request<{ status: BenchmarkStatus }>(`/api/benchmarks/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
};
