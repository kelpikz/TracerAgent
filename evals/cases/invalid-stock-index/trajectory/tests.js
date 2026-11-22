// Fault: migration 0142 (cron job catalog_migrations, 06:41) leaves the stock index INVALID. Each UPDATE stock
// is slow from then on. At 11:15 the hourly warehouse_stock_sync job starts a large restock in one transaction.
// It holds row locks for about 50 minutes, so checkout stock reservations time out (Catalog 503).
// Evidence by source: the blocking pid is only on the failed trace span, the sync pid is in the cron logs,
// the 06:41 step is in the Catalog DB metrics, and the failed index build is in the cron logs.
// Each check reads what the tool results show, in any order of discovery.
const NOW = Date.parse('2026-11-20T12:00:00Z');
const BREAK = Date.parse('2026-11-20T06:41:00Z');
const RESTOCK = Date.parse('2026-11-20T11:15:00Z');
const NEAR = 10 * 60_000;  // the step must be located to within 10 minutes on each side
const FULL_UP_TO = 10;     // effective calls; the shortest supported path is about 6
const ZERO_AT = 24;
const ROWS_PER_CALL = 100; // a log result with many rows counts as several calls

const ok = call => !call.error && call.result != null;
const text = call => JSON.stringify(call.result ?? '');
const ts = r => Date.parse(r.ts);
const metricOf = c => c.args?.name ?? c.args?.metric;
// The tool window. A call without from/to uses the last hour before "to".
function win(args = {}) {
  const to = args.to ? Date.parse(args.to) : NOW;
  const from = args.from ? Date.parse(args.from) : to - 3_600_000;
  return { from, to };
}

// All log rows in a result, wherever the tool puts them (samples, logs, examples, slow query samples).
function logRows(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => logRows(v, out));
  else if (value && typeof value === 'object') {
    if (typeof value.msg === 'string' && typeof value.ts === 'string') out.push(value);
    Object.values(value).forEach(v => logRows(v, out));
  }
  return out;
}

// Failed stock UPDATE spans from get_trace results: { t, pid } (t = trace start).
function lockedSpans(calls) {
  const out = [];
  for (const c of calls.filter(x => x.tool === 'get_trace')) {
    const t = Date.parse(c.result.start);
    for (const s of c.result.spans ?? []) {
      const a = s.attrs ?? {};
      if (s.name === 'pg UPDATE stock' && a.wait_event === 'Lock:transactionid' && /statement timeout/.test(a.error ?? '')) {
        out.push({ t, pid: a.blocking_pid != null ? String(a.blocking_pid) : null, services: (c.result.spans ?? []).map(x => x.service) });
      }
    }
  }
  return out;
}

