import type { ErrorInfo, Status, Step } from './types';

export const statusLabels: Record<Status | 'none', string> = {
  done: 'Done',
  running: 'Running',
  error: 'Error',
  skipped: 'Skipped',
  missing: 'Missing',
  pending: 'Pending',
  none: 'No runs',
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function formatTime(iso: string | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
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
