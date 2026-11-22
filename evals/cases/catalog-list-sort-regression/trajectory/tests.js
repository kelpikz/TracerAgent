const START = Date.parse('2026-11-20T11:12:00Z');
const LATE = Date.parse('2026-11-20T11:50:00Z');
const NOW = Date.parse('2026-11-20T12:00:00Z');
const NORMAL_CALLS = 11;

function overlaps(args, start) {
  const end = args?.to ? Date.parse(args.to) : NOW;
  const from = args?.from ? Date.parse(args.from) : end - 3_600_000;
  return end >= start && from < NOW;
}

export default function grade(transcript, { helpers }) {
  const all = helpers.toolCalls(transcript);
  const repeated = all.length - new Set(all.map(({ tool, args }) => JSON.stringify([tool, args]))).size;
  const calls = all.filter(call => !call.error && call.result != null);
  const shows = pattern => calls.some(call => pattern.test(JSON.stringify(call.result)));
  const metricCalls = calls.filter(call => ['query_metric', 'compare_windows'].includes(call.tool));
  const metric = call => call.args.name ?? call.args.metric;
  const hasWindow = (call, start) => (call.tool === 'compare_windows' ? [call.args.a, call.args.b] : [call.args])
    .some(args => overlaps(args, start));
  const elevated = result => result.max > 200 || [result.a, result.b].some(window => window?.max > 200);
  const serviceLatency = call => (['gateway', 'catalog'].includes(call.result.labels?.service) && elevated(call.result))
    || call.result.series?.some(row => ['gateway', 'catalog'].includes(row.labels.service) && row.max > 200);
  const listRows = calls.flatMap(call => call.result.endpoints ?? []);
  const shape = listRows.some(row => row.route === 'GET /products' && row.p95_ms > 200)
    || metricCalls.some(call => hasWindow(call, START) && metric(call) === 'http_latency_p95_ms' && serviceLatency(call))
    || calls.some(call => hasWindow(call, START) && call.tool === 'get_service_health'
      && ['gateway', 'catalog'].includes(call.args.service) && call.result.signals?.http_latency_p95_ms?.max > 200);
  const replicaSort = calls.some(call => call.tool === 'get_trace' && call.result.spans?.some(span =>
    span.service === 'catalog' && span.attrs?.db === 'catalog-replica' && span.duration_ms > 200
    && /supplier_rank|top-N heapsort/.test(`${span.attrs.order_by} ${span.attrs.plan}`)));
  const rollout = shows(/Product listing merchandising rollout|product list settings loaded/i);
  const databaseLatency = calls.some(call => hasWindow(call, START) && call.tool === 'db_health'
    && call.result.db === 'catalog' && call.result.metrics?.pg_query_p95_ms?.max > 200);
  const scope = calls.some(call => hasWindow(call, START) && call.tool === 'business_kpis' && call.result.checkout_success_pct > 90)
    || metricCalls.some(call => hasWindow(call, START) && (
      (metric(call) === 'catalog_product_page_p95_ms' && call.result.max < 100 && call.result.points?.length >= 2)
      || (/^(?:checkout_success_rate|payment_success_rate|catalog_stock_reserve_failures_per_min)$/.test(metric(call))
        && (call.result.points?.length >= 2 || [call.result.a?.max, call.result.b?.max].every(Number.isFinite)))))
    || (listRows.some(row => row.route === 'GET /products' && row.p95_ms > 200)
      && listRows.some(row => row.route === 'GET /products/:id' && row.errors === 0 && row.p95_ms < 100));
  const ongoing = calls.some(({ result }) => (result.matches ?? []).some(alert => alert.name === 'ServiceLatencyHigh'
    && alert.resolved_at === null && /service=(?:gateway|catalog)}/.test(alert.summary)))
    || metricCalls.some(call => hasWindow(call, LATE) && metric(call) === 'http_latency_p95_ms' && serviceLatency(call)
      && (call.result.last > 200 || call.result.series?.some(row => ['gateway', 'catalog'].includes(row.labels.service) && row.last > 200)
        || [call.result.a, call.result.b].some(window => Date.parse(window?.from) >= LATE && window.avg > 200)))
    || calls.some(call => hasWindow(call, LATE) && call.tool === 'get_service_health'
      && ['gateway', 'catalog'].includes(call.args.service) && call.result.signals?.http_latency_p95_ms?.last > 200)
    || calls.some(call => call.tool === 'top_endpoints' && Date.parse(call.args.from) >= LATE && hasWindow(call, LATE)
      && (call.result.endpoints ?? []).some(row => row.route === 'GET /products' && row.p95_ms > 200));
  return {
    checked_latency: shape ? 1 : databaseLatency ? 0.5 : 0,
    checked_slow_replica_sort: Number(replicaSort),
    checked_rollout: Number(rollout),
    checked_impact_scope: Number(scope),
    checked_ongoing_latency: Number(ongoing),
    efficiency: replicaSort && rollout && repeated <= 6
      ? Math.max(0, Math.min(repeated <= 2 ? 1 : 0.5, (4 * NORMAL_CALLS - all.length) / (1.5 * NORMAL_CALLS))) : 0,
  };
}
