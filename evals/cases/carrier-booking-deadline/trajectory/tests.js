const START = Date.parse('2026-11-20T08:42:00Z');
const RESTORE = Date.parse('2026-11-20T09:10:00Z');
const DRAINED = Date.parse('2026-11-20T09:22:00Z');
const NOW = Date.parse('2026-11-20T12:00:00Z');
const NORMAL_CALLS = 11;

function overlaps(args, from, to) {
  const end = args?.to ? Date.parse(args.to) : NOW;
  const start = args?.from ? Date.parse(args.from) : end - 3_600_000;
  return start < to && end >= from;
}

export default function grade(transcript, { helpers }) {
  const all = helpers.toolCalls(transcript);
  const repeated = all.length - new Set(all.map(({ tool, args }) => JSON.stringify([tool, args]))).size;
  const calls = all.filter(call => !call.error && call.result != null);
  const logs = calls.flatMap(({ result }) => (result.samples ?? result.logs ?? result.error_log_samples
    ?? result.patterns?.map(row => row.example) ?? []));
  const incidentTime = value => Date.parse(value) >= START && Date.parse(value) < RESTORE;
  const windows = call => call.tool === 'compare_windows' ? [call.args.a, call.args.b] : [call.args];
  const during = call => windows(call).some(args => overlaps(args, START, RESTORE));
  const faultAlert = alert => alert.name === 'ThirdPartyErrors' && /provider=carrier}/.test(alert.summary) && incidentTime(alert.fired_at);
  const alerts = calls.flatMap(({ result }) => result.matches ?? []).filter(faultAlert);
  const peakInFault = result => result?.max > 5 && incidentTime(result.max_at);
  const provider = alerts.length > 0 || calls.some(call => {
    if (call.tool === 'third_party_health' && call.result.provider === 'carrier') {
      return peakInFault(call.result.metrics?.third_party_error_rate);
    }
    if ((call.args.name ?? call.args.metric) !== 'third_party_error_rate') return false;
    return (call.result.labels?.provider === 'carrier' && (peakInFault(call.result)
      || [call.result.a, call.result.b].some(window => incidentTime(window?.from) && window.max > 5)))
      || call.result.series?.some(row => row.labels.provider === 'carrier' && peakInFault(row));
  });
  const cancels = logs.some(row => row.service === 'delivery' && row.response_received === false
    && incidentTime(row.ts) && row.target === 'carrier')
    || calls.some(({ result }) => (incidentTime(result.start) && result.spans?.some(span => span.service === 'delivery'
      && span.name === 'carrier POST /shipments' && span.status === 'error' && /client context deadline/i.test(span.attrs?.error)))
      || result.traces?.some(row => incidentTime(row.start) && /delivery: carrier POST \/shipments.*client context deadline/i.test(row.failed_span)));
  const deadline = logs.some(row => row.service === 'delivery' && row.operation === 'POST /shipments'
    && row.booking_deadline_ms === 450 && incidentTime(row.ts));
  const rollout = calls.some(({ result }) => [...(result.changes ?? []), result.last_change_before_window].some(event =>
    event?.service === 'delivery' && incidentTime(event.ts) && /Apply regional carrier client profile/i.test(event.summary)));
  const delayedOrder = ({ result }) => (result.timeline ?? []).some(row => /booking timed out/i.test(row.event));
  const retried = logs.some(row => row.service === 'delivery' && row.msg === 'carrier booked after retry'
    && Date.parse(row.ts) >= RESTORE && Date.parse(row.ts) <= DRAINED);
  const drained = logs.some(row => row.service === 'delivery' && row.msg === 'carrier booking retry queue drained'
    && Date.parse(row.ts) >= RESTORE && row.pending === 0 && row.retried > 0);
  const effect = calls.some(delayedOrder) || retried || drained
    || calls.some(call => during(call) && call.tool === 'compare_windows' && call.result.labels?.topic === 'delivery.updated'
      && [[call.result.a, call.result.b], [call.result.b, call.result.a]].some(([fault, after]) =>
        incidentTime(fault?.from) && Date.parse(after?.from) >= RESTORE && fault.avg < after.avg));
  const clear = alerts.some(alert => Date.parse(alert.resolved_at) === RESTORE)
    || calls.some(({ tool, result }) => tool === 'third_party_health' && result.provider === 'carrier'
      && Date.parse(result.window?.from) >= RESTORE && result.metrics?.third_party_error_rate?.avg < 5);
  const recoveryMetric = calls.some(call => call.tool === 'compare_windows' && call.result.labels?.provider === 'carrier'
    && (call.args.metric === 'third_party_error_rate') && during(call)
    && [call.result.a, call.result.b].some(window => Date.parse(window?.from) >= DRAINED && window.avg < 5));
  const sampleRecovered = retried || calls.some(call => delayedOrder(call)
    && call.result.timeline.some(row => /booked after retry/i.test(row.event)));
  return {
    checked_carrier_symptom: Number(provider),
    checked_client_abort: Number(cancels),
    checked_profile: deadline ? 1 : rollout ? 0.5 : 0,
    checked_booking_impact: Number(effect),
    checked_recovery: ((clear || recoveryMetric ? 1 : 0) + (drained ? 1 : sampleRecovered ? 0.5 : 0)) / 2,
    efficiency: cancels && deadline && repeated <= 6
      ? Math.max(0, Math.min(repeated <= 2 ? 1 : 0.5, (4 * NORMAL_CALLS - all.length) / (1.5 * NORMAL_CALLS))) : 0,
  };
}
