// Fault: at 10:38 marketing turns on the winback_campaign job in Notification. It runs at 10:45, 11:15 and 11:45
// and sends thousands of emails with the API key sg_main, the same key as the order emails. The provider allows
// 600 requests/min per key and returns 429 for the rest. Order emails fail (2 retries, then the DLQ).
// Evidence by source:
//   alerts and email metrics: bursts at :45 and :15, with normal values between the runs
//   provider health / metric:  email requests go from about 60 to over 1,000 per minute in a run
//   Notification logs:         "429 Too Many Requests: rate limit of 600 requests/min exceeded for API key sg_main"
//   Notification logs:         job=winback_campaign (run started, throttled, run finished)
//   changes:                   config change at 10:38 by marketing
//   DLQ and KPIs:              about 420 DLQ messages with 429 (1 to 5 with 550), email failures, checkout normal
// Each check reads what the tool results show, in any order of discovery.
const NOW = Date.parse('2026-11-20T12:00:00Z');
const RUN_START = Date.parse('2026-11-20T10:45:00Z');
const RUN_END = Date.parse('2026-11-20T11:59:00Z');
const NORMAL_PATH = 14;                               // calls of an agent that follows its prompt
const FULL_UP_TO = 2.5 * NORMAL_PATH;
const ZERO_AT = 4 * NORMAL_PATH;

const ok = call => !call.error && call.result != null;
const text = call => JSON.stringify(call.result ?? '');
const metricOf = c => c.args?.name ?? c.args?.metric;
// The tool window. A call without from/to uses the last hour before "to".
function win(args = {}) {
  const to = args.to ? Date.parse(args.to) : NOW;
  const from = args.from ? Date.parse(args.from) : to - 3_600_000;
  return { from, to };
}
const overlapsRuns = w => w.from < RUN_END && w.to > RUN_START;

// All log rows in a result, wherever the tool puts them.
function logRows(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => logRows(v, out));
  else if (value && typeof value === 'object') {
    if (typeof value.msg === 'string' && typeof value.ts === 'string') out.push(value);
    Object.values(value).forEach(v => logRows(v, out));
  }
  return out;
}

// The metrics that show the fault by minute: failed emails and the email provider requests and errors.
// A group metric counts only for the notification group.
const BURST_METRICS = /^(emails_failed_per_min|third_party_error_rate|third_party_requests_per_min|kafka_dlq_size)$/;
const rightSeries = c => {
  const name = metricOf(c) ?? '';
  if (!BURST_METRICS.test(name)) return false;
  if (/^third_party_/.test(name)) return c.args?.labels?.provider === 'email';
  if (name === 'kafka_dlq_size') return c.args?.labels?.group === 'notification';
  return true;
};
// The result of a query_metric call shows separate bursts: two or more high stretches (above half of the
// maximum) with a low point (under a quarter of the maximum) between them.
function showsSeparateBursts(result) {
  const points = (result.points ?? []).map(p => p.value);
  const max = result.max ?? Math.max(0, ...points);
  if (!(max > 0) || points.length < 3) return false;
  let bursts = 0;
  let inBurst = false;
  let lowSeen = true;
  for (const v of points) {
    if (v > max / 2) {
      if (!inBurst && lowSeen) bursts++;
      inBurst = true;
      lowSeen = false;
    } else {
      inBurst = false;
      if (v < max / 4) lowSeen = true;
    }
  }
  return bursts >= 2;
}
// A result with email series: a query without labels gives a list of series.
const emailSeriesMax = c => {
  if (c.result.series) return Math.max(0, ...c.result.series.filter(s => s.labels?.provider === 'email').map(s => s.max ?? 0));
  return c.result.max ?? 0;
};

