// Fault: the Order v3.4.0 deploy at 10:48 UTC publishes order.paid with schema_version=2. The Delivery consumer
// cannot parse it, retries the same offset (1854162, order ord_V6WMXG) and books no shipment. Lag for group
// delivery grows from 10:49. KafkaLagHigh fires at 11:33.
// Each check reads what the tool results show. Any tool that shows the fact gets credit.
// Normal path: about 20 calls. Shortest path: 6 calls.
const NOW = Date.parse('2026-11-20T12:00:00Z');
const DEPLOY = Date.parse('2026-11-20T10:48:00Z');
const FAULT_FROM = Date.parse('2026-11-20T10:49:00Z');
const ALERT = Date.parse('2026-11-20T11:33:00Z');
const NEAR_FAULT = Date.parse('2026-11-20T10:30:00Z'); // A window that ends before this misses the fault.
const MIN = 60_000;

const NORMAL_PATH = 20;
const FULL_UP_TO = 2.5 * NORMAL_PATH;
const ZERO_AT = 4 * NORMAL_PATH;

const ok = call => !call.error && call.result != null;
const metricOf = c => c.args?.name ?? c.args?.metric;
// The tool window. A call without from/to uses the last hour before "to".
function win(args = {}) {
  const to = args.to ? Date.parse(args.to) : NOW;
  const from = args.from ? Date.parse(args.from) : to - 3_600_000;
  return { from, to };
}
// Minutes of the window that lie inside [from, to].
const overlap = (w, from, to) => Math.max(0, Math.min(w.to, to) - Math.max(w.from, from)) / MIN;
const inFault = w => overlap(w, NEAR_FAULT, NOW) > 0;
const delivery = c => (c.args?.labels?.group ?? c.args?.group) === 'delivery';
const carrier = c => c.args?.labels?.provider === 'carrier';

// The two windows of a compare_windows call, as { before, after } around the deploy. Null if they do not fit.
function around(c) {
  const [a, b] = [{ ...win(c.args.a), r: c.result.a }, { ...win(c.args.b), r: c.result.b }];
  if (a.to <= DEPLOY + 2 * MIN && b.from >= DEPLOY - MIN) return { before: a, after: b };
  if (b.to <= DEPLOY + 2 * MIN && a.from >= DEPLOY - MIN) return { before: b, after: a };
  return null;
}

// All log rows in a result, wherever the tool puts them.
function logRows(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => logRows(v, out));
  else if (value && typeof value === 'object') {
    if (typeof value.msg === 'string' && typeof value.ts === 'string') out.push(value);
    Object.values(value).forEach(v => logRows(v, out));
  }
  return out;
}
const isParseError = r => r.service === 'delivery' && /cannot unmarshal object/.test(r.error ?? '');

