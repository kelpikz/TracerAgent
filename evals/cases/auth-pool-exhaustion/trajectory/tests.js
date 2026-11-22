const START = '2026-11-20T10:34:00Z';
const END = '2026-11-20T10:56:00Z';
const NOW = '2026-11-20T12:00:00Z';
const NORMAL_CALLS = 11;
const AUTH_ROUTE = /POST \/auth\/(login|refresh|signup)/i;

function covers(args, from, to) {
  const end = Date.parse(args?.to ?? NOW);
  const start = args?.from ? Date.parse(args.from) : end - 3_600_000;
  return start <= Date.parse(to) && end >= Date.parse(from);
}

export default function grade(transcript, { helpers }) {
  const all = helpers.toolCalls(transcript);
  const repeated = all.length - new Set(all.map(({ tool, args }) => JSON.stringify([tool, args]))).size;
  const calls = all.filter(call => !call.error && call.result != null);
  const shows = pattern => calls.some(call => pattern.test(JSON.stringify(call.result)));
  const during = call => (call.tool === 'compare_windows' ? [call.args.a, call.args.b] : [call.args])
    .some(args => covers(args, START, '2026-11-20T10:55:59Z'));
  const metric = call => call.args.name ?? call.args.metric;
  const metrics = calls.filter(call => ['query_metric', 'compare_windows'].includes(call.tool));
  const highError = result => result.max > 2 || [result.a, result.b].some(window => window?.max > 2);
  const authErrors = calls.some(({ result }) => (result.endpoints ?? []).some(row => AUTH_ROUTE.test(row.route) && row.errors > 0))
    || shows(/users pool acquire (?:timed out|timeout)/i)
    || calls.some(({ result }) => (result.samples ?? []).some(row => AUTH_ROUTE.test(row.route) && row.status === 503)
      || (result.traces ?? []).some(row => AUTH_ROUTE.test(row.root) && row.http_status === 503)
      || (AUTH_ROUTE.test(result.root) && result.http_status === 503))
    || calls.some(call => during(call) && call.tool === 'get_service_health' && call.args.service === 'auth'
      && call.result.signals?.http_error_rate?.max > 2)
    || metrics.some(call => during(call) && metric(call) === 'http_error_rate' &&
      ((call.result.labels?.service === 'auth' && highError(call.result))
        || call.result.series?.some(row => row.labels.service === 'auth' && highError(row))));
  const wait = shows(/users pool acquire|acquire timeout/i);
  const setting = shows(/"max_connections"\s*:\s*2\b[^}]*"session_listener_connections"\s*:\s*2\b/i);
  const rollout = shows(/Apply session settings to Auth canary/i);
  const database = calls.some(call => during(call) && call.tool === 'db_health' && call.result.db === 'users'
    && call.result.metrics?.pg_query_p95_ms?.max < 10 && call.result.metrics?.pg_connections_used?.max < 80)
    || metrics.some(call => during(call) && /^pg_(?:up|query_p95_ms|connections_used)$/.test(metric(call)) &&
      ((call.result.labels?.db === 'users' && [call.result.max, call.result.a?.max, call.result.b?.max].some(Number.isFinite))
        || call.result.series?.some(row => row.labels.db === 'users' && Number.isFinite(row.max))));
  const impact = calls.some(call => during(call) && call.tool === 'business_kpis' && call.result.metrics?.auth_login_success_rate?.avg < 70)
    || metrics.some(call => during(call) && /^(?:auth_login_success_rate|auth_token_refresh_errors_per_min|auth_signups_per_min)$/.test(metric(call))
      && [call.result.max, call.result.a?.max, call.result.b?.max].some(Number.isFinite))
    || calls.some(({ result }) => (result.endpoints ?? []).filter(row => AUTH_ROUTE.test(row.route) && row.errors > 0).length >= 2);
  const clear = calls.some(({ result }) => (result.matches ?? []).some(alert => alert.name === 'ServiceErrorRateHigh'
    && Date.parse(alert.resolved_at) === Date.parse(END)))
    || calls.some(({ tool, result }) => tool === 'get_service_health' && result.service === 'auth'
      && Date.parse(result.window?.to) >= Date.parse(END) && result.signals?.http_error_rate?.last < 2)
    || calls.some(({ tool, result }) => tool === 'get_trace' && AUTH_ROUTE.test(result.root)
      && Date.parse(result.start) >= Date.parse(END) && result.http_status < 400
      && result.spans?.some(span => span.service === 'auth' && span.attrs?.pod === 'auth-canary'))
    || metrics.some(call => call.tool === 'compare_windows' && metric(call) === 'http_error_rate'
      && ['auth', 'gateway'].includes(call.result.labels?.service) && during(call)
      && [call.result.a, call.result.b].some(window => Date.parse(window?.from) >= Date.parse(END) && window.max < 2));

  return {
    checked_auth_errors: Number(authErrors),
    checked_pool_wait: Number(wait),
    checked_canary_config: setting ? 1 : rollout ? 0.5 : 0,
    checked_users_postgres: Number(database),
    checked_customer_impact: Number(impact),
    checked_recovery: clear ? 1 : shows(/Revert Auth canary session settings|"max_connections"\s*:\s*12\b/i) ? 0.5 : 0,
    efficiency: wait && setting && repeated <= 6
      ? Math.max(0, Math.min(repeated <= 2 ? 1 : 0.5, (4 * NORMAL_CALLS - all.length) / (1.5 * NORMAL_CALLS))) : 0,
  };
}
