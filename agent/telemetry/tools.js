// The read-only triage tools from system-design.html, section 3.
// Each tool is plain data + a function, so any agent framework can use it.
// Rules: time window with a default of the last hour, small output,
// compare to normal, return linking IDs, clear errors.
import { iso, parseTime, suggest } from './store.js';

const MINUTE = 60_000;
const MAX_POINTS = 60;

// ---------- small helpers ----------

const round = (n, d = 2) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const median = values => {
  const v = values.filter(x => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const percentile = (values, p) => {
  const v = values.filter(x => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] : null;
};

function windowArgs(store, args) {
  const w = args.window ?? args;
  return store.window(w.from, w.to);
}

function seriesSlice(store, series, win) {
  const { first, last } = store.indexRange(win);
  const values = series.values.slice(first, last + 1);
  return { values, first };
}

/** min / max / avg / last of one series in a window, plus the 24 h median as "normal". */
function summarize(store, series, win) {
  const { values, first } = seriesSlice(store, series, win);
  if (!values.length) return { note: 'No points in this window.' };
  let maxIndex = 0;
  values.forEach((v, i) => { if (v > values[maxIndex]) maxIndex = i; });
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    unit: series.unit,
    last: round(values.at(-1)),
    min: round(Math.min(...values)),
    max: round(values[maxIndex]),
    max_at: iso(store.timeAt(first + maxIndex)),
    avg: round(avg),
    normal: round(median(series.values)),
  };
}

function downsample(store, series, win) {
  const { values, first } = seriesSlice(store, series, win);
  const step = Math.max(1, Math.ceil(values.length / MAX_POINTS));
  const points = [];
  for (let i = 0; i < values.length; i += step) {
    // Keep the worst (largest) value of each bucket, so spikes stay visible.
    const bucket = values.slice(i, i + step);
    points.push({ at: iso(store.timeAt(first + i)), value: round(Math.max(...bucket)) });
  }
  return { step_s: (step * store.stepMs) / 1000, points };
}

function oneSeries(store, name, labels) {
  const matches = store.findSeries(name, labels);
  return matches[0];
}

function logText(row) {
  return Object.entries(row)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => (k === 'msg' ? String(v) : `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`))
    .join(' ')
    .toLowerCase();
}

// Remove PII in the tool, not in the prompt.
const PII = new Set(['user_id', 'client_ip', 'user_agent']);
const noPii = attrs => attrs && Object.fromEntries(Object.entries(attrs).filter(([k]) => !PII.has(k)));
const cleanLog = row => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_') && !PII.has(k)));

function requireKnown(value, known, what) {
  if (!known.includes(value)) {
    throw new Error(`No ${what} "${value}". Did you mean ${suggest(String(value), known)}? Known: ${known.join(', ')}`);
  }
}

function inWindow(t, win) {
  return t >= win.from && t <= win.to;
}

// ---------- JSON schema fragments ----------

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const FROM = str('Window start, ISO UTC time. Default: one hour before "to".');
const TO = str('Window end, ISO UTC time. Default: the end of the data ("now").');
const LIMIT = num('Max items to return. Default 20.');
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

// ---------- the tools ----------

export const TOOL_GROUPS = {
  Map: ['list_services', 'get_service_health'],
  Metrics: ['query_metric', 'top_endpoints', 'compare_windows'],
  Logs: ['search_logs', 'log_patterns', 'logs_by_trace'],
  Traces: ['find_traces', 'get_trace'],
  Changes: ['list_changes'],
  Dependencies: ['db_health', 'kafka_lag', 'dlq_sample', 'third_party_health'],
  Business: ['business_kpis', 'stuck_orders', 'get_order_timeline'],
  Context: ['list_alerts', 'get_runbook', 'past_incidents'],
};