export default function grade(transcript, { helpers }) {
  const all = helpers.toolCalls(transcript);
  const calls = all.filter(ok);
  const rows = calls.flatMap(c => logRows(c.result));

  // 1. The burst pattern: failures only in runs, normal between them.
  //    1: a metric of the fault whose result shows two separate bursts, or the alert history with two or more
  //    different EmailsFailing alerts. 0.5: one run in a metric of the fault, or a summary that shows failures.
  const wide = calls.some(c => c.tool === 'query_metric' && rightSeries(c) && overlapsRuns(win(c.args))
    && showsSeparateBursts(c.result))
    || calls.some(c => c.tool === 'list_alerts'
      && new Set((c.result.matches ?? []).filter(a => a.name === 'EmailsFailing').map(a => a.fired_at)).size >= 2);
  const narrow = calls.some(c => (c.tool === 'query_metric' && rightSeries(c) && overlapsRuns(win(c.args)) && (c.result.max ?? 0) > 0)
    || (c.tool === 'third_party_health' && c.args?.provider === 'email' && overlapsRuns(win(c.args))
      && c.result.metrics?.third_party_error_rate?.max > 20)
    || (c.tool === 'business_kpis' && overlapsRuns(win(c.args?.window ?? c.args))
      && c.result.metrics?.emails_failed_per_min?.max > 100)
    || (c.tool === 'kafka_lag' && overlapsRuns(win(c.args)) && c.result.groups?.some(g => g.dlq_size?.max > 100)));
  const pattern = wide ? 1 : narrow ? 0.5 : 0;

  // 2. The request volume: email requests rise above 1,000 per minute in a run. A normal minute has about 60.
  //    A query without labels counts when its result has the email series.
  const volume = calls.some(c => {
    if (c.tool === 'query_metric') return metricOf(c) === 'third_party_requests_per_min'
      && (!c.args?.labels?.provider || c.args.labels.provider === 'email')
      && overlapsRuns(win(c.args)) && emailSeriesMax(c) > 1000;
    if (c.tool === 'compare_windows') return metricOf(c) === 'third_party_requests_per_min' && c.args?.labels?.provider === 'email'
      && Math.max(c.result.a?.max ?? 0, c.result.b?.max ?? 0) > 1000;
    if (c.tool === 'third_party_health') return c.args?.provider === 'email' && c.result.metrics?.third_party_requests_per_min?.max > 1000;
    return false;
  });

  // 3. The error: 429 with the rate limit and the key. One result that only shows 429 gives half.
  const quota = calls.some(c => /rate limit of 600 requests\/min exceeded for API key sg_main/.test(text(c)));
  const only429 = calls.some(c => /429 too many requests|email failed \(429\)/i.test(text(c)));
  const quotaScore = quota ? 1 : only429 ? 0.5 : 0;

  // 4. The job: log rows of winback_campaign that show its runs or its throttling.
  const job = rows.filter(r => r.job === 'winback_campaign');
  const jobRuns = job.some(r => /run started|throttled|run finished/.test(r.msg));
  const jobScore = jobRuns ? 1 : job.length ? 0.5 : 0;

  // 5. The trigger: the config change at 10:38 in the changes list (or as the last change before the window).
  //    The "config reloaded" log row at 10:38 shows the same step and gives half.
  const change = calls.some(c => c.tool === 'list_changes' && [...(c.result.changes ?? []), c.result.last_change_before_window]
    .some(e => e && e.type === 'config' && /winback/i.test(e.summary ?? '')));
  const reloaded = job.some(r => /config reloaded/.test(r.msg) && r.enabled === true);
  const triggerScore = change ? 1 : reloaded ? 0.5 : 0;

  // 6. The failed order emails: the DLQ messages with their errors, or the DLQ size.
  //    A DLQ read of one topic or one run has 70 to 180 messages with 429. A smaller sample (a short window) has
  //    10 or more, so the limit is 10.
  const dlqErrors = calls.some(c => c.tool === 'dlq_sample'
    && Object.entries(c.result.by_error ?? {}).some(([e, n]) => /^429/.test(e) && n >= 10));
  const dlqOther = calls.some(c => (c.tool === 'kafka_lag' && c.result.groups?.some(g => g.dlq_size?.max >= 100))
    || rows.some(r => /moved to DLQ/.test(r.msg) && /^429/.test(r.error ?? '')));
  const dlqScore = dlqErrors ? 1 : dlqOther ? 0.5 : 0;

  // 7. The customer impact: the KPIs in the runs, or the timeline of an order whose email got 429.
  const impact = calls.some(c => (c.tool === 'business_kpis' && overlapsRuns(win(c.args?.window ?? c.args)))
    || (c.tool === 'get_order_timeline' && /email failed \(429\)/.test(text(c))));

  // Efficiency counts only when the run finds the cause: the job rows or the 10:38 change. A run that never
  // finds them gets 0, however few calls it makes. A repeated call counts as 3 calls.
  const seen = new Set();
  let n = 0;
  for (const c of all) {
    const key = `${c.tool} ${JSON.stringify(c.args ?? {})}`;
    n += seen.has(key) ? 3 : 1;
    seen.add(key);
  }
  const foundCause = job.length > 0 || change;
  const efficiency = !foundCause ? 0 : n <= FULL_UP_TO ? 1 : Math.max(0, (ZERO_AT - n) / (ZERO_AT - FULL_UP_TO));

  return {
    checked_burst_pattern: pattern,
    checked_request_volume: volume ? 1 : 0,
    found_429_quota_error: quotaScore,
    found_winback_job_runs: jobScore,
    found_trigger_change: triggerScore,
    checked_dlq_errors: dlqScore,
    checked_order_impact: impact ? 1 : 0,
    efficiency: Math.round(efficiency * 100) / 100,
  };
}
