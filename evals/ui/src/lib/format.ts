import type { ErrorInfo, RunSummary, Status, Step } from './types';

export const statusLabels: Record<Status | 'none', string> = {
  done: 'Done',
  running: 'Running',
  error: 'Error',
  interrupted: 'Interrupted',
  skipped: 'Skipped',
  missing: 'Missing',
  pending: 'Pending',
  none: 'No runs',
};

export function runStatusLabel(run: RunSummary) {
  return run.status === 'running' ? run.steps == null ? 'Investigating' : 'Grading' : statusLabels[run.status];
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function formatTime(iso: string | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

/** Time since a date, such as "45s ago", "1h 25m ago" or "1d 4h ago". */
export function formatAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '';
  const s = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return iso;
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ago`;
  if (h > 0) return `${h}h ${m % 60}m ago`;
  return `${m}m ago`;
}

/** A token count, such as "875", "10.7k" or "1.2M". */
export function formatTokens(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return '';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function scoreText(score: number) {
  return Number.isInteger(score) ? score.toFixed(1) : String(Math.round(score * 100) / 100);
}

/** A score with 1 decimal, such as "7.3". Shows a dash when there is no score. */
export function scoreOf(score: number | null | undefined) {
  return typeof score === 'number' ? score.toFixed(1) : '—';
}

/** Color classes for a ratio from 0 to 1. */
export function scoreTone(ratio: number) {
  if (ratio < 0.5) return { text: 'text-destructive', bar: 'bg-destructive' };
  if (ratio < 1) return { text: 'text-warning', bar: 'bg-warning' };
  return { text: 'text-success', bar: 'bg-success' };
}

export function average(scores: number[]) {
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

export function serviceOf(step: Step): string | undefined {
  const a = step.args;
  return a?.service ?? a?.labels?.service ?? a?.db ?? a?.labels?.db;
}

export function errorMessage(error: ErrorInfo | string): string {
  return typeof error === 'string' ? error : error.message ?? 'Unknown error.';
}