export default function grade(transcript, { helpers }) {
  const all = helpers.toolCalls(transcript);
  const calls = all.filter(ok);
  const rows = calls.flatMap(c => logRows(c.result));

  // 1. Customer impact: values inside the fault window that show the drop.
  const late = w => w.from >= RESTOCK - 5 * 60_000 && w.to > RESTOCK + 10 * 60_000;
  const lowPoint = c => (c.result.points ?? []).some(p => Date.parse(p.at) >= RESTOCK && p.value < 90);
  const highPoint = c => (c.result.points ?? []).some(p => Date.parse(p.at) >= RESTOCK && p.value >= 5);
  const shows = c => {
    const r = c.result;
    if (c.tool === 'business_kpis') return late(win(c.args.window ?? c.args)) && r.checkout_success_pct != null && r.checkout_success_pct < 90;
    if (c.tool === 'query_metric' && metricOf(c) === 'checkout_success_rate') return lowPoint(c);
    if (c.tool === 'query_metric' && metricOf(c) === 'catalog_stock_reserve_failures_per_min') return highPoint(c);
    if (c.tool === 'compare_windows' && /^(checkout_success_rate|catalog_stock_reserve_failures_per_min)$/.test(metricOf(c))) {
      const [a, b] = [c.args.a, c.args.b].map(win);
      const [base, fault] = late(a) && !late(b) ? [r.a, r.b] : late(b) && !late(a) ? [r.b, r.a] : [];
      if (!base) return false;
      return metricOf(c) === 'checkout_success_rate' ? fault.avg < base.avg - 10 : fault.avg > base.avg + 3;
    }
    if (['search_logs', 'log_patterns'].includes(c.tool) && win(c.args).to > RESTOCK) {
      // Failure logs only: the Catalog stock failure or the Order checkout failure, with the timeout.
      const fail = /stock reserve failed|checkout failed: catalog/;
      const n = c.tool === 'log_patterns' ? Math.max(0, ...(r.patterns ?? []).filter(p => fail.test(p.pattern)).map(p => p.count))
        : logRows(r).filter(x => fail.test(x.msg) && ts(x) >= RESTOCK).length;
      return n >= 5;
    }
    return false;
  };
  const impactCalls = calls.filter(c => win(c.args?.window ?? c.args ?? {}).to > RESTOCK).filter(c => (c.tool === 'business_kpis' && c.result.checkout_success_pct != null)
    || (['query_metric', 'compare_windows'].includes(c.tool) && /^checkout_|^catalog_stock_reserve/.test(metricOf(c) ?? '')));
  const impactScore = calls.some(shows) ? 1 : impactCalls.length ? 0.5 : 0;

  // 2. The failing hop: one request whose stock UPDATE waited on a row lock and timed out.
  //    The timeout and a lock wait in separate results give half.
  const spans = lockedSpans(calls);
  const sameTrace = calls.some(c => c.tool === 'logs_by_trace' && /"msg":"lock wait"/.test(text(c)) && /statement timeout/.test(text(c)));
  const timeoutSeen = calls.some(c => /stock reserve failed|POST \/stock\/reserve/.test(text(c)) && /statement timeout/.test(text(c)));
  const waitSeen = calls.some(c => /Lock:transactionid|"msg":"lock wait"/.test(text(c)));
  const lateSpans = spans.filter(s => s.t >= RESTOCK);
  const hopScore = lateSpans.length || sameTrace ? 1 : spans.length ? 0.5 : timeoutSeen && waitSeen ? 0.5 : timeoutSeen || waitSeen ? 0.25 : 0;

  // 3. The lock holder: the blocking pid of a failed span after 11:15 equals the pg_pid of the sync run that
  //    started before that request and is still open (a progress line after it). One side alone gives half.
  const starts = rows.filter(r => r.job === 'warehouse_stock_sync' && r.pg_pid != null && /started|progress/.test(r.msg));
  const pidMatch = lateSpans.some(s => s.pid && starts.some(r => String(r.pg_pid) === s.pid && ts(r) <= s.t)
    && starts.some(r => String(r.pg_pid) === s.pid && /progress/.test(r.msg) && ts(r) > s.t));
  const holderScore = pidMatch ? 1 : spans.some(s => s.pid) || starts.some(r => ts(r) >= RESTOCK) ? 0.5 : 0;

  // 5. The root cause: the failed build of the stock index, with the index left invalid.
  const migRows = rows.filter(r => r.job === 'catalog_migrations');
  const build = migRows.find(r => r.result === 'error' && r.index_valid === false && /^0142/.test(r.migration ?? '') && /CREATE INDEX.*stock_sku_warehouse_idx/.test(r.step ?? ''));
  const migrationScore = build ? 1 : migRows.length ? 0.5 : 0;

  // 4. The slowdown starts at 06:41: Catalog DB values from just before and just after 06:41, from any calls,
  //    that show a large step. A point is the worst value of its bucket, so a "before" bucket must end by 06:41.
  const pgSeries = c => c.args?.labels?.db === 'catalog' && /^pg_(query_p95_ms|slow_queries_per_min)$/.test(metricOf(c) ?? '');
  const pts = { before: [], after: [] };
  for (const c of calls.filter(x => pgSeries(x))) {
    const m = metricOf(c);
    if (c.tool === 'query_metric') {
      const step = (c.result.step_s ?? 60) * 1000;
      for (const p of c.result.points ?? []) {
        const t = Date.parse(p.at);
        if (t + step <= BREAK && t + step >= BREAK - NEAR) pts.before.push({ m, v: p.value });
        if (t >= BREAK && t <= BREAK + NEAR) pts.after.push({ m, v: p.value });
      }
    }
    if (c.tool === 'compare_windows') {
      for (const [w, st] of [[win(c.args.a), c.result.a], [win(c.args.b), c.result.b]]) {
        if (w.to <= BREAK + 60_000 && w.to >= BREAK - NEAR && w.from < BREAK) pts.before.push({ m, v: st.avg });
        if (w.from >= BREAK && w.from <= BREAK + NEAR && w.to <= RESTOCK) pts.after.push({ m, v: st.avg });
      }
    }
  }
  const metricStep = ['pg_query_p95_ms', 'pg_slow_queries_per_min'].some(m => {
    const b = pts.before.filter(p => p.m === m).map(p => p.v);
    const a = pts.after.filter(p => p.m === m).map(p => p.v);
    return b.length && a.length && Math.min(...a) > 3 * Math.max(...b, 1);
  });
  // Or the sync run times: the last run that ends before 06:41 and the first run that starts after it,
  // both within an hour of 06:41, with the time per row more than 3 times higher after.
  const done = rows.filter(r => r.job === 'warehouse_stock_sync' && r.duration_s != null && r.rows);
  const perRow = r => r.duration_s / r.rows;
  const runBefore = done.filter(r => ts(r) <= BREAK && ts(r) >= BREAK - 60 * 60_000);
  const runAfter = done.filter(r => ts(r) - r.duration_s * 1000 >= BREAK && ts(r) <= BREAK + 60 * 60_000 + 5 * 60_000);
  const syncStep = runBefore.length && runAfter.length && Math.min(...runAfter.map(perRow)) > 3 * Math.max(...runBefore.map(perRow));
  // Or db_health for catalog says the p95 or slow queries are high since 06:41.
  const sinceStep = calls.some(c => c.tool === 'db_health' && c.args?.db === 'catalog'
    && ['pg_query_p95_ms', 'pg_slow_queries_per_min'].some(m => {
      const t = Date.parse(c.result.metrics?.[m]?.high_since ?? '');
      return Math.abs(t - BREAK) <= 3 * 60_000;
    }));
  const step = metricStep || syncStep || sinceStep;
  const slowBeforeRestock = done.some(r => ts(r) > BREAK && ts(r) < RESTOCK && r.duration_s > 30)
    || calls.some(c => pgSeries(c) && c.tool === 'query_metric' && (c.result.points ?? []).some(p => Date.parse(p.at) > BREAK && Date.parse(p.at) < RESTOCK - 30 * 60_000 && p.value > 30));
  // Full credit only when the run also finds what changed at the step (the failed build).
  const latentScore = step && build ? 1 : step || slowBeforeRestock ? 0.5 : 0;

  // 6. The join: the failed build happened at the measured step.
  const joinScore = build && step && Math.abs(ts(build) - BREAK) < 3 * 60_000 ? 1 : 0;

  // 7. The boundary: a failed checkout stops before Payment (trace without payment, or order timeline).
  const beforePayment = lateSpans.some(s => !s.services.includes('payment'))
    || calls.some(c => c.tool === 'find_traces' && (c.result.traces ?? []).some(t => Date.parse(t.start) >= RESTOCK
      && t.http_status === 503 && /checkout/.test(t.root) && t.services.includes('catalog') && !t.services.includes('payment')))
    || calls.some(c => c.tool === 'get_order_timeline' && /CHECKOUT_FAILED/.test(text(c)) && !/payment intent created/.test(text(c)));

  // Efficiency counts only when the run proves the main links. A repeated call counts as four calls, and a log result
  // with many rows counts as several calls.
  const seen = new Set();
  let n = 0;
  for (const c of all) {
    const key = `${c.tool} ${JSON.stringify(c.args ?? {})}`;
    n += seen.has(key) ? 4 : 1;
    seen.add(key);
    if (c.tool === 'search_logs' && ok(c)) n += Math.floor((c.result.shown ?? 0) / ROWS_PER_CALL);
  }
  const proven = build && pidMatch && hopScore === 1 && step;
  const efficiency = !proven ? 0 : n <= FULL_UP_TO ? 1 : Math.max(0, (ZERO_AT - n) / (ZERO_AT - FULL_UP_TO));

  return {
    checked_checkout_impact: impactScore,
    found_lock_wait_timeout: hopScore,
    matched_lock_holder: holderScore,
    found_slowdown_at_0641: latentScore,
    found_failed_index_build: migrationScore,
    matched_build_to_slowdown: joinScore,
    checked_failure_before_payment: beforePayment ? 1 : 0,
    efficiency: Math.round(efficiency * 100) / 100,
  };
}