export default function grade(transcript, { helpers }) {
  const all = helpers.toolCalls(transcript);
  const calls = all.filter(ok);

  // 1. The Delivery lag: it starts to grow at 10:49 and is still high at the alert.
  //    Full credit: the window holds the start (10:49) and the alert (11:33). Half: any other window in the fault.
  let lag = 0;
  for (const c of calls) {
    let w = null;
    if (c.tool === 'kafka_lag' && (!c.args.group || c.args.group === 'delivery')) w = win(c.args);
    else if (c.tool === 'query_metric' && metricOf(c) === 'kafka_consumer_lag' && delivery(c)) w = win(c.args);
    else if (c.tool === 'compare_windows' && metricOf(c) === 'kafka_consumer_lag' && delivery(c)) {
      const [a, b] = [win(c.args.a), win(c.args.b)];
      w = { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) };
    }
    if (!w) continue;
    const full = w.from <= FAULT_FROM && w.to >= ALERT;
    lag = Math.max(lag, full ? 1 : overlap(w, FAULT_FROM, NOW) > 0 ? 0.5 : 0);
  }

  // 2. The parse error: a Delivery log row shows the same offset retried with "cannot unmarshal object".
  //    Half: a Delivery log search in the fault that did not show the error.
  const parseSeen = calls.some(c => ['search_logs', 'log_patterns', 'logs_by_trace'].includes(c.tool) && logRows(c.result).some(isParseError));
  const deliveryLogs = calls.some(c => ['search_logs', 'log_patterns'].includes(c.tool) && c.args?.service === 'delivery' && inFault(win(c.args)));
  const parseError = parseSeen ? 1 : deliveryLogs ? 0.5 : 0;

  // 3. The trigger: the Order v3.4.0 deploy at 10:48, from the changes list or from the Order start-up logs.
  //    Half: a changes list or an Order log search in the fault window that did not show the deploy.
  const isDeploy = e => e?.service === 'order' && e?.version === 'v3.4.0';
  const deploySeen = calls.some(c => (c.tool === 'list_changes' && (c.result.changes ?? []).concat(c.result.last_change_before_window ?? []).some(isDeploy))
    || (['search_logs', 'log_patterns'].includes(c.tool) && logRows(c.result).some(r => r.service === 'order' && /order v3\.4\.0/.test(r.msg))));
  const changesLooked = calls.some(c => c.tool === 'list_changes' && inFault(win(c.args)));
  const orderDeploy = deploySeen ? 1 : changesLooked ? 0.5 : 0;

  // 4. The start time matches the deploy: the first failed log is at 10:48, or a metric shows the step at 10:48 to 10:50.
  //    Full credit needs the deploy too. The step alone is half.
  const firstError = calls.some(c => logRows(c.result).some(r => r.service === 'delivery' && r.level === 'error'
    && Date.parse(r.ts) >= DEPLOY && Date.parse(r.ts) <= DEPLOY + 4 * MIN));
  const step = c => {
    const pts = (c.result.points ?? []).map(p => ({ t: Date.parse(p.at), v: p.value }));
    const before = pts.filter(p => p.t >= DEPLOY - 20 * MIN && p.t < DEPLOY);
    const after = pts.filter(p => p.t >= DEPLOY + 2 * MIN && p.t <= DEPLOY + 12 * MIN);
    if (!before.length || !after.length) return false;
    if (metricOf(c) === 'kafka_consumer_lag') return Math.max(...before.map(p => p.v)) <= 10 && Math.max(...after.map(p => p.v)) >= 20;
    const avg = list => list.reduce((s, p) => s + p.v, 0) / list.length;
    return avg(before) >= 15 && avg(after) <= 0.5 * avg(before); // carrier requests per minute
  };
  const compareStep = c => {
    const w = around(c);
    if (!w) return false;
    if (metricOf(c) === 'kafka_consumer_lag') return w.before.r.avg <= 10 && w.after.r.avg >= 20;
    return w.before.r.avg >= 15 && w.after.r.avg <= 0.5 * w.before.r.avg;
  };
  const stepMetric = c => (delivery(c) && metricOf(c) === 'kafka_consumer_lag')
    || (carrier(c) && metricOf(c) === 'third_party_requests_per_min');
  const metricStep = calls.some(c => stepMetric(c)
    && ((c.tool === 'query_metric' && step(c)) || (c.tool === 'compare_windows' && compareStep(c))));
  const link = firstError || metricStep;
  const onset = link && orderDeploy === 1 ? 1 : link || (parseError === 1 && orderDeploy === 1) ? 0.5 : 0;

  // 5. Impact on orders: a paid order after the deploy has no Delivery step (no carrier booking),
  //    or its trace has the v2 publish and no Delivery span. Half: the carrier booking requests are low in the fault,
  //    and the investigation also found the cause (a carrier-only investigation gets 0).
  const noShipment = calls.some(c => c.tool === 'get_order_timeline' && Date.parse(c.result.created_at) >= DEPLOY
    && (c.result.timeline ?? []).some(e => /event published: order\.paid/.test(e.event))
    && !(c.result.timeline ?? []).some(e => e.service === 'delivery'));
  const noShipTrace = calls.some(c => c.tool === 'get_trace'
    && (c.result.spans ?? []).some(s => s.service === 'order' && /publish order\.paid/.test(s.name) && s.attrs?.schema_version === 2)
    && !(c.result.spans ?? []).some(s => s.service === 'delivery'));
  const causeSeen = parseSeen || deploySeen;
  const carrierDrop = causeSeen && calls.some(c => {
    if (c.tool === 'third_party_health' && c.args?.provider === 'carrier') {
      const m = c.result.metrics?.third_party_requests_per_min;
      return m && win(c.args).to >= FAULT_FROM + 10 * MIN && m.last < 0.5 * m.normal;
    }
    if (c.tool === 'query_metric' && carrier(c) && metricOf(c) === 'third_party_requests_per_min') {
      return win(c.args).to >= FAULT_FROM + 10 * MIN && c.result.last < 0.5 * c.result.normal;
    }
    if (c.tool === 'compare_windows' && carrier(c) && metricOf(c) === 'third_party_requests_per_min') {
      const w = around(c);
      return w && w.after.r.avg < 0.5 * w.before.r.avg && overlap(w.after, FAULT_FROM, NOW) >= 10;
    }
    return false;
  });
  const ordersNotShipping = noShipment || noShipTrace ? 1 : carrierDrop ? 0.5 : 0;

  // Credit for a health check by the time that it covers in the fault: 30 minutes or more is 1, less is 0.5.
  const faultCover = c => c.tool === 'compare_windows'
    ? Math.max(overlap(win(c.args.a), FAULT_FROM, NOW), overlap(win(c.args.b), FAULT_FROM, NOW))
    : overlap(win(c.args?.window ?? c.args), FAULT_FROM, NOW);

  // 6. The carrier is healthy: its error rate is normal in the fault window. Latency alone gets 0.
  let carrierOk = 0;
  for (const c of calls) {
    const isCarrier = (c.tool === 'third_party_health' && c.args?.provider === 'carrier' && c.result.metrics?.third_party_error_rate)
      || (['query_metric', 'compare_windows'].includes(c.tool) && carrier(c) && metricOf(c) === 'third_party_error_rate');
    if (!isCarrier) continue;
    const m = faultCover(c);
    carrierOk = Math.max(carrierOk, m >= 30 ? 1 : m > 0 ? 0.5 : 0);
  }

  // 7. Checkout and payment are normal in the fault window. business_kpis shows both. A metric query shows one,
  //    so the credit is the lower of the two.
  const cover = m => (m >= 30 ? 1 : m > 0 ? 0.5 : 0);
  let kpi = 0, checkoutRate = 0, paymentRate = 0;
  for (const c of calls) {
    if (c.tool === 'business_kpis') kpi = Math.max(kpi, cover(faultCover(c)));
    else if (['query_metric', 'compare_windows'].includes(c.tool)) {
      const name = metricOf(c);
      if (name === 'checkout_success_rate') checkoutRate = Math.max(checkoutRate, cover(faultCover(c)));
      if (name === 'payment_success_rate') paymentRate = Math.max(paymentRate, cover(faultCover(c)));
    }
  }
  const checkout = Math.max(kpi, Math.min(checkoutRate, paymentRate));

  // Efficiency (write-graders.md): 1 up to 2.5 times the normal path, then down to 0 at 4 times. Every call counts.
  // An investigation with no cause evidence (the parse error or the Order deploy) gets 0: few calls are not efficient.
  const n = all.length;
  const efficiency = n === 0 || (parseError === 0 && orderDeploy === 0) ? 0 : n <= FULL_UP_TO ? 1 : Math.max(0, (ZERO_AT - n) / (ZERO_AT - FULL_UP_TO));

  return {
    checked_delivery_lag: lag,
    found_delivery_parse_error: parseError,
    found_order_deploy: orderDeploy,
    matched_failure_start_to_deploy: onset,
    showed_orders_not_shipping: ordersNotShipping,
    checked_carrier_healthy: carrierOk,
    checked_checkout_normal: checkout,
    efficiency: Math.round(efficiency * 100) / 100,
  };
}
