// Loads one scenario folder and gives the tools fast, read-only access to it.
// The agent must never see labels.json: it holds the answers for the graders.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MINUTE = 60_000;

function readJson(dir, name, fallback) {
  const file = join(dir, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}

export class TelemetryStore {
  /** @param {string} dataDir @param {{ now?: string }} [options] */
  constructor(dataDir, { now } = {}) {
    this.dir = dataDir;
    const metrics = readJson(dataDir, 'metrics.json', null);
    if (!metrics) throw new Error(`No metrics.json in ${dataDir}`);
    this.metrics = metrics;
    this.start = Date.parse(metrics.start);
    this.stepMs = metrics.step_s * 1000;
    // "Now" is the end of the data window. The tools use it for the default window.
    const meta = readJson(dataDir, 'meta.json', {});
    this.now = parseTime(now ?? meta.now ?? this.start + (metrics.points - 1) * this.stepMs, 'now');
    this.topology = readJson(dataDir, 'topology.json', { services: [], edges: [] });
    this.alerts = readJson(dataDir, 'alerts.json', { firing: [], history: [], rules: [] });
    this.events = readJson(dataDir, 'events.json', []);
    this.runbooks = readJson(dataDir, 'runbooks.json', {});
    this.incidents = readJson(dataDir, 'incidents.json', []);
    this.#lazy = {};
  }

  #lazy;

  get logs() {
    return (this.#lazy.logs ??= readFileSync(join(this.dir, 'logs.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(line => {
        const row = JSON.parse(line);
        row._t = Date.parse(row.ts);
        return row;
      }));
  }

  get traces() {
    return (this.#lazy.traces ??= readJson(this.dir, 'traces.json', []).map(t => ({ ...t, _t: Date.parse(t.start) })));
  }

  get orders() {
    return (this.#lazy.orders ??= readJson(this.dir, 'orders.json', []));
  }

  /** Resolve a { from, to } window. Default: the last hour of data. */
  window(from, to) {
    const end = to ? parseTime(to, 'to') : this.now;
    const begin = from ? parseTime(from, 'from') : end - 60 * MINUTE;
    if (begin > end) throw new Error(`"from" (${iso(begin)}) is after "to" (${iso(end)}).`);
    return { from: begin, to: end };
  }

  /** Index range of metric points inside a window. */
  indexRange({ from, to }) {
    const first = Math.max(0, Math.ceil((from - this.start) / this.stepMs));
    const last = Math.min(this.metrics.points - 1, Math.floor((to - this.start) / this.stepMs));
    return { first, last };
  }

  timeAt(index) {
    return this.start + index * this.stepMs;
  }

  metricNames() {
    return [...new Set(this.metrics.series.map(s => s.name))];
  }

  /** All series with this name whose labels contain the given labels. */
  findSeries(name, labels = {}) {
    const byName = this.metrics.series.filter(s => s.name === name);
    if (!byName.length) {
      throw new Error(`No metric ${name}. Did you mean ${suggest(name, this.metricNames())}?`);
    }
    const matches = byName.filter(s => Object.entries(labels ?? {}).every(([k, v]) => String(s.labels[k]) === String(v)));
    if (!matches.length) {
      const options = byName.map(s => JSON.stringify(s.labels)).join(', ');
      throw new Error(`No ${name} series with labels ${JSON.stringify(labels)}. Labels that exist: ${options}`);
    }
    return matches;
  }
}

export function parseTime(value, field = 'time') {
  const t = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`Bad ${field} "${value}". Use an ISO time such as 2026-11-20T00:30:00Z.`);
  return t;
}

export const iso = t => new Date(t).toISOString();

/** The closest names by shared prefix and edit distance. */
export function suggest(name, options, count = 3) {
  const score = option => levenshtein(name, option) - (option.includes(name) || name.includes(option) ? 5 : 0);
  return [...options].sort((a, b) => score(a) - score(b)).slice(0, count).join(', ');
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
