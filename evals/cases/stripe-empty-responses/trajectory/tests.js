// Fault: Stripe is slow and sends empty HTTP 200 responses from 11:20. Payment fails to parse them.
// False lead: the Order v4.12.0 deploy at 11:16.
const NOW = Date.parse('2026-11-20T12:00:00Z');
const FAULT = Date.parse('2026-11-20T11:20:00Z');
// A normal path is about 12 calls: the agent prompt asks for changes, cron logs, KPIs and an "is it over" check,
// and most tools look at one service at a time (Order and Payment each need a call).
const MIN_PATH = 12;

// The tool window. A call without from/to uses the last hour before "to".
function win(args = {}) {
  const to = args.to ? Date.parse(args.to) : NOW;
  const from = args.from ? Date.parse(args.from) : to - 3_600_000;
  return { from, to };
}
const seesStep = w => w.from <= FAULT && w.to > FAULT + 120_000; // before and after the start
const inFault = w => w.to > FAULT && w.from < NOW;
const ok = call => !call.error && call.result != null;
const text = call => JSON.stringify(call.result ?? '');
const PARSE = /failed to parse stripe response/;

export default function grade(transcript, { helpers }) {
  const calls = helpers.toolCalls(transcript).filter(ok);

  // 1. Customer impact: checkout success in the fault window.
  const impact = calls.filter(c => c.tool === 'business_kpis'
    || (['query_metric', 'compare_windows'].includes(c.tool)
      && /^(checkout_success_rate|payment_success_rate|checkout_attempts_per_min)$/.test(c.args.name ?? c.args.metric)));
  const impactWin = c => (c.tool === 'compare_windows' ? [c.args.a, c.args.b].map(win) : [win(c.args.window ?? c.args)]);
  const impactScore = impact.some(c => impactWin(c).some(inFault)) ? 1 : impact.length ? 0.5 : 0;

  // 2. Stripe latency: the provider is slow, but its error rate is normal.
  const stripeMetric = c => (c.tool === 'third_party_health' && c.args.provider === 'stripe')
    || (['query_metric', 'compare_windows'].includes(c.tool) && c.args.labels?.provider === 'stripe'
      && /^third_party_latency_p9/.test(c.args.name ?? c.args.metric));
  const stripe = calls.filter(stripeMetric);
  const stripeWin = c => (c.tool === 'compare_windows'
    ? [win(c.args.a), win(c.args.b)].some(w => w.to <= FAULT) && [win(c.args.a), win(c.args.b)].some(inFault)
    : seesStep(win(c.args)));
  const slowSpan = calls.some(c => c.tool === 'get_trace'
    && c.result.spans?.some(s => /stripe/.test(s.name) && s.duration_ms > 3000));
  const latencyScore = stripe.some(stripeWin) ? 1 : stripe.some(c => inFault(win(c.args))) || slowSpan ? 0.5 : 0;

  // 3. The empty body: only a trace shows body_bytes=0. The parse error alone gives half.
  const emptySpan = calls.some(c => c.tool === 'get_trace' && /"body_bytes":0\b/.test(text(c)));
  const logTools = ['search_logs', 'log_patterns', 'logs_by_trace', 'get_trace'];
  const parseSeen = calls.some(c => logTools.includes(c.tool) && (PARSE.test(text(c)) || /unexpected end of JSON input/.test(text(c))));
  const parseScore = emptySpan ? 1 : parseSeen ? 0.5 : 0;

  // 4. The deploy: a change query that returns the Order deploy.
  const deploy = calls.filter(c => c.tool === 'list_changes' && /"service":"order"/.test(text(c)) && /v4\.12\.0/.test(text(c)));
  // 5. Proof that the time is in Payment -> Stripe, not in Order: a failed checkout trace from the fault,
  //    or Payment error logs from the fault window.
  //    A log search alone does not show where the time goes.
  const where = calls.filter(c => (c.tool === 'get_trace' && c.result.status === 'error'
      && Date.parse(c.result.start) >= FAULT && c.result.spans?.some(s => s.service === 'payment' && /stripe/.test(s.name)))
    || (c.tool === 'logs_by_trace' && PARSE.test(text(c))));
  const whereScore = where.length ? 1 : 0;

  // 4b. The deploy is checked only when the run also has evidence against it: a failed trace that
  //     shows the time in Payment -> Stripe, or Order endpoints on the new version.
  const orderReads = calls.some(c => c.tool === 'top_endpoints' && c.args.service === 'order' && /GET \/orders/.test(text(c)));
  const deployScore = deploy.length ? (where.length || orderReads ? 1 : 0.5) : 0;

  // Efficiency: full score from 4 calls up to 1.5x the normal path (18), 0 at 3x (36). Fewer than 4 calls
  // cannot cover the impact, the cause and the deploy, so they get 0.
  const n = helpers.toolCalls(transcript).length;
  const found = [impactScore, latencyScore, parseScore, deployScore, whereScore].filter(x => x > 0).length;
  const efficiency = n < 4 || found < 3 ? 0 : n <= MIN_PATH * 1.5 ? 1 : Math.max(0, 1 - (n - MIN_PATH * 1.5) / (MIN_PATH * 1.5));

  return {
    checked_checkout_impact: impactScore,
    checked_stripe_latency: latencyScore,
    found_empty_response: parseScore,
    checked_order_deploy: deployScore,
    located_failing_hop: whereScore,
    efficiency: Math.round(efficiency * 100) / 100,
  };
}
