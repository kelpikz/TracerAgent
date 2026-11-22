// Fault: at 08:20 the cart Redis moves to a smaller instance (maxmemory 640 MB, noeviction). Memory reaches the
// limit at 11:10, Redis rejects writes, and POST /cart/items returns 500. The page is at 11:15.
// Evidence by source: the 08:20 move is in list_changes, the 640 MB limit is in the cart log "redis connected",
// the OOM error is in cart logs and on the failed trace span, the flat memory is in the Redis metrics.
// Each check reads what the tool results show, in any order of discovery.
const NOW = Date.parse('2026-11-20T12:00:00Z');
const MOVE = Date.parse('2026-11-20T08:20:00Z');
const FULL = Date.parse('2026-11-20T11:10:00Z'); // Redis memory reaches 640 MB, writes fail from here
const BEFORE = Date.parse('2026-11-20T10:50:00Z'); // the checkout comparison needs time before the fault (baseline 10:30 to 11:10)
const NORMAL_PATH = 16;                          // calls of a thorough agent that follows its prompt (minimum: 7)
const FULL_UP_TO = 2.5 * NORMAL_PATH;
const ZERO_AT = 4 * NORMAL_PATH;

const ok = call => !call.error && call.result != null;
const text = call => JSON.stringify(call.result ?? '');
const metricOf = call => call.args?.name ?? call.args?.metric;
const cartLabel = call => call.args?.labels?.service === 'cart';

// Tool windows. A call without from/to uses the last hour before "to" (the default "to" is now).
function win(args = {}) {
  const to = args.to ? Date.parse(args.to) : NOW;
  const from = args.from ? Date.parse(args.from) : to - 3_600_000;
  return { from, to };
}
// compare_windows has two windows (a and b).
function windows(call) {
  if (call.tool === 'compare_windows') return [win(call.args?.a), win(call.args?.b)];
  return [win(call.args)];
}
const overlaps = (w, from, to) => w.from <= to && w.to >= from;
// 1: a window reaches the fault period (11:10 to now). 0.5: a window reaches only the lead-up (08:20 to 11:10).
function windowScore(call, partial = false) {
  const ws = windows(call);
  if (ws.some(w => overlaps(w, FULL, NOW))) return 1;
  if (partial && ws.some(w => overlaps(w, MOVE, FULL))) return 0.5;
  return 0;
}
// Impact: 1 needs a comparison with the time before 11:10 (a window that reaches back to 10:50 or earlier, plus a
// window in the fault period). 0.5: only a window in the fault period (no comparison).
function compareScore(call) {
  const ws = windows(call);
  const fault = ws.some(w => overlaps(w, FULL, NOW));
  const before = ws.some(w => w.from <= BEFORE && w.to > BEFORE);
  return fault && before ? 1 : fault ? 0.5 : 0;
}
function best(calls, partial) {
  return calls.reduce((m, call) => Math.max(m, windowScore(call, partial)), 0);
}

export default function grade(transcript, { helpers }) {
  const calls = helpers.toolCalls(transcript).filter(ok);
  const named = name => calls.filter(c => c.tool === name);
  const scores = {};

  // Symptom: the cart error rate and the failing route, in the fault period.
  // Accepted: health, top endpoints, traces, cart error logs or log patterns, and the error metrics (cart label,
  // no label at all (the result lists every service), or cart_errors_per_min).
  const shape = calls.filter(c => (c.tool === 'get_service_health' && c.args?.service === 'cart')
    || (c.tool === 'top_endpoints' && c.args?.service === 'cart')
    || (c.tool === 'find_traces' && c.args?.service === 'cart')
    || (['search_logs', 'log_patterns'].includes(c.tool) && c.args?.service === 'cart')
    || (['query_metric', 'compare_windows'].includes(c.tool)
      && ((metricOf(c) === 'http_error_rate' && (cartLabel(c) || !c.args?.labels?.service)) || metricOf(c) === 'cart_errors_per_min')));
  scores.checked_cart_error_shape = best(shape, false);

  // Cause (1): the Redis OOM error. Any tool that shows it counts (cart logs, log patterns, a failed trace span).
  scores.checked_oom_error = calls.some(c => /OOM command not allowed/i.test(text(c))) ? 1 : 0;

  // Cause (2): Redis memory is flat at the limit. 0.5 when the window ends before 11:10.
  const memory = calls.filter(c => (c.tool === 'db_health' && c.args?.db === 'redis')
    || (['query_metric', 'compare_windows'].includes(c.tool) && metricOf(c) === 'redis_memory_used_mb'));
  scores.checked_redis_memory = best(memory, true);

  // Trigger (1): the 08:20 move of the cart Redis. Two sources count:
  //  - a list_changes window that contains 08:20 (the move is in `changes`; `last_change_before_window` alone does
  //    not count, because a window that starts after 08:20 does not show the change in the list), or
  //  - the cart "redis connection lost" / "redis connected" log lines of 08:20.
  const isMove = e => e && Date.parse(e.ts) === MOVE && /redis/i.test(e.summary ?? '');
  const moveInChanges = named('list_changes').some(c => (c.result?.changes ?? []).some(isMove));
  const moveInLogs = calls.some(c => ['search_logs', 'log_patterns'].includes(c.tool)
    && /redis connected|redis connection lost/i.test(text(c)));
  scores.checked_redis_move_change = moveInChanges || moveInLogs ? 1 : 0;

  // Trigger (2): the maxmemory value of the new instance, in the "redis connected" log of the cart pods.
  scores.checked_maxmemory_setting = calls.some(c => /"maxmemory_mb":\s*640(?!\d)/.test(text(c))) ? 1 : 0;

  // Impact: checkout attempts or success in the fault period.
  const checkout = calls.filter(c => c.tool === 'business_kpis'
    || (['query_metric', 'compare_windows'].includes(c.tool)
      && ['checkout_attempts_per_min', 'checkout_success_rate', 'payment_success_rate'].includes(metricOf(c))));
  scores.checked_checkout_impact = checkout.reduce((m, c) => Math.max(m, compareScore(c)), 0);

  // Efficiency (write-graders.md): full credit up to 2.5 times the normal path, zero at 4 times.
  // The count is loose: it does not separate normal calls from unrelated calls, so the judge grades the waste.
  // A run that never finds the cause (no trigger evidence) gets 0: it did not use the calls to find it.
  const n = helpers.toolCalls(transcript).length;
  const foundCause = scores.checked_redis_move_change || scores.checked_maxmemory_setting;
  scores.efficiency = !foundCause ? 0
    : n <= FULL_UP_TO ? 1
      : n >= ZERO_AT ? 0
        : Math.round(((ZERO_AT - n) / (ZERO_AT - FULL_UP_TO)) * 100) / 100;

  return scores;
}
