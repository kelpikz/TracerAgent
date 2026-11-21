const importStart = Date.parse('2026-11-20T00:30:00Z');
const lagPeak = Date.parse('2026-11-20T00:36:00Z');
const lagRecovery = Date.parse('2026-11-20T00:44:00Z');

function covers({ from, to }, start, end) {
  return Date.parse(from) <= start && Date.parse(to) >= end;
}

export default function grade(transcript, { helpers }) {
  const { indexOfTool, toolCalls } = helpers;
  const lagMetric = args => args.name === 'pg_replication_lag_s' && args.labels?.db === 'catalog';
  const dbIndex = indexOfTool(transcript, 'db_health', { db: 'catalog' });
  const metricIndex = indexOfTool(transcript, 'query_metric', lagMetric);
  const lagChecks = [dbIndex, metricIndex].filter(index => index >= 0);
  const lagWindow = indexOfTool(transcript, 'query_metric', args =>
    lagMetric(args) && covers(args, lagPeak, lagRecovery));
  const cronIndex = indexOfTool(transcript, 'search_logs', args =>
    args.service === 'cron' && covers(args, importStart, lagPeak));
  const changesIndex = indexOfTool(transcript, 'list_changes', args =>
    (!args.service || args.service === 'catalog') && covers(args, importStart, lagPeak));
  const kpiIndex = indexOfTool(transcript, 'business_kpis', args =>
    covers(args.window ?? args, importStart, lagPeak));
  const checkoutIndex = indexOfTool(transcript, 'query_metric', args =>
    args.name === 'checkout_success_rate' && covers(args, importStart, lagPeak));
  const impactChecks = [kpiIndex, checkoutIndex].filter(index => index >= 0);
  const broaderCheck = toolCalls(transcript, 'business_kpis').length > 0
    || toolCalls(transcript, 'query_metric').some(call => call.args?.name === 'checkout_success_rate');
  return {
    checked_catalog_replica_lag: lagWindow >= 0 ? 1 : lagChecks.length ? 0.5 : 0,
    checked_import_window: cronIndex >= 0 ? 1 : changesIndex >= 0 ? 0.5 : 0,
    checked_checkout_impact: impactChecks.length ? 1 : broaderCheck ? 0.5 : 0,
    used_evidence_in_order: lagChecks.some(index => index < cronIndex)
      && impactChecks.some(index => index > cronIndex)
      ? 1 : lagChecks.length && (cronIndex >= 0 || impactChecks.length) ? 0.5 : 0,
  };
}