/** @type {Array<{name:string, description:string, parameters:object, run:(store:any, args:any)=>any}>} */
export const telemetryTools = [
  {
    name: 'list_services',
    description: 'Service map: who calls whom, databases, Kafka topics and consumer groups, endpoints with normal p95 and error %. Use it to decide where to look next.',
    parameters: obj({}),
    run(store) {
      const { services, edges, kafka, endpoints } = store.topology;
      return { services, calls: edges, kafka, endpoints };
    },
  },
  {
    name: 'get_service_health',
    description: 'Is this service sick, and since when? RPS, error rate, p95/p99 latency, CPU, memory, restarts, ready pods in the window, compared to normal.',
    parameters: obj({ service: str('Service name, e.g. payment'), from: FROM, to: TO }, ['service']),
    run(store, { service, from, to }) {
      requireKnown(service, store.topology.services, 'service');
      const win = store.window(from, to);
      const names = ['http_requests_per_second', 'http_error_rate', 'http_latency_p95_ms', 'http_latency_p99_ms',
        'cpu_pct', 'memory_mb', 'pod_restarts', 'pods_ready'];
      const signals = {};
      const problems = [];
      for (const name of names) {
        const series = store.metrics.series.find(s => s.name === name && s.labels.service === service);
        if (!series) continue;
        const s = summarize(store, series, win);
        signals[name] = s;
        const isHigh = name === 'http_error_rate' ? s.max > Math.max(2, s.normal * 3)
          : name.startsWith('http_latency') ? s.max > s.normal * 2
            : name === 'pod_restarts' ? s.max > s.normal : false;
        if (isHigh) {
          const { values, first } = seriesSlice(store, series, win);
          const limit = name === 'http_error_rate' ? Math.max(2, s.normal * 3) : name === 'pod_restarts' ? s.normal : s.normal * 2;
          const i = values.findIndex(v => v > limit);
          problems.push(`${name} max ${s.max}${s.unit === '%' ? '%' : ` ${s.unit}`} (normal ${s.normal}) since ${iso(store.timeAt(first + i))}`);
        }
      }
      return { service, window: { from: iso(win.from), to: iso(win.to) }, healthy: problems.length === 0, problems, signals };
    },
  },
  {
    name: 'query_metric',
    description: 'One metric over time: the shape of the problem (spike, climb, drop to zero). Gives a summary with normal, and up to 60 points (worst value per bucket). If labels match several series, gives a summary per series.',
    parameters: obj({
      name: str('Metric name, e.g. http_error_rate or pg_replication_lag_s'),
      labels: { type: 'object', description: 'Label filter, e.g. {"service":"payment"} or {"db":"catalog"}', additionalProperties: { type: 'string' } },
      from: FROM, to: TO,
    }, ['name']),
    run(store, { name, labels = {}, from, to }) {
      const win = store.window(from, to);
      const matches = store.findSeries(name, labels);
      if (matches.length > 1) {
        return {
          name,
          note: 'Several series match. Add labels to get points for one.',
          series: matches.map(s => ({ labels: s.labels, ...summarize(store, s, win) })),
        };
      }
      const series = matches[0];
      return { name, labels: series.labels, ...summarize(store, series, win), ...downsample(store, series, win) };
    },
  },
  {
    name: 'top_endpoints',
    description: 'Which endpoint is the problem. Groups sampled server requests of a service by route. by = errors | latency | volume.',
    parameters: obj({
      service: str('Service name'),
      by: str('Sort key', { enum: ['errors', 'latency', 'volume'] }),
      from: FROM, to: TO, limit: LIMIT,
    }, ['service']),
    run(store, { service, by = 'errors', from, to, limit = 10 }) {
      requireKnown(service, store.topology.services, 'service');
      const win = store.window(from, to);
      const groups = new Map();
      for (const trace of store.traces) {
        if (!inWindow(trace._t, win)) continue;
        for (const span of trace.spans) {
          if (span.service !== service || span.kind !== 'server') continue;
          const g = groups.get(span.name) ?? { route: span.name, requests: 0, errors: 0, durations: [], sample_error_trace: null };
          g.requests++;
          g.durations.push(span.duration_ms);
          const status = span.attrs?.http_status;
          if (span.status === 'error' || status >= 500) {
            g.errors++;
            g.sample_error_trace ??= trace.trace_id;
          }
          groups.set(span.name, g);
        }
      }
      const normal = Object.fromEntries((store.topology.endpoints ?? []).filter(e => e.service === service).map(e => [e.route, e]));
      const rows = [...groups.values()].map(g => ({
        route: g.route,
        sampled_requests: g.requests,
        errors: g.errors,
        error_pct: round((g.errors / g.requests) * 100),
        normal_error_pct: normal[g.route]?.error_pct ?? null,
        p95_ms: round(percentile(g.durations, 95)),
        normal_p95_ms: normal[g.route]?.p95_ms ?? null,
        sample_error_trace: g.sample_error_trace,
      }));
      const key = { errors: r => r.errors, latency: r => r.p95_ms, volume: r => r.sampled_requests }[by] ?? (r => r.errors);
      rows.sort((a, b) => key(b) - key(a));
      return { service, by, note: 'Counts come from sampled traces, not all requests.', endpoints: rows.slice(0, limit) };
    },
  },
  {
    name: 'compare_windows',
    description: 'Did a metric change between two windows (for example before and after a deploy)? Gives avg / max / p95 for each and the change in %.',
    parameters: obj({
      metric: str('Metric name'),
      labels: { type: 'object', additionalProperties: { type: 'string' }, description: 'Label filter for one series' },
      a: obj({ from: str('ISO time'), to: str('ISO time') }, ['from', 'to']),
      b: obj({ from: str('ISO time'), to: str('ISO time') }, ['from', 'to']),
    }, ['metric', 'a', 'b']),
    run(store, { metric, labels = {}, a, b }) {
      const series = oneSeries(store, metric, labels);
      const stats = w => {
        const { values } = seriesSlice(store, series, store.window(w.from, w.to));
        const avg = values.reduce((x, y) => x + y, 0) / (values.length || 1);
        return { from: w.from, to: w.to, avg: round(avg), max: round(Math.max(...values)), p95: round(percentile(values, 95)) };
      };
      const sa = stats(a);
      const sb = stats(b);
      const change = sa.avg ? round(((sb.avg - sa.avg) / Math.abs(sa.avg)) * 100, 1) : null;
      return { metric, labels: series.labels, unit: series.unit, a: sa, b: sb, avg_change_pct: change };
    },
  },
  {
    name: 'search_logs',
    description: 'The real log lines. Filters by service, level and text, in a window. Text matches the message and fields as "key=value", case-insensitive (e.g. "job=price_import" or "stripe"). Logs from scheduled jobs use the service "cron".',
    parameters: obj({
      service: str('Service name, or "cron" for scheduled jobs'),
      level: str('Log level', { enum: ['info', 'warn', 'error'] }),
      text: str('Text to find'),
      from: FROM, to: TO, limit: LIMIT,
    }),
    run(store, { service, level, text, from, to, limit = 20 }) {
      const win = store.window(from, to);
      if (service) requireKnown(service, [...store.topology.services, 'cron'], 'service');
      const needle = text?.toLowerCase();
      const rows = store.logs.filter(r => inWindow(r._t, win)
        && (!service || r.service === service)
        && (!level || r.level === level)
        && (!needle || logText(r).includes(needle)));
      return { count: rows.length, shown: Math.min(rows.length, limit), samples: rows.slice(0, limit).map(cleanLog) };
    },
  },
  {
    name: 'log_patterns',
    description: 'What is new or growing. Groups log messages (numbers removed) in the window and compares each count to the window just before it.',
    parameters: obj({
      service: str('Service name, or "cron"'),
      level: str('Log level', { enum: ['info', 'warn', 'error'] }),
      from: FROM, to: TO, limit: LIMIT,
    }),
    run(store, { service, level, from, to, limit = 15 }) {
      const win = store.window(from, to);
      const prev = { from: win.from - (win.to - win.from), to: win.from };
      const key = r => `${r.service} ${r.level}: ${String(r.msg).replace(/\d+(\.\d+)?/g, '#')}`;
      const count = (w, map) => {
        for (const r of store.logs) {
          if (!inWindow(r._t, w) || (service && r.service !== service) || (level && r.level !== level)) continue;
          if (r.msg === 'request') continue; // gateway access logs: use top_endpoints
          const k = key(r);
          const e = map.get(k) ?? { pattern: k, count: 0, example: cleanLog(r) };
          e.count++;
          map.set(k, e);
        }
        return map;
      };
      const now = count(win, new Map());
      const before = count(prev, new Map());
      const rows = [...now.values()].map(e => ({
        pattern: e.pattern,
        count: e.count,
        previous_window: before.get(e.pattern)?.count ?? 0,
        new: !before.has(e.pattern),
        example: e.example,
      }));
      rows.sort((a, b) => (b.count - b.previous_window) - (a.count - a.previous_window) || b.count - a.count);
      return { window: { from: iso(win.from), to: iso(win.to) }, patterns: rows.slice(0, limit) };
    },
  },
  {
    name: 'logs_by_trace',
    description: 'The full story of one request: every log line with this trace_id, in time order.',
    parameters: obj({ trace_id: str('Trace ID') }, ['trace_id']),
    run(store, { trace_id }) {
      const rows = store.logs.filter(r => r.trace_id === trace_id).map(cleanLog);
      if (!rows.length) throw new Error(`No logs for trace ${trace_id}.`);
      return { trace_id, logs: rows };
    },
  },
  {
    name: 'find_traces',
    description: 'Sample failed or slow requests. Filters sampled traces by service, status, route and minimum duration.',
    parameters: obj({
      service: str('Service the trace touches'),
      status: str('Trace status', { enum: ['ok', 'error'] }),
      route: str('Root route text, e.g. "POST /checkout"'),
      min_duration_ms: num('Only traces slower than this'),
      from: FROM, to: TO, limit: LIMIT,
    }),
    run(store, { service, status, route, min_duration_ms, from, to, limit = 10 }) {
      const win = store.window(from, to);
      const rows = store.traces.filter(t => inWindow(t._t, win)
        && (!service || t.services.includes(service))
        && (!status || t.status === status)
        && (!route || t.root.toLowerCase().includes(route.toLowerCase()))
        && (!min_duration_ms || t.total_ms >= min_duration_ms));
      return {
        count: rows.length,
        traces: rows.slice(0, limit).map(t => {
          const failed = t.spans.find(s => s.status === 'error');
          return {
            trace_id: t.trace_id, start: t.start, root: t.root, status: t.status, http_status: t.http_status,
            total_ms: t.total_ms, services: t.services,
            failed_span: failed ? `${failed.service}: ${failed.name}${failed.attrs?.error ? ` (${failed.attrs.error})` : ''}` : null,
          };
        }),
      };
    },
  },
  {
    name: 'get_trace',
    description: 'Which hop failed, and where the time went. All spans of one trace with parent, offset, duration, status and attributes.',
    parameters: obj({ trace_id: str('Trace ID') }, ['trace_id']),
    run(store, { trace_id }) {
      const t = store.traces.find(x => x.trace_id === trace_id);
      if (!t) throw new Error(`No trace ${trace_id}. It may not be sampled. Use find_traces to get IDs.`);
      return {
        trace_id, root: t.root, start: t.start, status: t.status, http_status: t.http_status, total_ms: t.total_ms,
        spans: t.spans.map(s => ({
          id: s.span_id, parent: s.parent_id, service: s.service, name: s.name, kind: s.kind,
          offset_ms: s.offset_ms, duration_ms: s.duration_ms, status: s.status, attrs: noPii(s.attrs),
        })),
      };
    },
  },
  {
    name: 'list_changes',
    description: 'Deploys and config changes in a window, optionally for one service. Often the most likely cause.',
    parameters: obj({ from: FROM, to: TO, service: str('Only changes to this service') }),
    run(store, { from, to, service }) {
      const win = store.window(from, to);
      const changes = store.events.filter(e => inWindow(Date.parse(e.ts), win) && (!service || e.service === service));
      const lastBefore = store.events.filter(e => Date.parse(e.ts) < win.from && (!service || e.service === service)).at(-1);
      return { window: { from: iso(win.from), to: iso(win.to) }, changes, last_change_before_window: lastBefore ?? null };
    },
  },
  {
    name: 'db_health',
    description: 'Is the database the bottleneck? Up, query p95, connections, slow queries, disk, replication lag (catalog). Use db "redis" for Redis.',
    parameters: obj({ db: str('Database: users, catalog, orders, payments, shipments, or redis'), from: FROM, to: TO }, ['db']),
    run(store, { db, from, to }) {
      const win = store.window(from, to);
      const prefix = db === 'redis' ? 'redis_' : 'pg_';
      const series = store.metrics.series.filter(s => s.name.startsWith(prefix) && (db === 'redis' || s.labels.db === db));
      if (!series.length) {
        const dbs = [...new Set(store.metrics.series.filter(s => s.name.startsWith('pg_')).map(s => s.labels.db)), 'redis'];
        requireKnown(db, dbs, 'database');
      }
      const out = Object.fromEntries(series.map(s => [s.name, summarize(store, s, win)]));
      const slow = store.logs.filter(r => inWindow(r._t, win) && r.db === db && /slow/i.test(r.msg)).slice(0, 5).map(cleanLog);
      return { db, window: { from: iso(win.from), to: iso(win.to) }, metrics: out, slow_query_samples: slow };
    },
  },
  {
    name: 'kafka_lag',
    description: 'Are events stuck? Consumer lag and DLQ size per consumer group, with the topics each group reads.',
    parameters: obj({ group: str('Consumer group: order, delivery, notification'), from: FROM, to: TO }),
    run(store, { group, from, to }) {
      const win = store.window(from, to);
      const groups = Object.keys(store.topology.kafka?.consumer_groups ?? {});
      if (group) requireKnown(group, groups, 'consumer group');
      return {
        window: { from: iso(win.from), to: iso(win.to) },
        groups: (group ? [group] : groups).map(g => ({
          group: g,
          reads: store.topology.kafka.consumer_groups[g],
          consumer_lag: summarize(store, oneSeries(store, 'kafka_consumer_lag', { group: g }), win),
          dlq_size: summarize(store, oneSeries(store, 'kafka_dlq_size', { group: g }), win),
        })),
      };
    },
  },
  {
    name: 'dlq_sample',
    description: 'Why messages fail: recent messages moved to a dead letter queue, with the error. Filter by topic or consumer group.',
    parameters: obj({ topic: str('Kafka topic, e.g. delivery.updated'), group: str('Consumer group'), from: FROM, to: TO, limit: LIMIT }),
    run(store, { topic, group, from, to, limit = 10 }) {
      const win = from || to ? store.window(from, to) : { from: store.start, to: store.now };
      const rows = store.logs.filter(r => /dlq|dead letter/i.test(r.msg) && inWindow(r._t, win)
        && (!topic || r.topic === topic) && (!group || r.group === group));
      const errors = {};
      for (const r of rows) errors[r.error ?? 'unknown'] = (errors[r.error ?? 'unknown'] ?? 0) + 1;
      return { count: rows.length, by_error: errors, samples: rows.slice(-limit).map(cleanLog) };
    },
  },
  {
    name: 'third_party_health',
    description: 'Is it us or them? Request rate, error rate, p95 latency, and webhooks for one provider, compared to normal.',
    parameters: obj({ provider: str('stripe, carrier, or email'), from: FROM, to: TO }, ['provider']),
    run(store, { provider, from, to }) {
      const win = store.window(from, to);
      const series = store.metrics.series.filter(s => s.labels.provider === provider);
      if (!series.length) {
        requireKnown(provider, [...new Set(store.metrics.series.map(s => s.labels.provider).filter(Boolean))], 'provider');
      }
      const errors = store.logs.filter(r => inWindow(r._t, win) && r.level !== 'info'
        && (r.target === provider || r.carrier === provider || logText(r).includes(provider)));
      return {
        provider,
        window: { from: iso(win.from), to: iso(win.to) },
        metrics: Object.fromEntries(series.map(s => [s.name, summarize(store, s, win)])),
        error_log_count: errors.length,
        error_log_samples: errors.slice(0, 5).map(cleanLog),
      };
    },
  },
  {
    name: 'business_kpis',
    description: 'Are users affected, and how much? Checkout attempts and success, payment success, stuck orders, email failures in the window, compared to normal.',
    parameters: obj({ from: FROM, to: TO }),
    run(store, args) {
      const win = windowArgs(store, args);
      const names = ['checkout_attempts_per_min', 'checkout_success_rate', 'payment_success_rate', 'orders_pending',
        'orders_stuck_pending_15m', 'order_outbox_unpublished', 'emails_failed_per_min', 'auth_login_success_rate'];
      const m = Object.fromEntries(names.filter(n => store.metrics.series.some(s => s.name === n))
        .map(n => [n, summarize(store, oneSeries(store, n, {}), win)]));
      const attempts = seriesSlice(store, oneSeries(store, 'checkout_attempts_per_min', {}), win).values;
      const success = seriesSlice(store, oneSeries(store, 'checkout_success_rate', {}), win).values;
      const total = attempts.reduce((a, b) => a + b, 0);
      const ok = attempts.reduce((a, v, i) => a + v * (success[i] ?? 100) / 100, 0);
      return {
        window: { from: iso(win.from), to: iso(win.to) },
        checkout_attempts: Math.round(total),
        checkout_success_pct: total ? round((ok / total) * 100) : null,
        lowest_minute_checkout_success_pct: m.checkout_success_rate?.min ?? null,
        lowest_minute_payment_success_pct: m.payment_success_rate?.min ?? null,
        max_orders_stuck_pending_15m: m.orders_stuck_pending_15m?.max ?? null,
        metrics: m,
      };
    },
  },
  {
    name: 'stuck_orders',
    description: 'Real impact plus order IDs to trace: sampled orders that are still in a state (default PENDING) for longer than older_than_min, at a time (default now).',
    parameters: obj({
      state: str('Order status', { enum: ['NEW', 'PENDING', 'PAID', 'PAYMENT_FAILED', 'SHIPPED', 'DELIVERED'] }),
      older_than_min: num('Age in minutes. Default 15.'),
      at: str('ISO time to check at. Default: now.'),
      limit: LIMIT,
    }),
    run(store, { state = 'PENDING', older_than_min = 15, at, limit = 20 }) {
      const t = at ? parseTime(at, 'at') : store.now;
      // An order's state at time t is the last "status X" event at or before t.
      const stuck = [];
      for (const o of store.orders) {
        const created = Date.parse(o.created_at);
        if (created > t) continue;
        let status = 'NEW';
        let since = created;
        for (const e of o.timeline) {
          const ts = Date.parse(e.ts);
          if (ts > t) break;
          const m = /status (\w+)/.exec(e.event);
          if (m) { status = m[1]; since = ts; }
        }
        const age = (t - since) / MINUTE;
        if (status === state && age > older_than_min) {
          stuck.push({ order_id: o.order_id, created_at: o.created_at, in_state_since: iso(since), minutes: Math.round(age), amount: o.amount });
        }
      }
      const metric = store.metrics.series.find(s => s.name === 'orders_stuck_pending_15m');
      const idx = Math.min(store.metrics.points - 1, Math.max(0, Math.round((t - store.start) / store.stepMs)));
      return {
        at: iso(t),
        state,
        older_than_min,
        sampled_count: stuck.length,
        metric_orders_stuck_pending_15m: metric ? metric.values[idx] : null,
        note: 'orders.json holds a sample of checkouts. Use the metric for the full count.',
        orders: stuck.slice(0, limit),
      };
    },
  },
  {
    name: 'get_order_timeline',
    description: 'The full history of one customer order: each event with time, service, and trace_id.',
    parameters: obj({ order_id: str('Order ID, e.g. ord_CQV7SY') }, ['order_id']),
    run(store, { order_id }) {
      const o = store.orders.find(x => x.order_id === order_id);
      if (!o) throw new Error(`No order ${order_id} in the sample. Use stuck_orders or find_traces to get IDs.`);
      const { user_id: _pii, ...rest } = o; // Remove PII in the tool.
      return rest;
    },
  },
  {
    name: 'list_alerts',
    description: 'Where to start. Alerts by state: firing, resolved, or all, in an optional window. Also lists the alert rules.',
    parameters: obj({ state: str('Alert state', { enum: ['firing', 'resolved', 'all'] }), from: str('ISO time'), to: str('ISO time') }),
    run(store, { state = 'firing', from, to }) {
      const win = from || to ? store.window(from, to) : null;
      const all = [...store.alerts.history, ...store.alerts.firing.filter(f => !store.alerts.history.some(h => h.name === f.name && h.fired_at === f.fired_at))];
      const matches = all.filter(a => (state === 'all' || (state === 'firing' ? a.resolved_at == null : a.resolved_at != null))
        && (!win || (Date.parse(a.fired_at) <= win.to && (a.resolved_at == null || Date.parse(a.resolved_at) >= win.from))));
      return { now: iso(store.now), state, matches, rules: store.alerts.rules?.map(r => `${r.name}: ${r.rule} [${r.severity}]`) };
    },
  },
  {
    name: 'get_runbook',
    description: 'Known causes and fixes for an alert.',
    parameters: obj({ alert: str('Alert name, e.g. ReplicaLagHigh') }, ['alert']),
    run(store, { alert }) {
      const rules = store.alerts.rules ?? [];
      requireKnown(alert, rules.map(r => r.name), 'alert');
      const rule = rules.find(r => r.name === alert);
      return { alert, rule: rule.rule, severity: rule.severity, runbook: store.runbooks[alert] ?? 'No runbook is written for this alert yet.' };
    },
  },
  {
    name: 'past_incidents',
    description: '"This happened before. Last time it was X." Searches past incident write-ups by text.',
    parameters: obj({ query: str('Words to search, e.g. "replica lag"') }, ['query']),
    run(store, { query }) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = store.incidents.filter(i => words.some(w => JSON.stringify(i).toLowerCase().includes(w)));
      return { query, matches: hits.slice(0, 5), note: store.incidents.length ? undefined : 'No past incidents are recorded.' };
    },
  },
];

/** Prompt text: today's tools, grouped. */
export function describeTools() {
  return Object.entries(TOOL_GROUPS).map(([group, names]) => `- ${group}: ${names.join(', ')}`).join('\n');
}
